// @ts-check

/** @typedef {import('./core.mjs').SearchHit} SearchHit */
/** @typedef {{ pdfFile: string, indexFile: string, tempFile: string, cacheDir: string, bookId: string }} JobFiles */
/** @typedef {JobFiles & ({ kind: 'index' } | { kind: 'search', question: string })} WorkerJob */
/** @typedef {{ type: 'done', kind: 'index', indexed: boolean } | { type: 'done', kind: 'search', hits: SearchHit[] }} DoneReply */
/** @typedef {DoneReply | { type: 'progress' } | { type: 'error', error: string }} WorkerReply */

/** @param {unknown} value @returns {value is WorkerJob} */
export function isWorkerJob(value) {
  if (!value || typeof value !== "object") return false;
  const job = /** @type {Record<string, unknown>} */ (value);
  return ["pdfFile", "indexFile", "tempFile", "cacheDir", "bookId"].every((key) => typeof job[key] === "string" && job[key].length > 0)
    && (job.kind === "index" || (job.kind === "search" && typeof job.question === "string"
      && job.question.trim().length > 0 && job.question.length <= 2000));
}

/** @param {unknown} value @returns {value is SearchHit} */
function isSearchHit(value) {
  if (!value || typeof value !== "object") return false;
  const hit = /** @type {Record<string, unknown>} */ (value);
  return typeof hit.id === "string" && typeof hit.page === "number" && Number.isInteger(hit.page) && hit.page >= 1
    && typeof hit.text === "string" && typeof hit.score === "number" && Number.isFinite(hit.score);
}

/** @param {unknown} value @returns {value is WorkerReply} */
export function isWorkerReply(value) {
  if (!value || typeof value !== "object") return false;
  const reply = /** @type {Record<string, unknown>} */ (value);
  if (reply.type === "progress") return true;
  if (reply.type === "error") return typeof reply.error === "string";
  return reply.type === "done" && (reply.kind === "index" ? typeof reply.indexed === "boolean"
    : reply.kind === "search" && Array.isArray(reply.hits) && reply.hits.length <= 10 && reply.hits.every(isSearchHit));
}
