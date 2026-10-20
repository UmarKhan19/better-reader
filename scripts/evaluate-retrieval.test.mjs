import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { EMBEDDING_MODEL, EMBEDDING_REVISION, INDEX_VERSION } from "../src/lib/server/book-index/core.mjs";
import {
  UsageError, aggregate, assertSafePaths, parseArgs, percentile95, proofInsideSources,
  readFixture, resolveInputs, sameOrInside, scoreReply, sha256, summarize, validateFixture,
  validateGoldAgainstIndex,
} from "./lib/retrieval-eval.mjs";

const runFile = promisify(execFile);
const cliFile = fileURLToPath(new URL("./evaluate-retrieval.mjs", import.meta.url));
const fixtureFile = new URL("../tests/fixtures/retrieval/questions.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureFile, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

const exactQuestion = (overrides = {}) => ({
  id: "q-1", book: "book-one", question: "Where is the proof?", kind: "exact",
  answerable: true, pairedWith: null,
  evidenceGroups: [{ chunks: [{ id: "1-1", page: 1, quote: "the proof" }] }],
  ...overrides,
});

test("CLI requires explicit data and output directories", () => {
  assert.throws(() => parseArgs([]), UsageError);
  assert.throws(() => parseArgs([]), /--data-dir/);
  assert.throws(() => parseArgs(["--data-dir", "library"]), /--output-dir/);
  assert.throws(() => parseArgs(["--data-dir", "library", "--output-dir"]), /needs a path/);
  assert.throws(() => parseArgs(["--data-dir", "library", "--output-dir", "out", "--wat"]), /Unknown argument/);
  assert.deepEqual(parseArgs(["--data-dir", "library", "--output-dir", "out", "--questions", "q.json"]), {
    dataDir: "library", outputDir: "out", questions: "q.json",
  });
  assert.deepEqual(parseArgs(["--", "--data-dir", "library", "--output-dir", "out"]), {
    dataDir: "library", outputDir: "out",
  });
});

test("CLI rejects output or model cache that overlaps the input library", async () => {
  const data = path.resolve("/tmp/opencode/retrieval/data");
  const sibling = path.resolve("/tmp/opencode/retrieval/out");
  assert.equal(sameOrInside(data, data), true);
  assert.equal(sameOrInside(path.join(data, "..foo"), data), true);
  assert.equal(sameOrInside(path.join(data, "..", "outside"), data), false);
  await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: data }), /must not be inside/);
  await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: path.join(data, "eval") }), /must not be inside/);
  await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: path.dirname(data) }), /must not be inside/);
  await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: sibling, modelCache: path.join(data, "models") }), /model-cache/);
  await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: sibling, modelCache: path.dirname(data) }), /model-cache/);
  const safe = await assertSafePaths({ dataDir: data, outputDir: sibling });
  assert.equal(safe.modelCache, path.join(sibling, "models"));
  assert.equal(safe.explicitModelCache, false);
  assert.equal((await assertSafePaths({ dataDir: data, outputDir: sibling, modelCache: "/tmp/opencode/cache" })).explicitModelCache, true);
});

