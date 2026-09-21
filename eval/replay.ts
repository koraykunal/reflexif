import { readDecisionEvents, readDecisionLedger } from "../lib/reflexif/ledger.ts";
import { replayDecisionEvents, replayDecisions } from "../lib/reflexif/replay.ts";

const ledgerPath = process.argv[2];
const legacyResults = replayDecisions(await readDecisionLedger(ledgerPath));
const eventResults = replayDecisionEvents(await readDecisionEvents(ledgerPath));

if (legacyResults.length > 0) {
  console.table(
    legacyResults.map((result) => ({
      schema: 1,
      id: result.id.slice(0, 8),
      recorded: result.recordedDecision.to,
      current: result.currentDecision.to,
      result: result.changed ? "CHANGED" : "SAME",
      policy: `${result.recordedPolicyVersion} -> ${result.currentPolicyVersion}`,
    })),
  );
}

if (eventResults.length > 0) {
  console.table(
    eventResults.map((result) => ({
      schema: 2,
      session: result.sessionId.slice(0, 8),
      sequence: result.sequence,
      status: result.status,
      recorded: result.recordedCommit.to,
      current: result.currentCommit.to,
      result: result.changed ? "CHANGED" : "SAME",
      policy: `${result.recordedPolicyVersion} -> ${result.currentPolicyVersion}`,
      temporal: `${result.recordedTemporalPolicyVersion} -> ${result.currentTemporalPolicyVersion}`,
    })),
  );
}

const results = [...legacyResults, ...eventResults];
const changed = results.filter((result) => result.changed).length;
console.log(`${results.length} ledger entries replayed: ${results.length - changed} same, ${changed} changed.`);
