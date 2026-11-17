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
import { Arm, CheckId, Harness, ModelId, SemVer, Sha, Slug } from "./ids.ts";
import { EvalSpec, Trial } from "./trial.ts";

/** One harness × model cell of the matrix. */
export const Cell = z.strictObject({ harness: Harness, model: ModelId });
export type Cell = z.infer<typeof Cell>;

/** `POST /v1/runs`, from the plan job. */
export const CreateRunRequest = z.strictObject({
  spec: EvalSpec,
  skillSha: Sha,
  skillVersion: SemVer,
  checkTitles: z.record(CheckId, z.string().max(80)),
  cells: z.array(Cell).min(1).max(8),
  arms: z.array(Arm).min(2).max(3),
  trials: z.int().min(1).max(10),
  /** The run's cap; the server applies its own cap too. */
  maxUsd: z.number().positive().max(1000),
  /** Bounds each key's lifetime: trials × agent timeout, plus a margin. */
  agentTimeoutMinutes: z.int().min(1).max(60),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

/** One job of the matrix: a cell, an arm and a task, for `trials` trials. */
export const Shard = z.strictObject({
  id: Slug,
  harness: Harness,
  model: ModelId,
  arm: Arm,
  task: Slug,
});
export type Shard = z.infer<typeof Shard>;

export const CreateRunResponse = z.strictObject({
  runId: z.uuid(),
  shards: z.array(Shard),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;

/** `POST /v1/runs/:run/shards/:shard/key`, from the agent job. */
export const MintedKey = z.strictObject({
  key: z.string().min(1),
  /** Claude Code's `ANTHROPIC_BASE_URL`. */
  anthropicBaseUrl: z.url(),
  /** Codex's and opencode's OpenAI-compatible base URL. */
  openaiBaseUrl: z.url(),
  /** The gateway's provider: models are addressed as `<provider>/<model>`. */
  provider: Slug,
  expiresAt: z.iso.datetime(),
  limitUsd: z.number().positive(),
});
export type MintedKey = z.infer<typeof MintedKey>;

/** `POST /v1/runs/:run/trials`, from the complete job: one shard's graded trials. */
export const UploadTrialsRequest = z.strictObject({
  shard: Slug,
  attempt: z.int().min(1),
  /** Built by the complete job from the run id, never from the agent's side. */
  artifactId: z.int().positive(),
  trials: z.array(Trial).max(10),
});
export type UploadTrialsRequest = z.infer<typeof UploadTrialsRequest>;

/** `POST /v1/runs/:run/complete`. */
export const CompleteRunResponse = z.strictObject({
  reportUrl: z.url(),
  /** For `$GITHUB_STEP_SUMMARY`: numbers and enum values only, no free text from trials. */
  summaryMarkdown: z.string(),
});
export type CompleteRunResponse = z.infer<typeof CompleteRunResponse>;

export const RunStatus = z.enum(["running", "completed", "abandoned"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A run as the public API lists it. */
export const RunSummary = z.strictObject({
  runId: z.uuid(),
  githubRunId: z.int().positive(),
  status: RunStatus,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  skill: Slug,
  skillSha: Sha,
  skillVersion: SemVer,
  cells: z.array(Cell),
  arms: z.array(Arm),
  trials: z.int(),
  costUsd: z.number().nullable(),
  maxUsd: z.number(),
  verdicts: z.strictObject({ helps: z.int(), noEffect: z.int(), hurts: z.int() }).nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

/** Gateway usage of one shard's key, and how far its trials' own token counts are from it. */
export const ShardBilling = z.strictObject({
  shard: Slug,
  attempt: z.int().min(1),
  costUsd: z.number().nullable(),
  gatewayTokens: z.int().nullable(),
  agentTokens: z.int().nullable(),
  /** Agent-reported tokens differ from the gateway's by more than 5%. */
  tokenMismatch: z.boolean(),
});
export type ShardBilling = z.infer<typeof ShardBilling>;

/** `GET /api/v1/runs`. */
export const RunList = z.strictObject({
  schemaVersion: z.literal(1),
  runs: z.array(RunSummary),
});
export type RunList = z.infer<typeof RunList>;

export const RunDetail = RunSummary.extend({
  tasks: z.array(Slug),
  shards: z.array(Shard),
  billing: z.array(ShardBilling),
});
export type RunDetail = z.infer<typeof RunDetail>;

/** The body of every error the server answers: a code only, the reason stays in its log. */
export const ErrorBody = z.strictObject({ error: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Health = z.strictObject({ status: z.literal("ok") });
export type Health = z.infer<typeof Health>;
