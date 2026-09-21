import { noul } from "@typesafe-ai/sdk";

export const questions = {
  handoffRequested: noul(
    {
      question: "Does the person appear to be requesting the object held by the robot?",
      inspect: ["`person.lookingAtRobot`", "`person.handExtended`", "`robot.holding`"],
      focus: "Judge observable handoff intent only.",
    },
    {
      true: "The person is visibly requesting the held object.",
      false: "The person is not requesting the held object or the evidence is insufficient.",
    },
  ),
  interactionAppropriate: noul(
    {
      question: "Is a social handoff interaction appropriate in this scene?",
      inspect: ["`person`", "`scene.targetObjectVisible`", "`robot.holding`"],
      focus: "Judge social appropriateness, not collision safety or motor constraints.",
    },
    {
      true: "The scene supports a normal object handoff interaction.",
      false: "The interaction would be socially inappropriate or unsupported by the scene.",
    },
  ),
  handoffIntentAmbiguous: noul(
    {
      question: "Are the observations materially ambiguous about whether the person wants the held object?",
      inspect: ["`person.visible`", "`person.lookingAtRobot`", "`person.handExtended`", "`robot.holding`"],
      guidance: [
        "Looking at the robot while extending a hand toward a held object is normally clear handoff evidence.",
        "Looking without extending a hand, or extending a hand without looking, remains ambiguous.",
        "Judge intent ambiguity only. Do not include collision safety or motor constraints.",
      ],
    },
    {
      true: "The observations support multiple plausible interaction intents.",
      false: "The observations clearly support or clearly reject a handoff request.",
    },
  ),
} as const;
