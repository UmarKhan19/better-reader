import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The reader loads the worker from public/, so the copy must match the installed
// pdfjs-dist or PDF.js fails at runtime with a version mismatch.
test("the public pdf.js worker matches the installed pdfjs-dist", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../node_modules/pdfjs-dist/package.json", import.meta.url), "utf8"));
  const worker = await readFile(new URL("../../../public/pdf.worker.min.mjs", import.meta.url), "utf8");
  assert.ok(pkg.version, "pdfjs-dist has a version");
  assert.ok(worker.includes(pkg.version), `public/pdf.worker.min.mjs is not pdfjs-dist ${pkg.version}; copy node_modules/pdfjs-dist/build/pdf.worker.min.mjs`);
});
