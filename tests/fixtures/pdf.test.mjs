import { test } from "node:test";
import assert from "node:assert/strict";
import { getDocumentProxy } from "unpdf";
import { pdfFixture } from "./pdf.mjs";

test("PDF fixtures have deterministic bytes, searchable text, original dimensions and working destinations", async () => {
  const options = { pages: 3, width: 600, height: 800, link: true };
  const bytes = pdfFixture(options);
  assert.equal(pdfFixture(options), bytes);
  const pdf = await getDocumentProxy(new TextEncoder().encode(bytes));
  try {
    assert.equal(pdf.numPages, 3);
    const page = await pdf.getPage(1);
    assert.match((await page.getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(""), /Fixture page 1/);
    assert.equal(page.getViewport({ scale: 1 }).height, 800);
    assert.equal(await pdf.getPageIndex((await page.getAnnotations())[0].dest[0]), 2);
  } finally { await pdf.loadingTask.destroy(); }
});

test("blank worker fixtures contain no text and malformed fixture requests fail early", async () => {
  const pdf = await getDocumentProxy(new TextEncoder().encode(pdfFixture({ pages: 1, blank: true })));
  try { assert.deepEqual((await (await pdf.getPage(1)).getTextContent()).items, []); }
  finally { await pdf.loadingTask.destroy(); }
  for (const options of [{ pages: 0 }, { height: NaN }, { width: -1 }, { pages: 1, link: true }]) {
    assert.throws(() => pdfFixture(options), /Invalid PDF fixture/);
  }
});
