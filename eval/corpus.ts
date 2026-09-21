import { evaluatePolicy, type OutcomeLabel } from "../lib/reflexif/evaluation.ts";
import type { DecisionEvent } from "../lib/reflexif/ledger.ts";
import { decide, POLICY_VERSION } from "../lib/reflexif/policy.ts";
import { CURRENT_REPLAY_POLICY } from "../lib/reflexif/replay.ts";
import {
  advanceTemporal,
  createTemporalState,
  summarizeTemporalCommit,
  TEMPORAL_POLICY_VERSION,
} from "../lib/reflexif/temporal.ts";
import type { RobotMode, RobotSnapshot, SemanticSignals, SignalFrame } from "../lib/reflexif/types.ts";

const CORPUS_VERSION = "handoff-reference-v1";
const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

type CorpusStep = {
  atMs: number;
  signals: SemanticSignals | null;
  expectedMode: RobotMode;
  expectedHandoffRequested?: boolean;
};

type CorpusScenario = {
  id: string;
  initialMode: RobotMode;
  snapshot: RobotSnapshot;
  steps: readonly CorpusStep[];
};

const snapshot: RobotSnapshot = {
  person: { visible: true, lookingAtRobot: true, handExtended: true, distanceMeters: 0.7 },
  scene: { targetObjectVisible: true, obstruction: false },
  robot: { holding: "screwdriver", mode: "OBSERVING" },
};

const strong = { handoffRequested: 0.82, interactionAppropriate: 0.9, handoffIntentAmbiguous: 0.1 };
const low = { handoffRequested: 0.3, interactionAppropriate: 0.5, handoffIntentAmbiguous: 0.7 };

const scenarios: readonly CorpusScenario[] = [
  {
    id: "stable-handoff",
    initialMode: "OBSERVING",
    snapshot,
    steps: [
      { atMs: 0, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 200, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 400, signals: strong, expectedMode: "HANDOFF", expectedHandoffRequested: true },
      { atMs: 600, signals: strong, expectedMode: "HANDOFF", expectedHandoffRequested: true },
    ],
  },
  {
    id: "flicker-without-commit",
    initialMode: "OBSERVING",
    snapshot,
    steps: [
      { atMs: 0, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 200, signals: { ...strong, handoffRequested: 0.45 }, expectedMode: "OBSERVING", expectedHandoffRequested: false },
      { atMs: 400, signals: { ...strong, handoffRequested: 0.78 }, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 600, signals: { ...strong, handoffRequested: 0.4 }, expectedMode: "OBSERVING", expectedHandoffRequested: false },
      { atMs: 800, signals: { ...strong, handoffRequested: 0.72 }, expectedMode: "OBSERVING", expectedHandoffRequested: true },
    ],
  },
  {
    id: "ambiguous-request",
    initialMode: "OBSERVING",
    snapshot,
    steps: [0, 200, 400].map((atMs) => ({
      atMs,
      signals: { ...strong, handoffIntentAmbiguous: 0.65 },
      expectedMode: "OBSERVING" as const,
      expectedHandoffRequested: true,
    })),
  },
  {
    id: "deterministic-block",
    initialMode: "HANDOFF",
    snapshot: {
      ...snapshot,
      scene: { ...snapshot.scene, obstruction: true },
      robot: { ...snapshot.robot, mode: "HANDOFF" },
    },
    steps: [{ atMs: 0, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true }],
  },
  {
    id: "stale-fallback",
    initialMode: "OBSERVING",
    snapshot,
    steps: [
      { atMs: 0, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 200, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 400, signals: strong, expectedMode: "HANDOFF", expectedHandoffRequested: true },
      { atMs: 1_501, signals: null, expectedMode: "OBSERVING" },
    ],
  },
  {
    id: "hysteretic-exit",
    initialMode: "OBSERVING",
    snapshot,
    steps: [
      { atMs: 0, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 200, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true },
      { atMs: 400, signals: strong, expectedMode: "HANDOFF", expectedHandoffRequested: true },
      { atMs: 600, signals: low, expectedMode: "HANDOFF", expectedHandoffRequested: false },
      { atMs: 800, signals: low, expectedMode: "OBSERVING", expectedHandoffRequested: false },
    ],
  },
  {
    id: "no-person",
    initialMode: "OBSERVING",
    snapshot: {
      ...snapshot,
      person: { ...snapshot.person, visible: false, lookingAtRobot: false, handExtended: false },
    },
    steps: [{ atMs: 0, signals: { ...low, handoffRequested: 0.1 }, expectedMode: "IDLE", expectedHandoffRequested: false }],
  },
  {
    id: "out-of-range",
    initialMode: "OBSERVING",
    snapshot: { ...snapshot, person: { ...snapshot.person, distanceMeters: 2.4 } },
    steps: [{ atMs: 0, signals: strong, expectedMode: "OBSERVING", expectedHandoffRequested: true }],
  },
];

