import type {
  PolicyDecision,
  PolicyGate,
  RobotSnapshot,
  SemanticSignals,
} from "./types.ts";

export const POLICY_VERSION = "handoff-v1";

export type PolicyThresholds = {
  handoffRequested: number;
  interactionAppropriate: number;
  handoffIntentAmbiguousMax: number;
  handoffDistanceMeters: { min: number; max: number };
};

export const POLICY_THRESHOLDS: PolicyThresholds = {
  handoffRequested: 0.7,
  interactionAppropriate: 0.8,
  handoffIntentAmbiguousMax: 0.35,
  handoffDistanceMeters: { min: 0.35, max: 1.2 },
} as const;

function probabilityGate(label: string, value: number, threshold: number, kind: "min" | "max"): PolicyGate {
  const passed = kind === "min" ? value >= threshold : value <= threshold;
  return {
    label,
    value: `${value.toFixed(2)} ${kind === "min" ? ">=" : "<="} ${threshold.toFixed(2)}`,
    passed,
  };
}

export function decide(
  snapshot: RobotSnapshot,
  signals: SemanticSignals,
  thresholds: PolicyThresholds = POLICY_THRESHOLDS,
): PolicyDecision {
  const distanceInRange =
    snapshot.person.distanceMeters >= thresholds.handoffDistanceMeters.min &&
    snapshot.person.distanceMeters <= thresholds.handoffDistanceMeters.max;
  const gates: PolicyGate[] = [
    { label: "Person visible", value: snapshot.person.visible ? "yes" : "no", passed: snapshot.person.visible },
    { label: "Object held", value: snapshot.robot.holding ?? "none", passed: Boolean(snapshot.robot.holding) },
    { label: "Path clear", value: snapshot.scene.obstruction ? "blocked" : "clear", passed: !snapshot.scene.obstruction },
    {
      label: "Handoff range",
      value: `${snapshot.person.distanceMeters.toFixed(2)} m`,
      passed: distanceInRange,
    },
    probabilityGate("Handoff intent", signals.handoffRequested, thresholds.handoffRequested, "min"),
    probabilityGate(
      "Interaction appropriate",
      signals.interactionAppropriate,
      thresholds.interactionAppropriate,
      "min",
    ),
    probabilityGate(
      "Handoff ambiguity",
      signals.handoffIntentAmbiguous,
      thresholds.handoffIntentAmbiguousMax,
      "max",
    ),
  ];

  if (!snapshot.person.visible) {
    return {
      from: snapshot.robot.mode,
      to: "IDLE",
      reason: "No person is present.",
      stability: "immediate",
      gates,
    };
  }

  if (!snapshot.robot.holding || snapshot.scene.obstruction || !distanceInRange) {
    return {
      from: snapshot.robot.mode,
      to: "OBSERVING",
      reason: snapshot.scene.obstruction
        ? "A deterministic safety gate blocked the path."
        : !snapshot.robot.holding
          ? "There is no object to hand off."
          : "The person is outside the configured handoff range.",
      stability: "immediate",
      gates,
    };
  }

  if (signals.handoffIntentAmbiguous > thresholds.handoffIntentAmbiguousMax) {
    return {
      from: snapshot.robot.mode,
      to: "OBSERVING",
      reason: "The handoff intent is too ambiguous to act.",
      stability: "stabilized",
      gates,
    };
  }

  if (
    signals.handoffRequested >= thresholds.handoffRequested &&
    signals.interactionAppropriate >= thresholds.interactionAppropriate
  ) {
    return {
      from: snapshot.robot.mode,
      to: "HANDOFF",
      reason: "All semantic and deterministic gates passed.",
      stability: "stabilized",
      gates,
    };
  }

  return {
    from: snapshot.robot.mode,
    to: "OBSERVING",
    reason: "More evidence is required before acting.",
    stability: "stabilized",
    gates,
  };
}
