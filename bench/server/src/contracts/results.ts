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

import { z } from "zod";
import { CheckId, Harness, ModelId, SemVer, Sha, SkillName, TaskId } from "./ids.ts";
import { SCHEMA_VERSION } from "./trial.ts";

/** A point estimate and its bootstrap confidence interval. */
export const Interval = z.strictObject({
  estimate: z.number(),
  low: z.number(),
  high: z.number(),
}).meta({ id: "Interval" });
export type Interval = z.infer<typeof Interval>;

const Rate = z.number().min(0).max(1);

export const Verdict = z.enum(["helps", "no-effect", "hurts"]).meta({ id: "Verdict" });
export type Verdict = z.infer<typeof Verdict>;

/** One arm of one model, over every task of the evaluation. */
export const ArmSummary = z.strictObject({
  trials: z.int().nonnegative(),
  works: Rate.nullable(),
  target: Rate.nullable(),
  control: Rate.nullable(),
  /** Trials that work and pass every applicable target check. */
  successes: z.int().nonnegative(),
  tokens: z.strictObject({ median: z.number(), p90: z.number() }),
  turns: z.number(),
  seconds: z.number(),
  costUsd: z.number(),
  costPerSuccessUsd: z.number().nullable(),
  /** Share of trials that loaded the skill; null in the `without` arm. */
  triggered: Rate.nullable(),
}).meta({ id: "ArmSummary" });
export type ArmSummary = z.infer<typeof ArmSummary>;

const ArmRate = z.strictObject({ rate: Rate.nullable(), n: z.int().nonnegative() });

export const CheckRate = z.strictObject({
  check: CheckId,
  role: z.enum(["target", "control"]),
  without: ArmRate,
  with: ArmRate,
}).meta({ id: "CheckRate" });
export type CheckRate = z.infer<typeof CheckRate>;

export const TaskDelta = z.strictObject({
  task: TaskId,
  target: z.strictObject({ without: Rate.nullable(), with: Rate.nullable() }),
  /** Δ pass rate per check, null where the check never applied in one of the arms. */
  checks: z.record(CheckId, z.number().nullable()),
}).meta({ id: "TaskDelta" });
export type TaskDelta = z.infer<typeof TaskDelta>;

/** `with`-arm trials by whether the skill was loaded, and whether the trial succeeded. */
export const Trigger = z.strictObject({
  loadedSuccess: z.int().nonnegative(),
  loadedFailure: z.int().nonnegative(),
  notLoaded: z.int().nonnegative(),
}).meta({ id: "Trigger" });
export type Trigger = z.infer<typeof Trigger>;

export const ModelResult = z.strictObject({
  harness: Harness,
  model: ModelId,
  without: ArmSummary,
  with: ArmSummary,
  delta: z.strictObject({
    target: Interval.nullable(),
    control: Interval.nullable(),
    works: Interval.nullable(),
    /** (with − without) / (1 − without): the share of the remaining gap the skill closed. */
    normalizedGain: z.number().nullable(),
    /** Relative change of the median tokens per trial. */
    tokensPct: z.number().nullable(),
    costUsd: z.number(),
    turns: z.number(),
    seconds: z.number(),
  }),
  verdict: Verdict.nullable(),
  /** A control check or `works` got significantly worse. */
  regression: z.boolean(),
  trigger: Trigger,
  checks: z.array(CheckRate),
  tasks: z.array(TaskDelta),
}).meta({ id: "ModelResult" });
export type ModelResult = z.infer<typeof ModelResult>;

export const Results = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  skill: SkillName,
  skillSha: Sha,
  skillVersion: SemVer,
  tasks: z.array(TaskId),
  targets: z.array(CheckId),
  controls: z.array(CheckId),
  /** Human titles of the checks, from the graders' catalog. */
  checkTitles: z.record(CheckId, z.string().max(80)),
  bootstrap: z.strictObject({
    resamples: z.int().positive(),
    seed: z.int(),
    confidence: z.number().gt(0).lt(1),
  }),
  models: z.array(ModelResult),
  overall: z.strictObject({
    verdicts: z.strictObject({ helps: z.int(), noEffect: z.int(), hurts: z.int() }),
    target: Interval.nullable(),
    tokensPct: z.number().nullable(),
    triggered: Rate.nullable(),
    costUsd: z.number(),
    maxUsd: z.number().nullable(),
  }),
}).meta({ id: "Results" });
export type Results = z.infer<typeof Results>;
