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

export type EvaluationResult = {
  decisionId: string;
  snapshot: RobotSnapshot;
  frame: SignalFrame;
  decision: PolicyDecision;
};
