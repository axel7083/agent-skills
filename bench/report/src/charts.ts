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

import type { ModelResult, PublishedTrial, Results } from "@podman-desktop/agent-skills-bench-server-client";
import type { TopLevelSpec } from "vega-lite";
import { grouped, interval, percent, points, signedGrouped, signedNumber, signedUsd, usd } from "./format.ts";
import { type Theme, vegaConfig } from "./theme.ts";

/** A chart, the one question it answers, and the same numbers as a table (never tooltip-only). */
export interface ChartView {
  readonly id: string;
  readonly question: string;
  readonly caption: string;
  readonly spec: TopLevelSpec;
  readonly table: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };
}

const WITHOUT = "Without skill";
const WITH = "With skill";
/** What the two kinds of checks are, in the reader's words. */
const TAUGHT = "Taught by the skill";
const NOT_TAUGHT = "Not taught (must not get worse)";
const NOT_TAUGHT_WORSE = "Not taught ⚠ got worse";

/** A model and its harness, the gateway's path prefix dropped: `glm-5-3 · opencode`. */
export function modelLabel(result: Pick<ModelResult, "model" | "harness">): string {
  return `${result.model.split("/").at(-1) ?? result.model} · ${result.harness}`;
}

/** The practices the skill teaches, by title. */
function taughtTitles(results: Results): string {
  return results.targets.map((check) => checkTitle(results, check)).join(", ");
}

/** A y-axis title read horizontally, above the axis, instead of rotated along it. */
function topTitle(title: string): Record<string, unknown> {
  return { title, titleAngle: 0, titleAnchor: "end", titleAlign: "left", titleBaseline: "bottom", titleX: -36, titleY: -14 };
}

interface Label {
  readonly model: string;
  readonly cost: number;
  readonly score: number;
  /** Where the text goes, in the chart's data coordinates. */
  labelScore: number;
  readonly side: "left" | "right";
}

/**
 * Places each model's name next to its *without* point (they spread out; the *with* points pile up
 * at the top), then pushes down a name that would overlap one already placed. The chart's size is
 * estimated: good enough to keep names apart.
 */
