// @ts-check

import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const FIXTURE_VERSION = 1;
export const FIXTURE_DEFAULT = "tests/fixtures/retrieval/questions.json";
export const KINDS = ["exact", "semantic", "multi", "hinglish", "unanswerable"];

const BOOK_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class UsageError extends Error {}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  /** @type {{ dataDir?: string, outputDir?: string, questions?: string, modelCache?: string, help?: boolean }} */
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (!next || next.startsWith("--")) throw new UsageError(`${arg} needs a path`);
      return next;
    };
    if (arg === "--data-dir") options.dataDir = value();
    else if (arg === "--output-dir") options.outputDir = value();
    else if (arg === "--questions") options.questions = value();
    else if (arg === "--model-cache") options.modelCache = value();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.dataDir) throw new UsageError("--data-dir is required; this tool never reads a default library");
  if (!options.outputDir) throw new UsageError("--output-dir is required; reports and scratch indexes need an owned directory");
  return options;
}

/** @param {string} child @param {string} parent */
export function sameOrInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/**
 * Resolves symlinks in the closest existing ancestor, then appends the missing
 * tail. Comparing lexical paths alone would let a symlink point inside the library.
 * @param {string} target
 */
export async function canonicalPath(target) {
  let current = path.resolve(target);
  /** @type {string[]} */
  const missing = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing.reverse());
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** @param {{ dataDir: string, outputDir: string, modelCache?: string }} options */
export async function assertSafePaths(options) {
  const dataDir = await canonicalPath(options.dataDir);
  const outputDir = await canonicalPath(options.outputDir);
  if (sameOrInside(outputDir, dataDir) || sameOrInside(dataDir, outputDir)) {
    throw new UsageError("--output-dir must not be inside, equal to, or a parent of --data-dir (after resolving symlinks)");
  }
  const modelCache = await canonicalPath(options.modelCache ?? path.join(outputDir, "models"));
  if (sameOrInside(modelCache, dataDir) || sameOrInside(dataDir, modelCache)) {
    throw new UsageError("--model-cache must not contain or be contained by --data-dir");
  }
  return { dataDir, outputDir, modelCache, explicitModelCache: Boolean(options.modelCache) };
}

/** @param {string | Uint8Array} value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} file */
export async function sha256File(file) {
  return sha256(await readFile(file));
}

