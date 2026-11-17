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
import { Arm, CheckId, Harness, ModelId, Sha, SkillName, Slug, TaskId } from "./ids.ts";

export const SCHEMA_VERSION = 1;

/** `na`: the check doesn't apply to this trial. `error`: the grader failed, the trial is excluded from that check. */
export const CheckStatus = z.enum(["pass", "fail", "na", "error"]).meta({ id: "CheckStatus" });
export type CheckStatus = z.infer<typeof CheckStatus>;

/** The first gate that failed, `none` when the artifact built, started and answered the probe. */
export const FailureClass = z.enum(["none", "no-artifact", "build", "start", "probe", "timeout", "infra"]).meta({ id: "FailureClass" });
export type FailureClass = z.infer<typeof FailureClass>;

/** Evidence is agent-controlled text (file excerpts): bounded, and only ever rendered as text. */
export const CheckResult = z.strictObject({
  status: CheckStatus,
  evidence: z.string().max(1024),
}).meta({ id: "CheckResult" });
export type CheckResult = z.infer<typeof CheckResult>;

const Count = z.int().nonnegative();

export const Tokens = z.strictObject({
  /** Uncached input tokens. */
  input: Count,
  cached: Count,
  output: Count,
}).meta({ id: "Tokens" });
export type Tokens = z.infer<typeof Tokens>;

/**
 * Read from the agent's own trajectory, which the agent could forge. The gateway's usage per key is
 * the cost of record; these figures are cross-checked against it.
 */
export const AgentReported = z.strictObject({
  /** The agent read the skill's SKILL.md, or called its harness's skill tool. */
  triggered: z.boolean(),
  tokens: Tokens,
  turns: Count,
  toolCalls: Count,
}).meta({ id: "AgentReported" });
export type AgentReported = z.infer<typeof AgentReported>;

/** One trial as the grade job writes it to `trials.json`. */
export const Trial = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** The skill under evaluation; set in every arm, including `without`. */
  skill: SkillName,
  arm: Arm,
  harness: Harness,
  model: ModelId,
  task: TaskId,
  /** The GitHub run attempt the trial ran in. */
  attempt: z.int().min(1),
  trial: Count,
  works: z.boolean(),
  failureClass: FailureClass,
  checks: z.record(CheckId, CheckResult),
  agentSeconds: z.number().nonnegative(),
  agentReported: AgentReported,
  /** The commit of the graders that produced `works` and `checks`. */
  graderCommit: Sha,
  /** Path of the trial's transcript inside its shard's artifact. */
  transcriptPath: z.string().regex(/^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,255}$/),
}).meta({ id: "Trial" });
export type Trial = z.infer<typeof Trial>;

/** A trial as stored and published: plus its share of the shard's gateway cost, and where its transcript is. */
export const PublishedTrial = Trial.extend({
  shard: Slug,
  costUsd: z.number().nonnegative(),
  artifactUrl: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
}).meta({ id: "PublishedTrial" });
export type PublishedTrial = z.infer<typeof PublishedTrial>;

/** `bench/evals/<skill>.yaml`: what a skill claims to fix, and what it must not break. */
export const EvalSpec = z.strictObject({
  skill: SkillName,
  tasks: z.array(TaskId).min(1),
  targets: z.array(CheckId).min(1),
  controls: z.array(CheckId),
}).meta({ id: "EvalSpec" });
export type EvalSpec = z.infer<typeof EvalSpec>;
