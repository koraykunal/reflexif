import { all, any, signal, type SignalSample } from "./temporal-signal.ts";
import type { PolicyDecision, RobotMode, SemanticSignals } from "./types.ts";

export const TEMPORAL_POLICY = {
  enterHandoff: { intentAtLeast: 0.75, requiredSamples: 3, windowSamples: 4 },
  exitHandoff: { intentAtMost: 0.55, requiredSamples: 2, windowSamples: 3 },
  cooldownMs: 500,
  staleAfterMs: 1_000,
} as const;

const enterHandoff = all(
  signal("handoffRequested")
    .above(TEMPORAL_POLICY.enterHandoff.intentAtLeast)
    .samples(TEMPORAL_POLICY.enterHandoff.requiredSamples, TEMPORAL_POLICY.enterHandoff.windowSamples),
  signal("interactionAppropriate").above(0.8),
  signal("handoffIntentAmbiguous").below(0.35),
);

const exitHandoff = any(
  signal("handoffRequested")
    .below(TEMPORAL_POLICY.exitHandoff.intentAtMost)
    .samples(TEMPORAL_POLICY.exitHandoff.requiredSamples, TEMPORAL_POLICY.exitHandoff.windowSamples),
  signal("interactionAppropriate").below(0.65).samples(2, 3),
  signal("handoffIntentAmbiguous").above(0.55).samples(2, 3),
);

export type TemporalState = {
  committedMode: RobotMode;
  pendingMode: RobotMode | null;
  pendingSinceMs: number | null;
  lastSequence: number | null;
  lastSignalAtMs: number | null;
  cooldownUntilMs: number | null;
  samples: SignalSample[];
};

export type TemporalInput = {
  sequence: number;
  decision: PolicyDecision;
  signals: SemanticSignals;
};

export function createTemporalState(mode: RobotMode): TemporalState {
  return {
    committedMode: mode,
    pendingMode: null,
    pendingSinceMs: null,
    lastSequence: null,
    lastSignalAtMs: null,
    cooldownUntilMs: null,
    samples: [],
  };
}

export function advanceTemporal(
  state: TemporalState,
  input: TemporalInput | null,
  nowMs: number,
): TemporalState {
  if (state.lastSignalAtMs !== null && nowMs < state.lastSignalAtMs) {
    throw new RangeError("Temporal timestamps must be monotonic.");
  }

  if (input !== null && (!Number.isInteger(input.sequence) || input.sequence < 0)) {
    throw new RangeError("Temporal sequence numbers must be non-negative integers.");
  }

  if (input !== null && state.lastSequence !== null && input.sequence <= state.lastSequence) {
    return state;
  }

  if (input === null) {
    if (state.lastSignalAtMs === null || nowMs - state.lastSignalAtMs <= TEMPORAL_POLICY.staleAfterMs) return state;
    return {
      ...state,
      committedMode: state.committedMode === "IDLE" ? "IDLE" : "OBSERVING",
      pendingMode: null,
      pendingSinceMs: null,
      cooldownUntilMs: nowMs + TEMPORAL_POLICY.cooldownMs,
      samples: [],
    };
  }

  const signalGapMs = state.lastSignalAtMs === null ? 0 : nowMs - state.lastSignalAtMs;
  const current =
    signalGapMs > TEMPORAL_POLICY.staleAfterMs
      ? {
          ...state,
          committedMode: state.committedMode === "IDLE" ? ("IDLE" as const) : ("OBSERVING" as const),
          pendingMode: null,
          pendingSinceMs: null,
          cooldownUntilMs: nowMs + TEMPORAL_POLICY.cooldownMs,
          samples: [],
        }
      : state;
  const samples = [...current.samples, { atMs: nowMs, signals: input.signals }].slice(-32);
  const wasHandoff = current.committedMode === "HANDOFF";

  if (input.decision.stability === "immediate") {
    return {
      ...current,
      committedMode: input.decision.to,
      pendingMode: null,
      pendingSinceMs: null,
      lastSequence: input.sequence,
      lastSignalAtMs: nowMs,
      cooldownUntilMs:
        wasHandoff && input.decision.to !== "HANDOFF"
          ? nowMs + TEMPORAL_POLICY.cooldownMs
          : current.cooldownUntilMs,
      samples: input.decision.to === "HANDOFF" ? samples : [],
    };
  }

  if (wasHandoff) {
    if (!exitHandoff.test(samples)) {
      return {
        ...current,
        pendingMode: null,
        pendingSinceMs: null,
        lastSequence: input.sequence,
        lastSignalAtMs: nowMs,
        samples,
      };
    }
    return {
      ...current,
      committedMode: "OBSERVING",
      pendingMode: null,
      pendingSinceMs: null,
      lastSequence: input.sequence,
      lastSignalAtMs: nowMs,
      cooldownUntilMs: nowMs + TEMPORAL_POLICY.cooldownMs,
      samples,
    };
  }

  const coolingDown = current.cooldownUntilMs !== null && nowMs < current.cooldownUntilMs;
  if (!coolingDown && input.decision.to === "HANDOFF" && enterHandoff.test(samples)) {
    return {
      ...current,
      committedMode: "HANDOFF",
      pendingMode: null,
      pendingSinceMs: null,
      lastSequence: input.sequence,
      lastSignalAtMs: nowMs,
      cooldownUntilMs: null,
      samples,
    };
  }

  const committedMode = input.decision.to === "OBSERVING" ? "OBSERVING" : current.committedMode;
  return {
    ...current,
    committedMode,
    pendingMode: input.decision.to === "HANDOFF" && !coolingDown ? "HANDOFF" : null,
    pendingSinceMs:
      input.decision.to === "HANDOFF" && !coolingDown ? (current.pendingSinceMs ?? nowMs) : null,
    lastSequence: input.sequence,
    lastSignalAtMs: nowMs,
    samples,
  };
}
