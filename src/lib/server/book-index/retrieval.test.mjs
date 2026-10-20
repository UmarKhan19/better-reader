import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, INDEX_VERSION } from "./core.mjs";
import { planQueries, retrieveEvidence } from "./retrieval.mjs";

const vector = (x = 1, y = 0) => [x, y, ...Array(EMBEDDING_DIMENSIONS - 2).fill(0)];
const chunk = (id, page, text, embedding = vector()) => ({ id, page, text, embedding });
const index = (...chunks) => ({ bookId: "synthetic", version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL, chunks });

test("query planning splits explicit questions but keeps coordinated noun phrases intact", () => {
  assert.deepEqual(planQueries("How does Node and Express handle input and output?"), ["How does Node and Express handle input and output?"]);
  assert.deepEqual(planQueries("What is caching, and how does it help?"), ["What is caching, and how does it help?", "What is caching", "how does it help?"]);
  assert.deepEqual(planQueries("Explain this: one example for setup and one example for teardown."), [
    "Explain this: one example for setup and one example for teardown.", "Explain this: one example for setup", "Explain this: one example for teardown",
  ]);
  assert.deepEqual(planQueries("What is X? Aur kya fayda hai?"), ["What is X? Aur kya fayda hai?", "What is X", "kya fayda hai?"]);
  assert.deepEqual(planQueries("What is caching; how does it help"), ["What is caching; how does it help", "What is caching", "how does it help"]);
});

test("independent query parts each get a bounded result and cite exact original text", () => {
  const book = index(chunk("a", 1, "The copper process uses heat to refine ore.", vector(1, 0)),
    chunk("b", 2, "The blue harbor shelters boats during storms.", vector(0, 1)));
  const hits = retrieveEvidence(book, ["copper process", "blue harbor"], [vector(1, 0), vector(0, 1)]);
  assert.equal(hits.length, 1, "the second selected passage is already fully included as context");
  assert.deepEqual(hits[0].matches, [0, 1]);
  assert.deepEqual(hits[0].selectedIds, ["a", "b"]);
  for (const hit of hits) {
    assert.ok(hit.sources.length);
    for (const source of hit.sources) {
      const original = book.chunks.find((item) => item.id === source.id);
      assert.ok(original);
      assert.ok(source.start >= 0 && source.end <= hit.text.length && source.end > source.start);
      assert.ok(original.text.includes(hit.text.slice(source.start, source.end)));
    }
  }
});

test("neighbor context deduplicates overlap, respects pages and short/unspaced text", () => {
  const book = index(chunk("first", 4, "alpha beta shared words", vector(0, 1)),
    chunk("second", 4, "shared words gamma delta", vector(1, 0)),
    chunk("next-page", 6, "far page context", vector(0, 1)));
  const [hit] = retrieveEvidence(book, ["gamma delta"], [vector()]);
  assert.match(hit.text, /alpha beta \nshared words gamma delta/u);
  assert.equal((hit.text.match(/shared words/gu) ?? []).length, 1);
  assert.ok(hit.sources.every((source) => source.page <= 5));
  const [tiny] = retrieveEvidence(index(chunk("tiny", 1, "漢字😀")), ["漢字"], [vector()]);
  assert.equal(tiny.text, "漢字😀");
});

test("evidence obeys hit and character budgets and repeated citations accumulate query indexes", () => {
  const text = "distinctive " + "x".repeat(5000);
  const book = index(...Array.from({ length: 20 }, (_, i) => chunk(`${i}`, i + 1, `${i} ${text}`)));
  const hits = retrieveEvidence(book, ["distinctive", "distinctive"], [vector(), vector()]);
  assert.ok(hits.length <= 10);
  assert.ok(hits.reduce((sum, hit) => sum + hit.text.length, 0) <= 16_000);
  assert.ok(hits.every((hit) => hit.text.length <= 2400));
  assert.ok(hits.some((hit) => hit.matches.includes(0) && hit.matches.includes(1)));
  assert.ok(hits.every((hit) => hit.sources.every((source) => source.end <= hit.text.length)));
});

test("rank selection interleaves query ranks, merges fully included direct chunks and keeps clipped emoji whole", () => {
  const book = index(chunk("primary", 1, "central facts", vector()),
    chunk("neighbor", 1, "beginning " + "q".repeat(400) + " central facts " + "z".repeat(400), vector()),
    chunk("other", 2, "other answer evidence", vector(0, 1)));
  const hits = retrieveEvidence(book, ["whole question", "central facts"], [vector(), vector()]);
  assert.ok(hits.length >= 2);
  const merged = hits.find((hit) => hit.id === "neighbor");
  assert.ok(merged);
  assert.ok(merged.selectedIds.includes("neighbor"));
  const huge = index(chunk("emoji", 1, "a".repeat(1200) + "😀" + "b".repeat(1200)));
  const [clipped] = retrieveEvidence(huge, ["emoji"], [vector()]);
  assert.ok(clipped.text.length <= 2400);
  assert.ok(!/[\uD800-\uDBFF]$/u.test(clipped.text));
  assert.ok(!/^[\uDC00-\uDFFF]/u.test(clipped.text));
});

test("context separators count toward the exact hit and aggregate text limits", () => {
  const chunks = Array.from({ length: 20 }, (_, i) => chunk(`${i}`, 1, `${String(i).padStart(2, "0")}:` + "x".repeat(2400)));
  const hits = retrieveEvidence(index(...chunks), ["x"], [vector()]);
  assert.ok(hits.length <= 10);
  assert.ok(hits.every((hit) => hit.text.length <= 2400));
  assert.ok(hits.reduce((sum, hit) => sum + hit.text.length, 0) <= 16_000);
  const primary = "important beginning " + "x".repeat(2300) + " important ending";
  const [preserved] = retrieveEvidence(index(chunk("primary", 1, primary), chunk("next", 1, "neighbor", vector(0, 1))), ["important"], [vector()]);
  assert.ok(preserved.text.includes(primary), "context must not replace an otherwise fitting primary passage");
});

test("invalid embedding rows and blank queries are ignored safely", () => {
  const book = index(chunk("ok", 1, "usable evidence"));
  assert.deepEqual(retrieveEvidence(book, ["usable", ""], [[1], vector()]).map((hit) => hit.id), []);
  assert.deepEqual(retrieveEvidence(book, ["usable", ""], [vector(), [1]]).map((hit) => hit.id), ["ok"]);
  assert.deepEqual(retrieveEvidence(book, ["usable"], [[1]]), []);
  assert.deepEqual(retrieveEvidence(book, [], []), []);
});
