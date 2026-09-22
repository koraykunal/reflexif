import type { RobotMode, RobotSnapshot } from "./types";

type ParseResult = { ok: true; value: RobotSnapshot } | { ok: false; error: string };

type EvaluationRequest = {
  sessionId: string;
  sequence: number;
  snapshot: RobotSnapshot;
};

type EvaluationRequestResult =
  | { ok: true; value: EvaluationRequest }
  | { ok: false; error: string };

type OutcomeRequest = {
  decisionId: string;
  sessionId: string;
  sequence: number;
  expectedMode: RobotMode;
  expectedHandoffRequested?: boolean;
};

type OutcomeRequestResult =
  | { ok: true; value: OutcomeRequest }
  | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isMode = (value: unknown): value is RobotMode =>
  value === "IDLE" || value === "OBSERVING" || value === "HANDOFF";

export function parseSnapshot(input: unknown): ParseResult {
  if (!isRecord(input) || !isRecord(input.person) || !isRecord(input.scene) || !isRecord(input.robot)) {
    return { ok: false, error: "Snapshot must contain person, scene, and robot objects." };
  }

  const { person, scene, robot } = input;
  const distance = person.distanceMeters;
  const holding = robot.holding;

  if (
    !isBoolean(person.visible) ||
    !isBoolean(person.lookingAtRobot) ||
    !isBoolean(person.handExtended) ||
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance < 0.1 ||
    distance > 5
  ) {
    return { ok: false, error: "Person observations are invalid." };
  }

  if (!isBoolean(scene.targetObjectVisible) || !isBoolean(scene.obstruction)) {
    return { ok: false, error: "Scene observations are invalid." };
  }

  if ((holding !== null && (typeof holding !== "string" || holding.trim().length === 0 || holding.length > 64)) || !isMode(robot.mode)) {
    return { ok: false, error: "Robot state is invalid." };
  }

  return {
    ok: true,
    value: {
      person: {
        visible: person.visible,
        lookingAtRobot: person.lookingAtRobot,
        handExtended: person.handExtended,
        distanceMeters: distance,
      },
      scene: {
        targetObjectVisible: scene.targetObjectVisible,
        obstruction: scene.obstruction,
      },
      robot: {
        holding: holding === null ? null : holding.trim(),
        mode: robot.mode,
      },
    },
  };
}

export function parseEvaluationRequest(input: unknown): EvaluationRequestResult {
  if (
    !isRecord(input) ||
    typeof input.sessionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.sessionId) ||
    !Number.isInteger(input.sequence) ||
    (input.sequence as number) < 0
  ) {
    return { ok: false, error: "Session id and sequence are invalid." };
  }

  const snapshot = parseSnapshot(input.snapshot);
  if (!snapshot.ok) return snapshot;

  return {
    ok: true,
    value: {
      sessionId: input.sessionId,
      sequence: input.sequence as number,
      snapshot: snapshot.value,
    },
  };
}

export function parseOutcomeRequest(input: unknown): OutcomeRequestResult {
  if (
    !isRecord(input) ||
    typeof input.decisionId !== "string" ||
    input.decisionId.length === 0 ||
    input.decisionId.length > 128 ||
    typeof input.sessionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.sessionId) ||
    !Number.isInteger(input.sequence) ||
    (input.sequence as number) < 0 ||
    !isMode(input.expectedMode) ||
    ("expectedHandoffRequested" in input &&
      typeof input.expectedHandoffRequested !== "boolean")
  ) {
    return { ok: false, error: "Outcome label is invalid." };
  }

  return {
    ok: true,
    value: {
      decisionId: input.decisionId,
      sessionId: input.sessionId,
      sequence: input.sequence as number,
      expectedMode: input.expectedMode,
      ...("expectedHandoffRequested" in input
        ? { expectedHandoffRequested: input.expectedHandoffRequested as boolean }
        : {}),
    },
  };
}
