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

import type { Harness } from "./ids.ts";
import type { ArmSummary, CheckRate, ModelResult, Results, TaskDelta, Trigger, Verdict } from "./results.ts";
import { type BootstrapOptions, bootstrapPairedDelta, mean, median, type PairedCluster, quantile } from "./stats.ts";
import { type EvalSpec, type PublishedTrial, SCHEMA_VERSION } from "./trial.ts";

export const DEFAULT_BOOTSTRAP: BootstrapOptions = { resamples: 10_000, seed: 20_261_117, confidence: 0.95 };

export interface AggregateInput {
  readonly spec: EvalSpec;
  readonly skillSha: string;
  readonly skillVersion: string;
  readonly trials: readonly PublishedTrial[];
  /** The gateway's total for the run, which also covers trials that never got graded. */
  readonly costUsd: number;
  readonly maxUsd: number | null;
  readonly checkTitles?: Readonly<Record<string, string>>;
  readonly bootstrap?: BootstrapOptions;
}

/** Share of the applicable checks (pass or fail) that passed; null when none applied. */
export function checkScore(trial: PublishedTrial, checks: readonly string[]): number | null {
  let passed = 0;
  let applicable = 0;
  for (const id of checks) {
    const status = trial.checks[id]?.status;
    if (status === "pass") passed++;
    if (status === "pass" || status === "fail") applicable++;
  }
  return applicable === 0 ? null : passed / applicable;
}

/** It works, and every applicable target check passes. */
export function isSuccess(trial: PublishedTrial, targets: readonly string[]): boolean {
  return trial.works && checkScore(trial, targets) === 1;
}

