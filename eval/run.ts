import { scenarios } from "./scenarios.ts";
import { decide } from "../lib/reflexif/policy.ts";
import { createJevProvider } from "../lib/reflexif/providers.ts";

if (!process.env.TYPESAFE_API_KEY) {
  throw new Error("TYPESAFE_API_KEY is required. Load .env.local before running this command.");
}

const provider = createJevProvider(process.env.TYPESAFE_API_KEY);
const rows: Array<Record<string, string | number>> = [];
let inputTokens = 0;

for (const scenario of scenarios) {
  const frame = await provider.evaluate(scenario.snapshot);
  const decision = decide(scenario.snapshot, frame);
  const passed = decision.to === scenario.expected;
  inputTokens += frame.inputTokens ?? 0;
  rows.push({
    scenario: scenario.id,
    intent: frame.handoffRequested.toFixed(2),
    appropriate: frame.interactionAppropriate.toFixed(2),
    ambiguous: frame.handoffIntentAmbiguous.toFixed(2),
    expected: scenario.expected,
    actual: decision.to,
    result: passed ? "PASS" : "FAIL",
    latency_ms: frame.latencyMs,
  });
}

console.table(rows);

const failures = rows.filter((row) => row.result === "FAIL");
console.log(`${rows.length - failures.length}/${rows.length} scenarios passed, ${inputTokens} input tokens.`);

if (failures.length > 0) {
  process.exitCode = 1;
}
