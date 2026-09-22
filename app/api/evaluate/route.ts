import {
  appendDecisionEvent,
  readLatestDecisionEvent,
  SequenceConflictError,
} from "@/lib/reflexif/ledger";
import { decide, POLICY_VERSION } from "@/lib/reflexif/policy";
import { evaluateSignals } from "@/lib/reflexif/signals";
import {
  advanceTemporal,
  createTemporalState,
  summarizeTemporalCommit,
  TEMPORAL_POLICY_VERSION,
} from "@/lib/reflexif/temporal";
import type { PolicyDecision, SignalFrame } from "@/lib/reflexif/types";
import { parseEvaluationRequest } from "@/lib/reflexif/validate";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseEvaluationRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { sessionId, sequence } = parsed.value;
  const latest = await readLatestDecisionEvent(sessionId);
  if (latest && sequence <= latest.sequence) {
    return Response.json({ error: "Sequence must advance within a decision session." }, { status: 409 });
  }

  const temporalBefore = latest?.temporalAfter ?? createTemporalState(parsed.value.snapshot.robot.mode);
  const snapshot = {
    ...parsed.value.snapshot,
    robot: { ...parsed.value.snapshot.robot, mode: temporalBefore.committedMode },
  };
  const receivedAtMs = Math.max(Date.now(), temporalBefore.lastSignalAtMs ?? 0);
  let frame: SignalFrame | null = null;
  let decision: PolicyDecision | null = null;
  let status: "evaluated" | "provider_error" = "evaluated";

  try {
    frame = await evaluateSignals(snapshot);
    decision = decide(snapshot, frame);
  } catch (error) {
    status = "provider_error";
    console.error("Decision provider evaluation failed", error);
  }

  const temporalAfter = advanceTemporal(
    temporalBefore,
    frame && decision ? { sequence, decision, signals: frame } : null,
    receivedAtMs,
  );
  const commit = summarizeTemporalCommit(temporalBefore, temporalAfter, decision);

  try {
    const event = await appendDecisionEvent(
      {
        sessionId,
        sequence,
        receivedAtMs,
        policyVersion: POLICY_VERSION,
        temporalPolicyVersion: TEMPORAL_POLICY_VERSION,
        status,
        snapshot,
        frame,
        decision,
        temporalBefore,
        temporalAfter,
        commit,
      },
      latest?.sequence ?? null,
    );

    if (status === "provider_error" || !frame || !decision) {
      return Response.json(
        {
          error: "Decision provider evaluation failed. The failure was recorded.",
          decisionId: event.id,
          temporalAfter,
          commit,
        },
        { status: 502 },
      );
    }

    return Response.json({
      decisionId: event.id,
      sessionId,
      sequence,
      snapshot,
      frame,
      decision,
      temporalBefore,
      temporalAfter,
      commit,
    });
  } catch (error) {
    if (error instanceof SequenceConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Decision event ledger write failed", error);
    return Response.json(
      { error: "The decision could not be recorded. No untracked decision was returned." },
      { status: 500 },
    );
  }
}
