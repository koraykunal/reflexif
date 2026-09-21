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

export type StreamFault = "missing" | "timeout" | "duplicate" | "late" | "none";

export type FaultInjectionConfig = {
  seed: number;
  signalNoise?: number;
  missingRate?: number;
  timeoutRate?: number;
  duplicateRate?: number;
  lateRate?: number;
  maxDelayMs?: number;
};

export type InjectedStreamEvent = {
  sequence: number;
  receivedAtMs: number;
  expectedMode: RobotMode;
  frame: SimulationFrame | null;
  fault: StreamFault;
  noisy: boolean;
};

export type FaultSimulationStep = InjectedStreamEvent & {
  accepted: boolean;
  rawMode: RobotMode | null;
  stableMode: RobotMode;
};

export type FaultMetrics = StabilityMetrics & {
  missingFrames: number;
  timeouts: number;
  duplicateFrames: number;
  lateFrames: number;
  rejectedFrames: number;
};

const transitions = (modes: readonly RobotMode[]) =>
  modes.slice(1).filter((mode, index) => mode !== modes[index]).length;

function oscillations(modes: readonly RobotMode[]) {
  const compressed = modes.filter((mode, index) => index === 0 || mode !== modes[index - 1]);
  return compressed.slice(2).filter((mode, index) => mode === compressed[index]).length;
}

function calculateMetrics(
  steps: readonly {
    atMs: number;
    rawMode: RobotMode | null;
    stableMode: RobotMode;
    expectedMode: RobotMode;
  }[],
  intentStartsAtMs: number,
): StabilityMetrics {
  const rawSteps = steps.filter(
    (step): step is typeof step & { rawMode: RobotMode } => step.rawMode !== null,
  );
  const rawModes = rawSteps.map((step) => step.rawMode);
  const rawExpectedModes = rawSteps.map((step) => step.expectedMode);
  const stableModes = steps.map((step) => step.stableMode);
  const expectedModes = steps.map((step) => step.expectedMode);
  const firstAction = steps.find((step) => step.stableMode === "HANDOFF");
  const observedDuration = Math.max(0, (steps.at(-1)?.atMs ?? 0) - (steps[0]?.atMs ?? 0));
  let abstentionDuration = 0;
  for (let index = 0; index < steps.length - 1; index += 1) {
    if (steps[index].stableMode !== "HANDOFF") abstentionDuration += steps[index + 1].atMs - steps[index].atMs;
  }

  return {
    rawTransitions: transitions(rawModes),
    stableTransitions: transitions(stableModes),
    rawOscillations: Math.max(0, oscillations(rawModes) - oscillations(rawExpectedModes)),
    stableOscillations: Math.max(0, oscillations(stableModes) - oscillations(expectedModes)),
    falseActivations: steps.filter(
      (step, index) =>
        step.stableMode === "HANDOFF" &&
        steps[index - 1]?.stableMode !== "HANDOFF" &&
        step.expectedMode !== "HANDOFF",
    ).length,
    decisionLatencyMs: firstAction ? firstAction.atMs - intentStartsAtMs : null,
    abstentionRate: observedDuration === 0 ? 0 : abstentionDuration / observedDuration,
  };
}

