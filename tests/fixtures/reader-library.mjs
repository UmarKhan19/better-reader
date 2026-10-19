import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EMBEDDING_MODEL, INDEX_VERSION } from "../../src/lib/server/book-index/core.mjs";
import { pdfFixture } from "./pdf.mjs";

/** Owns all bytes it creates. The prebuilt empty test index keeps smoke tests offline. */
export async function createReaderLibrary() {
  const directory = await mkdtemp(path.join(tmpdir(), "better-reader-smoke-"));
  const id = randomUUID();
  const bytes = Buffer.from(pdfFixture({ pages: 40, width: 600, height: 800, readingText: true }));
  const pdfFile = path.join(directory, "uploads", `${id}.pdf`);
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await mkdir(path.dirname(pdfFile), { recursive: true });
    await mkdir(path.join(directory, "ai", id), { recursive: true });
    await Promise.all([
      writeFile(pdfFile, bytes),
      writeFile(path.join(directory, "pdfs.json"), JSON.stringify([
        { id, name: "Reader fixture.pdf", size: bytes.length, mimeType: "application/pdf", createdAt: "2026-01-01T00:00:00Z" },
      ])),
      writeFile(path.join(directory, "ai", id, "index.json"), JSON.stringify({ bookId: id, version: INDEX_VERSION, embeddingModel: EMBEDDING_MODEL, chunks: [] })),
    ]);
    return { directory, id, bytes, pdfFile, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
