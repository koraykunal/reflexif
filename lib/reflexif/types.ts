import type { TemporalState } from "./temporal";

export type RobotMode = "IDLE" | "OBSERVING" | "HANDOFF";

export type RobotSnapshot = {
  person: {
    visible: boolean;
    lookingAtRobot: boolean;
    handExtended: boolean;
    distanceMeters: number;
  };
  scene: {
    targetObjectVisible: boolean;
    obstruction: boolean;
  };
  robot: {
    holding: string | null;
    mode: RobotMode;
  };
};

export type SemanticSignals = {
  handoffRequested: number;
  interactionAppropriate: number;
  handoffIntentAmbiguous: number;
};

export type SignalFrame = SemanticSignals & {
  source: "jev" | "demo";
  providerVersion: string;
  modelVersion: string;
  latencyMs: number;
  inputTokens: number | null;
};

export type DecisionProvider<State, Result> = {
  readonly id: string;
  evaluate(state: State): Promise<Result>;
};

export type PolicyGate = {
  label: string;
  value: string;
  passed: boolean;
};

export type PolicyDecision = {
  from: RobotMode;
  to: RobotMode;
  reason: string;
  stability: "immediate" | "stabilized";
  gates: PolicyGate[];
};

export type DecisionCommit = {
  from: RobotMode;
  to: RobotMode;
  changed: boolean;
  reason: string;
};

export type EvaluationResult = {
  decisionId: string;
  sessionId: string;
  sequence: number;
  snapshot: RobotSnapshot;
  frame: SignalFrame;
  decision: PolicyDecision;
  temporalBefore: TemporalState;
  temporalAfter: TemporalState;
  commit: DecisionCommit;
};

export type EvaluationErrorResult = {
  error: string;
  decisionId?: string;
  temporalAfter?: TemporalState;
  commit?: DecisionCommit;
};
