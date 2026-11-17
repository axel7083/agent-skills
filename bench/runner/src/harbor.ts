import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness, MintedKey, Shard } from "@podman-desktop/bench-contracts";
import { parse } from "yaml";
import { z } from "zod";
import { REPO_ROOT, SANDBOX_LOCK } from "./paths.ts";
import type { Task } from "./tasks.ts";

const HarnessVersions = z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/));

export function harnessVersion(harness: Harness): string {
  const versions = HarnessVersions.parse(parse(readFileSync(join(REPO_ROOT, "bench", "harnesses.yaml"), "utf8")));
  const version = versions[harness];
  if (version === undefined) throw new Error(`no pinned version for ${harness} in bench/harnesses.yaml`);
  return version;
}

/** The sandbox image, pinned by digest: Fedora with a nested Podman for the agent. */
export function sandboxImage(): string {
  const image = readFileSync(SANDBOX_LOCK, "utf8").trim();
  if (!/^[a-z0-9./-]+(:[\w.-]+)?@sha256:[0-9a-f]{64}$/.test(image)) throw new Error(`${SANDBOX_LOCK}: expected an image pinned by digest`);
  return image;
}

const TASK_TOML = (task: Task): string => `schema_version = "1.4"

[task]
name = "bench/${task.id}"
version = "1.0.0"

[agent]
timeout_sec = ${String(task.spec.agentTimeoutSec)}.0

[verifier]
timeout_sec = 60.0

[environment]
build_timeout_sec = 900.0
cpus = 2
memory_mb = 4096
`;

/**
 * Merged by Harbor into its compose file. `privileged`: the agent builds and runs containers with
 * a nested Podman. No environment variable is declared: the sandbox gets none of the job's.
 */
const COMPOSE = `services:
  main:
    privileged: true
    # Harbor's \`sleep infinity\` ignores SIGTERM as PID 1: every teardown waited for SIGKILL.
    init: true
`;

/**
 * Writes the Harbor task for `task` under `dir`: the environment (sandbox image + the app) and the
 * instruction only. Grading happens later, in another job: no grader, test or oracle goes in.
 */
export function writeHarborTask(task: Task, dir: string): string {
  const root = join(dir, task.id);
  mkdirSync(join(root, "environment"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "task.toml"), TASK_TOML(task));
  writeFileSync(join(root, "instruction.md"), task.instruction);
  cpSync(join(task.dir, "app"), join(root, "environment", "app"), { recursive: true });
  writeFileSync(join(root, "environment", "Dockerfile"), `FROM ${sandboxImage()}\nCOPY app/ /app/\nWORKDIR /app\n`);
  writeFileSync(join(root, "environment", "docker-compose.yaml"), COMPOSE);
  // Harbor requires a test script; verification is disabled, so it never runs.
  writeFileSync(join(root, "tests", "test.sh"), "#!/bin/sh\necho 0 > /logs/verifier/reward.txt\n");
  chmodSync(join(root, "tests", "test.sh"), 0o755);
  return root;
}

/** The model as the gateway routes it: `<provider>/<model>`. */
function gatewayModel(key: MintedKey, model: string): string {
  return `${key.provider}/${model}`;
}

/** Harbor's agent arguments for a harness talking to the gateway with the shard's key. */
export function agentArgs(shard: Shard, key: MintedKey): string[] {
  const model = gatewayModel(key, shard.model);
  const version = ["--ak", `version=${harnessVersion(shard.harness)}`];
  switch (shard.harness) {
    case "claude-code":
      return [
        "-a",
        "claude-code",
        ...version,
        "-m",
        model,
        "--ae",
        `ANTHROPIC_BASE_URL=${key.anthropicBaseUrl}`,
        "--ae",
        `ANTHROPIC_AUTH_TOKEN=${key.key}`,
        "--ae",
        "ANTHROPIC_API_KEY=",
        // Every model class maps to the shard's model: the key allows that one only.
        "--ae",
        `ANTHROPIC_DEFAULT_OPUS_MODEL=${model}`,
        "--ae",
        `ANTHROPIC_DEFAULT_SONNET_MODEL=${model}`,
        "--ae",
        `ANTHROPIC_DEFAULT_HAIKU_MODEL=${model}`,
        "--ae",
        `CLAUDE_CODE_SUBAGENT_MODEL=${model}`,
        "--ae",
        "DISABLE_AUTOUPDATER=1",
        "--ae",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
      ];
    case "codex":
      return ["-a", "codex", ...version, "-m", model, "--ae", `OPENAI_BASE_URL=${key.openaiBaseUrl}`, "--ae", `OPENAI_API_KEY=${key.key}`];
    case "opencode": {
      const config = {
        provider: {
          bench: {
            npm: "@ai-sdk/openai-compatible",
            name: "bench gateway",
            options: { baseURL: key.openaiBaseUrl, apiKey: "{env:BENCH_API_KEY}" },
            models: { [model]: { name: shard.model } },
          },
        },
      };
      return ["-a", "opencode", ...version, "-m", `bench/${model}`, "--ak", `opencode_config=${JSON.stringify(config)}`, "--ae", `BENCH_API_KEY=${key.key}`];
    }
  }
}

/** The skills to install for an arm: none, the evaluated one, or every skill of the repository. */
export function skillArgs(arm: Shard["arm"], skill: string, allSkills: readonly string[]): string[] {
  const dirs = arm === "without" ? [] : arm === "with" ? [skill] : allSkills;
  return dirs.flatMap((name) => ["--skill", join(REPO_ROOT, "skills", name)]);
}

/**
 * The environment Harbor runs with: what Podman and the tools need, nothing of the job's own
 * (no `ACTIONS_*` token, no `GITHUB_TOKEN`), as a second line behind the compose file.
 */
export function harborEnvironment(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LANG", "TMPDIR", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DOCKER_HOST", "CONTAINER_HOST"];
  return Object.fromEntries(keep.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])));
}
