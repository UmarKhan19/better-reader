// @ts-check

/** @typedef {import('./retrieval.mjs').EvidenceHit} EvidenceHit */
/** @typedef {{ pdfFile: string, indexFile: string, tempFile: string, cacheDir: string, bookId: string }} JobFiles */
/** @typedef {JobFiles & ({ kind: 'index' } | { kind: 'search', question: string })} WorkerJob */
/** @typedef {{ type: 'done', kind: 'index', indexed: boolean } | { type: 'done', kind: 'search', hits: EvidenceHit[], queries: string[] }} DoneReply */
/** @typedef {DoneReply | { type: 'progress' } | { type: 'error', error: string }} WorkerReply */

/** @param {unknown} value @returns {value is WorkerJob} */
export function isWorkerJob(value) {
  if (!value || typeof value !== "object") return false;
  const job = /** @type {Record<string, unknown>} */ (value);
  return ["pdfFile", "indexFile", "tempFile", "cacheDir", "bookId"].every((key) => typeof job[key] === "string" && job[key].length > 0)
    && (job.kind === "index" || (job.kind === "search" && typeof job.question === "string"
      && job.question.trim().length > 0 && job.question.length <= 2000));
}

/** @param {unknown} value @param {number} queryCount @returns {value is EvidenceHit} */
function isSearchHit(value, queryCount) {
  if (!value || typeof value !== "object") return false;
  const hit = /** @type {EvidenceHit} */ (value);
  const allowed = new Set(["id", "page", "text", "score", "sources", "matches", "selectedIds"]);
  if (!Object.keys(hit).every((key) => allowed.has(key)) || typeof hit.id !== "string" || !hit.id || hit.id.length > 256
    || !Number.isInteger(hit.page) || hit.page < 1 || typeof hit.text !== "string" || !hit.text || hit.text.length > 2_400
    || typeof hit.score !== "number" || !Number.isFinite(hit.score)
    || !Array.isArray(hit.sources) || !hit.sources.length || hit.sources.length > 3
    || !Array.isArray(hit.matches) || !hit.matches.length || hit.matches.length > queryCount) return false;
  const sources = new Set();
  for (const source of hit.sources) {
    if (!source || typeof source !== "object" || !Object.keys(source).every((key) => ["id", "page", "start", "end"].includes(key))
      || typeof source.id !== "string" || !source.id || source.id.length > 256 || sources.has(source.id)
      || !Number.isInteger(source.page) || source.page < 1
      || !Number.isInteger(source.start) || !Number.isInteger(source.end)
      || source.start < 0 || source.end <= source.start || source.end > hit.text.length) return false;
    sources.add(source.id);
  }
  if (!hit.sources.some((source) => source.id === hit.id && source.page === hit.page)
    || new Set(hit.matches).size !== hit.matches.length
    || !hit.matches.every((query) => Number.isInteger(query) && query >= 0 && query < queryCount)) return false;
  return Array.isArray(hit.selectedIds) && hit.selectedIds.length > 0
    && hit.selectedIds.length <= 3 && new Set(hit.selectedIds).size === hit.selectedIds.length
    && hit.selectedIds.includes(hit.id) && hit.selectedIds.every((id) => sources.has(id));
}

/** @param {unknown} value @returns {value is WorkerReply} */
export function isWorkerReply(value) {
  if (!value || typeof value !== "object") return false;
  const reply = /** @type {Record<string, unknown>} */ (value);
  if (reply.type === "progress") return true;
  if (reply.type === "error") return typeof reply.error === "string";
  if (reply.type !== "done") return false;
  if (reply.kind === "index") return typeof reply.indexed === "boolean";
  if (reply.kind !== "search" || !Array.isArray(reply.queries) || !reply.queries.length || reply.queries.length > 3
    || !reply.queries.every((query) => typeof query === "string" && query.trim() && query.length <= 2000)
    || !Array.isArray(reply.hits) || reply.hits.length > 10) return false;
  const queryCount = reply.queries.length;
  return reply.hits.every((hit) => isSearchHit(hit, queryCount))
    && new Set(reply.hits.map((hit) => hit.id)).size === reply.hits.length
    && reply.hits.reduce((sum, hit) => sum + hit.text.length, 0) <= 16_000;
}
