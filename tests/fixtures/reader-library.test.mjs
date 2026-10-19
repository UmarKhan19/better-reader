import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { isBookIndex } from "../../src/lib/server/book-index/core.mjs";
import { createReaderLibrary } from "./reader-library.mjs";

test("reader smoke fixtures own a disposable library and need no inference or personal book IDs", async () => {
  const library = await createReaderLibrary();
  try {
    assert.notEqual(path.resolve(library.directory), path.resolve("data"));
    assert.deepEqual(await readFile(library.pdfFile), library.bytes);
    assert.equal(JSON.parse(await readFile(path.join(library.directory, "pdfs.json"), "utf8"))[0].id, library.id);
    assert.equal(isBookIndex(JSON.parse(await readFile(path.join(library.directory, "ai", library.id, "index.json"), "utf8")), library.id), true);
    await assert.rejects(stat(path.join(library.directory, "ai", "models")), { code: "ENOENT" });
    const pdf = await getDocumentProxy(new Uint8Array(library.bytes));
    try {
      assert.equal(pdf.numPages, 40);
      for (const number of [1, 15, 16, 40]) {
        const page = await pdf.getPage(number);
        assert.match((await page.getTextContent()).items.filter(item => "str" in item).map(item => item.str).join(""), /Searchable text for navigation/);
        assert.equal(page.getViewport({ scale: 1 }).height, 800);
      }
    } finally { await pdf.loadingTask.destroy(); }
  } finally { await library.cleanup(); }
  await assert.rejects(stat(library.directory), { code: "ENOENT" });
});
