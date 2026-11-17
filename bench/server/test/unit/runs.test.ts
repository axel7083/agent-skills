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

import { aggregate, type PublishedTrial } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";
import { shareOf } from "../../src/keys/keys.service.ts";
import { PriceList } from "../../src/keys/prices.ts";
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

describe("shareOf", () => {
  const prices = new PriceList({ dear: { input: 4e-6, output: 2e-5 }, cheap: { input: 1e-7, output: 5e-7 } });

  it("weights each shard's share of the run by its model's price", () => {
    const shards = [{ model: "dear" }, { model: "dear" }, { model: "cheap" }, { model: "cheap" }];
    expect(shareOf("dear", shards, prices) * 2 + shareOf("cheap", shards, prices) * 2).toBeCloseTo(1);
    expect(shareOf("dear", shards, prices) / shareOf("cheap", shards, prices)).toBeCloseTo(40);
  });

  it("splits evenly on one model", () => {
    expect(shareOf("cheap", [{ model: "cheap" }, { model: "cheap" }, { model: "cheap" }], prices)).toBeCloseTo(1 / 3);
  });
});
