import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorkerJob, isWorkerReply } from "./protocol.mjs";

const files = { bookId: "book", pdfFile: "book.pdf", indexFile: "index.json", tempFile: "index.tmp", cacheDir: "models" };

test("worker jobs distinguish indexing from questions and require their filesystem coordinates", () => {
  assert.equal(isWorkerJob({ ...files, kind: "index" }), true);
  assert.equal(isWorkerJob({ ...files, kind: "search", question: "Evidence?" }), true);
  for (const value of [null, {}, { ...files, kind: "other" }, { ...files, kind: "search" },
    { ...files, kind: "search", question: " " }, { ...files, kind: "search", question: "x".repeat(2001) },
    { ...files, kind: "index", tempFile: "" }]) assert.equal(isWorkerJob(value), false);
});

test("only complete, finite and bounded worker replies cross the process seam", () => {
  for (const value of [{ type: "progress" }, { type: "error", error: "failed" },
    { type: "done", kind: "index", indexed: false }, { type: "done", kind: "search", hits: [] }]) {
    assert.equal(isWorkerReply(value), true);
  }
  const hit = { id: "1-1", page: 1, text: "Evidence", score: 0.9 };
  assert.equal(isWorkerReply({ type: "done", kind: "search", hits: [hit] }), true);
  for (const value of [null, {}, { type: "error" }, { type: "done", indexed: true },
    { type: "done", kind: "index", indexed: "yes" }, { type: "done", kind: "search", hits: [null] },
    { type: "done", kind: "search", hits: [{ ...hit, score: NaN }] },
    { type: "done", kind: "search", hits: Array(11).fill(hit) }]) assert.equal(isWorkerReply(value), false);
});
