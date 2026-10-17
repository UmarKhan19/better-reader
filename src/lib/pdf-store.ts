import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PdfItem } from "@/types/pdf";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const INDEX_FILE = path.join(DATA_DIR, "pdfs.json");
const TRASH_DIR = path.join(DATA_DIR, "trash");
const TRASH_FILE = path.join(DATA_DIR, "trash.json");
// Deleted files stay recoverable for 30 days; older entries are purged on the
// next delete or restore so the trash cannot grow without bound.
const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TrashRecord = { item: PdfItem; deletedAt: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPdfId(id: string): boolean {
  return UUID_RE.test(id);
}

async function ensureDirs(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

async function readIndex(): Promise<PdfItem[]> {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPdfItem);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function isPdfItem(value: unknown): value is PdfItem {
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

async function writeIndex(items: PdfItem[]): Promise<void> {
  await writeFile(INDEX_FILE, JSON.stringify(items, null, 2), "utf8");
}

function isTrashRecord(value: unknown): value is TrashRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isPdfItem(v.item) && typeof v.deletedAt === "string";
}

async function readTrash(): Promise<TrashRecord[]> {
  try {
    const raw = await readFile(TRASH_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrashRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeTrash(records: TrashRecord[]): Promise<void> {
  await writeFile(TRASH_FILE, JSON.stringify(records, null, 2), "utf8");
}

async function purgeExpiredTrash(records: TrashRecord[]): Promise<TrashRecord[]> {
  const cutoff = Date.now() - TRASH_TTL_MS;
  const live = records.filter((record) => {
    const deletedAt = Date.parse(record.deletedAt);
    return !Number.isFinite(deletedAt) || deletedAt >= cutoff;
  });
  const purged = records.filter((record) => !live.includes(record));
  if (purged.length) {
    await Promise.all(purged.map((record) =>
      rm(path.join(TRASH_DIR, `${record.item.id}.pdf`), { force: true })));
  }
  return live;
}

export async function listPdfs(): Promise<PdfItem[]> {
  await ensureDirs();
  const items = await readIndex();
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function savePdf(
  file: File,
): Promise<PdfItem> {
  await ensureDirs();
  const id = randomUUID();
  const item: PdfItem = {
    id,
    name: file.name || `${id}.pdf`,
    size: file.size,
    mimeType: file.type || "application/pdf",
    createdAt: new Date().toISOString(),
  };
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOADS_DIR, `${id}.pdf`), buffer);
  const items = await readIndex();
  items.push(item);
  await writeIndex(items);
  return item;
}

export async function deletePdf(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  await ensureDirs();
  const items = await readIndex();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeIndex(next);
  // Move the file into the trash instead of unlinking it, so the delete can be
  // undone from the library. Only a file that actually moved is restorable.
  let stashed = false;
  try {
    await mkdir(TRASH_DIR, { recursive: true });
    await rename(path.join(UPLOADS_DIR, `${id}.pdf`), path.join(TRASH_DIR, `${id}.pdf`));
    stashed = true;
  } catch (error) {
    // ENOENT: the file was already gone, nothing to keep. Any other failure
    // (e.g. permissions) leaves the bytes on disk rather than destroying them;
    // the entry is only reachable through the index, so the file stays hidden.
    void error;
  }
  if (stashed) {
    const record = (await readTrash()).filter((entry) => entry.item.id !== id);
    record.push({ item: items.find((item) => item.id === id)!, deletedAt: new Date().toISOString() });
    await writeTrash(await purgeExpiredTrash(record));
  }
  return true;
}

export async function restorePdf(id: string): Promise<PdfItem | null> {
  if (!isValidPdfId(id)) return null;
  await ensureDirs();
  const records = await readTrash();
  const record = records.find((entry) => entry.item.id === id);
  if (!record) return null;
  try {
    await rename(path.join(TRASH_DIR, `${id}.pdf`), path.join(UPLOADS_DIR, `${id}.pdf`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // No file to bring back; drop the stale record so it cannot linger.
      await writeTrash(records.filter((entry) => entry.item.id !== id));
      return null;
    }
    throw error;
  }
  const items = await readIndex();
  if (!items.some((item) => item.id === id)) {
    items.push(record.item);
    await writeIndex(items);
  }
  await writeTrash(await purgeExpiredTrash(records.filter((entry) => entry.item.id !== id)));
  return record.item;
}

export function pdfFilePath(id: string): string {
  return path.join(UPLOADS_DIR, `${id}.pdf`);
}

export async function pdfFileExists(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  try {
    await stat(pdfFilePath(id));
    return true;
  } catch {
    return false;
  }
}

export { createReadStream };
