import { simulateFaultyStream, type SimulationFrame } from "../lib/reflexif/simulator.ts";
import type { RobotSnapshot } from "../lib/reflexif/types.ts";

const snapshot: RobotSnapshot = {
  person: { visible: true, lookingAtRobot: true, handExtended: true, distanceMeters: 0.7 },
  scene: { targetObjectVisible: true, obstruction: false },
  robot: { holding: "screwdriver", mode: "OBSERVING" },
};

const intent = [0.42, 0.51, 0.38, 0.58, 0.61, 0.81, 0.88, 0.74, 0.93, 0.79, 0.86, 0.9, 0.77, 0.84, 0.82, 0.48, 0.52, 0.43, 0.39, 0.35];
const frames: SimulationFrame[] = intent.map((handoffRequested, sequence) => ({
  sequence,
  atMs: sequence * 200,
  expectedMode: sequence >= 5 && sequence < 15 ? "HANDOFF" : "OBSERVING",
  signals: {
    handoffRequested,
    interactionAppropriate: 0.94,
    handoffIntentAmbiguous: 0.12,
  },
}));

const { steps, metrics } = simulateFaultyStream(snapshot, frames, {
  seed: 20_260_921,
  signalNoise: 0.08,
  missingRate: 0.08,
  timeoutRate: 0.08,
  duplicateRate: 0.15,
  lateRate: 0.2,
  maxDelayMs: 600,
}, frames[5].atMs);

console.table(
  steps.map((step) => ({
    sequence: step.sequence,
    observed_ms: step.frame?.atMs ?? "-",
    received_ms: step.receivedAtMs,
    fault: step.fault,
    accepted: step.accepted,
    intent: step.frame?.signals.handoffRequested.toFixed(2) ?? "-",
    raw: step.rawMode ?? "-",
    reflexif: step.stableMode,
  })),
);
console.table(metrics);
