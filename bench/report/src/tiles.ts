import type { Results } from "@podman-desktop/bench-contracts";
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
