import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkPage, cosineSimilarity, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, INDEX_VERSION, isBookIndex, isEmbedding, rankChunks, MODEL_MAX_TOKENS, QUERY_PREFIX } from "./core.mjs";

const countWords = (text) => text.split(/\s+/u).length + 2;
const vector = (x = 1, y = 0) => [x, y, ...Array(EMBEDDING_DIMENSIONS - 2).fill(0)];
const index = (chunks) => ({ bookId: "book", version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL, chunks });
const chunk = (id, text, embedding = vector()) => ({ id, page: Number(id) + 1, text, embedding });

test("passages have 150 words, 30-word overlap and their original page", () => {
  const words = Array.from({ length: 310 }, (_, i) => `word${i}`);
  const chunks = chunkPage(words.join(" \n"), 7, countWords);
  assert.deepEqual(chunks.map((c) => c.text.split(" ").length), [150, 150, 70]);
  assert.deepEqual(chunks[0].text.split(" ").slice(-30), chunks[1].text.split(" ").slice(0, 30));
  assert.ok(chunks.every((c) => c.page === 7));
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
  assert.deepEqual([...new Set(chunks.flatMap((c) => c.text.split(" ")))], words, "no text gets dropped");
});

test("blank pages add no chunks and page numbers never get renumbered", () => {
  const chunks = ["first page", " \n\t", "third page"].flatMap((text, page) => chunkPage(text, page + 1, countWords));
  assert.deepEqual(chunks.map((c) => c.page), [1, 3]);
  assert.equal(chunks[1].text, "third page");
});

test("token-heavy words shorten passages without silently truncating their text", () => {
  const words = Array.from({ length: 200 }, (_, i) => `technical${i}`);
  const tokens = (text) => text.split(" ").length * 4 + 2;
  const chunks = chunkPage(words.join(" "), 2, tokens);
  assert.ok(chunks.every((c) => tokens(c.text) <= 256));
  assert.deepEqual([...new Set(chunks.flatMap((c) => c.text.split(" ")))], words);
});

test("unspaced text and surrogate pairs split safely within the token budget", () => {
  const text = "漢😀字".repeat(300);
  const tokens = (text) => [...text].length + 2;
  const chunks = chunkPage(text, 12, tokens);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => tokens(c.text) <= 256 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(c.text)));
  // Unique characters make it possible to check coverage despite overlapping chunks.
  const unique = Array.from({ length: 900 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
  const passages = chunkPage(unique, 1, tokens);
  const seen = new Set(passages.flatMap((c) => [...c.text]));
  assert.deepEqual(seen, new Set([...unique]));
});

test("cosine similarity handles non-normalized, opposite and zero vectors", () => {
  assert.equal(cosineSimilarity([2, 0], [4, 0]), 1);
  assert.equal(cosineSimilarity([2, 0], [-4, 0]), -1);
  assert.equal(cosineSimilarity([2, 0], [0, 4]), 0);
  assert.equal(cosineSimilarity([0, 0], [0, 4]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 2]), /dimensions/);
});

test("only finite, nonzero 384-dimensional vectors are accepted", () => {
  assert.equal(isEmbedding(vector()), true);
  for (const value of [null, [], [1, 2], Array(384).fill(0), vector(NaN), vector(Infinity), ["1", ...Array(383).fill(0)]]) {
    assert.equal(isEmbedding(value), false);
  }
});

test("indexes are scoped to one book, model and schema version", () => {
  const valid = index([chunk("0", "Evidence")]);
  assert.equal(isBookIndex(valid, "book"), true);
  assert.equal(isBookIndex(index([]), "book"), true, "scanned books can have no extractable text");
  for (const bad of [null, {}, { ...valid, version: 0 }, { ...valid, embeddingModel: "other" },
    { ...valid, chunks: [null] }, index([{ ...chunk("0", "text"), page: 0 }]),
    index([chunk("0", "   ")]), index([chunk("0", "text", [1])])]) {
    assert.equal(isBookIndex(bad, "book"), false);
  }
  assert.equal(isBookIndex(valid, "another-book"), false);
  assert.equal(isBookIndex({ ...valid, version: 1, embeddingModel: "Xenova/all-MiniLM-L6-v2" }, "book"), false);
  assert.equal(isBookIndex(index([chunk("0", "one"), chunk("0", "another")]), "book"), false);
  assert.equal(isBookIndex(index([{ ...chunk("0", "text"), id: "" }]), "book"), false);
});

test("BGE uses its query-only instruction and preserves the existing passage budget", () => {
  assert.equal(EMBEDDING_MODEL, "Xenova/bge-small-en-v1.5");
  assert.equal(MODEL_MAX_TOKENS, 512);
  assert.equal(QUERY_PREFIX, "Represent this sentence for searching relevant passages: ");
});

test("hybrid ranking uses semantics and whole, case-insensitive keyword matches", () => {
  const book = index([
    chunk("0", "An unrelated passage", vector(0, 1)),
    chunk("1", "Photons carry light", vector(0.9, 0.1)),
    chunk("2", "DARK MATTER explains the missing mass", vector(0.9, 0.1)),
    chunk("3", "The darkness matters", vector(0.9, 0.1)),
  ]);
  const hits = rankChunks(book, "What is dark matter?", vector());
  assert.equal(hits[0].id, "2");
  assert.equal(hits.at(-1).id, "0");
  assert.equal(hits[1].score, hits[2].score, "substrings are not keyword matches");
  assert.ok(hits.every((hit) => !Object.hasOwn(hit, "embedding")));
  assert.equal(hits[0].page, 3);
});

test("retrieval returns the best ten pieces of evidence, or fewer for short books", () => {
  assert.equal(rankChunks(index(Array.from({ length: 20 }, (_, i) => chunk(`${i}`, `passage ${i}`))), "passage", vector()).length, 10);
  assert.deepEqual(rankChunks(index([]), "question", vector()), []);
  assert.throws(() => rankChunks(index([]), "question", [1]), /Invalid query/);
  const book = index(Array.from({ length: 60 }, (_, i) => chunk(`${i}`, `passage ${i}`)));
  assert.equal(rankChunks(book, "passage", vector(), 50).length, 50);
  for (const limit of [0, -1, 1.5, 51, Infinity]) assert.throws(() => rankChunks(book, "passage", vector(), limit), /limit/);
});

test("reusing an index snapshot preserves cosine/keyword scores and does not leak preparation", () => {
  const book = index([chunk("0", "dark matter", vector(2, 1)), chunk("1", "other text", vector(0, 3))]);
  const expected = 0.8 * cosineSimilarity(vector(), book.chunks[0].embedding) + 0.2;
  const first = rankChunks(book, "dark matter", vector());
  const second = rankChunks(book, "dark matter", vector());
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first[0].score - expected) < 1e-12);
  assert.deepEqual(Object.keys(first[0]).sort(), ["id", "page", "score", "text"]);
  const replacement = index([chunk("2", "dark matter", vector(0, 2))]);
  assert.equal(rankChunks(replacement, "dark matter", vector())[0].id, "2");
});