function rate(name: string, value = 0) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1.`);
  }
  return value;
}

function seededRandom(seed: number) {
  if (!Number.isInteger(seed)) throw new RangeError("Seed must be an integer.");
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function injectStreamFaults(
  frames: readonly SimulationFrame[],
  config: FaultInjectionConfig,
): InjectedStreamEvent[] {
  const random = seededRandom(config.seed);
  const signalNoise = rate("Signal noise", config.signalNoise);
  const missingRate = rate("Missing rate", config.missingRate);
  const timeoutRate = rate("Timeout rate", config.timeoutRate);
  const duplicateRate = rate("Duplicate rate", config.duplicateRate);
  const lateRate = rate("Late rate", config.lateRate);
  const maxDelayMs = config.maxDelayMs ?? 800;
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 1) {
    throw new RangeError("Maximum delay must be positive.");
  }

  const events: Array<InjectedStreamEvent & { order: number }> = [];
  let order = 0;
  for (const original of frames) {
    if (random() < missingRate) {
      events.push({
        sequence: original.sequence,
        receivedAtMs: original.atMs,
        expectedMode: original.expectedMode,
        frame: null,
        fault: "missing",
        noisy: false,
        order: order++,
      });
      continue;
    }

    if (random() < timeoutRate) {
      events.push({
        sequence: original.sequence,
        receivedAtMs: original.atMs,
        expectedMode: original.expectedMode,
        frame: null,
        fault: "timeout",
        noisy: false,
        order: order++,
      });
      continue;
    }

    const noisy = signalNoise > 0;
    const frame = noisy
      ? {
          ...original,
          signals: Object.fromEntries(
            Object.entries(original.signals).map(([name, value]) => [
              name,
              clamp(value + (random() * 2 - 1) * signalNoise),
            ]),
          ) as SemanticSignals,
        }
      : original;
    const late = random() < lateRate;
    const receivedAtMs = original.atMs + (late ? 1 + Math.floor(random() * maxDelayMs) : 0);
    events.push({
      sequence: original.sequence,
      receivedAtMs,
      expectedMode: original.expectedMode,
      frame,
      fault: late ? "late" : "none",
      noisy,
      order: order++,
    });

    if (random() < duplicateRate) {
      events.push({
        sequence: original.sequence,
        receivedAtMs: receivedAtMs + 1,
        expectedMode: original.expectedMode,
        frame,
        fault: "duplicate",
        noisy,
        order: order++,
      });
    }
  }

  return events
    .sort((left, right) => left.receivedAtMs - right.receivedAtMs || left.order - right.order)
    .map(({ sequence, receivedAtMs, expectedMode, frame, fault, noisy }) => ({
      sequence,
      receivedAtMs,
      expectedMode,
      frame,
      fault,
      noisy,
    }));
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

  return {
    steps,
    metrics: calculateMetrics(steps, intentStartsAtMs),
  };
}

export function simulateFaultyStream(
  snapshot: RobotSnapshot,
  frames: readonly SimulationFrame[],
  config: FaultInjectionConfig,
  intentStartsAtMs = frames[0]?.atMs ?? 0,
): { steps: FaultSimulationStep[]; metrics: FaultMetrics } {
  let temporal = createTemporalState(snapshot.robot.mode);
  const events = injectStreamFaults(frames, config);
  const steps = events.map((event): FaultSimulationStep => {
    if (event.frame === null) {
      temporal = advanceTemporal(temporal, null, event.receivedAtMs);
      return { ...event, accepted: false, rawMode: null, stableMode: temporal.committedMode };
    }

    const currentSnapshot = { ...snapshot, robot: { ...snapshot.robot, mode: temporal.committedMode } };
    const decision = decide(currentSnapshot, event.frame.signals);
    const accepted = temporal.lastSequence === null || event.sequence > temporal.lastSequence;
    temporal = advanceTemporal(
      temporal,
      { sequence: event.sequence, decision, signals: event.frame.signals },
      event.receivedAtMs,
    );
    return { ...event, accepted, rawMode: decision.to, stableMode: temporal.committedMode };
  });
  const stability = calculateMetrics(
    steps.map((step) => ({
      atMs: step.receivedAtMs,
      rawMode: step.rawMode,
      stableMode: step.stableMode,
      expectedMode: step.expectedMode,
    })),
    intentStartsAtMs,
  );

  return {
    steps,
    metrics: {
      ...stability,
      missingFrames: steps.filter((step) => step.fault === "missing").length,
      timeouts: steps.filter((step) => step.fault === "timeout").length,
      duplicateFrames: steps.filter((step) => step.fault === "duplicate").length,
      lateFrames: steps.filter((step) => step.fault === "late").length,
      rejectedFrames: steps.filter((step) => step.frame !== null && !step.accepted).length,
    },
  };
}
