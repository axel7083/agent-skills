import { aggregate, type PublishedTrial } from "@podman-desktop/bench-contracts";
import { describe, expect, it } from "vitest";
import { expand } from "../../src/runs/runs.service.ts";
import { summaryMarkdown } from "../../src/runs/summary.ts";
import { runRequest, SHA, trialFor } from "../integration/fixtures.ts";

describe("expand", () => {
  it("lays out cells × arms × tasks with stable ids", () => {
    const shards = expand({ ...runRequest, cells: [...runRequest.cells, { harness: "claude-code", model: "glm-4.6" }] });
    expect(shards).toHaveLength(8);
    expect(shards[0]).toEqual({ id: "s001", harness: "opencode", model: "gpt-oss-120b", arm: "without", task: "task-a" });
    expect(shards[7]).toEqual({ id: "s008", harness: "claude-code", model: "glm-4.6", arm: "with", task: "task-b" });
  });
});

describe("summaryMarkdown", () => {
  it("shows the verdict per model and never trial text", () => {
    const trials: PublishedTrial[] = expand(runRequest).flatMap((shard) =>
      [0, 1].map((trial) => ({
        ...trialFor(shard, trial, shard.arm === "with"),
        shard: shard.id,
        costUsd: 0.01,
        artifactUrl: "https://github.com/axel7083/agent-skills/actions/runs/1/artifacts/1",
      })),
    );
    const results = aggregate({ spec: runRequest.spec, skillSha: SHA, skillVersion: "0.1.0", trials, costUsd: 0.08, maxUsd: 4, checkTitles: {} });
    const markdown = summaryMarkdown(results, "https://bench.test/runs/x");
    expect(markdown).toContain("| `gpt-oss-120b` · opencode | ✅ Helps | 0% → 100% |");
    expect(markdown).toContain("[full report](https://bench.test/runs/x)");
    expect(markdown).not.toContain("script");
  });
});
