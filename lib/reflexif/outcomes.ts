import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseOutcomeLabels, type OutcomeLabel } from "./evaluation.ts";

export const DEFAULT_OUTCOMES_PATH = path.join(process.cwd(), ".reflexif", "outcomes.jsonl");

export type OutcomeRecord = OutcomeLabel & {
  decisionId: string;
  labeledAt: string;
};

export class OutcomeConflictError extends Error {
  constructor() {
    super("This decision event already has an outcome label.");
    this.name = "OutcomeConflictError";
  }
}

let outcomeWriteQueue = Promise.resolve();

async function serializeOutcomeWrite<T>(write: () => Promise<T>): Promise<T> {
  const previous = outcomeWriteQueue;
  let release = () => {};
  outcomeWriteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await write();
  } finally {
    release();
  }
}

export async function readOutcomeLabels(
  outcomesPath = process.env.REFLEXIF_OUTCOMES_PATH || DEFAULT_OUTCOMES_PATH,
): Promise<OutcomeLabel[]> {
  try {
    return parseOutcomeLabels(await readFile(outcomesPath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function appendOutcomeLabel(
  input: OutcomeLabel & { decisionId: string },
  outcomesPath = process.env.REFLEXIF_OUTCOMES_PATH || DEFAULT_OUTCOMES_PATH,
): Promise<OutcomeRecord> {
  return serializeOutcomeWrite(async () => {
    const labels = await readOutcomeLabels(outcomesPath);
    if (labels.some((label) => label.sessionId === input.sessionId && label.sequence === input.sequence)) {
      throw new OutcomeConflictError();
    }

    const record: OutcomeRecord = { ...input, labeledAt: new Date().toISOString() };
    await mkdir(path.dirname(outcomesPath), { recursive: true });
    // ponytail: JSONL is local single-node storage; move to transactional storage before multi-instance writes.
    await appendFile(outcomesPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  });
}
