// Evaluate server-side passage retrieval against frozen local-library cases.
// Usage: node scripts/evaluate-retrieval.mjs --data-dir <library> --output-dir <owned dir>
//        [--questions <fixture.json>] [--model-cache <owned dir>]

import { fork } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { EMBEDDING_MODEL, EMBEDDING_REVISION, INDEX_VERSION, isBookIndex } from "../src/lib/server/book-index/core.mjs";
import { isWorkerReply } from "../src/lib/server/book-index/protocol.mjs";
import {
  FIXTURE_DEFAULT, UsageError, assertSafePaths, parseArgs, percentile95, readFixture,
  resolveInputs, scoreReply, sha256, sha256File, summarize, validateGoldAgainstIndex,
} from "./lib/retrieval-eval.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const workerFile = path.join(root, "src/lib/server/book-index/worker.mjs");
const INDEX_TIMEOUT = 30 * 60_000;
const SEARCH_TIMEOUT = 2 * 60_000;

const usage = `Usage: node scripts/evaluate-retrieval.mjs --data-dir PATH --output-dir PATH [options]

  --data-dir PATH       Existing Better Reader library (read-only). Required.
  --output-dir PATH     Owned directory for the report and scratch indexes. Required.
  --questions PATH      Fixture with custom held-out cases (default: ${FIXTURE_DEFAULT}).
  --model-cache PATH    Reusable model cache outside --data-dir (default: <output-dir>/models).

The output directory must not overlap the input library. PDFs are hashed before
and after; a changed or mismatched edition fails instead of scoring stale labels.`;

