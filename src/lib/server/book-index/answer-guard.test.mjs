import { test } from "node:test";
import assert from "node:assert/strict";
import { guardBookAnswer } from "./answer-guard.mjs";

const evidence = {
  bookId: "book-1",
  question: "What is copper?",
  queries: ["What is copper?", "What is copper", "How is it used?"],
  hits: [{ id: "chunk-1", page: 4, text: "Copper is a metal.", score: 0.99,
    sources: [{ id: "chunk-1", page: 4, start: 0, end: 18 }], matches: [0, 1], selectedIds: ["chunk-1"] }],
};
const citation = (text = "Copper is a metal.", overrides = {}) => ({
  passageId: "chunk-1", sourceId: "chunk-1", page: 4, start: 0, end: text.length, quote: text, ...overrides,
});
const draft = (parts = [{ query: 1, claims: [{ text: "Copper is a metal.", citations: [citation()] }] }], overrides = {}) => ({
  bookId: "book-1", question: "What is copper?", parts, ...overrides,
});

test("an exact valid citation is returned as unverified and the answer always abstains", () => {
  const result = guardBookAnswer(evidence, draft());
  assert.equal(result.answer, null);
  assert.equal(result.status, "abstained");
  assert.equal(result.reason, "semantic_verification_unavailable");
  assert.deepEqual(result.parts, [{ query: 1, question: "What is copper", status: "unverified", citations: [citation()] },
    { query: 2, question: "How is it used?", status: "uncited", citations: [] }]);
  assert.equal(JSON.stringify(result).includes("Copper is a metal."), true, "only the validated citation quote is exposed");
  assert.equal(JSON.stringify(result).includes("score"), false);
});

test("a high retrieval score does not change abstention or semantic status", () => {
  const result = guardBookAnswer(evidence, draft());
  assert.equal(result.status, "abstained");
  assert.equal(result.reason, "semantic_verification_unavailable");
  assert.equal(result.parts[0].status, "unverified");
});

test("wrong book, question, malformed draft and invalid query indexes fail closed", () => {
  for (const value of [draft(undefined, { bookId: "other" }), draft(undefined, { question: "other" }),
    draft([{ query: 8, claims: [] }]), draft([{ query: 1, claims: [] }, { query: 1, claims: [] }]), null]) {
    const result = guardBookAnswer(evidence, value);
    assert.equal(result.answer, null);
    assert.equal(result.reason, "invalid_draft");
    assert.ok(result.parts.every((part) => part.status === "invalid"));
  }
});

test("forged quote, offsets, page, dangling passage, and cross-source range are rejected", () => {
  const variants = [
    citation("Not in source."),
    citation("Copper", { start: 1, end: 7 }),
    citation("Copper is a metal.", { page: 5 }),
    citation("Copper is a metal.", { passageId: "missing" }),
    citation("Copper is a metal.", { sourceId: "missing" }),
  ];
  for (const invalid of variants) {
    const result = guardBookAnswer(evidence, draft([{ query: 1, claims: [{ text: "claim", citations: [invalid] }] }]));
    assert.equal(result.reason, "invalid_draft");
  }
  const split = structuredClone(evidence);
  split.hits[0].sources = [
    { id: "chunk-1", page: 4, start: 0, end: 6 },
    { id: "right", page: 4, start: 6, end: 18 },
  ];
  assert.equal(guardBookAnswer(split, draft()).reason, "invalid_draft");
});

test("partially cited multi-part draft reports cited and uncited parts without claims", () => {
  const result = guardBookAnswer(evidence, draft([
    { query: 1, claims: [{ text: "secret claim A", citations: [citation()] }] },
    { query: 2, claims: [{ text: "secret claim B", citations: [] }] },
  ]));
  assert.deepEqual(result.parts.map(({ status }) => status), ["unverified", "uncited"]);
  assert.equal(JSON.stringify(result).includes("secret claim"), false);
});

test("hostile oversized drafts fail closed and output stays bounded without retrieval metadata", () => {
  const huge = draft([{ query: 1, claims: Array.from({ length: 11 }, () => ({ text: "x", citations: [] })) }]);
  const result = guardBookAnswer(evidence, huge);
  assert.equal(result.reason, "invalid_draft");
  assert.ok(JSON.stringify(result).length < 1000);
  assert.equal(JSON.stringify(result).includes("matches"), false);
  assert.equal(JSON.stringify(result).includes("selectedIds"), false);
  assert.equal(JSON.stringify(result).includes("score"), false);
});

test("protocol validation rejects duplicate evidence source IDs and invalid source spans", () => {
  const duplicate = structuredClone(evidence);
  duplicate.hits[0].sources.push({ id: "chunk-1", page: 4, start: 0, end: 6 });
  assert.deepEqual(guardBookAnswer(duplicate, draft()), {
    answer: null, status: "abstained", reason: "insufficient_evidence", parts: [],
  });

  const invalidSpan = structuredClone(evidence);
  invalidSpan.hits[0].sources[0].end = invalidSpan.hits[0].text.length + 1;
  assert.deepEqual(guardBookAnswer(invalidSpan, draft()), {
    answer: null, status: "abstained", reason: "insufficient_evidence", parts: [],
  });
});

test("empty evidence abstains without asserting that the book has no answer", () => {
  const empty = { ...evidence, hits: [] };
  const result = guardBookAnswer(empty, { bookId: "book-1", question: empty.question, parts: [] });
  assert.deepEqual(result, { answer: null, status: "abstained", reason: "insufficient_evidence",
    parts: [{ query: 1, question: "What is copper", status: "uncited", citations: [] },
      { query: 2, question: "How is it used?", status: "uncited", citations: [] }] });
  assert.equal(JSON.stringify(result).includes("no answer"), false);
});
