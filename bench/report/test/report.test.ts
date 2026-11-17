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

import { aggregate, type PublishedTrial, Results } from "@podman-desktop/agent-skills-bench-contracts";
import * as vega from "vega";
import { compile, type TopLevelSpec } from "vega-lite";
import { describe, expect, it } from "vitest";
import { charts, DARK, jsonForScript, LIGHT, renderReportHtml, tiles } from "../src/index.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const spec = { skill: "containerfile-best-practices", tasks: ["task-a", "task-b"], targets: ["healthcheck"], controls: ["non-root"] };

function trial(arm: "with" | "without", task: string, model: string, passed: boolean, index: number): PublishedTrial {
  return {
    schemaVersion: 1,
    skill: spec.skill,
    arm,
    harness: "opencode",
    model,
    task,
    attempt: 1,
    trial: index,
    works: true,
    failureClass: "none",
    checks: {
      healthcheck: { status: passed ? "pass" : "fail", evidence: "</script><script>alert(1)</script>" },
      "non-root": { status: "pass", evidence: "" },
    },
    agentSeconds: 30 + index,
    agentReported: { triggered: arm === "with", tokens: { input: 1000 + index, cached: 0, output: 10 }, turns: 4, toolCalls: 4 },
    graderCommit: SHA,
    transcriptPath: `t/${index}.json`,
    shard: "shard",
    costUsd: 0.01 + index / 1000,
    artifactUrl: "https://github.com/podman-desktop/agent-skills/actions/runs/1/artifacts/2",
  };
}

const trials = ["model-a", "model-b"].flatMap((model) =>
  spec.tasks.flatMap((task) =>
    Array.from({ length: 3 }, (_, index) => [trial("without", task, model, index === 0, index), trial("with", task, model, true, index)]).flat(),
  ),
);
const results = aggregate({
  spec,
  skillSha: SHA,
  skillVersion: "0.1.0",
  trials,
  costUsd: 0.5,
  maxUsd: 1,
  bootstrap: { resamples: 200, seed: 1, confidence: 0.95 },
});

describe("charts", () => {
  for (const theme of [LIGHT, DARK]) {
    it(`compile and render in ${theme.mode} mode`, async () => {
      const views = charts(results, trials, theme);
      expect(views.map((view) => view.id)).toEqual(["hero", "forest", "dumbbell", "efficiency", "trigger", "heatmap"]);
      for (const view of views) {
        const runtime = new vega.View(vega.parse(compile(view.spec satisfies TopLevelSpec).spec), { renderer: "none" });
        const svg = await runtime.toSVG();
        expect(svg, view.id).toContain("<svg");
        expect(view.table.rows.length, view.id).toBeGreaterThan(0);
        expect(view.table.rows.every((row) => row.length === view.table.columns.length), view.id).toBe(true);
      }
    });
  }

  it("never puts check evidence in a chart", () => {
    for (const view of charts(results, trials, LIGHT)) expect(JSON.stringify(view.spec)).not.toContain("alert(1)");
  });
});

describe("tiles", () => {
  it("lead with the verdict", () => {
    expect(tiles(results)[0]).toMatchObject({ label: "Verdict" });
  });
});

describe("renderReportHtml", () => {
  it("keeps data from closing its script element", () => {
    expect(jsonForScript({ evidence: "</script><b>&" })).toBe('{"evidence":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026"}');
    const html = renderReportHtml({ results, trials, scriptUrl: "report.js", styleUrl: "report.css" });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html.match(/<script/g)).toHaveLength(3);
    expect(html).toContain("script-src &#39;self&#39;");
  });

  it("round-trips the results through the page's data island", () => {
    const html = renderReportHtml({ results, trials, scriptUrl: "report.js", styleUrl: "report.css" });
    const island = /<script type="application\/json" id="bench-results">(.*?)<\/script>/s.exec(html)?.[1] ?? "";
    expect(Results.parse(JSON.parse(island))).toEqual(results);
  });
});
