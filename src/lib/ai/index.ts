import { fork, type ChildProcess } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { findPdf, pdfFilePath, readIndex } from "../pdf-store/index-store";
import { AI_DIR, fileExists, isValidPdfId, serialized } from "../pdf-store/storage";
import type { SearchHit } from "./core.mjs";

type Job = { kind: "index" | "search"; bookId: string; question?: string };
type Reply = { type: "progress" | "done" | "error"; indexed?: boolean; hits?: SearchHit[]; error?: string };
type State = { child: ChildProcess | null; tail: Promise<unknown>; started: boolean };

// Route bundles and dev reloads must share the same queue and model process.
const globalAi = globalThis as typeof globalThis & { betterReaderAi?: State };
const state = globalAi.betterReaderAi ??= {
  child: null, tail: Promise.resolve(), started: false,
};

function bookIndexFile(id: string): string {
  return path.join(AI_DIR, id, "index.json");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  // shortcut: retrieval shares this FIFO queue; prioritize questions when interactive AI is added.
  const run = state.tail.then(work, work);
  state.tail = run.catch(() => {});
  return run;
}

function runJob(job: Job): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let child = state.child;
    if (!child) {
      child = fork(/* turbopackIgnore: true */ path.join(process.cwd(), "src/lib/ai/worker.mjs"), [], {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
        execArgv: ["--max-old-space-size=512"],
      });
      state.child = child;
      child.once("exit", () => { if (state.child === child) state.child = null; });
      child.unref();
      child.channel?.unref();
    }
    const worker = child;
    worker.ref();
    worker.channel?.ref();
    const timeout = () => {
      if (state.child === worker) state.child = null;
      worker.kill();
      finish(new Error("Book indexing worker timed out"));
    };
    let timer = setTimeout(timeout, 15 * 60_000);
    timer.unref();
    let settled = false;
    function finish(error?: Error, reply?: Reply) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      worker.unref();
      worker.channel?.unref();
      if (error) reject(error);
      else resolve(reply!);
    }
    function onMessage(reply: Reply) {
      if (reply.type === "progress") {
        clearTimeout(timer);
        timer = setTimeout(timeout, 15 * 60_000);
        timer.unref();
      } else if (reply.type === "error") finish(new Error(reply.error));
      else finish(undefined, reply);
    }
    function onError(error: Error) {
      if (state.child === worker) state.child = null;
      worker.kill();
      finish(error);
    }
    function onExit(code: number | null) { finish(new Error(`Book indexing worker exited (${code})`)); }
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    worker.send({
      ...job, pdfFile: pdfFilePath(job.bookId), indexFile: bookIndexFile(job.bookId),
      tempFile: `${bookIndexFile(job.bookId)}.tmp`, cacheDir: path.join(AI_DIR, "models"),
    }, (error: Error | null) => { if (error) onError(error); });
  });
}

/** Only the final rename shares the library lock, never parsing or inference. */
export async function publishBookIndex(id: string, tempFile: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  return serialized(async () => {
    if (!await findPdf(id) || !await fileExists(pdfFilePath(id))) return false;
    await rename(tempFile, bookIndexFile(id));
    return true;
  });
}

/** Fire-and-forget: failures belong in server logs, not in upload/restore responses. */
export function queueBookIndex(id: string): void {
  if (process.env.NODE_ENV === "test" || !isValidPdfId(id)) return;
  void enqueue(async () => {
    if (!await findPdf(id) || !await fileExists(pdfFilePath(id))) return;
    const file = bookIndexFile(id);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await rm(`${file}.tmp`, { force: true });
      const reply = await runJob({ kind: "index", bookId: id });
      if (reply.indexed) await publishBookIndex(id, `${file}.tmp`);
    } finally {
      await rm(`${file}.tmp`, { force: true });
    }
  }).catch((error) => {
    console.error(`[book-index] ${id}:`, error);
  });
}

/** Missing, interrupted, outdated and corrupt indexes are rebuilt on server startup. */
export function startBookIndexing(): void {
  if (process.env.NODE_ENV === "test" || state.started) return;
  state.started = true;
  void readIndex().then((items) => items.forEach((item) => queueBookIndex(item.id)))
    .catch((error) => console.error("[book-index] Unable to scan library:", error));
}

/** Server-only retrieval for future AI callers. Returns evidence, never the full book or vectors. */
export async function searchBook(id: string, question: string): Promise<SearchHit[]> {
  if (!isValidPdfId(id)) throw new Error("Invalid book ID");
  question = question.trim();
  if (!question || question.length > 2000) throw new Error("Question must contain 1 to 2000 characters");
  return enqueue(async () => {
    if (!await findPdf(id) || !await fileExists(pdfFilePath(id))) return [];
    const reply = await runJob({ kind: "search", bookId: id, question });
    // A delete during inference must not return evidence from the trash.
    if (!await findPdf(id) || !await fileExists(pdfFilePath(id))) return [];
    return reply.hits ?? [];
  });
}
