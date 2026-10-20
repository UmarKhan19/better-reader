import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pdfUpload, resetLibrary, store } from "../../../../tests/helpers/library";
import { EMBEDDING_MODEL, INDEX_VERSION } from "./core.mjs";
import { guardBookAnswer, retrieveBookEvidence, searchBook } from "./index";
import type { BookIndexWorker } from "./worker-client";

beforeEach(resetLibrary);

test("public retrieval validates input and returns no evidence for missing books", async () => {
  await assert.rejects(retrieveBookEvidence("invalid", "question"), /book ID/);
  const id = randomUUID();
  await assert.rejects(retrieveBookEvidence(id, " "), /Question/);
  await assert.rejects(searchBook(id, "x".repeat(2001)), /Question/);
  assert.deepEqual(await retrieveBookEvidence(id, "  Question?  "), { bookId: id, question: "Question?", queries: ["Question?"], hits: [] });
  assert.deepEqual(await searchBook(id, "Question?"), []);
});

test("public evidence and legacy search use the real offline worker, and deleted books stay hidden", async () => {
  const book = await store.savePdf(...pdfUpload());
  const files = store.bookIndexPaths(book.id);
  await mkdir(path.dirname(files.indexFile), { recursive: true });
  await writeFile(files.indexFile, JSON.stringify({ bookId: book.id, version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL, chunks: [] }));
  const evidence = await retrieveBookEvidence(book.id, "  What is caching, and how does it help?  ");
  assert.equal(evidence.bookId, book.id);
  assert.equal(evidence.question, "What is caching, and how does it help?");
  assert.equal(evidence.queries.length, 3);
  assert.deepEqual(evidence.hits, []);
  assert.deepEqual(await searchBook(book.id, "question"), []);
  const answer = guardBookAnswer(evidence, { bookId: book.id, question: evidence.question, parts: [] });
  assert.equal(answer.answer, null);
  assert.equal(answer.status, "abstained");
  await store.deletePdf(book.id);
  assert.deepEqual((await retrieveBookEvidence(book.id, "question")).hits, []);
});

test("questions use interactive priority and a deletion during inference discards returned passages", async () => {
  const book = await store.savePdf(...pdfUpload());
  const state = (globalThis as typeof globalThis & { betterReaderBookIndex?: { worker: BookIndexWorker } }).betterReaderBookIndex;
  assert.ok(state);
  const schedule = state.worker.schedule;
  let priority: string | undefined;
  state.worker.schedule = async (work, requestedPriority) => {
    priority = requestedPriority;
    return work(async (job) => {
      if (job.kind !== "search") throw new Error("Expected a question");
      await store.deletePdf(book.id);
      return { type: "done", kind: "search", queries: [job.question], hits: [{ id: "1-1", page: 1,
        text: "Private", score: 0.99, selectedIds: ["1-1"], matches: [0],
        sources: [{ id: "1-1", page: 1, start: 0, end: 7 }] }] };
    });
  };
  try {
    const evidence = await retrieveBookEvidence(book.id, "question");
    assert.equal(priority, "interactive");
    assert.deepEqual(evidence.hits, []);
  } finally {
    state.worker.schedule = schedule;
  }
});
