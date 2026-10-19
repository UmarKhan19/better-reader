import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { pureModules } from "./lib/import-policy.mjs";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
const pureCodeFiles = pureModules.filter((name) => !name.endsWith(".json")).map((name) => `src/${name}.ts`);
async function violations(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.ok(!result.messages.some((message) => message.fatal), JSON.stringify(result.messages));
  return result.messages.filter((message) => message.ruleId === "ownership/imports");
}

async function assertImports(filePath, sources, allowed) {
  for (const source of sources) {
    const quoted = JSON.stringify(source);
    for (const code of [
      `import { value } from ${quoted}; export { value };`,
      `export { value } from ${quoted};`,
      `export * from ${quoted};`,
      `export const load = () => import(${quoted});`,
    ]) assert.equal((await violations(filePath, code)).length === 0, allowed, `${filePath}: ${code}`);
  }
}

test("browser/shared code rejects bare and node-prefixed builtins in every import form", async () => {
  for (const filePath of [
    "src/components/library/example.ts",
    "src/components/reader/chrome/use-reader-chrome.ts",
    "src/lib/pdf-title.ts",
  ]) {
    await assertImports(filePath, ["fs", "fs/promises", "node:fs", "node:fs/promises", "path/posix", "node:test"], false);
    await assertImports(filePath, ["fs-extra", "path-to-regexp", "node-fetch", "pdfjs-dist"], true);
  }
});

test("browser/shared code rejects alias and relative server imports", async () => {
  for (const [filePath, sources] of [
    ["src/components/library/example.ts", ["@/lib/server/pdf-store", "../../lib/server/pdf-store/index", "@/lib/server/book-index"]],
    ["src/components/reader/chrome/use-reader-chrome.ts", ["../../../lib/server/http", "@/lib/server/http"]],
    ["src/lib/pdf-title.ts", ["./server/pdf-store", "@/lib/server"]],
  ]) await assertImports(filePath, sources, false);
});

test("all store subpaths are private to the store, including new filenames and nested paths", async () => {
  for (const filePath of [
    "src/app/api/pdfs/example.ts",
    "src/lib/server/book-index/example.ts",
    "src/lib/server/http/example.mjs",
    "src/lib/server/new-owner/example.ts",
    "src/lib/another-owner/example.ts",
    "scripts/example.mjs",
    "tests/helpers/another-helper.ts",
  ]) await assertImports(filePath, [
    "@/lib/server/pdf-store/storage",
    "@/lib/server/pdf-store/record",
    "@/lib/server/pdf-store/record.ts",
    "@/lib/server/pdf-store/future-record.mjs",
    "@/lib/server/pdf-store/nested/future.json",
    "@/lib/server/pdf-store/index/private",
    "@/lib/server/pdf-store/index-other",
  ], false);

  for (const [filePath, source] of [
    ["src/lib/server/book-index/example.ts", "../pdf-store/record"],
    ["src/lib/server/http/example.mjs", "../pdf-store/future-record.mjs"],
    ["src/app/api/pdfs/example.ts", "../../../lib/server/pdf-store/record"],
    ["scripts/example.mjs", "../src/lib/server/pdf-store/record"],
    ["src/lib/server/book-index/example.ts", "@/lib/server/pdf-store/../pdf-store/record"],
  ]) await assertImports(filePath, [source], false);
});

test("store root and index remain public to server callers", async () => {
  await assertImports("src/lib/server/book-index/example.ts", [
    "@/lib/server/pdf-store",
    "@/lib/server/pdf-store/index",
    "@/lib/server/pdf-store/index.ts",
    "@/lib/server/pdf-store/index.js",
    "../pdf-store",
    "../pdf-store/index",
    "../pdf-store/index.ts",
    "../pdf-store/../pdf-store/index",
    "node:fs/promises",
    "fs/promises",
  ], true);
});

test("store internals may collaborate through alias and relative imports", async () => {
  await assertImports("src/lib/server/pdf-store/catalog.ts", [
    "./record",
    "./future-record.mjs",
    "@/lib/server/pdf-store/storage",
    "@/lib/server/pdf-store/nested/future",
  ], true);
  await assertImports("src/lib/server/pdf-store/nested/example.ts", ["../record", "../storage"], true);
});

