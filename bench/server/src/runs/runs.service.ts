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

import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import {
  aggregate,
  type CompleteRunResponse,
  type CreateRunRequest,
  type CreateRunResponse,
  type PublishedTrial,
  type Results,
  type RunDetail,
  type RunSummary,
  type Shard,
  type ShardBilling,
  type UploadTrialsRequest,
} from "@podman-desktop/agent-skills-bench-contracts";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { Principal } from "../auth/oidc-verifier.ts";
import { Clock } from "../common/clock.ts";
import { BudgetExceeded, Conflict, Forbidden, NotFound, Refused } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import type { Db } from "../db/db.module.ts";
import { keys, runs, shards, trials } from "../db/schema.ts";
import { KeysService } from "../keys/keys.service.ts";
import { PriceList } from "../keys/prices.ts";
import { summaryMarkdown } from "./summary.ts";

type RunRow = typeof runs.$inferSelect;

/** Agent-reported tokens further than this from the gateway's count flag the shard. */
const TOKEN_TOLERANCE = 0.05;

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Db,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly keys: KeysService,
    private readonly prices: PriceList,
    private readonly clock: Clock,
  ) {}

  /** Registers the workflow run and expands its matrix. A re-run of the plan job gets the same run back. */
  async create(request: CreateRunRequest, principal: Principal): Promise<CreateRunResponse> {
    const [same] = await this.db.select().from(runs).where(eq(runs.githubRunId, principal.githubRunId));
    if (same !== undefined) {
      if (JSON.stringify(same.request) !== JSON.stringify(request)) throw new Conflict(`workflow run ${String(principal.githubRunId)} already has another run`);
      return { runId: same.id, shards: await this.shardsOf(same.id) };
    }

    if (!request.arms.includes("without") || !request.arms.includes("with")) throw new Refused("a run compares `without` and `with`: both arms are required");
    const unpriced = this.prices.unpriced([...new Set(request.cells.map((cell) => cell.model))]);
    if (unpriced.length > 0) throw new Refused(`no price for ${unpriced.join(", ")}`);
    const planned = expand(request);
    if (planned.length > this.env.MAX_SHARDS) throw new Refused(`${String(planned.length)} shards, more than ${String(this.env.MAX_SHARDS)}`);

    const now = this.clock.now();
    const runId = await this.db.transaction(async (tx) => {
      // One run at a time: a second dispatch waits for the first one to finish.
      await tx.execute(sql`select pg_advisory_xact_lock(7207102)`);
      const [running] = await tx.select({ id: runs.id }).from(runs).where(eq(runs.status, "running"));
      if (running !== undefined) throw new Conflict(`run ${running.id} is still running`);
      const [day] = await tx
        .select({ usd: sql<number>`coalesce(sum(case when ${keys.state} = 'settled' then coalesce(${keys.usageUsd}, 0) else ${keys.limitUsd} end), 0)::float8` })
        .from(keys)
        .where(gt(keys.createdAt, new Date(now.getTime() - 24 * 3_600_000)));
      if (this.env.DAILY_USD - (day?.usd ?? 0) < 0.05) throw new BudgetExceeded("the daily cap is spent");
      const [created] = await tx
        .insert(runs)
        .values({ githubRunId: principal.githubRunId, actorId: principal.actorId, request, maxUsd: Math.min(request.maxUsd, this.env.MAX_RUN_USD), createdAt: now })
        .returning({ id: runs.id });
      if (created === undefined) throw new Error("run insert returned nothing");
      await tx.insert(shards).values(planned.map((shard) => ({ ...shard, runId: created.id })));
      return created.id;
    });
    this.logger.log(`run ${runId} for workflow run ${String(principal.githubRunId)}: ${String(planned.length)} shards`);
    return { runId, shards: planned };
  }

  /** Stores one shard's graded trials, replacing a previous upload of the same attempt. */
  async uploadTrials(runId: string, upload: UploadTrialsRequest, principal: Principal): Promise<void> {
    const run = await this.ownRun(runId, principal);
    if (run.status !== "running") throw new Conflict(`run ${runId} is ${run.status}`);
    if (upload.attempt > principal.runAttempt) throw new Refused(`attempt ${String(upload.attempt)} hasn't happened`);
    const [shard] = await this.db.select().from(shards).where(and(eq(shards.runId, runId), eq(shards.id, upload.shard)));
    if (shard === undefined) throw new NotFound(`shard ${upload.shard}`);
    const numbers = new Set<number>();
    for (const trial of upload.trials) {
      const mismatch =
        trial.skill !== run.request.spec.skill ||
        trial.harness !== shard.harness ||
        trial.model !== shard.model ||
        trial.arm !== shard.arm ||
        trial.task !== shard.task ||
        trial.attempt !== upload.attempt;
      if (mismatch) throw new Refused(`trial ${String(trial.trial)} doesn't belong to shard ${upload.shard}`);
      if (trial.trial >= run.request.trials || numbers.has(trial.trial)) throw new Refused(`trial number ${String(trial.trial)} out of range or repeated`);
      numbers.add(trial.trial);
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(trials).where(and(eq(trials.runId, runId), eq(trials.shard, upload.shard), eq(trials.attempt, upload.attempt)));
      if (upload.trials.length > 0) {
        await tx.insert(trials).values(
          upload.trials.map((trial) => ({ runId, shard: upload.shard, attempt: upload.attempt, trial: trial.trial, data: trial, artifactId: upload.artifactId })),
        );
      }
    });
  }

  /** Settles every key, prices each trial, computes the results once, and closes the run. */
  async complete(runId: string, principal: Principal): Promise<CompleteRunResponse> {
    const run = await this.ownRun(runId, principal);
    if (run.status === "completed" && run.results !== null) return this.completion(run, run.results);
    if (run.status !== "running") throw new Conflict(`run ${runId} is ${run.status}`);

    await this.keys.settleRun(runId);
    const keyRows = await this.db.select().from(keys).where(eq(keys.runId, runId));
    const published = await this.publishedTrials(run, true);
    const costUsd = keyRows.reduce((sum, key) => sum + (key.usageUsd ?? 0), 0);
    const results = aggregate({
      spec: run.request.spec,
      skillSha: run.request.skillSha,
      skillVersion: run.request.skillVersion,
      trials: published,
      costUsd,
      maxUsd: run.maxUsd,
      checkTitles: run.request.checkTitles,
    });
    await this.db.transaction(async (tx) => {
      for (const trial of published) {
        await tx
          .update(trials)
          .set({ costUsd: trial.costUsd })
          .where(and(eq(trials.runId, runId), eq(trials.shard, trial.shard), eq(trials.attempt, trial.attempt), eq(trials.trial, trial.trial)));
      }
      await tx.update(runs).set({ status: "completed", completedAt: this.clock.now(), results, costUsd }).where(eq(runs.id, runId));
    });
    this.logger.log(`run ${runId} completed: ${String(published.length)} trials, $${costUsd.toFixed(2)}`);
    return this.completion(run, results);
  }

  /** Runs past their TTL: abandoned, their keys disabled (the sweeper settles them). */
  async abandonStale(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - this.env.RUN_TTL_HOURS * 3_600_000);
    const stale = await this.db
      .update(runs)
      .set({ status: "abandoned", completedAt: this.clock.now() })
      .where(and(eq(runs.status, "running"), lt(runs.createdAt, cutoff)))
      .returning({ id: runs.id });
    if (stale.length > 0) this.logger.warn(`abandoned ${stale.map((run) => run.id).join(", ")}`);
    await this.keys.disableRuns(stale.map((run) => run.id));
  }

  async list(): Promise<RunSummary[]> {
    const rows = await this.db.select().from(runs).orderBy(desc(runs.createdAt)).limit(200);
    return rows.map(summaryOf);
  }

  async detail(runId: string): Promise<RunDetail> {
    const run = await this.find(runId);
    const keyRows = await this.db.select().from(keys).where(eq(keys.runId, runId));
    const trialRows = await this.db.select().from(trials).where(eq(trials.runId, runId));
    const billing: ShardBilling[] = keyRows
      .sort((a, b) => a.shard.localeCompare(b.shard) || a.attempt - b.attempt)
      .map((key) => {
        const own = trialRows.filter((row) => row.shard === key.shard && row.attempt === key.attempt);
        const agentTokens = own.length === 0 ? null : own.reduce((sum, row) => sum + totalTokens(row.data), 0);
        const gatewayTokens = key.usageTokens;
        return {
          shard: key.shard,
          attempt: key.attempt,
          costUsd: key.usageUsd,
          gatewayTokens,
          agentTokens,
          tokenMismatch:
            agentTokens !== null && gatewayTokens !== null && gatewayTokens > 0 && Math.abs(agentTokens - gatewayTokens) / gatewayTokens > TOKEN_TOLERANCE,
        };
      });
    return { ...summaryOf(run), tasks: run.request.spec.tasks, shards: await this.shardsOf(runId), billing };
  }

  /** A completed run's trials, as the report and the raw-data API publish them. */
  async trials(runId: string): Promise<PublishedTrial[]> {
    const run = await this.find(runId);
    if (run.status !== "completed") throw new NotFound(`run ${runId} isn't completed`);
    return this.publishedTrials(run, false);
  }

  async results(runId: string): Promise<Results> {
    const run = await this.find(runId);
    if (run.results === null) throw new NotFound(`run ${runId} has no results yet`);
    return run.results;
  }

  private async find(runId: string): Promise<RunRow> {
    const [run] = await this.db.select().from(runs).where(eq(runs.id, runId));
    if (run === undefined) throw new NotFound(`run ${runId}`);
    return run;
  }

  private async ownRun(runId: string, principal: Principal): Promise<RunRow> {
    const run = await this.find(runId);
    if (run.githubRunId !== principal.githubRunId) throw new Forbidden(`run ${runId} belongs to another workflow run`);
    return run;
  }

  private async shardsOf(runId: string): Promise<Shard[]> {
    const rows = await this.db.select().from(shards).where(eq(shards.runId, runId)).orderBy(shards.id);
    return rows.map((row) => ({ id: row.id, harness: row.harness, model: row.model, arm: row.arm, task: row.task }));
  }

  /**
   * The latest attempt of each shard, each trial priced with its share of its key's usage (by the
   * tokens it reported, evenly when none did). `price`: compute from the keys; otherwise read the
   * stored cost.
   */
  private async publishedTrials(run: RunRow, price: boolean): Promise<PublishedTrial[]> {
    const rows = await this.db.select().from(trials).where(eq(trials.runId, run.id));
    const keyRows = await this.db.select().from(keys).where(eq(keys.runId, run.id));
    const latest = new Map<string, number>();
    for (const row of rows) latest.set(row.shard, Math.max(latest.get(row.shard) ?? 0, row.attempt));
    const kept = rows.filter((row) => latest.get(row.shard) === row.attempt);
    const artifactBase = `https://github.com/${this.env.GITHUB_REPOSITORY}/actions/runs/${String(run.githubRunId)}/artifacts/`;
    return kept
      .sort((a, b) => a.shard.localeCompare(b.shard) || a.trial - b.trial)
      .map((row) => {
        let costUsd = row.costUsd ?? 0;
        if (price) {
          const key = keyRows.find((candidate) => candidate.shard === row.shard && candidate.attempt === row.attempt);
          const siblings = kept.filter((other) => other.shard === row.shard);
          const tokens = siblings.reduce((sum, other) => sum + totalTokens(other.data), 0);
          const share = tokens > 0 ? totalTokens(row.data) / tokens : 1 / siblings.length;
          costUsd = (key?.usageUsd ?? 0) * share;
        }
        return { ...row.data, shard: row.shard, costUsd, artifactUrl: `${artifactBase}${String(row.artifactId)}` };
      });
  }

  private completion(run: RunRow, results: Results): CompleteRunResponse {
    const reportUrl = `${this.env.PUBLIC_URL.replace(/\/+$/, "")}/runs/${run.id}`;
    return { reportUrl, summaryMarkdown: summaryMarkdown(results, reportUrl) };
  }
}

/** Cells × arms × tasks, with stable ids: `s001`… in that order. */
export function expand(request: CreateRunRequest): Shard[] {
  const planned: Shard[] = [];
  for (const cell of request.cells) {
    for (const arm of request.arms) {
      for (const task of request.spec.tasks) {
        planned.push({ id: `s${String(planned.length + 1).padStart(3, "0")}`, harness: cell.harness, model: cell.model, arm, task });
      }
    }
  }
  return planned;
}

function totalTokens(trial: { agentReported: { tokens: { input: number; cached: number; output: number } } }): number {
  const { input, cached, output } = trial.agentReported.tokens;
  return input + cached + output;
}

function summaryOf(run: RunRow): RunSummary {
  return {
    runId: run.id,
    githubRunId: run.githubRunId,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    skill: run.request.spec.skill,
    skillSha: run.request.skillSha,
    skillVersion: run.request.skillVersion,
    cells: run.request.cells,
    arms: run.request.arms,
    trials: run.request.trials,
    costUsd: run.costUsd,
    maxUsd: run.maxUsd,
    verdicts: run.results?.overall.verdicts ?? null,
  };
}
