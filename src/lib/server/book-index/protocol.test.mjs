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
    { type: "done", kind: "index", indexed: false }, { type: "done", kind: "search", hits: [], queries: ["Evidence?"] }]) {
    assert.equal(isWorkerReply(value), true);
  }
  const hit = { id: "1-1", page: 1, text: "Evidence", score: 0.9,
    sources: [{ id: "1-1", page: 1, start: 0, end: 8 }], matches: [0], selectedIds: ["1-1"] };
  const reply = (hits, queries = ["Evidence?"]) => ({ type: "done", kind: "search", hits, queries });
  assert.equal(isWorkerReply(reply([hit])), true);
  for (const value of [null, {}, { type: "error" }, { type: "done", indexed: true },
    { type: "done", kind: "index", indexed: "yes" }, { type: "done", kind: "search", hits: [null] },
    reply([{ ...hit, score: NaN }]), reply(Array(11).fill(hit)), reply([hit, hit]),
    reply([{ ...hit, embedding: [1, 2, 3] }]), reply([{ ...hit, matches: [1] }]),
    reply([{ ...hit, selectedIds: ["another-source"] }]),
    reply([{ ...hit, selectedIds: undefined }]),
    reply([{ ...hit, sources: [{ id: "1-1", page: 2, start: 0, end: 8 }] }]),
    reply([{ ...hit, sources: [{ id: "1-1", page: 1, start: 0, end: 9 }] }]),
    reply([{ ...hit, text: "x".repeat(2401) }]), reply([hit], []), reply([hit], Array(4).fill("query")),
    reply([hit], [" "]), reply([hit], ["x".repeat(2001)])]) assert.equal(isWorkerReply(value), false);
  const long = Array.from({ length: 7 }, (_, i) => ({ ...hit, id: `${i}-1`, text: "x".repeat(2400),
    sources: [{ id: `${i}-1`, page: 1, start: 0, end: 8 }], selectedIds: [`${i}-1`] }));
  assert.equal(isWorkerReply(reply(long)), false, "combined text is bounded even when each distinct hit fits");
});
