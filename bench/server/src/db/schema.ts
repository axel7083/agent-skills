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

import type { Arm, CreateRunRequest, Harness, Results, Trial } from "../contracts/index.ts";
import { sql } from "drizzle-orm";
import { bigint, doublePrecision, index, integer, jsonb, pgEnum, pgTableCreator, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Columns are snake_case in SQL, camelCase in TypeScript. */
const pgTable = pgTableCreator((name) => name, "snake_case");

export const runStatus = pgEnum("run_status", ["running", "completed", "abandoned"]);

/** One benchmark run: one GitHub workflow run of the bench workflow. */
export const runs = pgTable(
  "runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** The GitHub run every later call must come from (its OIDC `run_id`). */
    githubRunId: bigint({ mode: "number" }).notNull(),
    actorId: bigint({ mode: "number" }).notNull(),
    request: jsonb().$type<CreateRunRequest>().notNull(),
    maxUsd: doublePrecision().notNull(),
    status: runStatus().notNull().default("running"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
    /** Computed once at completion; the public API serves it as stored. */
    results: jsonb().$type<Results>(),
    costUsd: doublePrecision(),
  },
  (table) => [uniqueIndex("runs_github_run_id").on(table.githubRunId), index("runs_status").on(table.status)],
);

/** One job of the matrix: a cell × arm × task. */
export const shards = pgTable(
  "shards",
  {
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    id: text().notNull(),
    harness: text().$type<Harness>().notNull(),
    model: text().notNull(),
    arm: text().$type<Arm>().notNull(),
    task: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.id] })],
);

export const keyState = pgEnum("key_state", ["active", "disabled", "settled"]);

/**
 * A Bifrost virtual key, one per shard and attempt. Its limit counts against the run's cap until it
 * is settled; then its real usage does.
 */
export const keys = pgTable(
  "keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    shard: text().notNull(),
    attempt: integer().notNull(),
    virtualKeyId: text().notNull(),
    limitUsd: doublePrecision().notNull(),
    state: keyState().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    disabledAt: timestamp({ withTimezone: true }),
    usageUsd: doublePrecision(),
    usageTokens: bigint({ mode: "number" }),
  },
  (table) => [
    uniqueIndex("keys_run_shard_attempt").on(table.runId, table.shard, table.attempt),
    index("keys_state").on(table.state),
    index("keys_created_at").on(table.createdAt),
  ],
);

/** A graded trial as the complete job uploaded it; its cost is set when the run completes. */
export const trials = pgTable(
  "trials",
  {
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    shard: text().notNull(),
    attempt: integer().notNull(),
    trial: integer().notNull(),
    data: jsonb().$type<Trial>().notNull(),
    artifactId: bigint({ mode: "number" }).notNull(),
    costUsd: doublePrecision(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.shard, table.attempt, table.trial] })],
);

/** `now() - interval`: rows of the last `hours`. */
export function hoursAgo(hours: number): ReturnType<typeof sql> {
  return sql`now() - make_interval(hours => ${hours})`;
}
