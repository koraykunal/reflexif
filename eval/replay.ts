import { readDecisionLedger } from "../lib/reflexif/ledger.ts";
import { replayDecisions } from "../lib/reflexif/replay.ts";

const records = await readDecisionLedger(process.argv[2]);
const results = replayDecisions(records);

console.table(
  results.map((result) => ({
    id: result.id.slice(0, 8),
    recorded: result.recordedDecision.to,
    current: result.currentDecision.to,
    result: result.changed ? "CHANGED" : "SAME",
    policy: `${result.recordedPolicyVersion} -> ${result.currentPolicyVersion}`,
  })),
);

const changed = results.filter((result) => result.changed).length;
console.log(`${results.length} decisions replayed: ${results.length - changed} same, ${changed} changed.`);