/** @param {unknown} value @returns {any} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

/** @param {any} fixture */
export function validateFixture(fixture) {
  if (!isRecord(fixture) || fixture.version !== FIXTURE_VERSION) {
    throw new Error(`Fixture must be an object with version ${FIXTURE_VERSION}`);
  }
  if (!Array.isArray(fixture.books) || !fixture.books.length) throw new Error("Fixture needs a non-empty books array");
  const keys = new Set(), names = new Set(), hashes = new Set();
  for (const [index, book] of fixture.books.entries()) {
    if (!isRecord(book) || typeof book.key !== "string" || !BOOK_KEY.test(book.key)) {
      throw new Error(`books[${index}] has an invalid stable key`);
    }
    if (typeof book.fileName !== "string" || !book.fileName || path.basename(book.fileName) !== book.fileName) {
      throw new Error(`${book.key}: fileName must be a bare file name`);
    }
    if (typeof book.sha256 !== "string" || !SHA256.test(book.sha256)) {
      throw new Error(`${book.key}: sha256 must be 64 lowercase hex characters`);
    }
    if (keys.has(book.key) || names.has(book.fileName) || hashes.has(book.sha256)) {
      throw new Error(`${book.key}: duplicate key, fileName or sha256`);
    }
    keys.add(book.key);
    names.add(book.fileName);
    hashes.add(book.sha256);
  }
  if (!Array.isArray(fixture.questions) || !fixture.questions.length) throw new Error("Fixture needs questions");
  const ids = new Set(), byId = new Map();
  for (const [index, question] of fixture.questions.entries()) {
    const label = isRecord(question) && typeof question.id === "string" ? question.id : `questions[${index}]`;
    if (!isRecord(question) || typeof question.id !== "string" || !question.id.trim()) throw new Error(`${label}: invalid id`);
    if (ids.has(question.id)) throw new Error(`${label}: duplicate id`);
    if (typeof question.book !== "string" || !keys.has(question.book)) throw new Error(`${label}: unknown book`);
    if (typeof question.question !== "string" || !question.question.trim()) throw new Error(`${label}: empty question`);
    if (!KINDS.includes(question.kind)) throw new Error(`${label}: unknown kind`);
    if (typeof question.answerable !== "boolean") throw new Error(`${label}: answerable must be boolean`);
    if (question.answerable === (question.kind === "unanswerable")) {
      throw new Error(`${label}: unanswerable kind and answerable flag disagree`);
    }
    if (!Array.isArray(question.evidenceGroups)) throw new Error(`${label}: evidenceGroups must be an array`);
    if (question.answerable === false && question.evidenceGroups.length) throw new Error(`${label}: negatives need no gold groups`);
    if (question.answerable && !question.evidenceGroups.length) throw new Error(`${label}: answerable case needs a gold group`);
    if (question.kind === "multi" && question.evidenceGroups.length < 2) throw new Error(`${label}: multi case needs at least two needs`);
    for (const [groupIndex, group] of question.evidenceGroups.entries()) {
      if (!isRecord(group) || !Array.isArray(group.chunks) || !group.chunks.length) {
        throw new Error(`${label}: group ${groupIndex} needs chunks`);
      }
      const chunkIds = new Set();
      for (const proof of group.chunks) {
        const proofLabel = `${label} group ${groupIndex}`;
        if (!isRecord(proof) || typeof proof.id !== "string" || !proof.id) throw new Error(`${proofLabel}: invalid chunk id`);
        if (chunkIds.has(proof.id)) throw new Error(`${proofLabel}: duplicate chunk ${proof.id}`);
        chunkIds.add(proof.id);
        if (!Number.isInteger(proof.page) || proof.page < 1) throw new Error(`${proofLabel}/${proof.id}: invalid page`);
        if (!proof.id.startsWith(`${proof.page}-`)) throw new Error(`${proofLabel}/${proof.id}: id and page disagree`);
        if (typeof proof.quote !== "string" || !proof.quote.trim()) throw new Error(`${proofLabel}/${proof.id}: empty quote`);
        if (proof.quote.trim().split(/\s+/u).length > 25) throw new Error(`${proofLabel}/${proof.id}: quote is longer than 25 words`);
      }
    }
    if (question.pairedWith != null && (typeof question.pairedWith !== "string" || !question.pairedWith)) {
      throw new Error(`${label}: invalid pairedWith`);
    }
    ids.add(question.id);
    byId.set(question.id, question);
  }
  for (const question of fixture.questions) {
    if (question.pairedWith == null) continue;
    const paired = byId.get(question.pairedWith);
    if (!paired) throw new Error(`${question.id}: pairedWith target does not exist`);
    if (paired.id === question.id) throw new Error(`${question.id}: cannot pair with itself`);
    if (paired.book !== question.book) throw new Error(`${question.id}: paired question belongs to another book`);
    if (paired.kind === "hinglish") throw new Error(`${question.id}: paired target must be the English case`);
  }
  return fixture;
}

/** @param {string} file */
export async function readFixture(file) {
  return validateFixture(JSON.parse(await readFile(file, "utf8")));
}

