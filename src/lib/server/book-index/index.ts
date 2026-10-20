import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { bookIndexPaths, isValidPdfId, listPdfs, livePdfPath, publishBookIndex } from "../pdf-store";
import type { EvidenceHit } from "./retrieval.mjs";
import { BookIndexWorker } from "./worker-client";

export { guardBookAnswer } from "./answer-guard.mjs";
export type BookEvidence = { bookId: string; question: string; queries: string[]; hits: EvidenceHit[] };

type State = { worker: BookIndexWorker; started: boolean };
// Route bundles and dev reloads share one queue and model process.
const globalAi = globalThis as typeof globalThis & { betterReaderBookIndex?: State };
const state = globalAi.betterReaderBookIndex ??= { worker: new BookIndexWorker(), started: false };

/** Fire-and-forget: failures belong in server logs, not in upload/restore responses. */
export function queueBookIndex(id: string): void {
  if (process.env.NODE_ENV === "test" || !isValidPdfId(id)) return;
  void state.worker.schedule(async (run) => {
    if (!await livePdfPath(id)) return;
    const files = bookIndexPaths(id);
    await mkdir(path.dirname(files.indexFile), { recursive: true });
    try {
      await rm(files.tempFile, { force: true });
      const reply = await run({ kind: "index", bookId: id, ...files });
      if (reply.kind === "index" && reply.indexed) await publishBookIndex(id);
    } finally {
      await rm(files.tempFile, { force: true });
    }
  }).catch((error) => console.error(`[book-index] ${id}:`, error));
}

/** Missing, interrupted, outdated and corrupt indexes are rebuilt on server startup. */
export function startBookIndexing(): void {
  if (process.env.NODE_ENV === "test" || state.started) return;
  state.started = true;
  void listPdfs().then((items) => items.forEach((item) => queueBookIndex(item.id)))
    .catch((error) => console.error("[book-index] Unable to scan library:", error));
}

/** Candidates and citation spans are not semantically verified answers. */
export async function retrieveBookEvidence(id: string, question: string): Promise<BookEvidence> {
  if (!isValidPdfId(id)) throw new Error("Invalid book ID");
  question = question.trim();
  if (!question || question.length > 2000) throw new Error("Question must contain 1 to 2000 characters");
  const empty: BookEvidence = { bookId: id, question, queries: [question], hits: [] };
  return state.worker.schedule(async (run) => {
    if (!await livePdfPath(id)) return empty;
    const reply = await run({ kind: "search", bookId: id, question, ...bookIndexPaths(id) });
    // A delete during inference must not return evidence from the trash.
    if (!await livePdfPath(id)) return empty;
    return reply.kind === "search" ? { bookId: id, question, queries: reply.queries, hits: reply.hits } : empty;
  }, "interactive");
}

/** Preserve the original array Interface for passage-search callers. */
export async function searchBook(id: string, question: string): Promise<EvidenceHit[]> {
  return (await retrieveBookEvidence(id, question)).hits;
}
