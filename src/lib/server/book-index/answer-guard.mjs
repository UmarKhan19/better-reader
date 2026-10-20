// @ts-check

import { isWorkerReply } from "./protocol.mjs";

/** @typedef {import('./retrieval.mjs').EvidenceHit} EvidenceHit */
/** @typedef {{ passageId: string, sourceId: string, page: number, start: number, end: number, quote: string }} GuardCitation */
/** @typedef {{ query: number, question: string, status: 'uncited' | 'unverified' | 'invalid', citations: GuardCitation[] }} GuardPart */
/** @typedef {{ answer: null, status: 'abstained', reason: 'invalid_draft' | 'insufficient_evidence' | 'semantic_verification_unavailable', parts: GuardPart[] }} GuardResult */
/** @typedef {{ bookId: string, question: string, queries: string[], hits: EvidenceHit[] }} EvidenceEnvelope */

const MAX_QUERIES = 3;
const MAX_CLAIMS = 10;
const MAX_CITATIONS = 3;
const MAX_QUOTE_TEXT = 8_000;
const MAX_QUOTE_LENGTH = 2_400;
const MAX_CLAIM_TEXT = 2_000;

/**
 * Citation integrity proves only that a bounded quote belongs to the cited retrieved source.
 * It does not establish that the source entails the claim. With no semantic verifier, every
 * result abstains and no draft claim text is returned.
 * @param {unknown} evidence
 * @param {unknown} draft
 * @returns {GuardResult}
 */
export function guardBookAnswer(evidence, draft) {
  const envelope = validEvidence(evidence);
  if (!envelope) return { answer: null, status: "abstained", reason: "insufficient_evidence", parts: [] };

  const queries = envelope.queries.length > 1
    ? envelope.queries.slice(1).map((question, index) => ({ question, query: index + 1 }))
    : [{ question: envelope.queries[0], query: 0 }];
  /** @type {GuardPart[]} */
  const outputParts = queries.map(({ question, query }) => ({ query, question, status: "uncited", citations: [] }));
  /** @returns {GuardResult} */
  const fail = () => ({ answer: null, status: "abstained", reason: "invalid_draft",
    parts: outputParts.map((part) => ({ ...part, status: "invalid" })) });

  if (!record(draft) || Object.keys(draft).some((key) => !["bookId", "question", "parts"].includes(key))
    || draft.bookId !== envelope.bookId || draft.question !== envelope.question || !Array.isArray(draft.parts)
    || draft.parts.length > MAX_QUERIES) return fail();

  const partQueries = new Set();
  let claimCount = 0;
  let quoteChars = 0;
  for (const part of draft.parts) {
    if (!record(part) || Object.keys(part).some((key) => !["query", "claims"].includes(key))
      || !integer(part.query) || !queries.some((item) => item.query === part.query)
      || partQueries.has(part.query) || !Array.isArray(part.claims)) return fail();
    partQueries.add(part.query);
    claimCount += part.claims.length;
    if (claimCount > MAX_CLAIMS) return fail();
    const output = outputParts.find((item) => item.query === part.query);
    if (!output) return fail();
    for (const claim of part.claims) {
      if (!record(claim) || Object.keys(claim).some((key) => !["text", "citations"].includes(key))
        || !boundedString(claim.text, 1, MAX_CLAIM_TEXT) || !Array.isArray(claim.citations)
        || claim.citations.length > MAX_CITATIONS) return fail();
      if (!claim.citations.length) continue;
      output.status = "unverified";
      for (const citation of claim.citations) {
        const validated = validateCitation(citation, envelope.hits);
        if (!validated) {
          output.status = "invalid";
          return fail();
        }
        quoteChars += validated.quote.length;
        if (quoteChars > MAX_QUOTE_TEXT) return fail();
        if (output.citations.some((item) => sameCitation(item, validated))) {
          output.status = "invalid";
          return fail();
        }
        output.citations.push(validated);
      }
    }
  }
  for (let i = 0; i < queries.length; i++) {
    if (!partQueries.has(queries[i].query)) outputParts[i].status = "uncited";
  }
  return {
    answer: null,
    status: "abstained",
    reason: envelope.hits.length ? "semantic_verification_unavailable" : "insufficient_evidence",
    parts: outputParts,
  };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** @param {unknown} value @param {number} min @param {number} max @returns {value is string} */
function boundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

/** @param {unknown} value @returns {value is number} */
function integer(value) {
  return typeof value === "number" && Number.isInteger(value);
}

/** @param {unknown} value @returns {EvidenceEnvelope | null} */
function validEvidence(value) {
  if (!record(value) || !boundedString(value.bookId, 1, 200) || !boundedString(value.question, 1, 2000)
    || !Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > MAX_QUERIES
    || !Array.isArray(value.hits)) return null;
  const reply = { type: "done", kind: "search", queries: value.queries, hits: value.hits };
  if (!isWorkerReply(reply) || reply.type !== "done" || reply.kind !== "search"
    || reply.queries[0] !== value.question) return null;
  return { bookId: value.bookId, question: value.question, queries: reply.queries, hits: reply.hits };
}

/** @param {unknown} value @param {EvidenceHit[]} hits @returns {GuardCitation | null} */
function validateCitation(value, hits) {
  if (!record(value) || Object.keys(value).some((key) => !["passageId", "sourceId", "page", "start", "end", "quote"].includes(key))
    || !boundedString(value.passageId, 1, 200) || !boundedString(value.sourceId, 1, 200)
    || !integer(value.page) || !integer(value.start) || !integer(value.end)
    || value.start < 0 || value.end <= value.start || !boundedString(value.quote, 1, MAX_QUOTE_LENGTH)) return null;
  const { passageId, sourceId, page, start, end, quote } = value;
  for (const hit of hits) {
    if (hit.id !== passageId || end > hit.text.length || hit.text.slice(start, end) !== quote) continue;
    const source = hit.sources.find((item) => item.id === sourceId && item.page === page
      && start >= item.start && end <= item.end);
    if (source) return {
      passageId, sourceId, page, start, end, quote,
    };
  }
  return null;
}

/** @param {GuardCitation} a @param {GuardCitation} b */
function sameCitation(a, b) {
  return a.passageId === b.passageId && a.sourceId === b.sourceId && a.page === b.page
    && a.start === b.start && a.end === b.end;
}
