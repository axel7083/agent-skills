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

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MintedKey, Shard } from "@podman-desktop/agent-skills-bench-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentArgs, harborEnvironment, skillArgs } from "../src/harbor.ts";
import { readTrial } from "../src/trajectory.ts";

const key: MintedKey = {
  key: "sk-bf-test",
  anthropicBaseUrl: "https://llm.test/anthropic",
  openaiBaseUrl: "https://llm.test/v1",
  provider: "enmaas",
  expiresAt: "2026-11-17T12:00:00Z",
  limitUsd: 1,
};

const shard = (harness: Shard["harness"]): Shard => ({ id: "s001", harness, model: "gpt-oss-120b", arm: "with", task: "containerfile-node-api" });

describe("agentArgs", () => {
  it("routes every harness through the gateway with the shard's model", () => {
    expect(agentArgs(shard("claude-code"), key)).toEqual(expect.arrayContaining(["claude-code", "enmaas/gpt-oss-120b", "ANTHROPIC_AUTH_TOKEN=sk-bf-test"]));
    expect(agentArgs(shard("codex"), key)).toEqual(expect.arrayContaining(["codex", "OPENAI_BASE_URL=https://llm.test/v1"]));
    const opencode = agentArgs(shard("opencode"), key);
    expect(opencode).toEqual(expect.arrayContaining(["bench/enmaas/gpt-oss-120b", "BENCH_API_KEY=sk-bf-test"]));
    expect(opencode.find((arg) => arg.startsWith("opencode_config="))).toContain('"baseURL":"https://llm.test/v1"');
  });
});

describe("skillArgs", () => {
  it("installs nothing, the skill, or every skill", () => {
    expect(skillArgs("without", "a", ["a", "b"])).toEqual([]);
    expect(skillArgs("with", "a", ["a", "b"]).filter((arg) => arg !== "--skill").map((path) => path.split("/").at(-1))).toEqual(["a"]);
    expect(skillArgs("bundle", "a", ["a", "b"])).toHaveLength(4);
  });
});

describe("harborEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the job's tokens out", () => {
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "secret");
    vi.stubEnv("GITHUB_TOKEN", "secret");
    vi.stubEnv("PATH", "/usr/bin");
    const env = harborEnvironment();
    expect(env["PATH"]).toBe("/usr/bin");
    expect(Object.keys(env).some((name) => name.startsWith("ACTIONS_") || name.startsWith("GITHUB_"))).toBe(false);
  });
});

describe("readTrial", () => {
  it("reads tokens, turns and whether the skill was loaded", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-trial-"));
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify({
        agent_result: { n_input_tokens: 1000, n_cache_tokens: 400, n_output_tokens: 50 },
        agent_execution: { started_at: "2026-11-17T10:00:00Z", finished_at: "2026-11-17T10:01:30Z" },
      }),
    );
    writeFileSync(
      join(dir, "trajectory.json"),
      JSON.stringify({
        steps: [
          { source: "user" },
          { source: "agent", tool_calls: [{ function_name: "Read", arguments: { path: "/root/.claude/skills/containerfile-best-practices/SKILL.md" } }] },
          { source: "agent", tool_calls: [{ function_name: "Bash", arguments: { command: "podman build ." } }, { function_name: "Write", arguments: {} }] },
        ],
      }),
    );
    const record = readTrial(dir, "containerfile-best-practices");
    expect(record.agentReported).toEqual({ triggered: true, tokens: { input: 600, cached: 400, output: 50 }, turns: 2, toolCalls: 3 });
    expect(record.agentSeconds).toBe(90);
    expect(readTrial(dir, "another-skill").agentReported.triggered).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "result.json"), "utf8"))).toBeDefined();
  });
});
