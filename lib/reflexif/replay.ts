import { decide, POLICY_VERSION } from "./policy.ts";
import type { DecisionEvent, DecisionRecord } from "./ledger.ts";
import {
  advanceTemporal,
  summarizeTemporalCommit,
  TEMPORAL_POLICY_VERSION,
  type TemporalState,
} from "./temporal.ts";
import type { DecisionCommit, PolicyDecision } from "./types.ts";

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

export type EventReplayResult = {
  id: string;
  sessionId: string;
  sequence: number;
  status: DecisionEvent["status"];
  recordedPolicyVersion: string;
  currentPolicyVersion: string;
  recordedTemporalPolicyVersion: string;
  currentTemporalPolicyVersion: string;
  recordedCommit: DecisionCommit;
  currentCommit: DecisionCommit;
  changed: boolean;
};

export function replayDecisionEvents(events: readonly DecisionEvent[]): EventReplayResult[] {
  const sessions = new Map<string, TemporalState>();

  return events.map((event) => {
    const temporalBefore = sessions.get(event.sessionId) ?? event.temporalBefore;
    const snapshot = {
      ...event.snapshot,
      robot: { ...event.snapshot.robot, mode: temporalBefore.committedMode },
    };
    const decision = event.frame ? decide(snapshot, event.frame) : null;
    const temporalAfter = advanceTemporal(
      temporalBefore,
      decision && event.frame
        ? { sequence: event.sequence, decision, signals: event.frame }
        : null,
      event.receivedAtMs,
    );
    const currentCommit = summarizeTemporalCommit(temporalBefore, temporalAfter, decision);
    sessions.set(event.sessionId, temporalAfter);

    return {
      id: event.id,
      sessionId: event.sessionId,
      sequence: event.sequence,
      status: event.status,
      recordedPolicyVersion: event.policyVersion,
      currentPolicyVersion: POLICY_VERSION,
      recordedTemporalPolicyVersion: event.temporalPolicyVersion,
      currentTemporalPolicyVersion: TEMPORAL_POLICY_VERSION,
      recordedCommit: event.commit,
      currentCommit,
      changed:
        currentCommit.to !== event.commit.to ||
        currentCommit.changed !== event.commit.changed,
    };
  });
}
