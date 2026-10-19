import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
const attributePattern = /data-reader-[a-z-]+|data-cached-page|data-page-number|data-thumb-page/g;
const markPattern = /(?<![-\w])reader:[a-z-]+/g;

async function files(directory, extensions) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(relative, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(relative);
  }
  return found;
}

async function tokens(directory) {
  const found = new Set();
  for (const file of await files(directory, [".ts", ".tsx", ".mjs", ".css"])) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const token of source.match(attributePattern) ?? []) found.add(token);
    for (const token of source.match(markPattern) ?? []) found.add(token);
  }
  return found;
}

test("browser checks only use reader hooks and marks that the app actually emits", async () => {
  const app = await tokens("src/components/reader");
  const tests = new Set([...(await tokens("tests/browser")), ...(await tokens("scripts"))]);
  const missing = [...tests].filter((token) => !app.has(token)).sort();
  assert.deepEqual(missing, [], `Browser checks reference reader contract tokens the app does not emit: ${missing.join(", ")}`);
});
