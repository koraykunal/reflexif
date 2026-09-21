import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { TemporalState } from "./temporal.ts";
import type { DecisionCommit, PolicyDecision, RobotSnapshot, SignalFrame } from "./types.ts";

export const DEFAULT_LEDGER_PATH = path.join(process.cwd(), ".reflexif", "decisions.jsonl");

export type DecisionRecord = {
  schemaVersion: 1;
  stateSchemaVersion: "robot-state-v1";
  signalSchemaVersion: "handoff-signals-v1";
  id: string;
  recordedAt: string;
  policyVersion: string;
  providerVersion: string;
  modelVersion: string;
  gitCommit: string | null;
  snapshot: RobotSnapshot;
  frame: SignalFrame;
  decision: PolicyDecision;
};

export type DecisionEvent = {
  schemaVersion: 2;
  stateSchemaVersion: "robot-state-v1";
  signalSchemaVersion: "handoff-signals-v1";
  id: string;
  sessionId: string;
  sequence: number;
  receivedAtMs: number;
  recordedAt: string;
  policyVersion: string;
  temporalPolicyVersion: string;
  providerVersion: string | null;
  modelVersion: string | null;
  gitCommit: string | null;
  status: "evaluated" | "provider_error";
  snapshot: RobotSnapshot;
  frame: SignalFrame | null;
  decision: PolicyDecision | null;
  temporalBefore: TemporalState;
  temporalAfter: TemporalState;
  commit: DecisionCommit;
};

export type LedgerEntry = DecisionRecord | DecisionEvent;

type DecisionRecordInput = Pick<DecisionRecord, "policyVersion" | "snapshot" | "frame" | "decision">;

type DecisionEventInput = Pick<
  DecisionEvent,
  | "sessionId"
  | "sequence"
  | "receivedAtMs"
  | "policyVersion"
  | "temporalPolicyVersion"
  | "status"
  | "snapshot"
  | "frame"
  | "decision"
  | "temporalBefore"
  | "temporalAfter"
  | "commit"
>;

export class SequenceConflictError extends Error {
  constructor() {
    super("The decision session advanced before this event could be recorded.");
    this.name = "SequenceConflictError";
  }
}

let ledgerWriteQueue = Promise.resolve();

async function serializeLedgerWrite<T>(write: () => Promise<T>): Promise<T> {
  const previous = ledgerWriteQueue;
  let release = () => {};
  ledgerWriteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await write();
  } finally {
    release();
  }
}

export async function appendDecision(
  input: DecisionRecordInput,
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<DecisionRecord> {
  const record: DecisionRecord = {
    schemaVersion: 1,
    stateSchemaVersion: "robot-state-v1",
    signalSchemaVersion: "handoff-signals-v1",
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    providerVersion: input.frame.providerVersion,
    modelVersion: input.frame.modelVersion,
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
    ...input,
  };

  await mkdir(path.dirname(ledgerPath), { recursive: true });
  // ponytail: JSONL is intentionally single-node storage; move to a database when multi-instance writes are required.
  await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function appendDecisionEvent(
  input: DecisionEventInput,
  expectedLastSequence: number | null,
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<DecisionEvent> {
  return serializeLedgerWrite(async () => {
    const latest = await readLatestDecisionEvent(input.sessionId, ledgerPath);
    if ((latest?.sequence ?? null) !== expectedLastSequence) throw new SequenceConflictError();

    const event: DecisionEvent = {
      schemaVersion: 2,
      stateSchemaVersion: "robot-state-v1",
      signalSchemaVersion: "handoff-signals-v1",
      id: randomUUID(),
      recordedAt: new Date(input.receivedAtMs).toISOString(),
      providerVersion: input.frame?.providerVersion ?? null,
      modelVersion: input.frame?.modelVersion ?? null,
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
      ...input,
    };

    await mkdir(path.dirname(ledgerPath), { recursive: true });
    // ponytail: JSONL is intentionally single-node storage; move to a database when multi-instance writes are required.
    await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  });
}

export async function readLedgerEntries(
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<LedgerEntry[]> {
  let contents: string;
  try {
    contents = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  return contents
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        const entry = JSON.parse(line) as { schemaVersion?: unknown };
        if (entry.schemaVersion !== 1 && entry.schemaVersion !== 2) {
          throw new SyntaxError(`Unsupported decision ledger schema on line ${index + 1}.`);
        }
        return entry as LedgerEntry;
      } catch (error) {
        if (error instanceof SyntaxError && error.message.startsWith("Unsupported")) throw error;
        throw new SyntaxError(`Invalid decision ledger entry on line ${index + 1}.`);
      }
    });
}

export async function readDecisionLedger(
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<DecisionRecord[]> {
  return (await readLedgerEntries(ledgerPath)).filter(
    (entry): entry is DecisionRecord => entry.schemaVersion === 1,
  );
}

export async function readDecisionEvents(
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<DecisionEvent[]> {
  return (await readLedgerEntries(ledgerPath)).filter(
    (entry): entry is DecisionEvent => entry.schemaVersion === 2,
  );
}

export async function readLatestDecisionEvent(
  sessionId: string,
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<DecisionEvent | null> {
  // ponytail: a linear scan is sufficient for the local JSONL ledger; index sessions when volume requires a database.
  return (await readDecisionEvents(ledgerPath)).findLast((event) => event.sessionId === sessionId) ?? null;
}
