import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PolicyDecision, RobotSnapshot, SignalFrame } from "./types.ts";

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

type DecisionRecordInput = Pick<DecisionRecord, "policyVersion" | "snapshot" | "frame" | "decision">;

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

export async function readDecisionLedger(
  ledgerPath = process.env.REFLEXIF_LEDGER_PATH || DEFAULT_LEDGER_PATH,
): Promise<DecisionRecord[]> {
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
        return JSON.parse(line) as DecisionRecord;
      } catch {
        throw new SyntaxError(`Invalid decision ledger entry on line ${index + 1}.`);
      }
    });
}
