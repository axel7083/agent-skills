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

import type { ModelResult, Results } from "../contracts/index.ts";
import { interval, percent, points, signedGrouped, signedUsd, usd } from "@podman-desktop/agent-skills-bench-report";

const VERDICTS: Record<NonNullable<ModelResult["verdict"]>, string> = {
  helps: "✅ Helps",
  "no-effect": "➖ No effect",
  hurts: "❌ Hurts",
};

/**
 * The job summary: numbers the server computed, and identifiers validated against enums and
 * patterns (skill, models, harnesses). No text from trials, which agents control.
 */
export function summaryMarkdown(results: Results, reportUrl: string): string {
  const { overall } = results;
  const lines = [
    `## ${results.skill} ${results.skillVersion} — skill benchmark`,
    "",
    `Skill \`${results.skillSha.slice(0, 7)}\` · ${String(results.tasks.length)} tasks · ${String(results.models.length)} models · [full report](${reportUrl})`,
    "",
    `**Taught practices followed ${overall.target === null ? "–" : points(overall.target.estimate)}** (95% range ${
      overall.target === null ? "–" : `${points(overall.target.low)} to ${points(overall.target.high)}`
    }) · skill loaded in ${percent(overall.triggered)} of trials · cost ${usd(overall.costUsd)}${
      overall.maxUsd === null ? "" : ` of ${usd(overall.maxUsd)}`
    }`,
    "",
    "| Model | Verdict | Taught practices followed | Change [95% range] | Tokens the skill adds | Cost / trial | Skill loaded | Works Δ |",
    "|---|---|---|---|---|---|---|---|",
    ...results.models.map((result) =>
      [
        `\`${result.model}\` · ${result.harness}`,
        `${result.verdict === null ? "… Not enough data" : VERDICTS[result.verdict]}${result.regression ? " ⚠ regression" : ""}`,
        `${percent(result.without.target)} → ${percent(result.with.target)}`,
        interval(result.delta.target),
        signedGrouped(result.with.tokens.median - result.without.tokens.median),
        signedUsd(result.delta.costUsd),
        percent(result.with.triggered),
        result.delta.works === null ? "–" : points(result.delta.works.estimate),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |"),
    ),
    "",
  ];
  return lines.join("\n");
}