test("the existing disposable fixture and unit tests may reset private store state", async () => {
  await assertImports("tests/helpers/library.ts", ["../../src/lib/server/pdf-store/covers"], true);
  await assertImports("src/lib/server/book-index/example.test.ts", ["../pdf-store/record"], true);
});

test("http subpaths are private to the module, which exposes only its root", async () => {
  for (const filePath of [
    "src/app/api/pdfs/example.ts",
    "src/components/reader/chrome/use-reader-chrome.ts",
    "src/lib/server/book-index/example.ts",
    "src/lib/another-owner/example.ts",
    "scripts/example.mjs",
  ]) await assertImports(filePath, [
    "@/lib/server/http/host-guard",
    "@/lib/server/http/serve-file",
    "@/lib/server/http/pdf-http",
    "@/lib/server/http/future.mjs",
    "@/lib/server/http/nested/future",
    "@/lib/server/http/index/private",
  ], false);

  for (const [filePath, source] of [
    ["src/app/api/pdfs/example.ts", "../../../lib/server/http/host-guard"],
    ["src/lib/server/book-index/example.ts", "../http/serve-file"],
    ["scripts/example.mjs", "../src/lib/server/http/host-guard"],
  ]) await assertImports(filePath, [source], false);

  await assertImports("src/app/api/pdfs/example.ts", [
    "@/lib/server/http",
    "@/lib/server/http/index",
    "@/lib/server/http/index.ts",
    "../../../lib/server/http",
    "../../../lib/server/http/index",
  ], true);
  await assertImports("src/lib/server/http/serve-file.ts", ["@/lib/server/http/pdf-http", "./host-guard"], true);
  await assertImports("src/app/api/pdfs/http.test.ts", ["@/lib/server/http/host-guard"], true);
});

test("book-index subpaths are private except for the tests and scripts fixtures", async () => {
  for (const filePath of [
    "src/app/api/pdfs/example.ts",
    "src/components/reader/chrome/use-reader-chrome.ts",
    "src/lib/server/http/example.mjs",
    "src/lib/another-owner/example.ts",
  ]) await assertImports(filePath, [
    "@/lib/server/book-index/core.mjs",
    "@/lib/server/book-index/worker-client",
    "@/lib/server/book-index/protocol.mjs",
    "@/lib/server/book-index/nested/future",
  ], false);

  for (const [filePath, source] of [
    ["src/lib/server/http/example.mjs", "../book-index/core.mjs"],
    ["src/app/api/pdfs/example.ts", "../../../lib/server/book-index/worker-client"],
  ]) await assertImports(filePath, [source], false);

  await assertImports("src/app/api/pdfs/example.ts", [
    "@/lib/server/book-index",
    "@/lib/server/book-index/index",
    "../../../lib/server/book-index",
  ], true);
  await assertImports("src/lib/server/book-index/worker-client.ts", ["./protocol.mjs", "./core.mjs"], true);

  // The .mjs fixtures build synthetic indexes and worker messages from the internals.
  await assertImports("tests/fixtures/reader-library.mjs", ["../../src/lib/server/book-index/core.mjs"], true);
  await assertImports("tests/helpers/another-helper.ts", ["../../src/lib/server/book-index/core.mjs"], true);
  await assertImports("scripts/example.mjs", ["../src/lib/server/book-index/protocol.mjs"], true);
  await assertImports("src/app/api/pdfs/book-index.test.ts", ["@/lib/server/book-index/worker-client"], true);
});

test("library code can use only the reader preload entry", async () => {
  await assertImports("src/components/library/example.ts", [
    "@/components/reader/reader-preload",
    "../reader/reader-preload",
    "../reader/reader-preload.ts",
  ], true);
  await assertImports("src/components/library/nested/example.ts", ["../../reader/reader-preload.js"], true);
  await assertImports("src/components/library/example.ts", [
    "@/components/reader",
    "@/components/reader/pdf-reader",
    "../reader/chrome/reader-ui-state",
    "../reader/chrome/use-reader-chrome",
    "../reader/chrome/use-reader-keyboard",
    "../reader/reader-preload/private",
  ], false);
});

