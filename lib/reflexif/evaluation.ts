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

const key = ({ sessionId, sequence }: { sessionId: string; sequence: number }) =>
  `${sessionId}:${sequence}`;

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
        !("expectedMode" in value) ||
        (value.expectedMode !== "IDLE" &&
          value.expectedMode !== "OBSERVING" &&
          value.expectedMode !== "HANDOFF")
      ) {
        throw new SyntaxError(`Invalid outcome label on line ${index + 1}.`);
      }
      return {
        sessionId: value.sessionId,
        sequence: value.sequence as number,
        expectedMode: value.expectedMode,
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
  const outcomes = new Map(labels.map((label) => [key(label), label.expectedMode]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const labeled = replay.flatMap((result) => {
    const expectedMode = outcomes.get(key(result));
    const event = eventsById.get(result.id);
    return expectedMode && event ? [{ result, event, expectedMode }] : [];
  });
  const probabilities = labeled.flatMap(({ event, expectedMode }) =>
    event.frame
      ? [{ predicted: event.frame.handoffRequested, actual: expectedMode === "HANDOFF" ? 1 : 0 }]
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
        : labeled.filter(({ result, expectedMode }) => result.currentCommit.to === expectedMode).length /
          labeled.length,
    falsePositiveFrames: labeled.filter(
      ({ result, expectedMode }) => result.currentCommit.to === "HANDOFF" && expectedMode !== "HANDOFF",
    ).length,
    falseNegativeFrames: labeled.filter(
      ({ result, expectedMode }) => result.currentCommit.to !== "HANDOFF" && expectedMode === "HANDOFF",
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
