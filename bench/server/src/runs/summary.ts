import type { ModelResult, Results } from "@podman-desktop/bench-contracts";
import { interval, percent, points, signedPercent, signedUsd, usd } from "@podman-desktop/bench-report";

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
    `**Target checks ${overall.target === null ? "–" : points(overall.target.estimate)}** (95% CI ${
      overall.target === null ? "–" : `${points(overall.target.low)} to ${points(overall.target.high)}`
    }) · tokens ${signedPercent(overall.tokensPct)} · skill loaded in ${percent(overall.triggered)} of trials · cost ${usd(overall.costUsd)}${
      overall.maxUsd === null ? "" : ` of ${usd(overall.maxUsd)}`
    }`,
    "",
    "| Model | Verdict | Target checks | Δ [95% CI] | Tokens | Cost / trial | Skill loaded | Works Δ |",
    "|---|---|---|---|---|---|---|---|",
    ...results.models.map((result) =>
      [
        `\`${result.model}\` · ${result.harness}`,
        `${result.verdict === null ? "… Not enough data" : VERDICTS[result.verdict]}${result.regression ? " ⚠ regression" : ""}`,
        `${percent(result.without.target)} → ${percent(result.with.target)}`,
        interval(result.delta.target),
        signedPercent(result.delta.tokensPct),
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
