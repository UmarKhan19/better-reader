// @ts-check

/** @typedef {{ id: string, page: number, text: string, embedding: number[] }} IndexedChunk */
/** @typedef {{ bookId: string, version: number, embeddingModel: string, chunks: IndexedChunk[] }} BookIndex */
/** @typedef {{ id: string, page: number, text: string, score: number }} SearchHit */

// Bump when pooling, prefixes, token budgets or page-batch grouping change.
export const INDEX_VERSION = 2;
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
export const EMBEDDING_DIMENSIONS = 384;
export const MAX_TOKENS = 256;
export const MODEL_MAX_TOKENS = 512;
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
export const EMBEDDING_BATCH_SIZE = 4;

/** @param {unknown} value @returns {value is number[]} */
export function isEmbedding(value) {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS
    && value.every((n) => typeof n === "number" && Number.isFinite(n))
    && value.some((n) => n !== 0);
}

/** @param {unknown} value @param {string} bookId @returns {value is BookIndex} */
export function isBookIndex(value, bookId) {
  if (!value || typeof value !== "object") return false;
  const v = /** @type {BookIndex} */ (value);
  return v.bookId === bookId && v.version === INDEX_VERSION && v.embeddingModel === EMBEDDING_MODEL
    && Array.isArray(v.chunks) && v.chunks.every((chunk) => chunk && typeof chunk.id === "string" && chunk.id.length > 0 && chunk.id.length <= 256
      && Number.isInteger(chunk.page) && chunk.page >= 1
      && typeof chunk.text === "string" && chunk.text.trim().length > 0 && isEmbedding(chunk.embedding))
    && new Set(v.chunks.map((chunk) => chunk.id)).size === v.chunks.length;
}

/**
 * Keep page boundaries and original characters, including text without spaces.
 * @param {string} text
 * @param {number} page
 * @param {(text: string) => number} countTokens Includes special tokens.
 * @returns {Omit<IndexedChunk, 'embedding'>[]}
 */
export function chunkPage(text, page, countTokens) {
  text = text.replace(/\s+/gu, " ").trim();
  /** @type {{ start: number, end: number }[]} */
  const words = [];
  /** @param {number} start @param {number} end */
  function addWord(start, end) {
    if (countTokens(text.slice(start, end)) <= MAX_TOKENS) {
      words.push({ start, end });
      return;
    }
    let middle = start + Math.floor((end - start) / 2);
    if (/[\uDC00-\uDFFF]/u.test(text[middle])) middle++;
    if (middle <= start || middle >= end) throw new Error("A character exceeds the model token limit");
    addWord(start, middle);
    addWord(middle, end);
  }
  for (const match of text.matchAll(/\S+/gu)) addWord(match.index, match.index + match[0].length);

  const chunks = [];
  for (let start = 0; start < words.length;) {
    let end = Math.min(start + 150, words.length);
    let passage = text.slice(words[start].start, words[end - 1].end);
    while (countTokens(passage) > MAX_TOKENS) {
      end--;
      passage = text.slice(words[start].start, words[end - 1].end);
    }
    chunks.push({ id: `${page}-${chunks.length + 1}`, page, text: passage });
    if (end === words.length) break;
    start = end - Math.min(30, Math.floor((end - start) / 2));
  }
  return chunks;
}

/** @param {number[]} a @param {number[]} b */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error("Embedding dimensions do not match");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

const STOP_WORDS = new Set("a an and are as at be by do does for from how i in is it of on or that the this to was what when where which who why with you".split(" "));
/** @param {string} text */
function keywords(text) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !STOP_WORDS.has(word)));
}

/** @type {WeakMap<BookIndex, { chunk: IndexedChunk, terms: Set<string>, norm: number }[]>} */
const rankingData = new WeakMap();

/** Published index snapshots are immutable; replacing/evicting the snapshot releases its preparation. */
/** @param {BookIndex} index @param {string} question @param {number[]} embedding @param {number} [limit] @returns {SearchHit[]} */
export function rankChunks(index, question, embedding, limit = 10) {
  if (!isEmbedding(embedding)) throw new Error("Invalid query embedding");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Result limit must be between 1 and 50");
  let prepared = rankingData.get(index);
  if (!prepared) {
    prepared = index.chunks.map((chunk) => ({ chunk, terms: keywords(chunk.text), norm: Math.hypot(...chunk.embedding) }));
    rankingData.set(index, prepared);
  }
  const terms = [...keywords(question)];
  const queryNorm = Math.hypot(...embedding);
  return prepared.map(({ chunk, terms: words, norm }) => {
    if (chunk.embedding.length !== embedding.length) throw new Error("Embedding dimensions do not match");
    let dot = 0;
    for (let i = 0; i < embedding.length; i++) dot += embedding[i] * chunk.embedding[i];
    const similarity = norm ? dot / (queryNorm * norm) : 0;
    const keywordScore = terms.length ? terms.filter((term) => words.has(term)).length / terms.length : 0;
    return {
      id: chunk.id, page: chunk.page, text: chunk.text,
      score: 0.8 * similarity + 0.2 * keywordScore,
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}
