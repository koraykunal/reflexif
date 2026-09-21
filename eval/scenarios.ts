import type { RobotMode, RobotSnapshot } from "../lib/reflexif/types.ts";

export type Scenario = {
  id: string;
  expected: RobotMode;
  snapshot: RobotSnapshot;
};

const clearHandoff: RobotSnapshot = {
  person: { visible: true, lookingAtRobot: true, handExtended: true, distanceMeters: 0.7 },
  scene: { targetObjectVisible: true, obstruction: false },
  robot: { holding: "screwdriver", mode: "OBSERVING" },
};

export const scenarios: readonly Scenario[] = [
  { id: "clear-handoff", expected: "HANDOFF", snapshot: clearHandoff },
  {
    id: "clear-handoff-pen",
    expected: "HANDOFF",
    snapshot: {
      ...clearHandoff,
      person: { ...clearHandoff.person, distanceMeters: 0.45 },
      robot: { holding: "pen", mode: "IDLE" },
    },
  },
  {
    id: "clear-handoff-cup",
    expected: "HANDOFF",
    snapshot: {
      ...clearHandoff,
      person: { ...clearHandoff.person, distanceMeters: 1.1 },
      robot: { holding: "cup", mode: "OBSERVING" },
    },
  },
  {
    id: "looking-only",
    expected: "OBSERVING",
    snapshot: { ...clearHandoff, person: { ...clearHandoff.person, handExtended: false } },
  },
  {
    id: "passerby",
    expected: "OBSERVING",
    snapshot: {
      ...clearHandoff,
      person: { ...clearHandoff.person, lookingAtRobot: false, handExtended: false },
    },
  },
  {
    id: "no-person",
    expected: "IDLE",
    snapshot: {
      ...clearHandoff,
      person: { ...clearHandoff.person, visible: false, lookingAtRobot: false, handExtended: false },
    },
  },
  {
    id: "robot-empty",
    expected: "OBSERVING",
    snapshot: { ...clearHandoff, robot: { ...clearHandoff.robot, holding: null } },
  },
  {
    id: "blocked-path",
    expected: "OBSERVING",
    snapshot: { ...clearHandoff, scene: { ...clearHandoff.scene, obstruction: true } },
  },
  {
    id: "extended-not-looking",
    expected: "OBSERVING",
    snapshot: { ...clearHandoff, person: { ...clearHandoff.person, lookingAtRobot: false } },
  },
  {
    id: "distant-request",
    expected: "OBSERVING",
    snapshot: { ...clearHandoff, person: { ...clearHandoff.person, distanceMeters: 2.4 } },
  },
];