function placeLabels(results: Results): Label[] {
  const width = 1000;
  const height = 340;
  const lineHeight = 16;
  const costs = results.models.flatMap((result) => [result.without.costUsd, result.with.costUsd]).filter((cost) => cost > 0);
  const low = Math.log10(Math.min(...costs));
  const span = Math.max(Math.log10(Math.max(...costs)) - low, 0.1);
  const placed: { left: number; right: number; top: number }[] = [];
  return results.models
    .map((result) => ({ result, score: result.without.target ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => {
      const model = modelLabel(result);
      const x = ((Math.log10(Math.max(result.without.costUsd, 1e-9)) - low) / span) * width;
      const side: Label["side"] = x > width / 2 ? "left" : "right";
      const textWidth = model.length * 6.6;
      const left = side === "right" ? x + 12 : x - 12 - textWidth;
      const right = left + textWidth;
      let top = (1 - score) * height - lineHeight / 2;
      while (placed.some((box) => left < box.right && right > box.left && Math.abs(top - box.top) < lineHeight)) top += lineHeight;
      placed.push({ left, right, top });
      return { model, cost: result.without.costUsd, score, labelScore: 1 - (top + lineHeight / 2) / height, side };
    });
}

function checkTitle(results: Results, check: string): string {
  return results.checkTitles[check] ?? check;
}

function armScale(theme: Theme): { domain: string[]; range: string[] } {
  return { domain: [WITHOUT, WITH], range: [theme.without, theme.with] };
}

/** Faceted charts can't fit the container's width: they size from their steps instead. */
function base(theme: Theme, fit = true): Pick<TopLevelSpec, "$schema" | "config" | "autosize"> {
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    config: vegaConfig(theme),
    autosize: fit ? { type: "fit-x", contains: "padding" } : { type: "pad" },
  };
}

/** ① Each model moves from its *without* point to its *with* point: up is better, left is cheaper. */
export function heroChart(results: Results, theme: Theme): ChartView {
  const points_ = results.models.flatMap((result) => [
    { model: modelLabel(result), arm: WITHOUT, cost: result.without.costUsd, score: result.without.target, tokens: result.without.tokens.median },
    { model: modelLabel(result), arm: WITH, cost: result.with.costUsd, score: result.with.target, tokens: result.with.tokens.median },
  ]);
  const labels = placeLabels(results);
  const moves = results.models.map((result) => ({
    model: modelLabel(result),
    x: result.without.costUsd,
    y: result.without.target,
    x2: result.with.costUsd,
    y2: result.with.target,
  }));
  const x = {
    field: "cost",
    type: "quantitative" as const,
    scale: { type: "log" as const, zero: false, nice: false, padding: 24 },
    axis: { format: "$.3~f", title: "Cost per trial (USD, log scale) — left is cheaper", tickCount: 5, grid: false },
  };
  const y = {
    field: "score",
    type: "quantitative" as const,
    scale: { domain: [0, 1] },
    axis: { format: ".0%", tickCount: 5, ...topTitle("Taught practices followed — up is better") },
  };
  // Below the chart: the y-axis title sits at the top left, and inside the plot it would cover the lines.
  const color = { field: "arm", type: "nominal" as const, scale: armScale(theme), legend: { title: null, symbolStrokeWidth: 2, orient: "bottom" as const } };
  const tooltip = [
    { field: "model", title: "Model" },
    { field: "arm", title: "Arm" },
    { field: "score", title: "Taught practices followed", format: ".0%" },
    { field: "cost", title: "Cost per trial", format: "$.4f" },
    { field: "tokens", title: "Tokens, typical trial", format: ",.0f" },
  ];
  return {
    id: "hero",
    question: "Does the skill make agents better, cheaper, or both?",
    caption: "Each line is one model, from ○ without the skill to ● with it. Up: more of the practices the skill teaches are followed. Left: a trial costs less.",
    spec: {
      ...base(theme),
      width: "container",
      height: 340,
      layer: [
        {
          data: { values: moves },
          mark: { type: "rule", strokeWidth: 2, color: theme.muted, strokeCap: "round" },
          encoding: {
            x: { ...x, field: "x" },
            y: { ...y, field: "y" },
            x2: { field: "x2" },
            y2: { field: "y2" },
          },
        },
        {
          data: { values: points_ },
          transform: [{ filter: `datum.arm === '${WITHOUT}'` }],
          mark: { type: "point", filled: false, fill: theme.surface, size: 110, strokeWidth: 2 },
          encoding: { x, y, color, tooltip },
        },
        {
          data: { values: points_ },
          transform: [{ filter: `datum.arm === '${WITH}'` }],
          mark: { type: "circle", size: 110, stroke: theme.surface, strokeWidth: 2, opacity: 1 },
          encoding: { x, y, color, tooltip },
        },
        {
          data: { values: labels },
          transform: [{ filter: "datum.side === 'right'" }],
          mark: { type: "text", align: "left", baseline: "middle", dx: 12, fontSize: 12, color: theme.inkSecondary },
          encoding: { x, y: { ...y, field: "labelScore" }, text: { field: "model" } },
        },
        {
          data: { values: labels },
          transform: [{ filter: "datum.side === 'left'" }],
          mark: { type: "text", align: "right", baseline: "middle", dx: -12, fontSize: 12, color: theme.inkSecondary },
          encoding: { x, y: { ...y, field: "labelScore" }, text: { field: "model" } },
        },
        // Hit targets bigger than the marks.
        {
          data: { values: points_ },
          mark: { type: "circle", size: 700, opacity: 0 },
          encoding: { x, y, tooltip },
        },
      ],
    },
    table: {
      columns: ["Model", "Taught practices followed (without → with)", "Cost per trial (without → with)", "Tokens, typical trial (without → with)"],
      rows: results.models.map((result) => [
        modelLabel(result),
        `${percent(result.without.target)} → ${percent(result.with.target)}`,
        `${usd(result.without.costUsd)} → ${usd(result.with.costUsd)}`,
        `${grouped(result.without.tokens.median)} → ${grouped(result.with.tokens.median)}`,
      ]),
    },
  };
}

function verdictLabel(result: ModelResult): string {
  switch (result.verdict) {
    case "helps":
      return "✅ Helps";
    case "hurts":
      return "❌ Hurts";
    case "no-effect":
      return "➖ No effect";
    case null:
      return "… Not enough data";
  }
}

/** ② Δ with its confidence interval, around zero: is the gain real or noise? */
export function forestChart(results: Results, theme: Theme): ChartView {
  const rows = results.models.flatMap((result) => {
    const label = `${modelLabel(result)}   ${verdictLabel(result)}`;
    const metrics = [
      { metric: TAUGHT, value: result.delta.target },
      { metric: result.regression ? NOT_TAUGHT_WORSE : NOT_TAUGHT, value: result.delta.control },
    ];
    return metrics.flatMap(({ metric, value }) =>
      value === null
        ? []
        : [{ model: label, metric, estimate: value.estimate * 100, low: value.low * 100, high: value.high * 100, text: interval(value) }],
    );
  });
  // Fitted to the intervals, zero always in view, room on the right for each interval's label.
  const lowest = Math.floor((Math.min(0, ...rows.map((row) => row.low)) - 10) / 10) * 10;
  const highest = Math.ceil((Math.max(0, ...rows.map((row) => row.high)) + 45) / 10) * 10;
  const x = {
    field: "estimate",
    type: "quantitative" as const,
    scale: { domain: [lowest, highest], nice: false },
    axis: { title: "Change in checks passed with the skill (percentage points; the bar is the 95% range)", tickCount: 8 },
  };
  const y = { field: "model", type: "nominal" as const, sort: null, axis: { title: null, labelColor: theme.ink, labelPadding: 8, labelLimit: 420 } };
  const yOffset = { field: "metric", sort: null };
  const color = {
    field: "metric",
    type: "nominal" as const,
    scale: { domain: [TAUGHT, NOT_TAUGHT, NOT_TAUGHT_WORSE], range: [theme.with, theme.without, theme.negative] },
    legend: { title: null, labelLimit: 320 },
  };
  const tooltip = [
    { field: "model", title: "Model" },
    { field: "metric", title: "Checks" },
    { field: "text", title: "Change [95% range]" },
  ];
  return {
    id: "forest",
    question: "Is the gain real, or noise?",
    caption: `Blue: the practices the skill teaches (${taughtTitles(results)}). Gray: practices it doesn't mention, which must not get worse. A bar entirely right of 0 is a real gain; one crossing 0 may be chance.`,
    spec: {
      ...base(theme),
      width: "container",
      data: { values: rows },
      height: { step: 30 },
      layer: [
        { mark: { type: "rule", color: theme.axis }, encoding: { x: { datum: 0, type: "quantitative", scale: x.scale } } },
        {
          mark: { type: "rule", strokeWidth: 2, strokeCap: "round" },
          encoding: { y, yOffset, x: { ...x, field: "low" }, x2: { field: "high" }, color, tooltip },
        },
        {
          mark: { type: "circle", size: 90, stroke: theme.surface, strokeWidth: 2, opacity: 1 },
          encoding: { y, yOffset, x, color, tooltip },
        },
        {
          mark: { type: "text", align: "left", dx: 8, fontSize: 12, color: theme.inkSecondary },
          encoding: { y, yOffset, x: { ...x, field: "high" }, text: { field: "text" } },
        },
      ],
    },
    table: {
      columns: ["Model", "Verdict", "Δ target checks [95% CI]", "Δ control checks [95% CI]", "Δ works [95% CI]", "Normalized gain"],
      rows: results.models.map((result) => [
        modelLabel(result),
        verdictLabel(result) + (result.regression ? " · ⚠ regression" : ""),
        interval(result.delta.target),
        interval(result.delta.control),
        interval(result.delta.works),
        percent(result.delta.normalizedGain),
      ]),
    },
  };
}

/** ③ Per check, per model: which practices did the skill fix, and did any control move? */
export function dumbbellChart(results: Results, theme: Theme): ChartView {
  const rows = results.models.flatMap((result) =>
    result.checks
      .filter((check) => check.without.rate !== null || check.with.rate !== null)
      .map((check, order) => ({
        model: modelLabel(result),
        check: `${check.role === "control" ? "Not taught · " : ""}${checkTitle(results, check.check)}`,
        order,
        without: check.without.rate,
        with: check.with.rate,
        delta: check.without.rate === null || check.with.rate === null ? "–" : points(check.with.rate - check.without.rate),
        n: `${check.without.n} / ${check.with.n}`,
      })),
  );
  const long = rows.flatMap((row) => [
    { ...row, arm: WITHOUT, rate: row.without },
    { ...row, arm: WITH, rate: row.with },
  ]);
  const scale = { domain: [0, 1], nice: false, padding: 8 };
  const x = { field: "rate", type: "quantitative" as const, scale, axis: { format: ".0%", title: "Pass rate", tickCount: 5 } };
  const y = { field: "check", type: "nominal" as const, sort: { field: "order" }, axis: { title: null, labelColor: theme.inkSecondary } };
  const color = { field: "arm", type: "nominal" as const, scale: armScale(theme), legend: { title: null } };
  const tooltip = [
    { field: "check", title: "Check" },
    { field: "arm", title: "Arm" },
    { field: "rate", title: "Pass rate", format: ".0%" },
    { field: "delta", title: "Δ" },
    { field: "n", title: "Trials (without / with)" },
  ];
  return {
    id: "dumbbell",
    question: "What exactly did the skill fix?",
    caption: "○ without the skill, ● with it. The practices the skill teaches come first; the ones it doesn't (\"Not taught\") should not move.",
    spec: {
      ...base(theme, false),
      data: { values: long },
      facet: { field: "model", type: "nominal", title: null, header: { labelAnchor: "start", labelAlign: "left" } },
      columns: 2,
      resolve: { scale: { y: "independent" } },
      spec: {
        width: 300,
        height: { step: 24 },
        encoding: { y },
        layer: [
          {
            transform: [{ filter: `datum.arm === '${WITH}'` }],
            mark: { type: "rule", strokeWidth: 2, color: theme.axis, strokeCap: "round" },
            encoding: { x: { field: "without", type: "quantitative", scale }, x2: { field: "with" } },
          },
          {
            transform: [{ filter: `datum.arm === '${WITHOUT}'` }],
            mark: { type: "point", filled: false, fill: theme.surface, size: 80, strokeWidth: 2 },
            encoding: { x, color, tooltip },
          },
          {
            transform: [{ filter: `datum.arm === '${WITH}'` }],
            mark: { type: "circle", size: 80, stroke: theme.surface, strokeWidth: 2, opacity: 1 },
            encoding: { x, color, tooltip },
          },
          { mark: { type: "circle", size: 500, opacity: 0 }, encoding: { x, tooltip } },
        ],
      },
    },
    table: {
      columns: ["Model", "Check", "Without", "With", "Δ", "Trials (without / with)"],
      rows: rows.map((row) => [row.model, row.check, percent(row.without), percent(row.with), row.delta, row.n]),
    },
  };
}

interface Measure {
  readonly key: "tokens" | "turns" | "seconds";
  readonly title: string;
  readonly format: string;
  readonly value: (trial: PublishedTrial) => number;
  readonly change: (result: ModelResult) => string;
}

const MEASURES: readonly Measure[] = [
  {
    key: "tokens",
    title: "Tokens per trial",
    format: "~s",
    value: (trial) => trial.agentReported.tokens.input + trial.agentReported.tokens.cached + trial.agentReported.tokens.output,
    change: (result) => `skill adds ${signedGrouped(result.with.tokens.median - result.without.tokens.median)} tokens`,
  },
  {
    key: "turns",
    title: "Turns per trial",
    format: "~d",
    value: (trial) => trial.agentReported.turns,
    change: (result) => `skill adds ${signedNumber(result.delta.turns)} turns`,
  },
  {
    key: "seconds",
    title: "Agent time per trial (s)",
    format: "~d",
    value: (trial) => trial.agentSeconds,
    change: (result) => `skill adds ${signedNumber(result.delta.seconds)} s`,
  },
];

/** ④ What the skill costs the agent: one panel per measure, never two scales on one axis. */
export function efficiencyChart(results: Results, trials: readonly PublishedTrial[], theme: Theme): ChartView {
  const labels = new Map(results.models.map((result) => [`${result.harness}\u0000${result.model}`, modelLabel(result)]));
  const rows = trials
    .filter((trial) => trial.arm !== "bundle")
    .map((trial) => ({
      model: labels.get(`${trial.harness}\u0000${trial.model}`) ?? `${trial.model} · ${trial.harness}`,
      arm: trial.arm === "with" ? WITH : WITHOUT,
      tokens: MEASURES[0]?.value(trial) ?? 0,
      turns: trial.agentReported.turns,
      seconds: trial.agentSeconds,
    }));
  const color = { field: "arm", type: "nominal" as const, scale: armScale(theme), legend: { title: null } };
  const panels = MEASURES.map((measure) => {
    const max = Math.max(1, ...rows.map((row) => row[measure.key]));
    const notes = results.models.map((result) => ({ model: modelLabel(result), x: max, note: measure.change(result) }));
    const y = { field: "model", type: "nominal" as const, sort: null, axis: { title: null, labelColor: theme.ink } };
    return {
      width: "container" as const,
      height: { step: 22 },
      title: measure.title,
      layer: [
        {
          data: { values: rows },
          mark: {
            type: "boxplot" as const,
            extent: "min-max" as const,
            size: 14,
            median: { color: theme.surface, strokeWidth: 2 },
            rule: { color: theme.muted },
          },
          encoding: {
            y,
            yOffset: { field: "arm", sort: [WITHOUT, WITH] },
            x: {
              field: measure.key,
              type: "quantitative" as const,
              scale: { domainMax: max * 1.35 },
              axis: { format: measure.format, title: null, tickCount: 5 },
            },
            color,
          },
        },
        {
          data: { values: notes },
          mark: { type: "text" as const, align: "left" as const, dx: 10, fontSize: 12, color: theme.inkSecondary },
          encoding: { y, x: { field: "x", type: "quantitative" as const }, text: { field: "note" } },
        },
      ],
    };
  });
  return {
    id: "efficiency",
    question: "What does the skill cost the agent?",
    caption: "What the skill adds to a typical trial (right of each model), and the spread: the box holds the middle half of the trials, the line inside is the typical one, the whiskers reach the lowest and highest. Tokens and turns are agent-reported.",
    spec: { ...base(theme), vconcat: panels, spacing: 24 },
    table: {
      columns: ["Model", "Tokens, typical trial (without → with)", "Turns", "Seconds", "Cost per trial", "Cost per success"],
      rows: results.models.map((result) => [
        modelLabel(result),
        `${grouped(result.without.tokens.median)} → ${grouped(result.with.tokens.median)} (${signedGrouped(result.with.tokens.median - result.without.tokens.median)})`,
        `${result.without.turns.toFixed(0)} → ${result.with.turns.toFixed(0)}`,
        `${result.without.seconds.toFixed(0)} → ${result.with.seconds.toFixed(0)}`,
        `${usd(result.without.costUsd)} → ${usd(result.with.costUsd)} (${signedUsd(result.delta.costUsd)})`,
        `${result.without.costPerSuccessUsd === null ? "–" : usd(result.without.costPerSuccessUsd)} → ${
          result.with.costPerSuccessUsd === null ? "–" : usd(result.with.costPerSuccessUsd)
        }`,
      ]),
    },
  };
}

const LOADED_SUCCESS = "Loaded · succeeded";
const LOADED_FAILURE = "Loaded · failed";
const NOT_LOADED = "Not loaded";

/** ⑤ Did the agent even load the skill? Separates a weak skill from a description that never triggers. */
export function triggerChart(results: Results, theme: Theme): ChartView {
  const rows = results.models.flatMap((result) => {
    const model = modelLabel(result);
    return [
      { model, segment: LOADED_SUCCESS, order: 0, count: result.trigger.loadedSuccess },
      { model, segment: LOADED_FAILURE, order: 1, count: result.trigger.loadedFailure },
      { model, segment: NOT_LOADED, order: 2, count: result.trigger.notLoaded },
    ];
  });
  const notes = results.models.map((result) => ({ model: modelLabel(result), note: `${percent(result.with.triggered)} loaded` }));
  const y = { field: "model", type: "nominal" as const, sort: null, axis: { title: null, labelColor: theme.ink } };
  return {
    id: "trigger",
    question: "Did the agent even load the skill?",
    caption: "With-skill trials only. Many “not loaded” trials point at the skill's description, not its content.",
    spec: {
      ...base(theme),
      width: "container",
      height: { step: 34 },
      layer: [
        {
          data: { values: rows },
          mark: { type: "bar", size: 22, cornerRadius: 0, stroke: theme.surface, strokeWidth: 2 },
          encoding: {
            y,
            x: { field: "count", type: "quantitative", stack: "normalize", axis: { format: ".0%", title: null, values: [0, 0.25, 0.5, 0.75, 1] }, scale: { domain: [0, 1.25] } },
            color: {
              field: "segment",
              type: "nominal",
              scale: { domain: [LOADED_SUCCESS, LOADED_FAILURE, NOT_LOADED], range: [theme.with, theme.withLight, theme.axis] },
              legend: { title: null },
            },
            order: { field: "order" },
            tooltip: [
              { field: "model", title: "Model" },
              { field: "segment", title: "Trials" },
              { field: "count", title: "Count" },
            ],
          },
        },
        {
          data: { values: notes },
          mark: { type: "text", align: "left", dx: 8, fontSize: 12, color: theme.inkSecondary },
          encoding: { y, x: { datum: 1 }, text: { field: "note" } },
        },
      ],
    },
    table: {
      columns: ["Model", LOADED_SUCCESS, LOADED_FAILURE, NOT_LOADED, "Loaded"],
      rows: results.models.map((result) => [
        modelLabel(result),
        String(result.trigger.loadedSuccess),
        String(result.trigger.loadedFailure),
        String(result.trigger.notLoaded),
        percent(result.with.triggered),
      ]),
    },
  };
}

/** ⑥ Task × check Δ, for finding where a skill helps or hurts. */
export function heatmapChart(results: Results, theme: Theme): ChartView {
  const checks = [...results.targets, ...results.controls];
  const rows = results.models.flatMap((result) =>
    result.tasks.flatMap((task) =>
      checks.map((check, order) => {
        const delta = task.checks[check] ?? null;
        return {
          model: modelLabel(result),
          task: task.task,
          check: `${results.controls.includes(check) ? "Not taught · " : ""}${checkTitle(results, check)}`,
          order,
          delta: delta === null ? null : delta * 100,
          text: delta === null ? "n/a" : points(delta),
        };
      }),
    ),
  );
  return {
    id: "heatmap",
    question: "Where, task by task, did each check move?",
    caption: "Δ pass rate per task and check. Blue: better with the skill, red: worse, gray cross: the check doesn't apply.",
    spec: {
      ...base(theme, false),
      data: { values: rows },
      facet: { row: { field: "model", type: "nominal", title: null, header: { labelAngle: 0, labelAlign: "left", labelAnchor: "start", labelOrient: "top" } } },
      spec: {
        width: { step: 64 },
        height: { step: 24 },
        encoding: {
          x: { field: "task", type: "nominal", axis: { title: null, labelAngle: -30, orient: "top" } },
          y: { field: "check", type: "nominal", sort: { field: "order" }, axis: { title: null, labelColor: theme.inkSecondary } },
          tooltip: [
            { field: "task", title: "Task" },
            { field: "check", title: "Check" },
            { field: "text", title: "Δ pass rate" },
          ],
        },
        layer: [
          {
            transform: [{ filter: "datum.delta !== null" }],
            mark: { type: "rect", stroke: theme.surface, strokeWidth: 2, cornerRadius: 3 },
            encoding: {
              color: {
                field: "delta",
                type: "quantitative",
                scale: { domain: [-100, 0, 100], range: [theme.negative, theme.neutral, theme.positive], interpolate: "lab" },
                legend: { title: "Δ pts", orient: "right", gradientLength: 120 },
              },
            },
          },
          {
            transform: [{ filter: "datum.delta === null" }],
            mark: { type: "text", text: "×", color: theme.muted, fontSize: 12 },
          },
        ],
      },
      resolve: { scale: { y: "shared" } },
    },
    table: {
      columns: ["Model", "Task", "Check", "Δ pass rate"],
      rows: rows.map((row) => [row.model, row.task, row.check, row.text]),
    },
  };
}

export function charts(results: Results, trials: readonly PublishedTrial[], theme: Theme): ChartView[] {
  return [
    heroChart(results, theme),
    forestChart(results, theme),
    dumbbellChart(results, theme),
    efficiencyChart(results, trials, theme),
    triggerChart(results, theme),
    heatmapChart(results, theme),
  ];
}
