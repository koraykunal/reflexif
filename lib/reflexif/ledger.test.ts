import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendDecision,
  appendDecisionEvent,
  readDecisionEvents,
  readDecisionLedger,
  readLatestDecisionEvent,
  SequenceConflictError,
} from "./ledger.ts";
import { decide, POLICY_VERSION } from "./policy.ts";
import { replayDecisions } from "./replay.ts";
import {
  advanceTemporal,
  createTemporalState,
  summarizeTemporalCommit,
  TEMPORAL_POLICY_VERSION,
} from "./temporal.ts";
import type { RobotSnapshot, SignalFrame } from "./types.ts";

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

    const staleAfter = advanceTemporal(temporalAfter, null, 2_001);
    const failure = await appendDecisionEvent(
      {
        sessionId,
        sequence: 1,
        receivedAtMs: 2_001,
        policyVersion: POLICY_VERSION,
        temporalPolicyVersion: TEMPORAL_POLICY_VERSION,
        status: "provider_error",
        snapshot: { ...snapshot, robot: { ...snapshot.robot, mode: temporalAfter.committedMode } },
        frame: null,
        decision: null,
        temporalBefore: temporalAfter,
        temporalAfter: staleAfter,
        commit: summarizeTemporalCommit(temporalAfter, staleAfter, null),
      },
      first.sequence,
      ledgerPath,
    );

    const events = await readDecisionEvents(ledgerPath);
    assert.equal(events.length, 2);
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
