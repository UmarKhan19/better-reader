import { test } from "node:test";
import assert from "node:assert/strict";
import { optionsForPdfSize, PDF_DOCUMENT_OPTIONS, SMALL_PDF_LIMIT, STREAMED_PDF_OPTIONS } from "./reader-load-options";

test("small PDFs stream without per-range latency and retain stable options identities", () => {
  assert.equal(optionsForPdfSize(375_889), STREAMED_PDF_OPTIONS);
  assert.equal(optionsForPdfSize(SMALL_PDF_LIMIT), STREAMED_PDF_OPTIONS);
  assert.equal(optionsForPdfSize(SMALL_PDF_LIMIT + 1), PDF_DOCUMENT_OPTIONS);
  assert.equal(optionsForPdfSize(6_744_507), PDF_DOCUMENT_OPTIONS);
  for (const size of [undefined, NaN, Infinity, -1, 0, 1.5]) assert.equal(optionsForPdfSize(size), PDF_DOCUMENT_OPTIONS);
  assert.equal(Object.isFrozen(STREAMED_PDF_OPTIONS), true);
  assert.equal(STREAMED_PDF_OPTIONS.disableStream, false);
  assert.equal(STREAMED_PDF_OPTIONS.disableAutoFetch, false);
});

test("reader-load-options keeps on-demand ranges and disables both background-fetch paths", async () => {
  assert.deepEqual(PDF_DOCUMENT_OPTIONS, {
    disableRange: false, disableStream: true, disableAutoFetch: true, rangeChunkSize: 65_536,
  });
  assert.equal(Object.isFrozen(PDF_DOCUMENT_OPTIONS), true);
  const again = await import("./reader-load-options");
  assert.equal(again.PDF_DOCUMENT_OPTIONS, PDF_DOCUMENT_OPTIONS);
});
