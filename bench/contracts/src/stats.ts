import type { Interval } from "./results.ts";

/** Mulberry32: a small seeded generator, so a run's intervals are reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Linear interpolation between closest ranks, `q` in [0, 1]. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/** The scores of one cluster (a task, or a model × task) in each arm. */
export interface PairedCluster {
  readonly without: readonly number[];
  readonly with: readonly number[];
}

export interface BootstrapOptions {
  readonly resamples: number;
  readonly seed: number;
  readonly confidence: number;
}

/** Mean over clusters of (mean with − mean without). Clusters missing an arm don't count. */
export function pairedDelta(clusters: readonly PairedCluster[]): number | null {
  const deltas: number[] = [];
  for (const cluster of clusters) {
    const withMean = mean(cluster.with);
    const withoutMean = mean(cluster.without);
    if (withMean !== null && withoutMean !== null) deltas.push(withMean - withoutMean);
  }
  return mean(deltas);
}

/**
 * Paired Δ with a two-stage cluster bootstrap: resample clusters with replacement, then trials
 * within each arm of each drawn cluster. Trials of one task are correlated, so resampling them
 * as independent draws would make the interval too narrow.
 */
export function bootstrapPairedDelta(clusters: readonly PairedCluster[], options: BootstrapOptions): Interval | null {
  const usable = clusters.filter((cluster) => cluster.with.length > 0 && cluster.without.length > 0);
  const estimate = pairedDelta(usable);
  if (estimate === null) return null;
  const random = seededRandom(options.seed);
  const draw = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("bootstrap: cannot draw from an empty sample");
    return item;
  };
  const resampleArm = (scores: readonly number[]): number[] => scores.map(() => draw(scores));
  const statistics: number[] = [];
  for (let index = 0; index < options.resamples; index++) {
    const sample = usable.map(() => {
      const cluster = draw(usable);
      return { without: resampleArm(cluster.without), with: resampleArm(cluster.with) };
    });
    const statistic = pairedDelta(sample);
    if (statistic !== null) statistics.push(statistic);
  }
  const alpha = (1 - options.confidence) / 2;
  return {
    estimate,
    low: quantile(statistics, alpha) ?? estimate,
    high: quantile(statistics, 1 - alpha) ?? estimate,
  };
}