test("path validation resolves symlinks before rejecting overlap", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "better-reader-retrieval-links-"));
  try {
    const data = path.join(directory, "library");
    const outside = path.join(directory, "outside");
    await mkdir(data);
    await mkdir(outside);
    const marker = path.join(data, "marker.txt");
    await writeFile(marker, "keep");
    const outputLink = path.join(directory, "output-link");
    await symlink(data, outputLink, "dir");
    await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: outputLink }), /must not be inside/);
    await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: path.join(outputLink, "nested") }), /must not be inside/);
    const cacheLink = path.join(directory, "cache-link");
    await symlink(data, cacheLink, "dir");
    await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: outside, modelCache: cacheLink }), /model-cache/);
    await assert.rejects(() => assertSafePaths({ dataDir: data, outputDir: outside, modelCache: directory }), /model-cache/);
    assert.equal(await readFile(marker, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("frozen fixture keeps 72 cases, six editions, paired links, and short per-chunk proofs", () => {
  validateFixture(fixture);
  assert.equal(fixture.labels.humanGroundTruth, false);
  assert.match(fixture.labels.note, /human-verified/);
  assert.equal(fixture.books.length, 6);
  assert.equal(fixture.questions.length, 72);
  assert.equal(fixture.questions.filter((question) => question.answerable).length, 60);
  assert.equal(fixture.questions.filter((question) => !question.answerable).length, 12);
  assert.equal(new Set(fixture.questions.map((question) => question.id)).size, 72);
  assert.equal(fixture.questions.filter((question) => question.kind === "multi").length, 6);
  assert.equal(fixture.questions.filter((question) => question.kind === "hinglish").length, 12);
  assert.equal(fixture.questions.filter((question) => question.pairedWith).length, 12);
  for (const book of fixture.books) {
    assert.match(book.key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(book.sha256, /^[0-9a-f]{64}$/);
    assert.equal(path.basename(book.fileName), book.fileName);
    assert.equal(fixture.questions.filter((question) => question.book === book.key).length, 12);
  }
  const proofs = fixture.questions.flatMap((question) => question.evidenceGroups
    .flatMap((group) => group.chunks.map((chunk) => ({ question, chunk }))));
  assert.equal(fixture.questions.reduce((total, question) => total + question.evidenceGroups.length, 0), 66);
  assert.equal(proofs.length, 163);
  for (const { question, chunk } of proofs) {
    assert.match(chunk.id, /^\d+-\d+$/);
    assert.equal(chunk.id.startsWith(`${chunk.page}-`), true, `${question.id}/${chunk.id}`);
    assert.ok(chunk.quote.trim());
    assert.ok(chunk.quote.trim().split(/\s+/u).length <= 25, `${question.id}/${chunk.id}`);
  }
  for (const question of fixture.questions.filter((item) => item.kind === "multi")) {
    assert.equal(question.evidenceGroups.length, 2, question.id);
  }
  for (const question of fixture.questions.filter((item) => item.pairedWith)) {
    const paired = fixture.questions.find((item) => item.id === question.pairedWith);
    assert.ok(paired, question.id);
    assert.equal(paired.book, question.book);
    assert.notEqual(paired.kind, "hinglish");
  }
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(fixture)), false);
});

test("edition metadata is matched by file name and verified by SHA-256", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "better-reader-retrieval-"));
  try {
    const bytes = "not a real pdf, only bytes for hashing";
    const data = path.join(directory, "library");
    await mkdir(path.join(data, "uploads"), { recursive: true });
    await writeFile(path.join(data, "uploads", "doc1.pdf"), bytes);
    await writeFile(path.join(data, "pdfs.json"), JSON.stringify([{ id: "doc1", name: "Book.pdf" }]));
    const expected = sha256(bytes);
    const input = { version: 1, books: [{ key: "book-one", fileName: "Book.pdf", sha256: expected }], questions: [exactQuestion()] };
    validateFixture(input);
    const resolved = await resolveInputs(input, data);
    assert.equal(resolved.books[0].pdfFile, await realpath(path.join(data, "uploads", "doc1.pdf")));
    assert.equal(resolved.books[0].sha256, expected);
    assert.equal(resolved.books[0].bytes, Buffer.byteLength(bytes));

    const wrong = clone(input);
    wrong.books[0].sha256 = "0".repeat(64);
    await assert.rejects(() => resolveInputs(wrong, data), /PDF hash mismatch/);

    const missing = clone(input);
    missing.books[0].fileName = "Other.pdf";
    await assert.rejects(() => resolveInputs(missing, data), /PDF not found/);

    await writeFile(path.join(data, "pdfs.json"), JSON.stringify([{ id: "../../escape", name: "Book.pdf" }]));
    await assert.rejects(() => resolveInputs(input, data), /Invalid PDF id/);

    await writeFile(path.join(data, "pdfs.json"), "{not json");
    await assert.rejects(() => resolveInputs(input, data), /Invalid JSON/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inputs cannot escape the library through an uploads symlink", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "better-reader-retrieval-input-link-"));
  try {
    const data = path.join(directory, "library");
    const outside = path.join(directory, "outside");
    await mkdir(data);
    await mkdir(outside);
    await writeFile(path.join(outside, "doc1.pdf"), "outside bytes that must never be hashed");
    await symlink(outside, path.join(data, "uploads"), "dir");
    await writeFile(path.join(data, "pdfs.json"), JSON.stringify([{ id: "doc1", name: "Book.pdf" }]));
    const input = { version: 1, books: [{ key: "book-one", fileName: "Book.pdf", sha256: "0".repeat(64) }], questions: [exactQuestion()] };
    await assert.rejects(() => resolveInputs(input, data), /resolves outside --data-dir/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fixture validation rejects stale pages and missing proofs", () => {
  const stale = clone(fixture);
  stale.questions[0].evidenceGroups[0].chunks[0].page += 100;
  assert.throws(() => validateFixture(stale), /id and page disagree/);
  const empty = clone(fixture);
  empty.questions[0].evidenceGroups[0].chunks = [];
  assert.throws(() => validateFixture(empty), /group 0 needs chunks/);
  const negative = clone(fixture);
  negative.questions[0].kind = "unanswerable";
  assert.throws(() => validateFixture(negative), /disagree/);
  const brokenPair = clone(fixture);
  brokenPair.questions.find((question) => question.pairedWith).pairedWith = "missing";
  assert.throws(() => validateFixture(brokenPair), /does not exist/);
});

test("gold labels are checked against the actual scratch index before scoring", () => {
  const question = exactQuestion();
  const index = { chunks: [{ id: "1-1", page: 1, text: "prefix the proof suffix" }] };
  validateGoldAgainstIndex(index, [question]);
  assert.throws(() => validateGoldAgainstIndex({ chunks: [{ id: "1-1", page: 2, text: "the proof" }] }, [question]), /Gold label mismatch/);
  assert.throws(() => validateGoldAgainstIndex({ chunks: [{ id: "1-1", page: 1, text: "different text" }] }, [question]), /Gold label mismatch/);
  assert.throws(() => validateGoldAgainstIndex({ chunks: [{ id: "1-2", page: 1, text: "the proof" }] }, [question]), /Gold label mismatch/);
  assert.throws(() => validateGoldAgainstIndex({}, [question]), /missing chunks/);
});

test("primary scoring uses ranked ids, MRR@10, and separate need coverage", () => {
  const single = exactQuestion();
  const atFive = scoreReply(single, { hits: ["x", "y", "z", "w", "1-1"].map((id) => ({ id })) });
  assert.equal(atFive.primary.hit1, 0);
  assert.equal(atFive.primary.hit5, 1);
  assert.equal(atFive.primary.hit10, 1);
  assert.equal(atFive.primary.mrr, 0.2);
  assert.equal(atFive.expanded.available, false);

  const late = scoreReply(single, { hits: [...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` })), { id: "1-1" }] });
  assert.equal(late.primary.hit10, 0);
  assert.equal(late.primary.mrr, 0);

  const multi = exactQuestion({
    kind: "multi",
    evidenceGroups: [
      { chunks: [{ id: "1-1", page: 1, quote: "the proof" }] },
      { chunks: [{ id: "2-1", page: 2, quote: "other proof" }] },
    ],
  });
  const firstNeed = scoreReply(multi, { hits: [{ id: "x" }, { id: "1-1" }, { id: "2-1" }] });
  assert.equal(firstNeed.primary.groupsAt5, 1);
  assert.equal(firstNeed.primary.allGroups5, 1);
  const oneNeed = scoreReply(multi, { hits: [{ id: "x" }, { id: "1-1" }, { id: "y" }] });
  assert.equal(oneNeed.primary.groupsAt5, 0.5);
  assert.equal(oneNeed.primary.allGroups5, 0);

  const center = scoreReply(single, { hits: [{ id: "1-1", page: 1, text: "intro\nthe proof",
    sources: [{ id: "1-1", page: 1, start: 6, end: 15 }] }] });
  assert.equal(center.primary.hit1, 1);
  assert.equal(center.expanded.hit1, 1);

  const contextOnly = scoreReply(single, { hits: [{ id: "2-1", page: 2, text: "intro\nthe proof",
    sources: [{ id: "1-1", page: 1, start: 6, end: 15 }, { id: "2-1", page: 2, start: 0, end: 5 }] }] });
  assert.equal(contextOnly.primary.hit1, 0);
  assert.equal(contextOnly.primary.mrr, 0);
  assert.equal(contextOnly.expanded.hit1, 1);
  assert.equal(contextOnly.expanded.allGroups5, 1);

  const clipped = scoreReply(single, { hits: [{ id: "1-1", page: 1, text: "only intro",
    sources: [{ id: "1-1", page: 1, start: 0, end: 10 }] }] });
  assert.equal(clipped.primary.hit1, 0);
  assert.equal(clipped.primary.mrr, 0);
  assert.equal(clipped.expanded.hit1, 0);
});

test("expanded success requires the exact quote inside the matching source span", () => {
  const proof = { id: "1-1", page: 1, quote: "ALPHA evidence" };
  const hit = { id: "1-1", page: 1, text: "intro\nALPHA evidence", sources: [{ id: "1-1", page: 1, start: 6, end: 20 }] };
  assert.equal(proofInsideSources(hit, proof), true);
  assert.equal(proofInsideSources(hit, { ...proof, page: 2 }), false);
  assert.equal(proofInsideSources(hit, { ...proof, id: "1-2" }), false);
  assert.equal(proofInsideSources({ ...hit, sources: [{ id: "1-1", page: 1, start: 0, end: 5 }] }, proof), false);
  assert.equal(proofInsideSources({ ...hit, text: "ALPHA evidence", sources: [{ id: "1-1", page: 1, start: 0, end: 14 }] }, proof), true);
  assert.equal(proofInsideSources({ ...hit, text: "ALPHA\nevidence", sources: [{ id: "1-1", page: 1, start: 0, end: 14 }] }, proof), true);
  for (const [start, end] of [[-1, 20], [0, 21], [NaN, 20], [6, 6], [6.5, 20]]) {
    assert.equal(proofInsideSources({ ...hit, sources: [{ id: "1-1", page: 1, start, end }] }, proof), false,
      `invalid span ${start}..${end}`);
  }

  const question = exactQuestion({
    kind: "multi",
    evidenceGroups: [
      { chunks: [proof] },
      { chunks: [{ id: "2-1", page: 2, quote: "BETA need" }] },
    ],
  });
  const hits = [
    { id: "1-1", page: 1, text: "intro\nALPHA evidence", sources: [{ id: "1-1", page: 1, start: 6, end: 20 }] },
    { id: "2-1", page: 2, text: "intro\nBETA need", sources: [{ id: "2-1", page: 2, start: 6, end: 15 }] },
  ];
  assert.equal(scoreReply(question, { hits }).expanded.allGroups5, 1);
  const outside = clone(hits);
  outside[1].sources[0].start = 0;
  outside[1].sources[0].end = 5;
  const failed = scoreReply(question, { hits: outside });
  assert.equal(failed.expanded.available, true);
  assert.equal(failed.expanded.allGroups5, 0);
});

test("aggregation separates English, Hinglish, needs, and negative candidate counts", () => {
  const english = exactQuestion({ id: "en" });
  const hinglish = exactQuestion({ id: "hi", kind: "hinglish", pairedWith: "en" });
  const negative = exactQuestion({ id: "neg", kind: "unanswerable", answerable: false, evidenceGroups: [] });
  const records = [
    scoreReply(english, { hits: [{ id: "1-1", score: 0.8 }] }),
    scoreReply(exactQuestion({ id: "en2" }), { hits: [{ id: "x", score: 0.4 }] }),
    scoreReply(hinglish, { hits: [{ id: "1-1", score: 0.7 }] }),
    scoreReply(negative, { hits: [{ id: "x", score: 0.6 }, { id: "y", score: 0.3 }] }),
  ];
  const summary = summarize(records);
  assert.equal(summary.overall.count, 3);
  assert.equal(summary.english.count, 2);
  assert.equal(summary.hinglish.count, 1);
  assert.equal(summary.english.hit1Count, 1);
  assert.equal(summary.english.hit5Count, 1);
  assert.equal(summary.hinglish.hit1Count, 1);
  assert.equal(summary.negatives.length, 1);
  assert.deepEqual(summary.negatives[0], { id: "neg", book: "book-one", candidates: 2, topScore: 0.6 });
  assert.equal(summary.negatives[0].abstained, undefined);
  assert.equal(summary.english.expanded.available, false);

  const base = scoreReply(exactQuestion({ id: "a" }), { hits: [{ id: "1-1" }] });
  assert.equal(aggregate([base]).hit1Count, 1);
  assert.equal(aggregate([]).count, 0);
  assert.equal(percentile95([1, 2, 3, 4, 5]), 5);
  assert.equal(percentile95([]), null);
});

test("default fixture is readable through the same validator", async () => {
  const loaded = await readFixture(fixtureFile);
  assert.equal(loaded.questions.length, 72);
  assert.equal(loaded.books.length, 6);
});

test("offline Node CLI forks the production worker and scores an empty cached index", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "better-reader-retrieval-cli-"));
  try {
    const data = path.join(directory, "library");
    const output = path.join(directory, "output");
    const bytes = Buffer.from("%PDF-1.4 tiny offline bytes\n");
    await mkdir(path.join(data, "uploads"), { recursive: true });
    await writeFile(path.join(data, "uploads", "doc1.pdf"), bytes);
    await writeFile(path.join(data, "pdfs.json"), JSON.stringify([{ id: "doc1", name: "Book.pdf" }]));
    const hash = sha256(bytes);
    const custom = {
      version: 1,
      books: [{ key: "book-one", fileName: "Book.pdf", sha256: hash }],
      questions: [{ id: "neg-1", book: "book-one", question: "Which absent detail is requested?",
        kind: "unanswerable", answerable: false, pairedWith: null, evidenceGroups: [] }],
    };
    const customFile = path.join(directory, "custom.json");
    await writeFile(customFile, JSON.stringify(custom));
    const indexDirectory = path.join(output, "scratch", "book-one", hash);
    await mkdir(indexDirectory, { recursive: true });
    await writeFile(path.join(indexDirectory, "index.json"), JSON.stringify({
      bookId: "book-one", version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL, chunks: [],
    }));

    let result;
    try {
      result = await runFile("node", [cliFile, "--data-dir", data, "--output-dir", output, "--questions", customFile], { timeout: 30_000 });
    } catch (error) {
      assert.fail(`CLI failed: ${error instanceof Error && "stderr" in error ? error.stderr : error}`);
    }
    assert.match(result.stdout, /book-one: cached in 0\.0s/);

    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.integrity.passed, true);
    assert.equal(report.params.embeddingModel, EMBEDDING_MODEL);
    assert.equal(report.params.embeddingRevision, EMBEDDING_REVISION);
    assert.equal(report.params.indexVersion, INDEX_VERSION);
    assert.equal(report.summary.negatives.length, 1);
    assert.equal(report.summary.negatives[0].candidates, 0);
    assert.equal(report.results[0].candidates, 0);
    assert.deepEqual(await readdir(path.join(output, "models")), []);
    assert.deepEqual(await readFile(path.join(data, "uploads", "doc1.pdf")), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
