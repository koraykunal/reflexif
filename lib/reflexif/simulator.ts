import { decide } from "./policy.ts";
import { advanceTemporal, createTemporalState } from "./temporal.ts";
import type { RobotMode, RobotSnapshot, SemanticSignals } from "./types.ts";

export type SimulationFrame = {
  sequence: number;
  atMs: number;
  signals: SemanticSignals;
  expectedMode: RobotMode;
};

export type SimulationStep = SimulationFrame & {
  rawMode: RobotMode;
  stableMode: RobotMode;
};

export type StabilityMetrics = {
  rawTransitions: number;
  stableTransitions: number;
  rawOscillations: number;
  stableOscillations: number;
  falseActivations: number;
  decisionLatencyMs: number | null;
  abstentionRate: number;
};

const transitions = (modes: readonly RobotMode[]) =>
  modes.slice(1).filter((mode, index) => mode !== modes[index]).length;

function oscillations(modes: readonly RobotMode[]) {
  const compressed = modes.filter((mode, index) => index === 0 || mode !== modes[index - 1]);
  return compressed.slice(2).filter((mode, index) => mode === compressed[index]).length;
}

export function simulateStream(
  snapshot: RobotSnapshot,
  frames: readonly SimulationFrame[],
  intentStartsAtMs = frames[0]?.atMs ?? 0,
): { steps: SimulationStep[]; metrics: StabilityMetrics } {
  let temporal = createTemporalState(snapshot.robot.mode);
  const steps = frames.map((frame) => {
    const currentSnapshot = { ...snapshot, robot: { ...snapshot.robot, mode: temporal.committedMode } };
    const decision = decide(currentSnapshot, frame.signals);
    temporal = advanceTemporal(
      temporal,
      { sequence: frame.sequence, decision, signals: frame.signals },
      frame.atMs,
    );
    return { ...frame, rawMode: decision.to, stableMode: temporal.committedMode };
  });

  const rawModes = steps.map((step) => step.rawMode);
  const stableModes = steps.map((step) => step.stableMode);
  const firstAction = steps.find((step) => step.stableMode === "HANDOFF");
  const observedDuration = Math.max(0, (frames.at(-1)?.atMs ?? 0) - (frames[0]?.atMs ?? 0));
  let abstentionDuration = 0;
  for (let index = 0; index < steps.length - 1; index += 1) {
    if (steps[index].stableMode !== "HANDOFF") abstentionDuration += steps[index + 1].atMs - steps[index].atMs;
  }

  return {
    steps,
    metrics: {
      rawTransitions: transitions(rawModes),
      stableTransitions: transitions(stableModes),
      rawOscillations: oscillations(rawModes),
      stableOscillations: oscillations(stableModes),
      falseActivations: steps.filter((step) => step.stableMode === "HANDOFF" && step.expectedMode !== "HANDOFF").length,
      decisionLatencyMs: firstAction ? firstAction.atMs - intentStartsAtMs : null,
      abstentionRate: observedDuration === 0 ? 0 : abstentionDuration / observedDuration,
    },
  };
}
