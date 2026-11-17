import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EvalSpec, Slug } from "@podman-desktop/bench-contracts";
import { parse } from "yaml";
import { z } from "zod";
import { EVALS_DIR, TASKS_DIR } from "./paths.ts";

/** `bench/tasks/<id>/task.yaml`: how a task's result is run and probed. */
export const TaskSpec = z.strictObject({
  gate: z.literal("image"),
  app: z.strictObject({
    language: z.enum(["node", "python", "go", "static"]),
    port: z.int().min(1).max(65_535),
    /** The app compiles: a multi-stage build applies. */
    needsBuild: z.boolean(),
  }),
  probe: z.strictObject({ path: z.string().startsWith("/"), status: z.int(), body: z.string().optional() }),
  /** A fake secret planted in the app: it must not end up in the image. */
  canary: z.strictObject({ file: z.string(), value: z.string().min(8) }).optional(),
  /** Platform constraints the image must run under (`podman run` arguments). */
  run: z.strictObject({ args: z.array(z.string()), portFromImage: z.boolean().default(false) }).optional(),
  /** An OpenShift task: the app must write under an arbitrary UID. */
  openshift: z.strictObject({ writePath: z.string().startsWith("/") }).optional(),
  agentTimeoutSec: z.int().min(60).max(3600),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

export interface Task {
  readonly id: string;
  readonly dir: string;
  readonly spec: TaskSpec;
  readonly instruction: string;
}

export function loadTask(id: string): Task {
  const dir = join(TASKS_DIR, Slug.parse(id));
  const spec = TaskSpec.parse(parse(readFileSync(join(dir, "task.yaml"), "utf8")));
  return { id, dir, spec, instruction: readFileSync(join(dir, "instruction.md"), "utf8") };
}

export function taskIds(): string[] {
  return readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(TASKS_DIR, entry.name, "task.yaml")))
    .map((entry) => entry.name)
    .sort();
}

export function loadEval(skill: string): EvalSpec {
  return EvalSpec.parse(parse(readFileSync(join(EVALS_DIR, `${Slug.parse(skill)}.yaml`), "utf8")));
}

export const OracleExpectation = z.strictObject({
  works: z.boolean(),
  pass: z.array(z.string()).default([]),
  fail: z.array(z.string()).default([]),
  na: z.array(z.string()).default([]),
});
export type OracleExpectation = z.infer<typeof OracleExpectation>;
