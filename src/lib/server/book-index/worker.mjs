// @ts-check

import { access, readFile, writeFile } from "node:fs/promises";
import { constants, setPriority } from "node:os";
import { getDocumentProxy } from "unpdf";
import { chunkPage, EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL, EMBEDDING_REVISION, INDEX_VERSION, isEmbedding, MODEL_MAX_TOKENS, QUERY_PREFIX } from "./core.mjs";
import { BookIndexCache } from "./index-cache.mjs";
import { isWorkerJob } from "./protocol.mjs";
import { planQueries, retrieveEvidence } from "./retrieval.mjs";

/** @typedef {import('./protocol.mjs').WorkerJob} WorkerJob */
/** @param {import('./protocol.mjs').WorkerReply} reply */
function send(reply) { process.send?.(reply); }

// Native inference and PDF parsing stay outside Next's process, at low CPU priority.
try { setPriority(0, constants.priority.PRIORITY_LOW); } catch { /* Not available on every host. */ }
process.on("disconnect", () => process.exit(0));

/** @type {import('@huggingface/transformers').FeatureExtractionPipeline | undefined} */
let extractor;
const indexes = new BookIndexCache();
/** @param {string} cacheDir */
async function getExtractor(cacheDir) {
  if (!extractor) {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = cacheDir;
    env.allowLocalModels = false;
    extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, {
      revision: EMBEDDING_REVISION, device: "cpu", dtype: "q8",
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    });
    extractor.tokenizer.config.model_max_length = MODEL_MAX_TOKENS;
  }
  return extractor;
}

/** @param {WorkerJob & { kind: 'index' }} job */
async function indexBook(job) {
  if (await indexes.read(job.indexFile, job.bookId)) return { indexed: false };
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(job.pdfFile)), {
    maxImageSize: 16_777_216, verbosity: 0,
  });
  const chunks = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      await access(job.pdfFile);
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items.filter((item) => "str" in item)
          .map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
        if (!text.trim()) continue;
        const model = await getExtractor(job.cacheDir);
        const passages = chunkPage(text, pageNumber, (passage) => model.tokenizer.encode(passage).length);
        for (let start = 0; start < passages.length; start += EMBEDDING_BATCH_SIZE) {
          await access(job.pdfFile);
          const batch = passages.slice(start, start + EMBEDDING_BATCH_SIZE);
          const output = await model(batch.map((chunk) => chunk.text), { pooling: "cls", normalize: true });
          const embeddings = output.tolist();
          for (let i = 0; i < batch.length; i++) {
            if (!isEmbedding(embeddings[i])) throw new Error("Invalid model embedding");
            chunks.push({ ...batch[i], embedding: embeddings[i] });
          }
          send({ type: "progress" });
        }
      } finally {
        page.cleanup();
      }
      send({ type: "progress" });
    }
    const index = { bookId: job.bookId, version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL, chunks };
    await writeFile(job.tempFile, JSON.stringify(index), "utf8");
    return { indexed: true };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** @param {WorkerJob & { kind: 'search' }} job */
async function searchBook(job) {
  const index = await indexes.read(job.indexFile, job.bookId);
  if (!index) throw new Error("Book index is not ready");
  const planned = planQueries(job.question);
  if (!index.chunks.length) return { hits: [], queries: planned };
  const model = await getExtractor(job.cacheDir);
  const queries = [], embeddings = [];
  for (const question of planned) {
    const input = QUERY_PREFIX + question;
    if (model.tokenizer.encode(input).length > MODEL_MAX_TOKENS) {
      if (!queries.length) throw new Error(`Question exceeds ${MODEL_MAX_TOKENS} tokens including its instruction`);
      continue;
    }
    const output = await model(input, { pooling: "cls", normalize: true });
    const embedding = output.tolist()[0];
    if (!isEmbedding(embedding)) throw new Error("Invalid query embedding");
    queries.push(question);
    embeddings.push(embedding);
  }
  return { hits: retrieveEvidence(index, queries, embeddings), queries };
}

process.on("message", async (job) => {
  try {
    if (!isWorkerJob(job)) throw new Error("Invalid book indexing worker job");
    if (job.kind === "index") send({ type: "done", kind: "index", ...await indexBook(job) });
    else send({ type: "done", kind: "search", ...await searchBook(job) });
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
});
