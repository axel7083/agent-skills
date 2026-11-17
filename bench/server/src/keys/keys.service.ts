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

import { setTimeout as sleep } from "node:timers/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { MintedKey } from "../contracts/index.ts";
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { Clock } from "../common/clock.ts";
import { BudgetExceeded, Conflict, Forbidden, NotFound } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import type { Db } from "../db/db.module.ts";
import { keys, runs, shards } from "../db/schema.ts";
import type { Principal } from "../auth/oidc-verifier.ts";
import { BifrostClient } from "./bifrost.client.ts";

/** The smallest key worth minting. */
const MIN_KEY_USD = 0.05;
/** Keys never live longer than this, whatever the run asks for. */
const MAX_KEY_HOURS = 6;
const KEY_MARGIN_MINUTES = 30;

type KeyRow = typeof keys.$inferSelect;

/**
 * Budget-capped LLM keys, one per shard and attempt. A key's limit counts against its run's cap
 * and the daily cap until it is settled; then its real usage does.
 */
@Injectable()
export class KeysService {
  private readonly logger = new Logger(KeysService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly bifrost: BifrostClient,
    private readonly clock: Clock,
  ) {}

  async mint(runId: string, shardId: string, principal: Principal): Promise<MintedKey> {
    return this.db.transaction(async (tx) => {
      // Serialises mints of one run, so two shards can't both take the last of its budget.
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
      if (run === undefined) throw new NotFound(`run ${runId}`);
      if (run.githubRunId !== principal.githubRunId) throw new Forbidden(`run ${runId} belongs to another workflow run`);
      if (run.status !== "running") throw new Conflict(`run ${runId} is ${run.status}`);
      const [shard] = await tx.select().from(shards).where(and(eq(shards.runId, runId), eq(shards.id, shardId)));
      if (shard === undefined) throw new NotFound(`shard ${shardId}`);
      const [existing] = await tx
        .select({ id: keys.id })
        .from(keys)
        .where(and(eq(keys.runId, runId), eq(keys.shard, shardId), eq(keys.attempt, principal.runAttempt)));
      if (existing !== undefined) throw new Conflict(`shard ${shardId} already has a key for attempt ${String(principal.runAttempt)}`);

      const now = this.clock.now();
      const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(shards).where(eq(shards.runId, runId));
      const shardCount = counted?.count ?? 1;
      const runCommitted = await committed(tx, eq(keys.runId, runId));
      const dayCommitted = await committed(tx, gt(keys.createdAt, new Date(now.getTime() - 24 * 3_600_000)));
      const limitUsd = roundCents(
        // Shards run in parallel: each gets its even share of the cap. A re-run's key gets what settled keys left over.
        Math.min(run.maxUsd - runCommitted, run.maxUsd / Math.max(1, shardCount), this.env.DAILY_USD - dayCommitted),
      );
      if (limitUsd < MIN_KEY_USD) throw new BudgetExceeded(`run ${runId} has $${limitUsd.toFixed(2)} left`);

      const lifetimeMinutes = Math.min(run.request.trials * run.request.agentTimeoutMinutes + KEY_MARGIN_MINUTES, MAX_KEY_HOURS * 60);
      const expiresAt = new Date(now.getTime() + lifetimeMinutes * 60_000);
      const name = `bench-${String(run.githubRunId)}-${String(principal.runAttempt)}-${shardId}`;
      const created = await this.bifrost.create({
        name,
        limitUsd,
        expiresAt,
        models: [shard.model],
        metadata: { run: runId, shard: shardId, attempt: String(principal.runAttempt), github_run: String(run.githubRunId) },
      });
      try {
        await tx.insert(keys).values({ runId, shard: shardId, attempt: principal.runAttempt, virtualKeyId: created.id, limitUsd, expiresAt, createdAt: now });
      } catch (error: unknown) {
        await this.bifrost.delete(created.id).catch(() => undefined);
        throw error;
      }
      this.logger.log(`key minted for ${name}: $${limitUsd.toFixed(2)} until ${expiresAt.toISOString()}`);
      const base = this.env.BIFROST_PUBLIC_URL.replace(/\/+$/, "");
      return {
        key: created.key,
        anthropicBaseUrl: `${base}/anthropic`,
        openaiBaseUrl: `${base}/v1`,
        provider: this.env.BIFROST_PROVIDER,
        expiresAt: expiresAt.toISOString(),
        limitUsd,
      };
    });
  }

