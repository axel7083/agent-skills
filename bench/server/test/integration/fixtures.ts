import type { CreateRunRequest, Trial } from "@podman-desktop/bench-contracts";

export const SHA = "0123456789abcdef0123456789abcdef01234567";

export const runRequest: CreateRunRequest = {
  spec: { skill: "containerfile-best-practices", tasks: ["task-a", "task-b"], targets: ["healthcheck"], controls: ["non-root"] },
  skillSha: SHA,
  skillVersion: "0.1.0",
  checkTitles: { healthcheck: "HEALTHCHECK", "non-root": "Non-root user" },
  cells: [{ harness: "opencode", model: "gpt-oss-120b" }],
  arms: ["without", "with"],
  trials: 2,
  maxUsd: 4,
  agentTimeoutMinutes: 15,
};

export function trialFor(shard: { harness: string; model: string; arm: string; task: string }, trial: number, passed: boolean): Trial {
  return {
    schemaVersion: 1,
    skill: runRequest.spec.skill,
    arm: shard.arm === "with" ? "with" : "without",
    harness: "opencode",
    model: shard.model,
    task: shard.task,
    attempt: 1,
    trial,
    works: true,
    failureClass: "none",
    checks: {
      healthcheck: { status: passed ? "pass" : "fail", evidence: '<script>alert("x")</script>' },
      "non-root": { status: "pass", evidence: "" },
    },
    agentSeconds: 60,
    agentReported: { triggered: shard.arm === "with", tokens: { input: 900, cached: 0, output: 100 }, turns: 6, toolCalls: 6 },
    graderCommit: SHA,
    transcriptPath: `${shard.task}/${String(trial)}/trajectory.json`,
  };
}