function totalTokens(trial: PublishedTrial): number {
  const { input, cached, output } = trial.agentReported.tokens;
  return input + cached + output;
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

function summarize(trials: readonly PublishedTrial[], spec: EvalSpec, withSkill: boolean): ArmSummary {
  const successes = trials.filter((trial) => isSuccess(trial, spec.targets)).length;
  const costUsd = trials.reduce((sum, trial) => sum + trial.costUsd, 0);
  const tokens = trials.map(totalTokens);
  return {
    trials: trials.length,
    works: mean(trials.map((trial) => (trial.works ? 1 : 0))),
    target: mean(present(trials.map((trial) => checkScore(trial, spec.targets)))),
    control: mean(present(trials.map((trial) => checkScore(trial, spec.controls)))),
    successes,
    tokens: { median: median(tokens) ?? 0, p90: quantile(tokens, 0.9) ?? 0 },
    turns: median(trials.map((trial) => trial.agentReported.turns)) ?? 0,
    seconds: median(trials.map((trial) => trial.agentSeconds)) ?? 0,
    costUsd: trials.length === 0 ? 0 : costUsd / trials.length,
    costPerSuccessUsd: successes === 0 ? null : costUsd / successes,
    triggered: withSkill ? mean(trials.map((trial) => (trial.agentReported.triggered ? 1 : 0))) : null,
  };
}

function clusters(
  trials: readonly PublishedTrial[],
  keyOf: (trial: PublishedTrial) => string,
  score: (trial: PublishedTrial) => number | null,
): PairedCluster[] {
  const byKey = new Map<string, { without: number[]; with: number[] }>();
  for (const trial of trials) {
    if (trial.arm === "bundle") continue;
    const value = score(trial);
    if (value === null) continue;
    const key = keyOf(trial);
    const cluster = byKey.get(key) ?? { without: [], with: [] };
    cluster[trial.arm].push(value);
    byKey.set(key, cluster);
  }
  return [...byKey.values()];
}

function verdictOf(interval: { low: number; high: number } | null): Verdict | null {
  if (interval === null) return null;
  if (interval.low > 0) return "helps";
  if (interval.high < 0) return "hurts";
  return "no-effect";
}

function passRate(trials: readonly PublishedTrial[], check: string): { rate: number | null; n: number } {
  let passed = 0;
  let n = 0;
  for (const trial of trials) {
    const status = trial.checks[check]?.status;
    if (status === "pass") passed++;
    if (status === "pass" || status === "fail") n++;
  }
  return { rate: n === 0 ? null : passed / n, n };
}

function relativeChange(before: number, after: number): number | null {
  return before === 0 ? null : after / before - 1;
}

function modelResult(
  harness: Harness,
  model: string,
  trials: readonly PublishedTrial[],
  spec: EvalSpec,
  bootstrap: BootstrapOptions,
): ModelResult {
  const without = trials.filter((trial) => trial.arm === "without");
  const withSkill = trials.filter((trial) => trial.arm === "with");
  const before = summarize(without, spec, false);
  const after = summarize(withSkill, spec, true);
  const byTask = (trial: PublishedTrial): string => trial.task;

  const target = bootstrapPairedDelta(
    clusters(trials, byTask, (trial) => checkScore(trial, spec.targets)),
    bootstrap,
  );
  const control =
    spec.controls.length === 0
      ? null
      : bootstrapPairedDelta(
          clusters(trials, byTask, (trial) => checkScore(trial, spec.controls)),
          bootstrap,
        );
  const works = bootstrapPairedDelta(
    clusters(trials, byTask, (trial) => (trial.works ? 1 : 0)),
    bootstrap,
  );

  const trigger: Trigger = { loadedSuccess: 0, loadedFailure: 0, notLoaded: 0 };
  for (const trial of withSkill) {
    if (!trial.agentReported.triggered) trigger.notLoaded++;
    else if (isSuccess(trial, spec.targets)) trigger.loadedSuccess++;
    else trigger.loadedFailure++;
  }

  const checks: CheckRate[] = [
    ...spec.targets.map((check) => ({ check, role: "target" as const })),
    ...spec.controls.map((check) => ({ check, role: "control" as const })),
  ].map(({ check, role }) => ({ check, role, without: passRate(without, check), with: passRate(withSkill, check) }));

  const tasks: TaskDelta[] = spec.tasks.map((task) => {
    const taskWithout = without.filter((trial) => trial.task === task);
    const taskWith = withSkill.filter((trial) => trial.task === task);
    const deltas: Record<string, number | null> = {};
    for (const check of [...spec.targets, ...spec.controls]) {
      const a = passRate(taskWithout, check).rate;
      const b = passRate(taskWith, check).rate;
      deltas[check] = a === null || b === null ? null : b - a;
    }
    return {
      task,
      target: {
        without: mean(present(taskWithout.map((trial) => checkScore(trial, spec.targets)))),
        with: mean(present(taskWith.map((trial) => checkScore(trial, spec.targets)))),
      },
      checks: deltas,
    };
  });

  const normalizedGain =
    before.target === null || after.target === null || before.target >= 1
      ? null
      : (after.target - before.target) / (1 - before.target);

  return {
    harness,
    model,
    without: before,
    with: after,
    delta: {
      target,
      control,
      works,
      normalizedGain,
      tokensPct: relativeChange(before.tokens.median, after.tokens.median),
      costUsd: after.costUsd - before.costUsd,
      turns: after.turns - before.turns,
      seconds: after.seconds - before.seconds,
    },
    verdict: verdictOf(target),
    regression: (control !== null && control.high < 0) || (works !== null && works.high < 0),
    trigger,
    checks,
    tasks,
  };
}

/** Everything the report shows, computed once when a run completes. */
export function aggregate(input: AggregateInput): Results {
  const { spec, trials } = input;
  const bootstrap = input.bootstrap ?? DEFAULT_BOOTSTRAP;

  const cells = new Map<string, { harness: Harness; model: string; trials: PublishedTrial[] }>();
  for (const trial of trials) {
    const key = `${trial.harness}\u0000${trial.model}`;
    const cell = cells.get(key) ?? { harness: trial.harness, model: trial.model, trials: [] };
    cell.trials.push(trial);
    cells.set(key, cell);
  }
  const models = [...cells.values()]
    .sort((a, b) => a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model))
    .map((cell) => modelResult(cell.harness, cell.model, cell.trials, spec, bootstrap));

  const verdicts = { helps: 0, noEffect: 0, hurts: 0 };
  for (const result of models) {
    if (result.verdict === "helps") verdicts.helps++;
    if (result.verdict === "no-effect") verdicts.noEffect++;
    if (result.verdict === "hurts") verdicts.hurts++;
  }
  const withSkill = trials.filter((trial) => trial.arm === "with");
  const medianWithout = median(trials.filter((trial) => trial.arm === "without").map(totalTokens));
  const medianWith = median(withSkill.map(totalTokens));

  return {
    schemaVersion: SCHEMA_VERSION,
    skill: spec.skill,
    skillSha: input.skillSha,
    skillVersion: input.skillVersion,
    tasks: spec.tasks,
    targets: spec.targets,
    controls: spec.controls,
    checkTitles: { ...input.checkTitles },
    bootstrap,
    models,
    overall: {
      verdicts,
      // Clusters are model × task: each model's tasks are separate, correlated groups of trials.
      target: bootstrapPairedDelta(
        clusters(
          trials,
          (trial) => `${trial.harness}\u0000${trial.model}\u0000${trial.task}`,
          (trial) => checkScore(trial, spec.targets),
        ),
        bootstrap,
      ),
      tokensPct: medianWithout === null || medianWith === null ? null : relativeChange(medianWithout, medianWith),
      triggered: mean(withSkill.map((trial) => (trial.agentReported.triggered ? 1 : 0))),
      costUsd: input.costUsd,
      maxUsd: input.maxUsd,
    },
  };
}
