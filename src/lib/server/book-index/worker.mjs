// @ts-check

import { access, readFile, writeFile } from "node:fs/promises";
import { constants, setPriority } from "node:os";
import { getDocumentProxy } from "unpdf";
import { chunkPage, EMBEDDING_MODEL, INDEX_VERSION, isBookIndex, isEmbedding, MAX_TOKENS, rankChunks } from "./core.mjs";
import { isWorkerJob } from "./protocol.mjs";

/** @typedef {import('./protocol.mjs').WorkerJob} WorkerJob */
/** @param {import('./protocol.mjs').WorkerReply} reply */
function send(reply) { process.send?.(reply); }

// Native inference and PDF parsing stay outside Next's process, at low CPU priority.
try { setPriority(0, constants.priority.PRIORITY_LOW); } catch { /* Not available on every host. */ }
process.on("disconnect", () => process.exit(0));

/** @type {import('@huggingface/transformers').FeatureExtractionPipeline | undefined} */
let extractor;
/** @param {string} cacheDir */
async function getExtractor(cacheDir) {
  if (!extractor) {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = cacheDir;
    env.allowLocalModels = false;
    extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, {
      device: "cpu", dtype: "q8",
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    });
    // The exported tokenizer defaults to 512, but this sentence model was trained at 256.
    extractor.tokenizer.config.model_max_length = MAX_TOKENS;
  }
  return extractor;
}

/** @param {string} file @param {string} bookId */
async function readIndex(file, bookId) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return isBookIndex(value, bookId) ? value : null;
  } catch (error) {
    if ((error instanceof Error && "code" in error && error.code === "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** @param {WorkerJob & { kind: 'index' }} job */
async function indexBook(job) {
  if (await readIndex(job.indexFile, job.bookId)) return { indexed: false };
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
        for (let start = 0; start < passages.length; start += 4) {
          await access(job.pdfFile);
          const batch = passages.slice(start, start + 4);
          const output = await model(batch.map((chunk) => chunk.text), { pooling: "mean", normalize: true });
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
  const index = await readIndex(job.indexFile, job.bookId);
  if (!index) throw new Error("Book index is not ready");
  if (!index.chunks.length) return { hits: [] };
  const model = await getExtractor(job.cacheDir);
  if (model.tokenizer.encode(job.question).length > MAX_TOKENS) throw new Error("Question exceeds 256 tokens");
  const output = await model(job.question, { pooling: "mean", normalize: true });
  return { hits: rankChunks(index, job.question, output.tolist()[0]) };
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
