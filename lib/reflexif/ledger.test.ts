import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRegression,
  evaluateOutcomes,
  evaluatePolicy,
  parseCandidatePolicy,
  parseOutcomeLabels,
  type OutcomeLabel,
} from "./evaluation.ts";
import {
  appendDecision,
  appendDecisionEvent,
  readDecisionEvents,
  readDecisionLedger,
  readLatestDecisionEvent,
  SequenceConflictError,
} from "./ledger.ts";
import {
  appendOutcomeLabel,
  OutcomeConflictError,
  readOutcomeLabels,
} from "./outcomes.ts";
import { decide, POLICY_VERSION } from "./policy.ts";
import { CURRENT_REPLAY_POLICY, replayDecisionEvents, replayDecisions } from "./replay.ts";
import {
  advanceTemporal,
  createTemporalState,
  summarizeTemporalCommit,
  TEMPORAL_POLICY_VERSION,
} from "./temporal.ts";
import type { RobotSnapshot, SignalFrame } from "./types.ts";
import { parseOutcomeRequest } from "./validate.ts";

const snapshot: RobotSnapshot = {
  person: { visible: true, lookingAtRobot: true, handExtended: true, distanceMeters: 0.7 },
  scene: { targetObjectVisible: true, obstruction: false },
  robot: { holding: "screwdriver", mode: "OBSERVING" },
};

const frame: SignalFrame = {
  handoffRequested: 0.91,
  interactionAppropriate: 0.96,
  handoffIntentAmbiguous: 0.12,
  source: "demo",
  providerVersion: "test-provider-v1",
  modelVersion: "test-model-v1",
  latencyMs: 1,
  inputTokens: null,
};

