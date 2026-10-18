import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PdfItem } from "@/types/pdf";

// Resolved at import time. Tests set BETTER_KINDLE_DATA_DIR before importing the
// store; production reads the repository's data folder. Keeping these as module
// constants also lets Turbopack see that every filesystem path is scoped to data/.
if (process.env.NODE_ENV === "test" && !process.env.BETTER_KINDLE_DATA_DIR) {
  // A test run must never touch the real library.
  throw new Error("Tests must set BETTER_KINDLE_DATA_DIR before importing pdf-store");
}
const DATA_DIR = process.env.BETTER_KINDLE_DATA_DIR ?? path.join(process.cwd(), "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const COVERS_DIR = path.join(DATA_DIR, "covers");
export const INDEX_FILE = path.join(DATA_DIR, "pdfs.json");
export const TRASH_DIR = path.join(DATA_DIR, "trash");
// PDFs and cover images live in separate trash directories so one file name can
// never overwrite the other. TRASH_DIR itself keeps pre-upgrade deletions readable.
export const TRASH_PDFS_DIR = path.join(TRASH_DIR, "pdfs");
export const TRASH_COVERS_DIR = path.join(TRASH_DIR, "covers");
export const TRASH_FILE = path.join(DATA_DIR, "trash.json");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidPdfId(id: string): boolean {
  return UUID_RE.test(id);
}

export async function ensureDirs(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(COVERS_DIR, { recursive: true });
  await mkdir(TRASH_PDFS_DIR, { recursive: true });
  await mkdir(TRASH_COVERS_DIR, { recursive: true });
}

let mutations: Promise<unknown> = Promise.resolve();
export function serialized<T>(change: () => Promise<T>): Promise<T> {
  const run = mutations.then(change, change);
  mutations = run.then(() => undefined, () => undefined);
  return run;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export function isPdfItem(value: unknown): value is PdfItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.size === "number" &&
    typeof v.mimeType === "string" &&
    typeof v.createdAt === "string"
  );
}
