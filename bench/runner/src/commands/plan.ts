/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CreateRunRequest } from "@podman-desktop/agent-skills-bench-server-client";
import { zCell } from "@podman-desktop/agent-skills-bench-server-client/zod";
import { parse } from "yaml";
import { z } from "zod";
import { run } from "../exec.ts";
import { CHECK_TITLES } from "../graders/checks.ts";
import { setOutput } from "../github.ts";
import { REPO_ROOT, SKILLS_DIR } from "../paths.ts";
import { ServerClient } from "../server-client.ts";
import { loadEval, loadTask } from "../tasks.ts";

const SkillFrontMatter = z.looseObject({ name: z.string(), metadata: z.looseObject({ version: z.string() }) });

export interface PlanOptions {
  readonly server: string;
  readonly skill: string;
  readonly cells: string;
  readonly trials: number;
  readonly maxUsd: number;
}

/** Registers the run with the server and writes the agent jobs' matrix as a step output. */
export async function plan(options: PlanOptions): Promise<void> {
  const spec = loadEval(options.skill);
  const skillFile = readFileSync(join(SKILLS_DIR, spec.skill, "SKILL.md"), "utf8");
  const frontMatter = SkillFrontMatter.parse(parse(/^---\n([\s\S]*?)\n---/.exec(skillFile)?.[1] ?? ""));
  // The skill's tree: any change to any of its files is a new version of what is measured.
  const tree = await run("git", ["rev-parse", `HEAD:skills/${spec.skill}`], { cwd: REPO_ROOT });
  if (tree.code !== 0) throw new Error(`git rev-parse failed: ${tree.stderr}`);
  const timeouts = spec.tasks.map((id) => loadTask(id).spec.agentTimeoutSec);
  const request: CreateRunRequest = {
    spec,
    skillSha: tree.stdout.trim(),
    skillVersion: frontMatter.metadata.version,
    checkTitles: Object.fromEntries([...spec.targets, ...spec.controls].map((check) => [check, CHECK_TITLES[check] ?? check])),
    cells: z.array(zCell).parse(JSON.parse(options.cells)),
    arms: ["without", "with"],
    trials: options.trials,
    maxUsd: options.maxUsd,
    agentTimeoutMinutes: Math.ceil(Math.max(...timeouts) / 60),
  };
  const created = await new ServerClient(options.server).createRun(request);
  console.log(`run ${created.runId}: ${String(created.shards.length)} shards`);
  setOutput("run-id", created.runId);
  setOutput("matrix", JSON.stringify({ shard: created.shards }));
}
