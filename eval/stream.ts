import { simulateStream, type SimulationFrame } from "../lib/reflexif/simulator.ts";
import type { RobotSnapshot } from "../lib/reflexif/types.ts";

const snapshot: RobotSnapshot = {
  person: { visible: true, lookingAtRobot: true, handExtended: true, distanceMeters: 0.7 },
  scene: { targetObjectVisible: true, obstruction: false },
  robot: { holding: "screwdriver", mode: "OBSERVING" },
};

const intent = [0.81, 0.88, 0.55, 0.76, 0.91, 0.51, 0.95];
const frames: SimulationFrame[] = intent.map((handoffRequested, index) => ({
  atMs: index * 200,
  expectedMode: "HANDOFF",
  signals: {
    handoffRequested,
    interactionAppropriate: 0.96,
    handoffIntentAmbiguous: 0.1,
  },
}));

const { steps, metrics } = simulateStream(snapshot, frames);

console.table(
  steps.map((step) => ({
    at_ms: step.atMs,
    intent: step.signals.handoffRequested.toFixed(2),
    raw: step.rawMode,
    reflexif: step.stableMode,
  })),
);
console.table(metrics);
