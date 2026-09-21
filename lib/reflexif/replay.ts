import { decide, POLICY_VERSION } from "./policy.ts";
import type { DecisionRecord } from "./ledger.ts";
import type { PolicyDecision } from "./types.ts";

export type ReplayResult = {
  id: string;
  recordedPolicyVersion: string;
  currentPolicyVersion: string;
  recordedDecision: PolicyDecision;
  currentDecision: PolicyDecision;
  changed: boolean;
};

export function replayDecisions(records: DecisionRecord[]): ReplayResult[] {
  return records.map((record) => {
    const currentDecision = decide(record.snapshot, record.frame);
    return {
      id: record.id,
      recordedPolicyVersion: record.policyVersion,
      currentPolicyVersion: POLICY_VERSION,
      recordedDecision: record.decision,
      currentDecision,
      changed: currentDecision.to !== record.decision.to,
    };
  });
}
