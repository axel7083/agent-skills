import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Shard, type Trial } from "@podman-desktop/bench-contracts";
import { run } from "../exec.ts";
import { gradeApp } from "../graders/grade.ts";
import { REPO_ROOT } from "../paths.ts";
import { loadTask } from "../tasks.ts";
import { readTrial } from "../trajectory.ts";

export interface GradeOptions {
  readonly skill: string;
  readonly shard: string;
  readonly attempt: number;
  /** The agent job's artifact, downloaded. */
  readonly input: string;
  readonly out: string;
}

/**
 * Grades every trial of a shard from the agent job's artifact, on a runner of its own that holds
 * no identity: whatever the agent left, it builds and runs here, confined.
 */
export async function grade(options: GradeOptions): Promise<void> {
  const shard = Shard.parse(JSON.parse(options.shard));
  const task = loadTask(shard.task);
  const head = await run("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
  const graderCommit = head.stdout.trim();
  const dirs = existsSync(options.input)
    ? readdirSync(options.input).filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(a) - Number(b))
    : [];
  const trials: Trial[] = [];
  for (const name of dirs) {
    const dir = join(options.input, name);
    const record = readTrial(dir, options.skill);
    const app = join(dir, "app");
    const graded = await gradeApp(task.spec, existsSync(app) ? app : join(dir, "missing-app"));
    const timedOut = record.exception === "AgentTimeoutError";
    trials.push({
      schemaVersion: 1,
      skill: options.skill,
      arm: shard.arm,
      harness: shard.harness,
      model: shard.model,
      task: shard.task,
      attempt: options.attempt,
      trial: Number(name),
      // An agent that ran out of time failed the task, whatever it left behind.
      works: graded.works && !timedOut,
      failureClass: timedOut ? "timeout" : graded.failureClass,
      checks: graded.checks,
      agentSeconds: record.agentSeconds,
      agentReported: record.agentReported,
      graderCommit,
      transcriptPath: `${name}/trajectory.json`,
    });
    console.log(`${shard.id} trial ${name}: ${graded.failureClass}`);
  }
  writeFileSync(options.out, JSON.stringify({ shard: shard.id, attempt: options.attempt, trials }, null, 2));
}
