import { describe, expect, it } from "vitest";
import { bootstrapPairedDelta, median, quantile, seededRandom } from "../src/index.ts";

const options = { resamples: 2000, seed: 7, confidence: 0.95 };

describe("seededRandom", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("quantile", () => {
  it("interpolates between ranks", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([0, 10], 0.9)).toBe(9);
    expect(median([])).toBeNull();
  });
});

describe("bootstrapPairedDelta", () => {
  it("recovers a known effect, and its interval covers it", () => {
    const random = seededRandom(1);
    // 8 tasks with different baselines; the treatment adds 0.3 to every trial.
    const clusters = Array.from({ length: 8 }, (_, task) => {
      const base = 0.1 + task * 0.05;
      const noisy = (): number => base + (random() - 0.5) * 0.2;
      return {
        without: Array.from({ length: 5 }, noisy),
        with: Array.from({ length: 5 }, () => noisy() + 0.3),
      };
    });
    const interval = bootstrapPairedDelta(clusters, options);
    expect(interval).not.toBeNull();
    expect(interval?.estimate).toBeCloseTo(0.3, 1);
    expect(interval?.low).toBeLessThan(0.3);
    expect(interval?.high).toBeGreaterThan(0.3);
    expect(interval?.low).toBeGreaterThan(0);
  });

  it("straddles zero when there is no effect", () => {
    const random = seededRandom(2);
    const clusters = Array.from({ length: 6 }, () => ({
      without: Array.from({ length: 5 }, () => (random() < 0.5 ? 1 : 0)),
      with: Array.from({ length: 5 }, () => (random() < 0.5 ? 1 : 0)),
    }));
    const interval = bootstrapPairedDelta(clusters, options);
    expect(interval?.low).toBeLessThan(0);
    expect(interval?.high).toBeGreaterThan(0);
  });

  it("is reproducible for a seed", () => {
    const clusters = [
      { without: [0, 1, 0], with: [1, 1, 0] },
      { without: [0, 0, 0], with: [1, 0, 1] },
    ];
    expect(bootstrapPairedDelta(clusters, options)).toEqual(bootstrapPairedDelta(clusters, options));
  });

  it("ignores clusters missing an arm, and gives null without any pair", () => {
    expect(bootstrapPairedDelta([{ without: [1], with: [] }], options)).toBeNull();
    const interval = bootstrapPairedDelta(
      [
        { without: [0], with: [1] },
        { without: [], with: [0] },
      ],
      options,
    );
    expect(interval).toEqual({ estimate: 1, low: 1, high: 1 });
  });
});
