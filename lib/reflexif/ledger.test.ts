import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDecision, readDecisionLedger } from "./ledger.ts";
import { decide, POLICY_VERSION } from "./policy.ts";
import { replayDecisions } from "./replay.ts";
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
