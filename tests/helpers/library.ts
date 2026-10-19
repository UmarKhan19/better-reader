import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.NODE_ENV !== "test") throw new Error("The disposable library helper is only for tests");
const configuredDataDir = process.env.BETTER_READER_DATA_DIR;
if (!configuredDataDir) throw new Error("Tests must run through bun test so tests/preload.ts configures the store");
export const dataDir: string = configuredDataDir;
assert.notEqual(path.resolve(dataDir), path.resolve("data"));
export const store = await import("../../src/lib/server/pdf-store");
export const ai = await import("../../src/lib/server/book-index");
const { invalidateCoverMap } = await import("../../src/lib/server/pdf-store/covers");

/** Call from beforeEach. The filesystem-backed suites run serially against this owned directory. */
export async function resetLibrary() {
  process.env.BETTER_READER_DATA_DIR = dataDir;
  await chmod(dataDir, 0o755).catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "pdfs.json"), "[]");
  await writeFile(path.join(dataDir, "trash.json"), "[]");
  invalidateCoverMap();
}

export async function cleanupLibrary() {
  await chmod(dataDir, 0o755).catch(() => {});
}

let serial = 0;
export function pdfUpload(bytes = "%PDF-1.4\n%%EOF", name = `book-${++serial}.pdf`): [ReadableStream<Uint8Array>, string] {
  return [new Blob([bytes]).stream(), name];
}
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=", "base64");
