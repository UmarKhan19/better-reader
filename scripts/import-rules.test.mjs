import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
async function violations(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
}

test("browser/shared import rules cover static imports, exports and literal dynamic imports", async () => {
  for (const code of [
    'import { listPdfs } from "@/lib/server/pdf-store"; export { listPdfs };',
    'export { listPdfs } from "../../lib/server/pdf-store";',
    'export * from "@/lib/server/book-index";',
    'export const load = () => import("@/lib/server/book-index");',
    'export const load = () => import("node:fs");',
  ]) assert.ok((await violations("src/components/library/example.ts", code)).length > 0, code);
});

test("library prewarming and public server operations are allowed, private store imports are not", async () => {
  assert.equal((await violations("src/components/library/example.ts", 'export { prewarmReader } from "@/components/reader/reader-preload";')).length, 0);
  assert.ok((await violations("src/components/library/example.ts", 'export const load = () => import("@/components/reader/pdf-reader");')).length > 0);
  assert.equal((await violations("src/lib/server/book-index/example.ts", 'export { publishBookIndex } from "../pdf-store";')).length, 0);
  assert.ok((await violations("src/lib/server/book-index/example.ts", 'export { serialized } from "../pdf-store/storage";')).length > 0);
});

test("pure reader models cannot acquire a UI dependency", async () => {
  assert.ok((await violations("src/components/reader/viewport/reader-render-state.ts", 'export { rasterFrame } from "./reader-page-surface";')).length > 0);
  assert.ok((await violations("src/lib/reading-progress.ts", 'export { useState } from "react";')).length > 0);
  assert.equal((await violations("src/components/reader/viewport/reader-geometry.ts", 'export { clampZoom } from "../reader-preferences";')).length, 0);
});
