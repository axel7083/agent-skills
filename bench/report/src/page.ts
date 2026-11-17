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

/**
 * Browser entry of the report. Every string from the data goes into the DOM through `textContent`:
 * check evidence and model names are agent- or input-controlled.
 */
import { type PublishedTrial, type Results } from "@podman-desktop/agent-skills-bench-server-client";
import { zPublishedTrial, zResults } from "@podman-desktop/agent-skills-bench-server-client/zod";
import embed from "vega-embed";
import { expressionInterpreter } from "vega-interpreter";
import { z } from "zod";
import { type ChartView, charts, modelLabel } from "./charts.ts";
import { RESULTS_ELEMENT_ID, TRIALS_ELEMENT_ID } from "./html.ts";
import { DARK, LIGHT, type Theme } from "./theme.ts";
import { tiles } from "./tiles.ts";

const ALL_MODELS = "";
const THEME_KEY = "bench-report-theme";

function readIsland<T>(id: string, schema: z.ZodType<T>): T {
  const element = document.getElementById(id);
  if (element?.textContent == null) throw new Error(`report data #${id} is missing`);
  const parsed: unknown = JSON.parse(element.textContent);
  return schema.parse(parsed);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function currentTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark") return DARK;
  if (stored === "light") return LIGHT;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
}

function table(view: ChartView): HTMLElement {
  const details = element("details", "table-view");
  details.append(element("summary", undefined, "Show as a table"));
  const tableElement = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const column of view.table.columns) headRow.append(element("th", undefined, column));
  head.append(headRow);
  const body = element("tbody");
  for (const row of view.table.rows) {
    const tr = element("tr");
    for (const cell of row) tr.append(element("td", undefined, cell));
    body.append(tr);
  }
  tableElement.append(head, body);
  details.append(tableElement);
  return details;
}

function header(results: Results): HTMLElement {
  const node = element("header", "report-header");
  const trialsPerArm = results.models[0]?.without.trials ?? 0;
  node.append(
    element("p", "eyebrow", "Skill benchmark"),
    element("h1", undefined, `${results.skill} ${results.skillVersion}`),
    element(
      "p",
      "subtitle",
      `skill ${results.skillSha.slice(0, 7)} · ${results.tasks.length} tasks · ${results.models.length} models · ${trialsPerArm} trials per model and arm · without vs with the skill`,
    ),
  );
  if (document.body.hasAttribute("data-synthetic")) {
    node.append(element("p", "banner", "⚠ Synthetic data: this page is a mockup of the report, not a benchmark result."));
  }
  return node;
}

function tileRow(results: Results): HTMLElement {
  const row = element("section", "tiles");
  row.setAttribute("aria-label", "Headline numbers");
  for (const tile of tiles(results)) {
    const card = element("div", "tile");
    card.append(element("p", "tile-label", tile.label), element("p", "tile-value", tile.value), element("p", "tile-detail", tile.detail));
    row.append(card);
  }
  return row;
}

interface State {
  model: string;
  theme: Theme;
}

async function renderCharts(container: HTMLElement, results: Results, trials: readonly PublishedTrial[], state: State): Promise<void> {
  const models = state.model === ALL_MODELS ? results.models : results.models.filter((result) => modelLabel(result) === state.model);
  const scoped: Results = { ...results, models };
  const kept = new Set(models.map((result) => `${result.harness}\u0000${result.model}`));
  const scopedTrials = trials.filter((trial) => kept.has(`${trial.harness}\u0000${trial.model}`));

  // Refetch keeps the frame: the previous render stays, dimmed, until the new one is ready.
  container.classList.add("refreshing");
  const sections = charts(scoped, scopedTrials, state.theme).map((view, index) => {
    const section = element("section", "chart");
    section.id = view.id;
    const heading = element("h2", undefined, `${"①②③④⑤⑥"[index] ?? ""} ${view.question}`);
    const plot = element("div", "plot");
    section.append(heading, element("p", "caption", view.caption), plot, table(view));
    return { view, section, plot };
  });
  const fragment = document.createDocumentFragment();
  for (const { section } of sections) {
    if (section.id === "heatmap") {
      const collapsed = element("details", "drill-down");
      // A link to #heatmap opens it.
      collapsed.open = window.location.hash === `#${section.id}`;
      collapsed.append(element("summary", undefined, "⑥ Drill down: task × check"));
      collapsed.append(section);
      fragment.append(collapsed);
    } else {
      fragment.append(section);
    }
  }
  container.replaceChildren(fragment);
  await Promise.all(
    sections.map(({ view, plot }) =>
      embed(plot, view.spec, {
        actions: false,
        renderer: "svg",
        // CSP: no eval, no injected <style> elements.
        ast: true,
        expr: expressionInterpreter,
        defaultStyle: false,
        tooltip: { disableDefaultStyle: true, theme: "custom" },
      }),
    ),
  );
  container.classList.remove("refreshing");
}

function filters(results: Results, state: State, onChange: () => void): HTMLElement {
  const row = element("div", "filters");
  const label = element("label", undefined, "Model ");
  const select = element("select");
  select.append(new Option("All models", ALL_MODELS));
  for (const result of results.models) select.append(new Option(modelLabel(result), modelLabel(result)));
  select.addEventListener("change", () => {
    state.model = select.value;
    onChange();
  });
  label.append(select);

  const toggle = element("button", "theme-toggle");
  toggle.type = "button";
  const sync = (): void => {
    toggle.textContent = state.theme.mode === "dark" ? "☀ Light" : "☾ Dark";
    document.documentElement.dataset["theme"] = state.theme.mode;
  };
  toggle.addEventListener("click", () => {
    state.theme = state.theme.mode === "dark" ? LIGHT : DARK;
    localStorage.setItem(THEME_KEY, state.theme.mode);
    sync();
    onChange();
  });
  sync();
  row.append(label, toggle);
  return row;
}

async function main(): Promise<void> {
  const root = document.getElementById("report");
  if (root === null) return;
  const results = readIsland(RESULTS_ELEMENT_ID, zResults);
  const trials = readIsland(TRIALS_ELEMENT_ID, z.array(zPublishedTrial));
  const state: State = { model: ALL_MODELS, theme: currentTheme() };
  const chartsContainer = element("div", "charts");
  const rerender = (): void => {
    renderCharts(chartsContainer, results, trials, state).catch(showError);
  };
  root.append(header(results), tileRow(results), filters(results, state, rerender), chartsContainer);
  await renderCharts(chartsContainer, results, trials, state);
}

function showError(error: unknown): void {
  const root = document.getElementById("report");
  root?.append(element("p", "banner", `The report failed to render: ${error instanceof Error ? error.message : String(error)}`));
}

main().catch(showError);