/** @param {string} file @returns {Promise<unknown | null>} */
async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON: ${file}`, { cause: error });
    throw error;
  }
}

/** @param {string} file */
async function exists(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

/** @param {unknown} value */
function safeMetadataId(value) {
  return typeof value === "string" && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * Finds the frozen edition by metadata file name and verifies its bytes.
 * @param {any} fixture @param {string} dataDir
 */
export async function resolveInputs(fixture, dataDir) {
  const dataRoot = await canonicalPath(dataDir);
  const uploads = path.join(dataRoot, "uploads");
  const metadataFile = path.join(dataRoot, "pdfs.json");
  /** @type {Map<string, Set<string>>} */
  const candidates = new Map();
  const add = (name, file) => {
    if (typeof name !== "string" || !name) return;
    const files = candidates.get(name) ?? new Set();
    files.add(path.resolve(file));
    candidates.set(name, files);
  };
  const metadata = await readJsonIfExists(metadataFile);
  if (metadata !== null) {
    if (!Array.isArray(metadata)) throw new Error(`Invalid library metadata: ${metadataFile}`);
    for (const record of metadata) {
      if (!isRecord(record) || typeof record.id !== "string") continue;
      if (!safeMetadataId(record.id)) throw new Error(`Invalid PDF id in library metadata: ${record.id}`);
      add(record.name, path.join(uploads, `${record.id}.pdf`));
    }
  }
  for (const directory of [uploads, dataRoot]) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) add(entry.name, path.join(directory, entry.name));
  }
  const books = [];
  for (const book of fixture.books) {
    const found = [];
    for (const file of candidates.get(book.fileName) ?? []) {
      if (!await exists(file)) continue;
      const canonical = await realpath(file);
      if (!sameOrInside(canonical, dataRoot)) {
        throw new Error(`PDF path for ${book.key} resolves outside --data-dir: ${book.fileName}`);
      }
      if (!found.includes(canonical)) found.push(canonical);
    }
    if (!found.length) throw new Error(`PDF not found for ${book.key}: ${book.fileName}`);
    if (found.length > 1) throw new Error(`Ambiguous PDF for ${book.key}: ${book.fileName} (${found.length} files)`);
    const pdfFile = found[0];
    const actual = await sha256File(pdfFile);
    if (actual !== book.sha256) {
      throw new Error(`PDF hash mismatch for ${book.key} (${book.fileName}): expected ${book.sha256}, found ${actual}`);
    }
    books.push({ key: book.key, fileName: book.fileName, sha256: actual, pdfFile, bytes: (await stat(pdfFile)).size });
  }
  return { books, metadataFile: metadata === null ? null : metadataFile };
}

/** @param {string} text */
function collapse(text) {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Fails loudly when the actual index has different chunk ids/pages/text than the
 * frozen labels, so a tokenizer, chunking or edition change cannot score stale gold.
 * @param {any} index @param {any[]} questions
 */
export function validateGoldAgainstIndex(index, questions) {
  if (!isRecord(index) || !Array.isArray(index.chunks)) throw new Error("Scratch index is missing chunks");
  const chunks = new Map(index.chunks.map((/** @type {any} */ chunk) => [chunk.id, chunk]));
  for (const question of questions.filter((item) => item.answerable)) {
    for (const group of question.evidenceGroups) {
      for (const proof of group.chunks) {
        const chunk = chunks.get(proof.id);
        if (!chunk || chunk.page !== proof.page || typeof chunk.text !== "string" || !chunk.text.includes(proof.quote)) {
          throw new Error(`Gold label mismatch for ${question.id}/${proof.id}: this index edition does not contain the frozen proof`);
        }
      }
    }
  }
}

/**
 * True only when the exact proof sits in a valid source span for the same
 * book-local chunk id and page. Invalid offsets are rejected, never clamped.
 * @param {any} hit @param {{ id: string, page: number, quote: string }} proof
 */
export function proofInsideSources(hit, proof) {
  if (!isRecord(hit) || typeof hit.text !== "string" || !Array.isArray(hit.sources)) return false;
  const quote = collapse(proof.quote);
  return Boolean(quote) && hit.sources.some((source) => {
    if (!isRecord(source) || source.id !== proof.id || source.page !== proof.page) return false;
    if (!Number.isInteger(source.start) || !Number.isInteger(source.end)) return false;
    if (source.start < 0 || source.end <= source.start || source.end > hit.text.length) return false;
    return collapse(hit.text.slice(source.start, source.end)).includes(quote);
  });
}

/**
 * Primary evidence is the center hit id and nothing else. When the reply returns
 * expanded text, the gold proof must be inside that primary source's actual text;
 * a clipped primary chunk does not count as delivered evidence.
 * @param {any} hit @param {{ id: string, page: number, quote: string }} proof
 */
function primaryDelivers(hit, proof) {
  if (!isRecord(hit) || hit.id !== proof.id) return false;
  if (!Array.isArray(hit.sources)) return true;
  if (hit.page !== proof.page) return false;
  return proofInsideSources(hit, proof);
}

/** @param {any} question @param {any} reply */
export function scoreReply(question, reply) {
  const hits = Array.isArray(reply?.hits) ? reply.hits : [];
  /** @type {any} */
  const record = {
    id: question.id, book: question.book, kind: question.kind, answerable: question.answerable,
    pairedWith: question.pairedWith ?? null, candidates: hits.length,
    topScore: Number.isFinite(hits[0]?.score) ? hits[0].score : null,
    queryParts: Array.isArray(reply?.queries) ? reply.queries.length : 1,
  };
  if (!question.answerable) return record;

  const ranks = question.evidenceGroups.map((/** @type {any} */ group) => {
    let first = Infinity;
    for (const proof of group.chunks) {
      const index = hits.findIndex((hit) => primaryDelivers(hit, proof));
      if (index >= 0 && index < first) first = index;
    }
    return first;
  });
  const first = Math.min(...ranks);
  const covered = (/** @type {number} */ k) => ranks.filter((rank) => rank < k).length / ranks.length;
  record.primary = {
    hit1: Number(first < 1),
    hit5: Number(first < 5),
    hit10: Number(first < 10),
    mrr: first < 10 ? 1 / (first + 1) : 0,
    groupsAt5: covered(5), groupsAt10: covered(10),
    allGroups5: Number(covered(5) === 1), allGroups10: Number(covered(10) === 1),
  };

  const sourcesAvailable = hits.length > 0 && hits.every((hit) => typeof hit?.text === "string" && Array.isArray(hit.sources));
  if (sourcesAvailable) {
    const groupFound = (/** @type {any} */ group, /** @type {number} */ k) => hits.slice(0, k)
      .some((hit) => group.chunks.some((/** @type {any} */ proof) => proofInsideSources(hit, proof)));
    const expandedCovered = (/** @type {number} */ k) => question.evidenceGroups.filter((/** @type {any} */ group) => groupFound(group, k)).length / ranks.length;
    record.expanded = {
      available: true,
      hit1: Number(question.evidenceGroups.some((/** @type {any} */ group) => groupFound(group, 1))),
      hit5: Number(question.evidenceGroups.some((/** @type {any} */ group) => groupFound(group, 5))),
      hit10: Number(question.evidenceGroups.some((/** @type {any} */ group) => groupFound(group, 10))),
      groupsAt5: expandedCovered(5), groupsAt10: expandedCovered(10),
      allGroups5: Number(expandedCovered(5) === 1), allGroups10: Number(expandedCovered(10) === 1),
    };
  } else {
    record.expanded = { available: false };
  }
  return record;
}

/** @param {any[]} records */
export function aggregate(records) {
  const rows = records.filter((record) => record.primary);
  if (!rows.length) {
    return { count: 0, hit1: null, hit5: null, hit10: null, mrr: null, groupsAt5: null, allGroups5: null,
      hit1Count: 0, hit5Count: 0, hit10Count: 0, allGroups5Count: 0,
      expanded: { available: false, count: 0, hit5: null, allGroups5: null, allGroups5Count: 0 } };
  }
  const mean = (/** @type {(record: any) => number} */ pick) => rows.reduce((sum, record) => sum + pick(record), 0) / rows.length;
  const sum = (/** @type {(record: any) => number} */ pick) => rows.reduce((total, record) => total + pick(record), 0);
  const expanded = rows.filter((record) => record.expanded?.available);
  const expandedMean = (/** @type {(record: any) => number} */ pick) => expanded.reduce((total, record) => total + pick(record), 0) / expanded.length;
  return {
    count: rows.length,
    hit1: mean((record) => record.primary.hit1), hit5: mean((record) => record.primary.hit5),
    hit10: mean((record) => record.primary.hit10), mrr: mean((record) => record.primary.mrr),
    groupsAt5: mean((record) => record.primary.groupsAt5),
    allGroups5: mean((record) => record.primary.allGroups5),
    hit1Count: sum((record) => record.primary.hit1), hit5Count: sum((record) => record.primary.hit5),
    hit10Count: sum((record) => record.primary.hit10), allGroups5Count: sum((record) => record.primary.allGroups5),
    expanded: {
      available: expanded.length === rows.length,
      count: expanded.length,
      hit5: expanded.length ? expandedMean((record) => record.expanded.hit5) : null,
      allGroups5: expanded.length ? expandedMean((record) => record.expanded.allGroups5) : null,
      allGroups5Count: expanded.length ? expanded.reduce((total, record) => total + record.expanded.allGroups5, 0) : 0,
    },
  };
}

/** @param {any[]} records */
export function summarize(records) {
  const answerable = records.filter((record) => record.answerable);
  return {
    overall: aggregate(answerable),
    english: aggregate(answerable.filter((record) => record.kind !== "hinglish")),
    hinglish: aggregate(answerable.filter((record) => record.kind === "hinglish")),
    byKind: Object.fromEntries(KINDS.filter((kind) => kind !== "unanswerable")
      .map((kind) => [kind, aggregate(answerable.filter((record) => record.kind === kind))])),
    negatives: records.filter((record) => !record.answerable)
      .map((record) => ({ id: record.id, book: record.book, candidates: record.candidates, topScore: record.topScore })),
  };
}

/** @param {number[]} values */
export function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}
