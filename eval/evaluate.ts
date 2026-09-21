import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  checkRegression,
  evaluatePolicy,
  parseCandidatePolicy,
  parseOutcomeLabels,
} from "../lib/reflexif/evaluation.ts";
import { readDecisionEvents } from "../lib/reflexif/ledger.ts";
import { CURRENT_REPLAY_POLICY } from "../lib/reflexif/replay.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const [ledgerPath, outcomesArgument, candidateArgument] = args.filter((argument) => argument !== "--check");
const outcomesPath = outcomesArgument ?? path.join(process.cwd(), ".reflexif", "outcomes.jsonl");
const candidatePath = candidateArgument ?? path.join(process.cwd(), "eval", "candidate-policy.json");
const events = await readDecisionEvents(ledgerPath);

let outcomeContents: string;
try {
  outcomeContents = await readFile(outcomesPath, "utf8");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.error(`Outcome labels not found at ${outcomesPath}.`);
    console.error('Add JSONL rows such as {"sessionId":"...","sequence":0,"expectedMode":"OBSERVING"}.');
    process.exit(1);
  }
  throw error;
}

let candidateContents: string;
try {
  candidateContents = await readFile(candidatePath, "utf8");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.error(`Candidate policy not found at ${candidatePath}.`);
    process.exit(1);
  }
  throw error;
}

const labels = parseOutcomeLabels(outcomeContents);
const candidatePolicy = parseCandidatePolicy(candidateContents);
if (events.length === 0 || labels.length === 0) {
  console.error("Evaluation requires at least one v2 decision event and one outcome label.");
  process.exit(1);
}

const current = evaluatePolicy(events, labels, CURRENT_REPLAY_POLICY);
const candidate = evaluatePolicy(events, labels, candidatePolicy);

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
console.log(
  `${labels.length} labels, ${events.length} v2 events, ${changed} decision changes for ${candidatePolicy.name}.`,
);

if (check) {
  const violations = checkRegression(current.metrics, candidate.metrics, candidatePolicy.budgets);
  if (violations.length === 0) {
    console.log("Regression check passed.");
  } else {
    console.error(`Regression check failed:\n- ${violations.join("\n- ")}`);
    process.exitCode = 1;
  }
}