const events: DecisionEvent[] = [];
const labels: OutcomeLabel[] = [];

for (const [scenarioIndex, scenario] of scenarios.entries()) {
  const sessionId = `${CORPUS_VERSION}:${scenario.id}`;
  const sessionStartMs = EPOCH_MS + scenarioIndex * 10_000;
  let temporalState = createTemporalState(scenario.initialMode);

  for (const [sequence, step] of scenario.steps.entries()) {
    const receivedAtMs = sessionStartMs + step.atMs;
    const currentSnapshot: RobotSnapshot = {
      ...scenario.snapshot,
      robot: { ...scenario.snapshot.robot, mode: temporalState.committedMode },
    };
    const frame: SignalFrame | null = step.signals
      ? {
          ...step.signals,
          source: "demo",
          providerVersion: CORPUS_VERSION,
          modelVersion: "recorded-signals-v1",
          latencyMs: 0,
          inputTokens: null,
        }
      : null;
    const decision = frame ? decide(currentSnapshot, frame) : null;
    const temporalAfter = advanceTemporal(
      temporalState,
      decision && frame ? { sequence, decision, signals: frame } : null,
      receivedAtMs,
    );

    events.push({
      schemaVersion: 2,
      stateSchemaVersion: "robot-state-v1",
      signalSchemaVersion: "handoff-signals-v1",
      id: `${sessionId}:${sequence}`,
      sessionId,
      sequence,
      receivedAtMs,
      recordedAt: new Date(receivedAtMs).toISOString(),
      policyVersion: POLICY_VERSION,
      temporalPolicyVersion: TEMPORAL_POLICY_VERSION,
      providerVersion: frame?.providerVersion ?? null,
      modelVersion: frame?.modelVersion ?? null,
      gitCommit: null,
      status: frame ? "evaluated" : "provider_error",
      snapshot: currentSnapshot,
      frame,
      decision,
      temporalBefore: temporalState,
      temporalAfter,
      commit: summarizeTemporalCommit(temporalState, temporalAfter, decision),
    });
    labels.push({
      sessionId,
      sequence,
      expectedMode: step.expectedMode,
      ...(step.expectedHandoffRequested === undefined
        ? {}
        : { expectedHandoffRequested: step.expectedHandoffRequested }),
    });
    temporalState = temporalAfter;
  }
}

const evaluation = evaluatePolicy(events, labels, CURRENT_REPLAY_POLICY);
// ponytail: linear lookup is enough for this fixed 24-event corpus; index labels if it grows materially.
const failures = evaluation.replay.flatMap((result) => {
  const expected = labels.find(
    (label) => label.sessionId === result.sessionId && label.sequence === result.sequence,
  )?.expectedMode;
  return expected !== result.currentCommit.to
    ? [{ session: result.sessionId.split(":").at(-1), sequence: result.sequence, expected, actual: result.currentCommit.to }]
    : [];
});

console.table({
  scenarios: scenarios.length,
  events: events.length,
  coverage: evaluation.metrics.coverage,
  exactAccuracy: evaluation.metrics.exactAccuracy,
  falsePositiveFrames: evaluation.metrics.falsePositiveFrames,
  falseNegativeFrames: evaluation.metrics.falseNegativeFrames,
  brierScore: evaluation.metrics.brierScore,
  calibrationError: evaluation.metrics.calibrationError,
});

if (failures.length > 0 || evaluation.metrics.coverage !== 1) {
  console.table(failures);
  console.error(`${CORPUS_VERSION} failed behavioral acceptance.`);
  process.exitCode = 1;
} else {
  console.log(`${CORPUS_VERSION} passed behavioral acceptance.`);
}
