import { readDecisionEvents } from "@/lib/reflexif/ledger";
import { appendOutcomeLabel, OutcomeConflictError } from "@/lib/reflexif/outcomes";
import { parseOutcomeRequest } from "@/lib/reflexif/validate";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin outcome writes are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseOutcomeRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  // ponytail: a linear scan is enough for the local ledger; index events with transactional storage later.
  const event = (await readDecisionEvents()).find(
    (candidate) =>
      candidate.sessionId === parsed.value.sessionId &&
      candidate.sequence === parsed.value.sequence,
  );
  if (!event || event.id !== parsed.value.decisionId) {
    return Response.json({ error: "Decision event was not found in the ledger." }, { status: 404 });
  }

  try {
    const label = await appendOutcomeLabel(parsed.value);
    return Response.json({ label }, { status: 201 });
  } catch (error) {
    if (error instanceof OutcomeConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Outcome label write failed", error);
    return Response.json({ error: "The outcome label could not be recorded." }, { status: 500 });
  }
}