test("persists decisions and replays them without model inference", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "reflexif-ledger-"));
  const ledgerPath = path.join(directory, "decisions.jsonl");

  try {
    const written = await appendDecision(
      { policyVersion: POLICY_VERSION, snapshot, frame, decision: decide(snapshot, frame) },
      ledgerPath,
    );
    const records = await readDecisionLedger(ledgerPath);
    const replay = replayDecisions(records);

    assert.equal(records.length, 1);
    assert.equal(records[0].id, written.id);
    assert.equal(replay[0].changed, false);
    assert.equal(replay[0].currentDecision.to, "HANDOFF");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stores one validated outcome label per decision event", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "reflexif-outcomes-"));
  const outcomesPath = path.join(directory, "outcomes.jsonl");
  const input = {
    decisionId: "decision-1",
    sessionId: "session-1",
    sequence: 0,
    expectedMode: "OBSERVING" as const,
    expectedHandoffRequested: true,
  };

  try {
    const parsed = parseOutcomeRequest(input);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const record = await appendOutcomeLabel(parsed.value, outcomesPath);
    assert.equal(record.decisionId, input.decisionId);
    assert.deepEqual(await readOutcomeLabels(outcomesPath), [{
      sessionId: input.sessionId,
      sequence: input.sequence,
      expectedMode: input.expectedMode,
      expectedHandoffRequested: true,
    }]);
    await assert.rejects(appendOutcomeLabel(parsed.value, outcomesPath), OutcomeConflictError);
    assert.equal(parseOutcomeRequest({ ...input, expectedHandoffRequested: "yes" }).ok, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records committed temporal state and provider failures as ordered events", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "reflexif-events-"));
  const ledgerPath = path.join(directory, "decisions.jsonl");
  const sessionId = "test-session";

  try {
    const decision = decide(snapshot, frame);
    const temporalBefore = createTemporalState("OBSERVING");
    const temporalAfter = advanceTemporal(
      temporalBefore,
      { sequence: 0, decision, signals: frame },
      1_000,
    );
    const firstInput = {
      sessionId,
      sequence: 0,
      receivedAtMs: 1_000,
      policyVersion: POLICY_VERSION,
      temporalPolicyVersion: TEMPORAL_POLICY_VERSION,
      status: "evaluated" as const,
      snapshot,
      frame,
      decision,
      temporalBefore,
      temporalAfter,
      commit: summarizeTemporalCommit(temporalBefore, temporalAfter, decision),
    };
    const first = await appendDecisionEvent(firstInput, null, ledgerPath);

    const secondBefore = first.temporalAfter;
    const secondDecision = decide(
      { ...snapshot, robot: { ...snapshot.robot, mode: secondBefore.committedMode } },
      frame,
    );
    const secondAfter = advanceTemporal(
      secondBefore,
      { sequence: 1, decision: secondDecision, signals: frame },
      1_200,
    );
    const second = await appendDecisionEvent(
      {
        ...firstInput,
        sequence: 1,
        receivedAtMs: 1_200,
        decision: secondDecision,
        temporalBefore: secondBefore,
        temporalAfter: secondAfter,
        commit: summarizeTemporalCommit(secondBefore, secondAfter, secondDecision),
      },
      first.sequence,
      ledgerPath,
    );

    const thirdBefore = second.temporalAfter;
    const thirdDecision = decide(
      { ...snapshot, robot: { ...snapshot.robot, mode: thirdBefore.committedMode } },
      frame,
    );
    const thirdAfter = advanceTemporal(
      thirdBefore,
      { sequence: 2, decision: thirdDecision, signals: frame },
      1_400,
    );
    const third = await appendDecisionEvent(
      {
        ...firstInput,
        sequence: 2,
        receivedAtMs: 1_400,
        decision: thirdDecision,
        temporalBefore: thirdBefore,
        temporalAfter: thirdAfter,
        commit: summarizeTemporalCommit(thirdBefore, thirdAfter, thirdDecision),
      },
      second.sequence,
      ledgerPath,
    );
    assert.equal(third.commit.to, "HANDOFF");

    const staleAfter = advanceTemporal(thirdAfter, null, 2_401);
    const failure = await appendDecisionEvent(
      {
        sessionId,
        sequence: 3,
        receivedAtMs: 2_401,
        policyVersion: POLICY_VERSION,
        temporalPolicyVersion: TEMPORAL_POLICY_VERSION,
        status: "provider_error",
        snapshot: { ...snapshot, robot: { ...snapshot.robot, mode: thirdAfter.committedMode } },
        frame: null,
        decision: null,
        temporalBefore: thirdAfter,
        temporalAfter: staleAfter,
        commit: summarizeTemporalCommit(thirdAfter, staleAfter, null),
      },
      third.sequence,
      ledgerPath,
    );

    const events = await readDecisionEvents(ledgerPath);
    const replay = replayDecisionEvents(events);
    const labels: OutcomeLabel[] = ["OBSERVING", "OBSERVING", "HANDOFF", "OBSERVING"].map(
      (expectedMode, sequence) => ({
        sessionId,
        sequence,
        expectedMode: expectedMode as OutcomeLabel["expectedMode"],
        ...(sequence < 3 ? { expectedHandoffRequested: true } : {}),
      }),
    );
    assert.deepEqual(parseOutcomeLabels(labels.map((label) => JSON.stringify(label)).join("\n")), labels);
    assert.throws(() => parseOutcomeLabels('{"sessionId":"bad"}'), SyntaxError);
    assert.throws(
      () => parseOutcomeLabels(`${JSON.stringify(labels[0])}\n${JSON.stringify(labels[0])}`),
      /Duplicate outcome label/,
    );
    const metrics = evaluateOutcomes(events, replay, labels);
    assert.equal(events.length, 4);
    assert.equal(replay.every((result) => !result.changed), true);
    assert.equal(metrics.exactAccuracy, 1);
    assert.equal(metrics.falsePositiveFrames, 0);
    assert.equal(metrics.falseNegativeFrames, 0);
    assert.equal(metrics.brierScore?.toFixed(4), "0.0081");
    const candidatePolicy = parseCandidatePolicy(JSON.stringify({
      name: "test-candidate",
      ...CURRENT_REPLAY_POLICY,
      temporalPolicyVersion: "handoff-temporal-candidate",
      temporalPolicy: {
        ...CURRENT_REPLAY_POLICY.temporalPolicy,
        enterHandoff: {
          ...CURRENT_REPLAY_POLICY.temporalPolicy.enterHandoff,
          requiredSamples: 4,
          windowSamples: 4,
        },
      },
      budgets: {
        maxAccuracyDrop: 0,
        maxFalsePositiveIncrease: 0,
        maxFalseNegativeIncrease: 0,
        maxAbstentionIncrease: 0,
      },
    }));
    assert.throws(() => parseCandidatePolicy('{"name":"incomplete"}'), TypeError);
    const candidate = evaluatePolicy(events, labels, candidatePolicy);
    assert.equal(candidate.metrics.exactAccuracy, 0.75);
    assert.equal(candidate.metrics.falseNegativeFrames, 1);
    assert.deepEqual(checkRegression(metrics, candidate.metrics, {
      ...candidatePolicy.budgets,
      maxAccuracyDrop: 0.25,
      maxFalseNegativeIncrease: 1,
      maxAbstentionIncrease: 0.25,
    }), []);
    assert.match(checkRegression(metrics, candidate.metrics, candidatePolicy.budgets).join(" "), /Accuracy drop/);
    assert.equal(
      replayDecisionEvents([
        { ...events[0], commit: { ...events[0].commit, to: "HANDOFF" } },
      ])[0].changed,
      true,
    );
    assert.equal(failure.status, "provider_error");
    assert.equal(failure.commit.to, "OBSERVING");
    assert.equal((await readLatestDecisionEvent(sessionId, ledgerPath))?.id, failure.id);
    await assert.rejects(
      appendDecisionEvent(firstInput, null, ledgerPath),
      SequenceConflictError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
