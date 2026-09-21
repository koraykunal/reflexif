import type { SemanticSignals } from "./types.ts";

export type SignalSample = {
  atMs: number;
  signals: SemanticSignals;
};

export type TemporalCondition = {
  test(samples: readonly SignalSample[]): boolean;
};

type SampledCondition = TemporalCondition & {
  for(durationMs: number, maxGapMs?: number): TemporalCondition;
  samples(required: number, windowSize: number): TemporalCondition;
};

function sampledCondition(
  name: keyof SemanticSignals,
  predicate: (value: number) => boolean,
): SampledCondition {
  const current = (samples: readonly SignalSample[]) => {
    const latest = samples.at(-1);
    return latest ? predicate(latest.signals[name]) : false;
  };

  return {
    test: current,
    for(durationMs, maxGapMs = durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError("Duration must be non-negative.");
      if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new RangeError("Maximum sample gap must be positive.");
      return {
        test(samples) {
          const latest = samples.at(-1);
          if (!latest || !predicate(latest.signals[name])) return false;

          let oldestPassingAt = latest.atMs;
          for (let index = samples.length - 2; index >= 0; index -= 1) {
            if (!predicate(samples[index].signals[name])) break;
            if (samples[index + 1].atMs - samples[index].atMs > maxGapMs) break;
            oldestPassingAt = samples[index].atMs;
          }
          return latest.atMs - oldestPassingAt >= durationMs;
        },
      };
    },
    samples(required, windowSize) {
      if (!Number.isInteger(required) || !Number.isInteger(windowSize) || required < 1 || windowSize < required) {
        throw new RangeError("Sample windows require positive integers with required <= windowSize.");
      }
      return {
        test(samples) {
          const window = samples.slice(-windowSize);
          return window.length >= required && window.filter((sample) => predicate(sample.signals[name])).length >= required;
        },
      };
    },
  };
}

export function signal(name: keyof SemanticSignals) {
  return {
    above: (threshold: number) => sampledCondition(name, (value) => value >= threshold),
    below: (threshold: number) => sampledCondition(name, (value) => value <= threshold),
  };
}

export const all = (...conditions: readonly TemporalCondition[]): TemporalCondition => ({
  test: (samples) => conditions.every((condition) => condition.test(samples)),
});

export const any = (...conditions: readonly TemporalCondition[]): TemporalCondition => ({
  test: (samples) => conditions.some((condition) => condition.test(samples)),
});

export const not = (condition: TemporalCondition): TemporalCondition => ({
  test: (samples) => !condition.test(samples),
});
