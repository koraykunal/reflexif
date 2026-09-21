import "server-only";

import { createJevProvider, demoProvider } from "./providers";
import type { DecisionProvider, RobotSnapshot, SignalFrame } from "./types";

let defaultProvider: DecisionProvider<RobotSnapshot, SignalFrame> | null = null;

function getDefaultProvider() {
  defaultProvider ??= process.env.TYPESAFE_API_KEY
    ? createJevProvider(process.env.TYPESAFE_API_KEY)
    : demoProvider;
  return defaultProvider;
}

export function evaluateSignals(
  snapshot: RobotSnapshot,
  provider: DecisionProvider<RobotSnapshot, SignalFrame> = getDefaultProvider(),
): Promise<SignalFrame> {
  return provider.evaluate(snapshot);
}
