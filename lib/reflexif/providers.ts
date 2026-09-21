import { TypeSafeClient } from "@typesafe-ai/sdk";
import { questions } from "./questions.ts";
import type { DecisionProvider, RobotSnapshot, SignalFrame } from "./types.ts";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

export const demoProvider: DecisionProvider<RobotSnapshot, SignalFrame> = {
  id: "demo",
  async evaluate(snapshot) {
    const startedAt = performance.now();
    const { person, robot, scene } = snapshot;
    const handoffRequested = person.visible
      ? clamp(0.08 + (person.lookingAtRobot ? 0.28 : 0) + (person.handExtended ? 0.54 : 0) + (robot.holding ? 0.08 : 0))
      : 0.02;
    const interactionAppropriate = person.visible
      ? clamp(
          0.28 +
            (person.distanceMeters >= 0.35 && person.distanceMeters <= 1.2 ? 0.28 : 0) +
            (!scene.obstruction ? 0.28 : 0) +
            (robot.holding ? 0.12 : 0),
        )
      : 0.08;
    const handoffIntentAmbiguous = person.visible
      ? clamp(
          0.08 +
            (!person.lookingAtRobot ? 0.22 : 0) +
            (!person.handExtended ? 0.25 : 0) +
            (scene.obstruction ? 0.38 : 0) +
            (person.distanceMeters > 1.5 ? 0.18 : 0),
        )
      : 0.82;

    return {
      handoffRequested,
      interactionAppropriate,
      handoffIntentAmbiguous,
      source: "demo",
      providerVersion: "demo-v1",
      modelVersion: "deterministic-demo",
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      inputTokens: null,
    };
  },
};

export function createJevProvider(
  apiKey: string,
  model = process.env.TYPESAFE_MODEL || DEFAULT_JEV_MODEL,
): DecisionProvider<RobotSnapshot, SignalFrame> {
  const client = new TypeSafeClient({ apiKey, timeout: 5_000, retry: { maxRetries: 0 } });
  return {
    id: "jev",
    async evaluate(snapshot) {
      const startedAt = performance.now();
      const response = await client.systemOne({ state: snapshot, questions, model });
      return {
        handoffRequested: response.answers.handoffRequested.noul,
        interactionAppropriate: response.answers.interactionAppropriate.noul,
        handoffIntentAmbiguous: response.answers.handoffIntentAmbiguous.noul,
        source: "jev",
        providerVersion: "@typesafe-ai/sdk@0.6.0",
        modelVersion: response.model,
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: response.usage.input_tokens,
      };
    },
  };
}
