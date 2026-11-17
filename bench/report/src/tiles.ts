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

import type { Results } from "@podman-desktop/agent-skills-bench-server-client";
import { percent, points, signedPercent, usd } from "./format.ts";

/** A headline number: label, value, and the line that qualifies it. Status always carries an icon. */
export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

export function tiles(results: Results): Tile[] {
  const { verdicts, target, tokensPct, triggered, costUsd, maxUsd } = results.overall;
  const models = results.models.length;
  const verdict =
    verdicts.helps === models && models > 0
      ? "✅ Helps"
      : verdicts.hurts > 0
        ? "❌ Hurts"
        : verdicts.helps > 0
          ? "⚠ Mixed"
          : "➖ No effect";
  return [
    {
      label: "Verdict",
      value: verdict,
      detail: `helps ${verdicts.helps} · no effect ${verdicts.noEffect} · hurts ${verdicts.hurts} of ${models} models`,
    },
    {
      label: "Target checks",
      value: target === null ? "–" : points(target.estimate),
      detail: target === null ? "not enough data" : `95% CI ${points(target.low)} to ${points(target.high)}, all models`,
    },
    {
      label: "Tokens per trial",
      value: signedPercent(tokensPct),
      detail: "median, with vs without",
    },
    {
      label: "Skill loaded",
      value: percent(triggered),
      detail: "of the with-skill trials",
    },
    {
      label: "Run cost",
      value: usd(costUsd),
      detail: maxUsd === null ? "gateway usage" : `of the ${usd(maxUsd)} cap, gateway usage`,
    },
  ];
}
