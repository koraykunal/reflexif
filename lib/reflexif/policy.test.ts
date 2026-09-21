import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "./policy.ts";
import { simulateStream } from "./simulator.ts";
import { advanceTemporal, createTemporalState } from "./temporal.ts";
import { signal, type SignalSample } from "./temporal-signal.ts";
import type { RobotSnapshot, SemanticSignals } from "./types.ts";

const snapshot: RobotSnapshot = {
  person: { visible: true, lookingAtRobot: true, handExtended: true, distanceMeters: 0.7 },
  scene: { targetObjectVisible: true, obstruction: false },
  robot: { holding: "screwdriver", mode: "OBSERVING" },
};

const clearHandoff: SemanticSignals = {
  handoffRequested: 0.91,
  interactionAppropriate: 0.96,
  handoffIntentAmbiguous: 0.12,
};

test("allows handoff only when semantic and deterministic gates pass", () => {
  assert.equal(decide(snapshot, clearHandoff).to, "HANDOFF");
  assert.equal(decide({ ...snapshot, scene: { ...snapshot.scene, obstruction: true } }, clearHandoff).to, "OBSERVING");
  assert.equal(decide({ ...snapshot, person: { ...snapshot.person, distanceMeters: 2.4 } }, clearHandoff).to, "OBSERVING");
  assert.equal(decide({ ...snapshot, person: { ...snapshot.person, visible: false } }, clearHandoff).to, "IDLE");
});

test("turns flickering proposals into one stable transition", () => {
  const intent = [0.81, 0.88, 0.55, 0.76, 0.91, 0.51, 0.95];
  const { steps, metrics } = simulateStream(
    snapshot,
    intent.map((handoffRequested, index) => ({
      sequence: index,
      atMs: index * 200,
      expectedMode: "HANDOFF" as const,
      signals: { ...clearHandoff, handoffRequested },
    })),
  );

  assert.deepEqual(
    steps.map((step) => step.stableMode),
    ["OBSERVING", "OBSERVING", "OBSERVING", "HANDOFF", "HANDOFF", "HANDOFF", "HANDOFF"],
  );
  assert.equal(metrics.rawTransitions, 4);
  assert.equal(metrics.stableTransitions, 1);
  assert.equal(metrics.rawOscillations, 3);
  assert.equal(metrics.stableOscillations, 0);
  assert.equal(metrics.decisionLatencyMs, 600);
});

test("applies deterministic stops immediately and clears old evidence", () => {
  const handoff = decide(snapshot, clearHandoff);
  let state = createTemporalState("OBSERVING");
  state = advanceTemporal(state, { sequence: 0, decision: handoff, signals: clearHandoff }, 0);
  state = advanceTemporal(state, { sequence: 1, decision: handoff, signals: clearHandoff }, 200);
  state = advanceTemporal(state, { sequence: 2, decision: handoff, signals: clearHandoff }, 400);
  assert.equal(state.committedMode, "HANDOFF");

  const blockedSnapshot = {
    ...snapshot,
    scene: { ...snapshot.scene, obstruction: true },
    robot: { ...snapshot.robot, mode: "HANDOFF" as const },
  };
  const blocked = decide(blockedSnapshot, clearHandoff);
  state = advanceTemporal(state, { sequence: 3, decision: blocked, signals: clearHandoff }, 600);
  assert.equal(state.committedMode, "OBSERVING");
  assert.equal(state.samples.length, 0);

  state = advanceTemporal(state, { sequence: 4, decision: handoff, signals: clearHandoff }, 1_200);
  assert.equal(state.committedMode, "OBSERVING");
});

test("falls back from an active mode when signals become stale", () => {
  const handoff = decide(snapshot, clearHandoff);
  const fresh = advanceTemporal(
    createTemporalState("HANDOFF"),
    { sequence: 0, decision: handoff, signals: clearHandoff },
    1_000,
  );

  assert.equal(advanceTemporal(fresh, null, 2_000).committedMode, "HANDOFF");
  assert.equal(advanceTemporal(fresh, null, 2_001).committedMode, "OBSERVING");
});

test("does not count duplicate or out-of-order frames as new evidence", () => {
  const handoff = decide(snapshot, clearHandoff);
  let state = createTemporalState("OBSERVING");

  state = advanceTemporal(state, { sequence: 0, decision: handoff, signals: clearHandoff }, 0);
  state = advanceTemporal(state, { sequence: 1, decision: handoff, signals: clearHandoff }, 200);
  state = advanceTemporal(state, { sequence: 1, decision: handoff, signals: clearHandoff }, 300);
  assert.equal(state.committedMode, "OBSERVING");
  assert.equal(state.samples.length, 2);

  state = advanceTemporal(state, { sequence: 2, decision: handoff, signals: clearHandoff }, 400);
  assert.equal(state.committedMode, "HANDOFF");

  const observing = decide(snapshot, { ...clearHandoff, handoffRequested: 0.1 });
  const unchanged = advanceTemporal(
    state,
    { sequence: 0, decision: observing, signals: { ...clearHandoff, handoffRequested: 0.1 } },
    600,
  );
  assert.equal(unchanged, state);
});

test("supports duration-based signal evidence", () => {
  const sustained = signal("handoffRequested").above(0.8).for(300);
  const samples: SignalSample[] = [
    { atMs: 0, signals: clearHandoff },
    { atMs: 200, signals: clearHandoff },
    { atMs: 300, signals: clearHandoff },
  ];

  assert.equal(sustained.test(samples), true);
  assert.equal(
    sustained.test([...samples, { atMs: 400, signals: { ...clearHandoff, handoffRequested: 0.4 } }]),
    false,
  );
  assert.equal(
    sustained.test([
      { atMs: 0, signals: clearHandoff },
      { atMs: 1_000, signals: clearHandoff },
    ]),
    false,
  );
});
