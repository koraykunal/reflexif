import type { DecisionEvent } from "./ledger.ts";
import {
  replayDecisionEvents,
  type EventReplayResult,
  type ReplayPolicy,
} from "./replay.ts";
import type { RobotMode } from "./types.ts";

export type OutcomeLabel = {
  sessionId: string;
  sequence: number;
  expectedMode: RobotMode;
  expectedHandoffRequested?: boolean;
};

export type OutcomeMetrics = {
  labeledEvents: number;
  coverage: number;
  exactAccuracy: number;
  falsePositiveFrames: number;
  falseNegativeFrames: number;
  abstentionRate: number;
  brierScore: number | null;
  calibrationError: number | null;
};

export type RegressionBudgets = {
  maxAccuracyDrop: number;
  maxFalsePositiveIncrease: number;
  maxFalseNegativeIncrease: number;
  maxAbstentionIncrease: number;
};

export type CandidatePolicyConfig = ReplayPolicy & {
  name: string;
  budgets: RegressionBudgets;
};

const key = ({ sessionId, sequence }: { sessionId: string; sequence: number }) =>
  `${sessionId}:${sequence}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isProbability = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1;
const isNonNegative = (value: unknown): value is number => isFiniteNumber(value) && value >= 0;
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

export function parseCandidatePolicy(contents: string): CandidatePolicyConfig {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new SyntaxError("Candidate policy must be valid JSON.");
  }
  if (!isRecord(value)) throw new TypeError("Candidate policy must be an object.");

  const thresholds = value.thresholds;
  const temporal = value.temporalPolicy;
  const budgets = value.budgets;
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    typeof value.policyVersion !== "string" ||
    value.policyVersion.length === 0 ||
    typeof value.temporalPolicyVersion !== "string" ||
    value.temporalPolicyVersion.length === 0 ||
    !isRecord(thresholds) ||
    !isProbability(thresholds.handoffRequested) ||
    !isProbability(thresholds.interactionAppropriate) ||
    !isProbability(thresholds.handoffIntentAmbiguousMax) ||
    !isRecord(thresholds.handoffDistanceMeters) ||
    !isNonNegative(thresholds.handoffDistanceMeters.min) ||
    !isNonNegative(thresholds.handoffDistanceMeters.max) ||
    thresholds.handoffDistanceMeters.min > thresholds.handoffDistanceMeters.max ||
    !isRecord(temporal) ||
    !isRecord(temporal.enterHandoff) ||
    !isProbability(temporal.enterHandoff.intentAtLeast) ||
    !isProbability(temporal.enterHandoff.interactionAppropriateAtLeast) ||
    !isProbability(temporal.enterHandoff.ambiguityAtMost) ||
    !isPositiveInteger(temporal.enterHandoff.requiredSamples) ||
    !isPositiveInteger(temporal.enterHandoff.windowSamples) ||
    temporal.enterHandoff.requiredSamples > temporal.enterHandoff.windowSamples ||
    !isRecord(temporal.exitHandoff) ||
    !isProbability(temporal.exitHandoff.intentAtMost) ||
    !isProbability(temporal.exitHandoff.interactionAppropriateAtMost) ||
    !isProbability(temporal.exitHandoff.ambiguityAtLeast) ||
    !isPositiveInteger(temporal.exitHandoff.requiredSamples) ||
    !isPositiveInteger(temporal.exitHandoff.windowSamples) ||
    temporal.exitHandoff.requiredSamples > temporal.exitHandoff.windowSamples ||
    !isNonNegative(temporal.cooldownMs) ||
    !isNonNegative(temporal.staleAfterMs) ||
    !isRecord(budgets) ||
    !isNonNegative(budgets.maxAccuracyDrop) ||
    !isNonNegative(budgets.maxFalsePositiveIncrease) ||
    !isNonNegative(budgets.maxFalseNegativeIncrease) ||
    !isNonNegative(budgets.maxAbstentionIncrease)
  ) {
    throw new TypeError("Candidate policy contains invalid thresholds or regression budgets.");
  }
  return value as unknown as CandidatePolicyConfig;
}

export function checkRegression(
  current: OutcomeMetrics,
  candidate: OutcomeMetrics,
  budgets: RegressionBudgets,
): string[] {
  const violations: string[] = [];
  const check = (name: string, increase: number, maximum: number) => {
    if (increase > maximum) violations.push(`${name} increased by ${increase.toFixed(4)} (max ${maximum}).`);
  };
  check("Accuracy drop", current.exactAccuracy - candidate.exactAccuracy, budgets.maxAccuracyDrop);
  check(
    "False-positive frames",
    candidate.falsePositiveFrames - current.falsePositiveFrames,
    budgets.maxFalsePositiveIncrease,
  );
  check(
    "False-negative frames",
    candidate.falseNegativeFrames - current.falseNegativeFrames,
    budgets.maxFalseNegativeIncrease,
  );
  check("Abstention", candidate.abstentionRate - current.abstentionRate, budgets.maxAbstentionIncrease);
  return violations;
}

export function parseOutcomeLabels(contents: string): OutcomeLabel[] {
  const labels = contents
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new SyntaxError(`Invalid outcome label on line ${index + 1}.`);
      }
      if (
        typeof value !== "object" ||
        value === null ||
        !("sessionId" in value) ||
        typeof value.sessionId !== "string" ||
        !("sequence" in value) ||
        !Number.isInteger(value.sequence) ||
        (value.sequence as number) < 0 ||
        !("expectedMode" in value) ||
        (value.expectedMode !== "IDLE" &&
          value.expectedMode !== "OBSERVING" &&
          value.expectedMode !== "HANDOFF") ||
        ("expectedHandoffRequested" in value &&
          typeof value.expectedHandoffRequested !== "boolean")
      ) {
        throw new SyntaxError(`Invalid outcome label on line ${index + 1}.`);
      }
      return {
        sessionId: value.sessionId,
        sequence: value.sequence as number,
        expectedMode: value.expectedMode as RobotMode,
        ...("expectedHandoffRequested" in value
          ? { expectedHandoffRequested: value.expectedHandoffRequested as boolean }
          : {}),
      };
    });

  const seen = new Set<string>();
  for (const label of labels) {
    const outcomeKey = key(label);
    if (seen.has(outcomeKey)) {
      throw new SyntaxError(`Duplicate outcome label for ${outcomeKey}.`);
    }
    seen.add(outcomeKey);
  }
  return labels;
}

export function evaluateOutcomes(
  events: readonly DecisionEvent[],
  replay: readonly EventReplayResult[],
  labels: readonly OutcomeLabel[],
): OutcomeMetrics {
  const outcomes = new Map(labels.map((label) => [key(label), label]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const labeled = replay.flatMap((result) => {
    const label = outcomes.get(key(result));
    const event = eventsById.get(result.id);
    return label && event ? [{ result, event, label }] : [];
  });
  const probabilities = labeled.flatMap(({ event, label }) =>
    event.frame && label.expectedHandoffRequested !== undefined
      ? [{ predicted: event.frame.handoffRequested, actual: label.expectedHandoffRequested ? 1 : 0 }]
      : [],
  );
  const calibrationBins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, actual: 0 }));
  for (const probability of probabilities) {
    const bin = calibrationBins[Math.min(9, Math.floor(probability.predicted * 10))];
    bin.count += 1;
    bin.predicted += probability.predicted;
    bin.actual += probability.actual;
  }

  return {
    labeledEvents: labeled.length,
    coverage: events.length === 0 ? 0 : labeled.length / events.length,
    exactAccuracy:
      labeled.length === 0
        ? 0
        : labeled.filter(({ result, label }) => result.currentCommit.to === label.expectedMode).length /
          labeled.length,
    falsePositiveFrames: labeled.filter(
      ({ result, label }) => result.currentCommit.to === "HANDOFF" && label.expectedMode !== "HANDOFF",
    ).length,
    falseNegativeFrames: labeled.filter(
      ({ result, label }) => result.currentCommit.to !== "HANDOFF" && label.expectedMode === "HANDOFF",
    ).length,
    abstentionRate:
      labeled.length === 0
        ? 0
        : labeled.filter(({ result }) => result.currentCommit.to !== "HANDOFF").length / labeled.length,
    brierScore:
      probabilities.length === 0
        ? null
        : probabilities.reduce(
            (total, probability) => total + (probability.predicted - probability.actual) ** 2,
            0,
          ) / probabilities.length,
    calibrationError:
      probabilities.length === 0
        ? null
        : calibrationBins.reduce(
            (total, bin) =>
              bin.count === 0
                ? total
                : total +
                  (bin.count / probabilities.length) *
                    Math.abs(bin.predicted / bin.count - bin.actual / bin.count),
            0,
          ),
  };
}

export function evaluatePolicy(
  events: readonly DecisionEvent[],
  labels: readonly OutcomeLabel[],
  policy: ReplayPolicy,
): { replay: EventReplayResult[]; metrics: OutcomeMetrics } {
  const replay = replayDecisionEvents(events, policy);
  return { replay, metrics: evaluateOutcomes(events, replay, labels) };
}
