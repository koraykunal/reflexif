import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluatePolicy, parseOutcomeLabels } from "../lib/reflexif/evaluation.ts";
import { readDecisionEvents } from "../lib/reflexif/ledger.ts";
import { CURRENT_REPLAY_POLICY } from "../lib/reflexif/replay.ts";

const ledgerPath = process.argv[2];
const outcomesPath = process.argv[3] ?? path.join(process.cwd(), ".reflexif", "outcomes.jsonl");
const events = await readDecisionEvents(ledgerPath);

let contents: string;
try {
  contents = await readFile(outcomesPath, "utf8");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.error(`Outcome labels not found at ${outcomesPath}.`);
    console.error('Add JSONL rows such as {"sessionId":"...","sequence":0,"expectedMode":"OBSERVING"}.');
    process.exit(1);
  }
  throw error;
}

const labels = parseOutcomeLabels(contents);
if (events.length === 0 || labels.length === 0) {
  console.error("Evaluation requires at least one v2 decision event and one outcome label.");
  process.exit(1);
}

const current = evaluatePolicy(events, labels, CURRENT_REPLAY_POLICY);
const candidate = evaluatePolicy(events, labels, {
  ...CURRENT_REPLAY_POLICY,
  policyVersion: `${CURRENT_REPLAY_POLICY.policyVersion}-candidate`,
  temporalPolicyVersion: `${CURRENT_REPLAY_POLICY.temporalPolicyVersion}-candidate`,
  temporalPolicy: {
    ...CURRENT_REPLAY_POLICY.temporalPolicy,
    enterHandoff: {
      ...CURRENT_REPLAY_POLICY.temporalPolicy.enterHandoff,
      intentAtLeast: 0.8,
      requiredSamples: 4,
      windowSamples: 5,
    },
  },
});

const rows = [
  ["coverage", current.metrics.coverage, candidate.metrics.coverage],
  ["exact_accuracy", current.metrics.exactAccuracy, candidate.metrics.exactAccuracy],
  ["false_positive_frames", current.metrics.falsePositiveFrames, candidate.metrics.falsePositiveFrames],
  ["false_negative_frames", current.metrics.falseNegativeFrames, candidate.metrics.falseNegativeFrames],
  ["abstention_rate", current.metrics.abstentionRate, candidate.metrics.abstentionRate],
  ["brier_score", current.metrics.brierScore, candidate.metrics.brierScore],
  ["calibration_error", current.metrics.calibrationError, candidate.metrics.calibrationError],
] as const;

console.table(
  rows.map(([metric, baseline, shadow]) => ({
    metric,
    current: typeof baseline === "number" ? Number(baseline.toFixed(4)) : "-",
    candidate: typeof shadow === "number" ? Number(shadow.toFixed(4)) : "-",
    delta:
      typeof baseline === "number" && typeof shadow === "number"
        ? Number((shadow - baseline).toFixed(4))
        : "-",
  })),
);

const changed = candidate.replay.filter(
  (result, index) => result.currentCommit.to !== current.replay[index]?.currentCommit.to,
).length;
console.log(`${labels.length} labels, ${events.length} v2 events, ${changed} candidate decision changes.`);
