import { all, any, signal, type SignalSample } from "./temporal-signal.ts";
import type { DecisionCommit, PolicyDecision, RobotMode, SemanticSignals } from "./types.ts";

export const TEMPORAL_POLICY_VERSION = "handoff-temporal-v1";

export type TemporalPolicy = {
  enterHandoff: {
    intentAtLeast: number;
    interactionAppropriateAtLeast: number;
    ambiguityAtMost: number;
    requiredSamples: number;
    windowSamples: number;
  };
  exitHandoff: {
    intentAtMost: number;
    interactionAppropriateAtMost: number;
    ambiguityAtLeast: number;
    requiredSamples: number;
    windowSamples: number;
  };
  cooldownMs: number;
  staleAfterMs: number;
};

export const TEMPORAL_POLICY: TemporalPolicy = {
  enterHandoff: {
    intentAtLeast: 0.75,
    interactionAppropriateAtLeast: 0.8,
    ambiguityAtMost: 0.35,
    requiredSamples: 3,
    windowSamples: 4,
  },
  exitHandoff: {
    intentAtMost: 0.55,
    interactionAppropriateAtMost: 0.65,
    ambiguityAtLeast: 0.55,
    requiredSamples: 2,
    windowSamples: 3,
  },
  cooldownMs: 500,
  staleAfterMs: 1_000,
};

const enterHandoff = (policy: TemporalPolicy) =>
  all(
    signal("handoffRequested")
      .above(policy.enterHandoff.intentAtLeast)
      .samples(policy.enterHandoff.requiredSamples, policy.enterHandoff.windowSamples),
    signal("interactionAppropriate").above(policy.enterHandoff.interactionAppropriateAtLeast),
    signal("handoffIntentAmbiguous").below(policy.enterHandoff.ambiguityAtMost),
  );

const exitHandoff = (policy: TemporalPolicy) =>
  any(
    signal("handoffRequested")
      .below(policy.exitHandoff.intentAtMost)
      .samples(policy.exitHandoff.requiredSamples, policy.exitHandoff.windowSamples),
    signal("interactionAppropriate")
      .below(policy.exitHandoff.interactionAppropriateAtMost)
      .samples(policy.exitHandoff.requiredSamples, policy.exitHandoff.windowSamples),
    signal("handoffIntentAmbiguous")
      .above(policy.exitHandoff.ambiguityAtLeast)
      .samples(policy.exitHandoff.requiredSamples, policy.exitHandoff.windowSamples),
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

export function summarizeTemporalCommit(
  before: TemporalState,
  after: TemporalState,
  proposal: PolicyDecision | null,
): DecisionCommit {
  const changed = before.committedMode !== after.committedMode;
  return {
    from: before.committedMode,
    to: after.committedMode,
    changed,
    reason: changed
      ? (proposal?.reason ?? "The signal stream became stale.")
      : proposal && proposal.to !== after.committedMode
        ? "Temporal evidence is still pending."
        : (proposal?.reason ?? "No fresh signal was available."),
  };
}

export function advanceTemporal(
  state: TemporalState,
  input: TemporalInput | null,
  nowMs: number,
  policy: TemporalPolicy = TEMPORAL_POLICY,
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
    if (state.lastSignalAtMs === null || nowMs - state.lastSignalAtMs <= policy.staleAfterMs) return state;
    return {
      ...state,
      committedMode: state.committedMode === "IDLE" ? "IDLE" : "OBSERVING",
      pendingMode: null,
      pendingSinceMs: null,
      cooldownUntilMs: nowMs + policy.cooldownMs,
      samples: [],
    };
  }

  const signalGapMs = state.lastSignalAtMs === null ? 0 : nowMs - state.lastSignalAtMs;
  const current =
    signalGapMs > policy.staleAfterMs
      ? {
          ...state,
          committedMode: state.committedMode === "IDLE" ? ("IDLE" as const) : ("OBSERVING" as const),
          pendingMode: null,
          pendingSinceMs: null,
          cooldownUntilMs: nowMs + policy.cooldownMs,
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
          ? nowMs + policy.cooldownMs
          : current.cooldownUntilMs,
      samples: input.decision.to === "HANDOFF" ? samples : [],
    };
  }

  if (wasHandoff) {
    if (!exitHandoff(policy).test(samples)) {
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
      cooldownUntilMs: nowMs + policy.cooldownMs,
      samples,
    };
  }

  const coolingDown = current.cooldownUntilMs !== null && nowMs < current.cooldownUntilMs;
  if (!coolingDown && input.decision.to === "HANDOFF" && enterHandoff(policy).test(samples)) {
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
