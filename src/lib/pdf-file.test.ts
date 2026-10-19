import { test } from "node:test";
import assert from "node:assert/strict";
import { isPdf } from "./pdf-file";

test("the PDF MIME type is enough even without a .pdf name", () => {
  assert.equal(isPdf("book", "application/pdf"), true);
  assert.equal(isPdf("book", "application/pdf; charset=binary"), false);
});

test("a .pdf name is enough even without a MIME type", () => {
  assert.equal(isPdf("book.pdf"), true);
  assert.equal(isPdf("book.pdf", null), true);
  assert.equal(isPdf("book.pdf", "application/octet-stream"), true);
});

test("the extension check ignores case", () => {
  assert.equal(isPdf("BOOK.PDF"), true);
  assert.equal(isPdf("The Art of Reading.Pdf"), true);
});

test("anything else is not a PDF", () => {
  assert.equal(isPdf("notes.txt", "text/plain"), false);
  assert.equal(isPdf("book.pdf.txt"), false);
  assert.equal(isPdf(""), false);
});
