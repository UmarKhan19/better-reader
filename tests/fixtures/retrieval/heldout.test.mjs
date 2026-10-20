import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateFixture } from "../../../scripts/lib/retrieval-eval.mjs";

test("held-out cases stay distinct, paired and structurally valid without reading a library", async () => {
  const fixture = validateFixture(JSON.parse(await readFile(new URL("./heldout.json", import.meta.url), "utf8")));
  const regression = JSON.parse(await readFile(new URL("./questions.json", import.meta.url), "utf8"));
  assert.equal(fixture.books.length, 6);
  assert.equal(fixture.questions.length, 24);
  assert.equal(fixture.questions.filter((q) => q.kind === "semantic").length, 6);
  assert.equal(fixture.questions.filter((q) => q.kind === "multi").length, 6);
  assert.equal(fixture.questions.filter((q) => q.kind === "hinglish").length, 6);
  assert.equal(fixture.questions.filter((q) => !q.answerable).length, 6);
  const priorIds = new Set(regression.questions.map((q) => q.id));
  const priorQuestions = new Set(regression.questions.map((q) => q.question));
  const byId = new Map(fixture.questions.map((q) => [q.id, q]));
  for (const q of fixture.questions) {
    assert.equal(priorIds.has(q.id), false);
    assert.equal(priorQuestions.has(q.question), false);
    if (q.pairedWith) assert.deepEqual(q.evidenceGroups, byId.get(q.pairedWith).evidenceGroups);
  }
  assert.doesNotMatch(JSON.stringify(fixture), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu);
});
