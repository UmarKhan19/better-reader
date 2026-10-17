import { createReadStream, readdirSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PdfItem } from "@/types/pdf";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const COVERS_DIR = path.join(DATA_DIR, "covers");
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
  await mkdir(COVERS_DIR, { recursive: true });
  await mkdir(TRASH_DIR, { recursive: true });
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

const COVER_URL = (id: string) => `/api/pdfs/${id}/cover`;

function applyCoverMetadata(item: PdfItem, fileName: string, mimeType?: string): PdfItem {
  const url = COVER_URL(item.id);
  return {
    ...item,
    hasCover: true,
    cover: url,
    coverImage: url,
    coverUrl: url,
    coverFileName: fileName,
    coverMimeType: mimeType || item.coverMimeType,
    coverExt: path.extname(fileName).toLowerCase() || item.coverExt,
    thumbnail: url,
    thumbnailUrl: url,
  };
}

function clearCoverMetadata(item: PdfItem): PdfItem {
  return {
    ...item,
    hasCover: false,
    cover: undefined,
    coverImage: undefined,
    coverUrl: undefined,
    coverFileName: undefined,
    coverMimeType: undefined,
    coverExt: undefined,
    thumbnail: undefined,
    thumbnailUrl: undefined,
  };
}

async function findCoverFileName(dir: string, id: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    return entries.find((name) => name.startsWith(`${id}.`) && !name.toLowerCase().endsWith(".pdf")) ?? null;
  } catch {
    return null;
  }
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
    await Promise.all(purged.map(async (record) => {
      await rm(path.join(TRASH_DIR, `${record.item.id}.pdf`), { force: true });
      const coverName = record.item.coverFileName || (await findCoverFileName(TRASH_DIR, record.item.id));
      if (coverName) await rm(path.join(TRASH_DIR, coverName), { force: true });
    }));
  }
  return live;
}

export async function listPdfs(): Promise<PdfItem[]> {
  await ensureDirs();
  const items = await readIndex();
  const enriched = await Promise.all(items.map(async (item) => {
    if (item.hasCover && item.coverFileName) return item;
    const fileName = await findCoverFileName(COVERS_DIR, item.id);
    if (!fileName) return item.hasCover ? clearCoverMetadata(item) : item;
    return applyCoverMetadata(item, fileName, item.coverMimeType);
  }));
  return enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function savePdf(
  file: File,
  cover?: File | null,
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
  let savedItem = item;
  if (cover) {
    savedItem = await saveCoverToItem(item, cover);
  }
  items.push(savedItem);
  await writeIndex(items);
  return savedItem;
}

async function saveCoverToItem(item: PdfItem, file: File): Promise<PdfItem> {
  await ensureDirs();
  const ext = safeImageExtension(file);
  const fileName = `${item.id}${ext}`;
  const previous = await findCoverFileName(COVERS_DIR, item.id);
  if (previous && previous !== fileName) {
    await rm(path.join(COVERS_DIR, previous), { force: true });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(COVERS_DIR, fileName), buffer);
  return applyCoverMetadata(item, fileName, file.type || undefined);
}

function safeImageExtension(file: File): string {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (fromName && /^\.[a-z0-9]+$/.test(fromName)) return fromName;
  const type = (file.type || "").toLowerCase();
  if (type === "image/png") return ".png";
  if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "image/avif") return ".avif";
  if (type === "image/svg+xml") return ".svg";
  return ".png";
}

export async function saveCover(a: unknown, b: unknown): Promise<PdfItem | null> {
  const id = (a instanceof File ? b : a) as string;
  const file = (a instanceof File ? a : b) as File;
  if (!isValidPdfId(id) || !(file instanceof File)) return null;
  await ensureDirs();
  const items = await readIndex();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const updated = await saveCoverToItem(items[index], file);
  items[index] = updated;
  await writeIndex(items);
  return updated;
}

export async function deleteCover(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  await ensureDirs();
  const items = await readIndex();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  const item = items[index];
  const fileName = item.coverFileName || (await findCoverFileName(COVERS_DIR, id));
  if (fileName) {
    await rm(path.join(COVERS_DIR, fileName), { force: true });
  }
  items[index] = clearCoverMetadata(item);
  await writeIndex(items);
  return true;
}

export function coverFilePath(a: unknown, b?: PdfItem | null): string {
  let id: string;
  let item: PdfItem | null | undefined = b;
  if (a && typeof a === "object" && "id" in (a as Record<string, unknown>)) {
    item = a as PdfItem;
    id = (a as PdfItem).id;
  } else {
    id = a as string;
  }
  const fileName = item?.coverFileName;
  if (fileName) return path.join(COVERS_DIR, fileName);
  try {
    const found = readdirSync(COVERS_DIR).find((name) => name.startsWith(`${id}.`) && !name.toLowerCase().endsWith(".pdf"));
    if (found) return path.join(COVERS_DIR, found);
  } catch {
    // ignore
  }
  return path.join(COVERS_DIR, `${id}.png`);
}

export const coverPath = coverFilePath;
export function getCoverPath(id: string, item?: PdfItem | null): string {
  return coverFilePath(id, item);
}

export async function resolveCoverFilePath(id: string): Promise<string | null> {
  await ensureDirs();
  const items = await readIndex();
  const item = items.find((entry) => entry.id === id);
  const fromMeta = item?.coverFileName ? path.join(COVERS_DIR, item.coverFileName) : null;
  if (fromMeta) {
    try { await stat(fromMeta); return fromMeta; } catch { /* fall through */ }
  }
  const found = await findCoverFileName(COVERS_DIR, id);
  return found ? path.join(COVERS_DIR, found) : null;
}

export async function coverFileExists(id: string): Promise<boolean> {
  return (await resolveCoverFilePath(id)) !== null;
}

export async function deletePdf(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  await ensureDirs();
  const items = await readIndex();
  const target = items.find((item) => item.id === id);
  if (!target) return false;
  const next = items.filter((item) => item.id !== id);
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
  // Move any cover image into the trash too, so restore brings it back.
  const coverName = target.coverFileName || (await findCoverFileName(COVERS_DIR, id));
  if (stashed && coverName) {
    try {
      await rename(path.join(COVERS_DIR, coverName), path.join(TRASH_DIR, coverName));
    } catch (error) {
      void error;
    }
  }
  if (stashed) {
    const record = (await readTrash()).filter((entry) => entry.item.id !== id);
    record.push({ item: target, deletedAt: new Date().toISOString() });
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
  // Restore cover image if it was trashed alongside the PDF.
  const coverName = record.item.coverFileName || (await findCoverFileName(TRASH_DIR, id));
  if (coverName) {
    try {
      await rename(path.join(TRASH_DIR, coverName), path.join(COVERS_DIR, coverName));
    } catch (error) {
      void error;
    }
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
