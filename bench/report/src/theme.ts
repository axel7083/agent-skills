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

import type { Config } from "vega-lite";

/**
 * The report's colors, one set per mode (the dataviz reference palette). Arms are the only
 * categorical encoding and keep the same colors in every chart: *without* is the de-emphasis gray,
 * *with* the accent blue. Validated with the dataviz palette validator: CVD ΔE 15.9, contrast ≥ 3:1
 * in both modes (the gray is gray on purpose, the emphasis form).
 */
export interface Theme {
  readonly mode: "light" | "dark";
  readonly surface: string;
  readonly ink: string;
  readonly inkSecondary: string;
  readonly muted: string;
  readonly grid: string;
  readonly axis: string;
  readonly without: string;
  readonly with: string;
  /** Lighter step of the accent, for "loaded but failed". */
  readonly withLight: string;
  /** Diverging poles and neutral midpoint, for Δ heatmaps. */
  readonly negative: string;
  readonly neutral: string;
  readonly positive: string;
}

export const LIGHT: Theme = {
  mode: "light",
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  inkSecondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  without: "#898781",
  with: "#2a78d6",
  withLight: "#86b6ef",
  negative: "#e34948",
  neutral: "#f0efec",
  positive: "#2a78d6",
};

export const DARK: Theme = {
  mode: "dark",
  surface: "#1a1a19",
  ink: "#f0efec",
  inkSecondary: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
  without: "#898781",
  with: "#3987e5",
  withLight: "#184f95",
  negative: "#e66767",
  neutral: "#383835",
  positive: "#3987e5",
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Recessive chrome: hairline solid grid, muted axis labels, text in ink tokens only. */
export function vegaConfig(theme: Theme): Config {
  return {
    background: theme.surface,
    font: FONT,
    // Tooltips and labels without a format of their own: grouped by thousands (106,470, not 106470).
    numberFormat: ",.6~r",
    padding: 8,
    view: { stroke: null },
    axis: {
      domainColor: theme.axis,
      tickColor: theme.axis,
      gridColor: theme.grid,
      gridWidth: 1,
      labelColor: theme.muted,
      titleColor: theme.inkSecondary,
      labelFontSize: 12,
      titleFontSize: 12,
      titleFontWeight: 500,
      labelLimit: 260,
    },
    legend: {
      labelColor: theme.inkSecondary,
      titleColor: theme.inkSecondary,
      labelFontSize: 12,
      titleFontSize: 12,
      orient: "top",
    },
    header: { labelColor: theme.ink, titleColor: theme.ink, labelFontSize: 13, labelFontWeight: 600 },
    title: { color: theme.ink, fontSize: 13, anchor: "start" },
    text: { color: theme.inkSecondary, fontSize: 12 },
    rule: { color: theme.axis },
    line: { strokeWidth: 2, strokeCap: "round", strokeJoin: "round" },
    point: { size: 90, strokeWidth: 2 },
    bar: { cornerRadiusEnd: 4 },
  };
}