  /** Stops spending on the caller's own key. Idempotent; usage is read later, once Bifrost has counted it. */
  async revoke(runId: string, shardId: string, principal: Principal): Promise<void> {
    const [run] = await this.db.select({ githubRunId: runs.githubRunId }).from(runs).where(eq(runs.id, runId));
    if (run === undefined) throw new NotFound(`run ${runId}`);
    if (run.githubRunId !== principal.githubRunId) throw new Forbidden(`run ${runId} belongs to another workflow run`);
    const [key] = await this.db
      .select()
      .from(keys)
      .where(and(eq(keys.runId, runId), eq(keys.shard, shardId), eq(keys.attempt, principal.runAttempt)));
    if (key === undefined) throw new NotFound(`no key for shard ${shardId}`);
    if (key.state === "active") await this.disable(key);
  }

  /** Disables a run's active keys, waits for Bifrost's usage lag, and settles them all. */
  async settleRun(runId: string): Promise<void> {
    const active = await this.db.select().from(keys).where(and(eq(keys.runId, runId), eq(keys.state, "active")));
    for (const key of active) await this.disable(key);
    const pending = await this.db.select().from(keys).where(and(eq(keys.runId, runId), eq(keys.state, "disabled")));
    const latest = Math.max(0, ...pending.map((key) => key.disabledAt?.getTime() ?? 0));
    const wait = latest + this.env.USAGE_LAG_MS - this.clock.now().getTime();
    if (wait > 0) await sleep(wait);
    for (const key of pending) await this.settle(key);
  }

  /** The sweeper's pass: disables expired keys, settles disabled keys past the lag. */
  async sweep(): Promise<void> {
    const now = this.clock.now();
    const expired = await this.db.select().from(keys).where(and(eq(keys.state, "active"), lte(keys.expiresAt, now)));
    for (const key of expired) await this.disable(key);
    const due = await this.db
      .select()
      .from(keys)
      .where(and(eq(keys.state, "disabled"), lte(keys.disabledAt, new Date(now.getTime() - this.env.USAGE_LAG_MS))));
    for (const key of due) {
      await this.settle(key).catch((error: unknown) => {
        this.logger.error(`settling key ${key.id} failed: ${String(error)}`);
      });
    }
  }

  /** Disables then settles every key of the given runs, for runs abandoned by the sweeper. */
  async disableRuns(runIds: readonly string[]): Promise<void> {
    if (runIds.length === 0) return;
    const active = await this.db.select().from(keys).where(and(inArray(keys.runId, [...runIds]), eq(keys.state, "active")));
    for (const key of active) await this.disable(key);
  }

  private async disable(key: KeyRow): Promise<void> {
    await this.bifrost.disable(key.virtualKeyId);
    await this.db.update(keys).set({ state: "disabled", disabledAt: this.clock.now() }).where(and(eq(keys.id, key.id), eq(keys.state, "active")));
  }

  /** Reads the key's final usage, then removes it from Bifrost. */
  private async settle(key: KeyRow): Promise<void> {
    const usage = await this.bifrost.usage(key.virtualKeyId);
    await this.db.update(keys).set({ state: "settled", usageUsd: usage.usd, usageTokens: usage.tokens }).where(eq(keys.id, key.id));
    await this.bifrost.delete(key.virtualKeyId);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** USD a set of keys holds: the limit of each unsettled key, the usage of each settled one. */
async function committed(tx: Tx | Db, where: ReturnType<typeof eq>): Promise<number> {
  const [row] = await tx
    .select({ usd: sql<number>`coalesce(sum(case when ${keys.state} = 'settled' then coalesce(${keys.usageUsd}, 0) else ${keys.limitUsd} end), 0)::float8` })
    .from(keys)
    .where(where);
  return row?.usd ?? 0;
}

function roundCents(usd: number): number {
  return Math.floor(usd * 100) / 100;
}
