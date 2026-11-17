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

import type { Arm, EvalSpec, PublishedTrial } from "../src/index.ts";

export const SHA = "0123456789abcdef0123456789abcdef01234567";

export const spec: EvalSpec = {
  skill: "containerfile-best-practices",
  tasks: ["task-a", "task-b", "task-c"],
  targets: ["healthcheck", "digest"],
  controls: ["non-root"],
};

export interface TrialShape {
  readonly arm: Arm;
  readonly task: string;
  readonly target: readonly boolean[];
  readonly control?: boolean;
  readonly works?: boolean;
  readonly triggered?: boolean;
  readonly tokens?: number;
  readonly model?: string;
}

let counter = 0;

export function trial(shape: TrialShape): PublishedTrial {
  const [healthcheck = false, digest = false] = shape.target;
  const status = (passed: boolean): "pass" | "fail" => (passed ? "pass" : "fail");
  return {
    schemaVersion: 1,
    skill: spec.skill,
    arm: shape.arm,
    harness: "opencode",
    model: shape.model ?? "model-a",
    task: shape.task,
    attempt: 1,
    trial: counter++,
    works: shape.works ?? true,
    failureClass: shape.works === false ? "build" : "none",
    checks: {
      healthcheck: { status: status(healthcheck), evidence: "" },
      digest: { status: status(digest), evidence: "" },
      "non-root": { status: status(shape.control ?? true), evidence: "" },
    },
    agentSeconds: 60,
    agentReported: {
      triggered: shape.triggered ?? shape.arm !== "without",
      tokens: { input: shape.tokens ?? 1000, cached: 0, output: 0 },
      turns: 5,
      toolCalls: 5,
    },
    graderCommit: SHA,
    transcriptPath: `t/${counter}.json`,
    shard: "shard",
    costUsd: 0.01,
    artifactUrl: "https://github.com/podman-desktop/agent-skills/actions/runs/1/artifacts/2",
  };
}

/** `n` trials per task and arm, the same shape for each. */
export function grid(n: number, shapes: Omit<TrialShape, "task">[], tasks = spec.tasks): PublishedTrial[] {
  return tasks.flatMap((task) => shapes.flatMap((shape) => Array.from({ length: n }, () => trial({ ...shape, task }))));
}
