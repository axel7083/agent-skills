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

import type { Interval } from "@podman-desktop/agent-skills-bench-server-client";

export function percent(rate: number | null, digits = 0): string {
  return rate === null ? "–" : `${(rate * 100).toFixed(digits)}%`;
}

/** A Δ in percentage points, signed: `+21 pts`. */
export function points(delta: number): string {
  const value = Math.round(delta * 100);
  return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value)} pts`;
}

export function signedPercent(change: number | null): string {
  if (change === null) return "–";
  const value = Math.round(change * 100);
  return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value)}%`;
}

export function usd(value: number): string {
  if (value === 0) return "$0";
  const digits = Math.abs(value) < 0.1 ? 3 : 2;
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(digits)}`;
}

export function signedUsd(value: number): string {
  return value > 0 ? `+${usd(value)}` : usd(value);
}

export function signedNumber(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(digits)}`;
}

/** `+21 pts [+12, +30]` */
export function interval(value: Interval | null): string {
  if (value === null) return "–";
  const bound = (delta: number): string => points(delta).replace(" pts", "");
  return `${points(value.estimate)} [${bound(value.low)}, ${bound(value.high)}]`;
}

export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return value.toFixed(0);
}
