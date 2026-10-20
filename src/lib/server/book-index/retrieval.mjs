// @ts-check

import { rankChunks } from "./core.mjs";

/** @typedef {{ id: string, page: number, text: string, score: number }} SearchHit */
/** @typedef {{ id: string, page: number, start: number, end: number }} EvidenceSource Output-text offsets; text[start:end] is an exact source substring. */
/** @typedef {SearchHit & { sources: EvidenceSource[], matches: number[], selectedIds: string[] }} EvidenceHit */
/** @typedef {{ hit: SearchHit, query: number, rank: number }} Candidate */
/** @typedef {{ text: string, id: string, page: number, originalStart: number, originalEnd: number }} Piece */

const MAX_HITS = 10;
const MAX_TEXT = 16_000;
const MAX_HIT_TEXT = 2_400;

/**
 * Split only explicit coordinated interrogatives or one/two clauses enumerated after a colon.
 * shortcut: the interrogative marker list is intentionally narrow; extend it only with a regression test.
 * @param {string} question
 * @returns {string[]}
 */
export function planQueries(question) {
  const original = question.trim();
  if (!original) return [];
  const marker = /\s+(?:and\s+(?:what|how|which|why|where|when|who)\b|aur\s+(?:kya|kaise|kyun|kyon|kaun|kahan|kab)\b)/giu;
  const found = [...original.matchAll(marker)];
  if (found.length) {
    const match = found[0];
    const start = match.index ?? 0;
    const connector = match[0].match(/^\s*(?:and|aur)\s+/iu);
    if (!connector) return [original];
    const connectorLength = connector[0].length;
    // Keep the interrogative word; dropping it turns a question into an ungrounded fragment.
    return [original, original.slice(0, start).replace(/[?;,:\s]+$/gu, "").trim(), original.slice(start + connectorLength).trim()]
      .filter(Boolean).slice(0, 3);
  }

  const coordinated = original.match(/^(.+?)[?;]\s*((?:what|how|which|why|where|when|who|kya|kaise|kyun|kyon|kaun|kahan|kab)\b.+)$/iu);
  if (coordinated) return [original, coordinated[1].trim(), coordinated[2].trim()].slice(0, 3);

  const enumeration = original.match(/^(.+?):\s*one\s+(.+?)\s+and\s+one\s+(.+?)[?;.]?$/iu);
  if (enumeration) return [original, `${enumeration[1].trim()}: one ${enumeration[2].trim()}`, `${enumeration[1].trim()}: one ${enumeration[3].trim()}`];
  return [original];
}

/** @param {string} text @param {number} size */
function centeredRange(text, size) {
  let length = Math.min(text.length, size);
  let start = Math.floor((text.length - length) / 2);
  // String offsets are UTF-16; never return half of a surrogate pair.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start])) { start++; length--; }
  let end = start + length;
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  return { start, end };
}

/** @param {string} text @param {number} size @param {"head"|"tail"} side */
function edgeRange(text, size, side) {
  let start = side === "tail" ? Math.max(0, text.length - size) : 0;
  let end = side === "tail" ? text.length : Math.min(text.length, size);
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start])) start++;
  if (end < text.length && end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  return { start, end };
}

/** @param {string} before @param {string} after */
function overlapLength(before, after) {
  for (let length = Math.min(before.length, after.length); length > 0; length--) {
    if (before.endsWith(after.slice(0, length))) return length;
  }
  return 0;
}

/** @param {import('./core.mjs').BookIndex} index @param {string[]} queries @param {number[][]} embeddings @returns {EvidenceHit[]} */
export function retrieveEvidence(index, queries, embeddings) {
  const usable = queries.map((query, i) => ({ query, embedding: embeddings[i], i }))
    .filter(({ query, embedding }) => typeof query === "string" && query.trim() && Array.isArray(embedding)
      && embedding.length === 384 && embedding.every(Number.isFinite) && embedding.some((n) => n !== 0));
  if (!usable.length) return [];

  /** @type {Candidate[][]} */
  const ranked = usable.map(({ query, embedding, i }) => rankChunks(index, query, embedding, 50)
    .map((hit, rank) => ({ hit, query: i, rank })));
  // Interleave by rank, not raw scores: scores across different query strings are not calibrated.
  /** @type {Candidate[]} */
  const candidates = [];
  for (let rank = 0; rank < 50; rank++) for (const list of ranked) if (list[rank]) candidates.push(list[rank]);

  /** @type {EvidenceHit[]} */
  const results = [];
  let total = 0;
  for (const candidate of candidates) {
    if (results.length >= MAX_HITS || total >= MAX_TEXT) break;
    const primaryPosition = index.chunks.findIndex((chunk) => chunk.id === candidate.hit.id);
    if (primaryPosition < 0) continue;
    const primary = index.chunks[primaryPosition];
    const existing = results.find((hit) => hit.selectedIds.includes(primary.id) || hit.sources.some((source) => source.id === primary.id
      && hit.text.slice(source.start, source.end) === primary.text));
    if (existing) {
      if (!existing.matches.includes(candidate.query)) existing.matches.push(candidate.query);
      if (!existing.selectedIds.includes(primary.id)) existing.selectedIds.push(primary.id);
      continue;
    }
    if (results.some((hit) => hit.selectedIds.includes(primary.id))) continue;

    const budget = Math.min(MAX_HIT_TEXT, MAX_TEXT - total);
    // Preserve the selected passage before spending any remaining budget on neighbors.
    const primaryRange = centeredRange(primary.text, budget);
    const primaryPiece = { text: primary.text.slice(primaryRange.start, primaryRange.end), id: primary.id,
      page: primary.page, originalStart: primaryRange.start, originalEnd: primaryRange.end };
    /** @type {Piece[]} */
    let before = [];
    /** @type {Piece[]} */
    let after = [];
    let used = primaryPiece.text.length;
    for (const position of [primaryPosition - 1, primaryPosition + 1]) {
      const neighbor = index.chunks[position];
      if (!neighbor || Math.abs(neighbor.page - primary.page) > 1 || used + 2 >= budget) continue;
      const isBefore = position < primaryPosition;
      const overlap = isBefore ? overlapLength(neighbor.text, primaryPiece.text) : overlapLength(primaryPiece.text, neighbor.text);
      const available = Math.min(400, budget - used - 2);
      const range = edgeRange(neighbor.text, available + overlap, isBefore ? "tail" : "head");
      if (isBefore) range.end = Math.max(range.start, range.end - overlap);
      else range.start = Math.min(range.end, range.start + overlap);
      const piece = { text: neighbor.text.slice(range.start, range.end), id: neighbor.id, page: neighbor.page,
        originalStart: range.start, originalEnd: range.end };
      if (!piece.text) continue;
      (isBefore ? before : after).push(piece);
      used += piece.text.length + 1;
    }
    const pieces = [...before, primaryPiece, ...after];
    const text = pieces.map((piece) => piece.text).join("\n");
    if (!text || text.length > budget || text.length > MAX_HIT_TEXT) continue;
    /** @type {EvidenceSource[]} */
    const sources = [];
    let offset = 0;
    for (const piece of pieces) {
      sources.push({ id: piece.id, page: piece.page, start: offset, end: offset + piece.text.length });
      offset += piece.text.length + 1;
    }
    results.push({ ...candidate.hit, text, sources, matches: [candidate.query], selectedIds: [primary.id] });
    total += text.length;
  }
  return results;
}