test("reader code never depends on the library, through aliases or relative paths", async () => {
  for (const [filePath, sources] of [
    ["src/components/reader/pdf-reader.tsx", ["@/components/library", "../library/library"]],
    ["src/components/reader/chrome/use-reader-chrome.ts", ["@/components/library/library", "../../library/use-library"]],
    ["src/components/reader/chrome/use-reader-keyboard.ts", ["../../library/library-client", "@/components/reader/../library/library"]],
    ["src/components/reader/viewport/reader-geometry.ts", ["../../reader/../library/library"]],
  ]) await assertImports(filePath, sources, false);
});

test("every pure leaf, including chrome UI state, rejects React", async () => {
  for (const filePath of pureCodeFiles) await assertImports(filePath, ["react"], false);
});

test("pure leaves reject all reader UI and hooks, not just named chrome controls", async () => {
  await assertImports("src/components/reader/chrome/reader-ui-state.ts", [
    "react-dom/client",
    "react-pdf",
    "next/navigation",
    "@/components/ui/button",
    "../../ui/button",
    "@/components/reader/search/reader-search-panel",
    "../search/reader-search-panel",
    "@/components/reader/search/use-reader-search",
    "../search/use-reader-search",
    "./use-reader-chrome",
    "./use-reader-keyboard",
    "../viewport/reader-use-zoom",
    "../viewport/reader-render-queue",
    "../viewport/reader-page-surface",
    "../viewport/new-overlay",
    "@/components/reader/chrome/../search/reader-search-panel",
    "@/lib/use-example",
  ], false);
  await assertImports("src/components/reader/viewport/reader-render-state.ts", ["./reader-page-surface", "../search/reader-search-panel", "../search/use-reader-search"], false);
  await assertImports("src/lib/reading-progress.ts", ["../components/reader/search/reader-search-panel", "../components/reader/search/use-reader-search"], false);
});

test("pure leaves may share models, data and browser utilities", async () => {
  await assertImports("src/components/reader/chrome/reader-ui-state.ts", [
    "../reader-preferences",
    "../navigation/reader-navigation",
    "../navigation/reader-outline",
    "../search/reader-search-state",
    "./reader-thumbnails",
    "./reader-scrubber-state",
    "../viewport/reader-geometry",
    "../viewport/reader-limits.json",
    "@/lib/reading-progress",
    "@/lib/browser-storage",
    "pdfjs-dist",
  ], true);
  await assertImports("src/components/reader/viewport/reader-geometry.ts", ["../reader-preferences", "../chrome/reader-ui-state.js"], true);
});

test("reader chrome retains its shared ScheduledPdfPage render queue dependency", async () => {
  for (const filePath of [
    "src/components/reader/chrome/reader-sidebar.tsx",
    "src/components/reader/chrome/reader-scrubber.tsx",
    "src/components/reader/chrome/use-reader-chrome.ts",
  ]) await assertImports(filePath, ["../viewport/reader-render-queue", "@/components/reader/viewport/reader-render-queue"], true);
});

test("side-effect imports and type-only imports/reexports also respect ownership", async () => {
  for (const [filePath, source] of [
    ["src/lib/pdf-title.ts", "fs/promises"],
    ["src/lib/server/book-index/example.ts", "../pdf-store/record"],
    ["src/components/reader/chrome/reader-ui-state.ts", "../search/reader-search-panel"],
    ["src/components/reader/chrome/use-reader-keyboard.ts", "../../library/library"],
  ]) for (const code of [
    `import "${source}";`,
    `import type { Value } from "${source}"; export type { Value };`,
    `export type { Value } from "${source}";`,
    `export * as dependency from "${source}";`,
  ]) assert.ok((await violations(filePath, code)).length > 0, `${filePath}: ${code}`);
});