/** @param {string} file */
async function readIndex(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error instanceof Error && "code" in error && error.code === "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** @param {string} file */
async function hashIfExists(file) {
  try {
    return await sha256File(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** @param {string} file */
function startWorker(file) {
  const child = fork(file, [], {
    execPath: process.execPath, execArgv: ["--max-old-space-size=512"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  /** @param {any} job @param {number} timeoutMs */
  const run = (job, timeoutMs) => new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const finish = (error, reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error); else resolve(reply);
    };
    const onMessage = (value) => {
      if (!isWorkerReply(value)) return finish(new Error("Invalid worker reply"));
      if (value.type === "progress") {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error(`Worker job timed out after ${timeoutMs} ms`)), timeoutMs);
        return;
      }
      if (value.type === "error") return finish(new Error(value.error));
      if (value.type !== "done" || value.kind !== job.kind) return finish(new Error("Unexpected worker reply"));
      finish(undefined, value);
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Worker exited (${code})`));
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(new Error(`Worker job timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      child.send(job, (error) => { if (error) finish(error); });
    } catch (error) {
      finish(error);
    }
  });
  return { run, close: () => child.kill() };
}

/** @param {any} worker @param {any} book @param {string} cacheDir @param {string} scratchRoot */
async function ensureIndex(worker, book, cacheDir, scratchRoot) {
  const directory = path.join(scratchRoot, book.key, book.sha256);
  const indexFile = path.join(directory, "index.json");
  const tempFile = path.join(directory, "index.tmp");
  await mkdir(directory, { recursive: true });
  const existing = await readIndex(indexFile);
  if (existing && isBookIndex(existing, book.key)) return { indexFile, tempFile, cached: true, milliseconds: 0, index: existing };
  await rm(tempFile, { force: true });
  const start = performance.now();
  const reply = await worker.run({ kind: "index", bookId: book.key, pdfFile: book.pdfFile, indexFile, tempFile, cacheDir }, INDEX_TIMEOUT);
  const milliseconds = performance.now() - start;
  if (reply.indexed) await rename(tempFile, indexFile);
  const built = await readIndex(indexFile);
  if (!built || !isBookIndex(built, book.key)) throw new Error(`Worker did not publish a valid index for ${book.key}`);
  return { indexFile, tempFile, cached: false, milliseconds, index: built };
}

/** @param {any} options */
async function evaluate(options) {
  const paths = await assertSafePaths(options);
  const questionsFile = path.resolve(options.questions ?? path.join(root, FIXTURE_DEFAULT));
  const fixtureBytes = await readFile(questionsFile);
  const fixture = await readFixture(questionsFile);
  const fixtureSha256 = sha256(fixtureBytes);
  const started = new Date();
  const start = performance.now();

  const metadataFile = path.join(paths.dataDir, "pdfs.json");
  const metadataBefore = await hashIfExists(metadataFile);
  const inputs = await resolveInputs(fixture, paths.dataDir);
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.modelCache, { recursive: true });
  const scratchRoot = path.join(paths.outputDir, "scratch");

  const books = new Map();
  const worker = startWorker(workerFile);
  const searches = [];
  const records = [];
  try {
    for (const book of inputs.books) {
      console.log(`[eval] ${book.key}: checking scratch index`);
      const { index, ...built } = await ensureIndex(worker, book, paths.modelCache, scratchRoot);
      validateGoldAgainstIndex(index, fixture.questions.filter((question) => question.book === book.key));
      books.set(book.key, { ...book, ...built });
      console.log(`[eval] ${book.key}: ${built.cached ? "cached" : "indexed"} in ${(built.milliseconds / 1000).toFixed(1)}s`);
    }
    for (const question of fixture.questions) {
      const book = books.get(question.book);
      if (!book) throw new Error(`${question.id}: book ${question.book} was not indexed`);
      const queryStart = performance.now();
      const reply = await worker.run({
        kind: "search", bookId: book.key, question: question.question,
        pdfFile: book.pdfFile, indexFile: book.indexFile, tempFile: book.tempFile, cacheDir: paths.modelCache,
      }, SEARCH_TIMEOUT);
      const milliseconds = performance.now() - queryStart;
      searches.push(milliseconds);
      const record = scoreReply(question, reply);
      record.searchMs = milliseconds;
      records.push(record);
    }
  } finally {
    worker.close();
  }

  const integrity = {
    passed: true,
    metadata: { file: metadataFile, before: metadataBefore, after: null },
    pdfs: [],
  };
  for (const book of inputs.books) {
    const after = await sha256File(book.pdfFile);
    const unchanged = after === book.sha256;
    integrity.pdfs.push({ key: book.key, fileName: book.fileName, before: book.sha256, after, unchanged });
    if (!unchanged) integrity.passed = false;
  }
  integrity.metadata.after = await hashIfExists(metadataFile);
  if (integrity.metadata.after !== metadataBefore) integrity.passed = false;

  const finished = new Date();
  const totalMs = performance.now() - start;
  const summary = summarize(records);
  const report = {
    protocol: {
      fixtureVersion: fixture.version,
      primary: "hit@1/5/10 and MRR@10 over center hit ids; when sources are returned the gold proof must appear in the primary source's actual text; merged context ids do not count",
      expanded: "a group succeeds only when its exact gold quote appears inside a valid source span with the same book-local id and page (invalid offsets are ignored, never clamped)",
      negatives: "candidate counts only; this run does not claim answer/abstain accuracy",
      labels: "AI-adjudicated labels, not human ground truth",
    },
    generatedAt: finished.toISOString(),
    environment: {
      node: process.version, platform: process.platform, arch: process.arch, cpus: cpus().length,
      worker: path.relative(root, workerFile), versions: { node: process.versions.node, v8: process.versions.v8 },
    },
    params: {
      dataDir: paths.dataDir, outputDir: paths.outputDir, modelCache: paths.modelCache,
      modelCacheSource: paths.explicitModelCache ? "explicit" : "output-dir default",
      questions: questionsFile, fixtureSha256,
      embeddingModel: EMBEDDING_MODEL, embeddingRevision: EMBEDDING_REVISION, indexVersion: INDEX_VERSION,
    },
    fixture: {
      books: fixture.books.length, questions: fixture.questions.length,
      answerable: fixture.questions.filter((question) => question.answerable).length,
      negatives: fixture.questions.filter((question) => !question.answerable).length,
    },
    integrity,
    books: inputs.books.map((book) => {
      const built = books.get(book.key);
      return { key: book.key, fileName: book.fileName, sha256: book.sha256, bytes: book.bytes,
        indexCached: built.cached, indexMs: built.milliseconds };
    }),
    summary,
    results: records,
    timings: {
      startedAt: started.toISOString(), finishedAt: finished.toISOString(), totalMs,
      search: { count: searches.length, meanMs: searches.reduce((a, b) => a + b, 0) / Math.max(1, searches.length),
        p95Ms: percentile95(searches), maxMs: searches.length ? Math.max(...searches) : null },
    },
  };
  const reportFile = path.join(paths.outputDir, "report.json");
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportFile };
}

/** @param {any} summary */
function printSummary(summary) {
  const row = (/** @type {string} */ label, /** @type {any} */ value) => ({
    set: label, n: value.count,
    hit1: value.hit1 === null ? "n/a" : `${value.hit1Count}/${value.count}`,
    hit5: value.hit5 === null ? "n/a" : `${value.hit5Count}/${value.count}`,
    hit10: value.hit10 === null ? "n/a" : `${value.hit10Count}/${value.count}`,
    mrr: value.mrr === null ? "n/a" : value.mrr.toFixed(3),
    allGroups5: value.allGroups5 === null ? "n/a" : `${value.allGroups5Count}/${value.count}`,
    expandedAllGroups5: value.expanded.available ? `${value.expanded.allGroups5Count}/${value.count}` : "n/a",
  });
  console.table([
    row("English", summary.english),
    row("Hinglish", summary.hinglish),
    ...Object.entries(summary.byKind).map(([kind, value]) => row(kind, value)),
  ]);
  const candidates = summary.negatives.map((/** @type {any} */ negative) => negative.candidates);
  const mean = candidates.reduce((a, b) => a + b, 0) / Math.max(1, candidates.length);
  console.log(`Negatives: ${summary.negatives.length}; mean candidates ${mean.toFixed(1)} (not abstention accuracy).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
    } else {
      const { report, reportFile } = await evaluate(options);
      printSummary(report.summary);
      console.log(`Report: ${reportFile}`);
      if (!report.integrity.passed) throw new Error("Input library bytes changed during evaluation");
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${usage}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
