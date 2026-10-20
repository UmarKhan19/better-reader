import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, resetLibrary } from "../../../../tests/helpers/library.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, INDEX_VERSION } from "./core.mjs";
import { BookIndexCache } from "./index-cache.mjs";

beforeEach(resetLibrary);
const book = (bookId, text = "original") => ({ bookId, version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL,
  chunks: [{ id: "1-1", page: 1, text, embedding: [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)] }] });
const file = (name) => path.join(dataDir, `${name}.json`);
async function publish(name, value) {
  await writeFile(file(`${name}.tmp`), JSON.stringify(value));
  await rename(file(`${name}.tmp`), file(name));
}

test("unchanged snapshots are reused, atomic replacements are not", async () => {
  const cache = new BookIndexCache();
  await publish("a", book("a"));
  const first = await cache.read(file("a"), "a");
  assert.equal(await cache.read(file("a"), "a"), first);
  const time = await stat(file("a"));
  await writeFile(file("next"), JSON.stringify(book("a", "replaced")));
  await utimes(file("next"), time.atime, time.mtime);
  await rename(file("next"), file("a"));
  const next = await cache.read(file("a"), "a");
  assert.notEqual(next, first);
  assert.equal(next.chunks[0].text, "replaced");
});

test("delete, corrupt, outdated and wrong-book snapshots never fall back to cached evidence", async () => {
  const cache = new BookIndexCache();
  await publish("a", book("a"));
  const original = await cache.read(file("a"), "a");
  await rm(file("a"));
  assert.equal(await cache.read(file("a"), "a"), null);
  assert.equal(cache.size, 0);
  await publish("a", book("a", "restored"));
  assert.notEqual(await cache.read(file("a"), "a"), original);
  await writeFile(file("a"), "{broken");
  assert.equal(await cache.read(file("a"), "a"), null);
  await publish("a", { ...book("a"), version: 1, embeddingModel: "Xenova/all-MiniLM-L6-v2" });
  assert.equal(await cache.read(file("a"), "a"), null);
  await publish("a", book("a"));
  await cache.read(file("a"), "a");
  assert.equal(await cache.read(file("a"), "another-book"), null);
  assert.equal(cache.size, 0);
});

test("LRU and byte budgets bound cached books without rejecting oversized readable indexes", async () => {
  const cache = new BookIndexCache(2, 100_000);
  for (const id of ["a", "b", "c"]) await publish(id, book(id));
  const a = await cache.read(file("a"), "a");
  const b = await cache.read(file("b"), "b");
  assert.equal(await cache.read(file("a"), "a"), a);
  await cache.read(file("c"), "c");
  assert.equal(cache.size, 2);
  assert.equal(await cache.read(file("a"), "a"), a);
  assert.notEqual(await cache.read(file("b"), "b"), b);
  assert.ok(cache.bytes <= 100_000);
  const uncached = new BookIndexCache(2, 1);
  assert.ok(await uncached.read(file("a"), "a"));
  assert.equal(uncached.size, 0);
  assert.equal(uncached.bytes, 0);
});

test("real I/O errors propagate and invalid cache limits fail", async () => {
  const cache = new BookIndexCache();
  await mkdir(file("directory"));
  await assert.rejects(cache.read(file("directory"), "a"));
  for (const limits of [[0, 1], [1, 0], [1.5, 10]]) assert.throws(() => new BookIndexCache(...limits), /limits/);
});

test("overlapping cold reads account for a retained snapshot only once", async () => {
  const cache = new BookIndexCache();
  await publish("a", book("a"));
  await Promise.all(Array.from({ length: 8 }, () => cache.read(file("a"), "a")));
  assert.equal(cache.size, 1);
  assert.equal(cache.bytes, (await stat(file("a"))).size);
  cache.invalidate(file("a"));
  assert.equal(cache.bytes, 0);
});
