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

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zShard } from "@podman-desktop/agent-skills-bench-server-client/zod";
import { run, tail } from "../exec.ts";
import { mask } from "../github.ts";
import { agentArgs, harborEnvironment, skillArgs, writeHarborTask } from "../harbor.ts";
import { SKILLS_DIR } from "../paths.ts";
import { ServerClient } from "../server-client.ts";
import { loadEval, loadTask } from "../tasks.ts";

export interface AgentOptions {
  readonly server: string;
  readonly runId: string;
  readonly skill: string;
  readonly shard: string;
  readonly trials: number;
  readonly harbor: string;
  readonly out: string;
}

/** Files Harbor's result.json carries that we keep; the rest (its config) echoes the agent's environment, the key included. */
const KEPT_RESULT_FIELDS = ["agent_result", "exception_info", "agent_execution", "started_at", "finished_at"];
/** Text files larger than this aren't scanned for the key: they aren't published either. */
const MAX_SCANNED_BYTES = 5_000_000;

/**
 * Runs one shard's trials with Harbor, its LLM key minted for the run and revoked as soon as
 * Harbor exits. Writes `<out>/<trial>/{result.json, trajectory.json, app/}` for the grade job.
 */
export async function agent(options: AgentOptions): Promise<void> {
  const shard = zShard.parse(JSON.parse(options.shard));
  const task = loadTask(shard.task);
  const allSkills = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  loadEval(options.skill);
  const tasksDir = mkdtempSync(join(tmpdir(), "bench-tasks-"));
  writeHarborTask(task, tasksDir);
  const jobs = join(tmpdir(), `bench-jobs-${shard.id}`);

  const server = new ServerClient(options.server);
  const key = await server.mintKey(options.runId, shard.id);
  mask(key.key);
  let harbor;
  try {
    harbor = await run(
      options.harbor,
      [
        "run",
        "-e",
        "podman",
        "-p",
        tasksDir,
        "-i",
        task.id,
        "-k",
        String(options.trials),
        "-n",
        "1",
        "--max-retries",
        "0",
        "-o",
        jobs,
        "--job-name",
        shard.id,
        "--disable-verification",
        "--artifact",
        "/app",
        "-y",
        "-q",
        ...skillArgs(shard.arm, options.skill, allSkills),
        ...agentArgs(shard, key),
      ],
      { timeoutMs: (options.trials * task.spec.agentTimeoutSec + 1_800) * 1000, env: harborEnvironment() },
    );
  } finally {
    // Spending stops now, whatever happened.
    await server.revokeKey(options.runId, shard.id);
  }
  console.log(`harbor exited with ${String(harbor.code)}${harbor.timedOut ? " (timed out)" : ""}\n${tail(harbor.stdout + harbor.stderr, 4000).replaceAll(key.key, "[REDACTED]")}`);

  mkdirSync(options.out, { recursive: true });
  const jobDir = join(jobs, shard.id);
  const trials = existsSync(jobDir) ? readdirSync(jobDir).filter((name) => existsSync(join(jobDir, name, "result.json"))).sort() : [];
  trials.forEach((name, index) => {
    const source = join(jobDir, name);
    const target = join(options.out, String(index));
    mkdirSync(target, { recursive: true });
    const result: unknown = JSON.parse(readFileSync(join(source, "result.json"), "utf8"));
    const kept = typeof result === "object" && result !== null ? Object.fromEntries(Object.entries(result).filter(([field]) => KEPT_RESULT_FIELDS.includes(field))) : {};
    writeFileSync(join(target, "result.json"), JSON.stringify(kept, null, 2));
    const trajectory = join(source, "agent", "trajectory.json");
    if (existsSync(trajectory)) cpSync(trajectory, join(target, "trajectory.json"));
    const app = join(source, "artifacts", "app");
    if (existsSync(app)) cpSync(app, join(target, "app"), { recursive: true });
  });
  writeFileSync(join(options.out, "shard.json"), JSON.stringify({ shard, trials: trials.length }, null, 2));
  redact(options.out, key.key);
  console.log(`${String(trials.length)} trials collected for ${shard.id}`);
}

/** The key is revoked already; it still never leaves the runner. */
function redact(dir: string, secret: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (statSync(path).size > MAX_SCANNED_BYTES) continue;
    const text = readFileSync(path, "latin1");
    if (text.includes(secret)) writeFileSync(path, text.replaceAll(secret, "[REDACTED]"), "latin1");
  }
}
