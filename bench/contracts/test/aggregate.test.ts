import { describe, expect, it } from "vitest";
import { aggregate, checkScore, type PublishedTrial, Results } from "../src/index.ts";
import { grid, SHA, spec, trial } from "./fixtures.ts";

const bootstrap = { resamples: 1000, seed: 3, confidence: 0.95 };

function run(trials: PublishedTrial[]): Results {
  return aggregate({ spec, skillSha: SHA, skillVersion: "0.1.0", trials, costUsd: 1, maxUsd: 5, bootstrap });
}

describe("checkScore", () => {
  it("counts pass and fail, and skips na and error", () => {
    const t = trial({ arm: "with", task: "task-a", target: [true, false] });
    expect(checkScore(t, spec.targets)).toBe(0.5);
    t.checks["digest"] = { status: "na", evidence: "" };
    expect(checkScore(t, spec.targets)).toBe(1);
    t.checks["healthcheck"] = { status: "error", evidence: "" };
    expect(checkScore(t, spec.targets)).toBeNull();
  });
});

describe("aggregate", () => {
  it("says a skill helps when every task improves", () => {
    const results = run(grid(5, [
      { arm: "without", target: [false, false] },
      { arm: "with", target: [true, true] },
    ]));
    const [model] = results.models;
    expect(model?.verdict).toBe("helps");
    expect(model?.delta.target).toEqual({ estimate: 1, low: 1, high: 1 });
    expect(model?.delta.normalizedGain).toBe(1);
    expect(model?.with.successes).toBe(15);
    expect(model?.trigger).toEqual({ loadedSuccess: 15, loadedFailure: 0, notLoaded: 0 });
    expect(results.overall.verdicts).toEqual({ helps: 1, noEffect: 0, hurts: 0 });
    expect(Results.parse(results)).toEqual(results);
  });

  it("says no effect when the arms are the same, and flags a broken control", () => {
    const results = run(grid(5, [
      { arm: "without", target: [true, false], control: true },
      { arm: "with", target: [true, false], control: false },
    ]));
    const [model] = results.models;
    expect(model?.verdict).toBe("no-effect");
    expect(model?.regression).toBe(true);
    expect(model?.delta.control?.estimate).toBe(-1);
  });

  it("reports the change in median tokens and the trigger split", () => {
    const results = run([
      ...grid(2, [{ arm: "without", target: [false, false], tokens: 2000 }]),
      ...grid(1, [{ arm: "with", target: [true, true], tokens: 1000, triggered: true }]),
      ...grid(1, [{ arm: "with", target: [false, false], tokens: 1000, triggered: false }]),
    ]);
    const [model] = results.models;
    expect(model?.delta.tokensPct).toBe(-0.5);
    expect(model?.trigger).toEqual({ loadedSuccess: 3, loadedFailure: 0, notLoaded: 3 });
    expect(model?.with.triggered).toBe(0.5);
    expect(model?.without.triggered).toBeNull();
  });

  it("keeps one result per model, with per-check and per-task deltas", () => {
    const results = run([
      ...grid(2, [
        { arm: "without", target: [false, true], model: "model-b" },
        { arm: "with", target: [true, true], model: "model-b" },
      ]),
      ...grid(2, [
        { arm: "without", target: [false, false] },
        { arm: "with", target: [false, false] },
      ]),
    ]);
    expect(results.models.map((model) => model.model)).toEqual(["model-a", "model-b"]);
    const modelB = results.models[1];
    const healthcheck = modelB?.checks.find((check) => check.check === "healthcheck");
    expect(healthcheck).toEqual({ check: "healthcheck", role: "target", without: { rate: 0, n: 6 }, with: { rate: 1, n: 6 } });
    expect(modelB?.tasks[0]?.checks["healthcheck"]).toBe(1);
    expect(modelB?.tasks[0]?.checks["digest"]).toBe(0);
  });
});
