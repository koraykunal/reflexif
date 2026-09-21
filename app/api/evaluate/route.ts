import { appendDecision } from "@/lib/reflexif/ledger";
import { decide, POLICY_VERSION } from "@/lib/reflexif/policy";
import { evaluateSignals } from "@/lib/reflexif/signals";
import type { SignalFrame } from "@/lib/reflexif/types";
import { parseSnapshot } from "@/lib/reflexif/validate";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseSnapshot(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  let frame: SignalFrame;
  try {
    frame = await evaluateSignals(parsed.value);
  } catch (error) {
    console.error("Jev evaluation failed", error);
    return Response.json(
      { error: "Jev evaluation failed. Check the server log and TYPESAFE_API_KEY." },
      { status: 502 },
    );
  }

  const decision = decide(parsed.value, frame);
  try {
    const record = await appendDecision({
      policyVersion: POLICY_VERSION,
      snapshot: parsed.value,
      frame,
      decision,
    });
    return Response.json({ decisionId: record.id, snapshot: parsed.value, frame, decision });
  } catch (error) {
    console.error("Decision ledger write failed", error);
    return Response.json(
      { error: "The decision could not be recorded. No untracked decision was returned." },
      { status: 500 },
    );
  }
}
