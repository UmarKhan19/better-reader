import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";
import type { PdfItem } from "@/types/pdf";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const INDEX_FILE = path.join(DATA_DIR, "pdfs.json");
const TRASH_DIR = path.join(DATA_DIR, "trash");
// PDFs and cover images live in separate trash directories so one file name can
// never overwrite the other. TRASH_DIR itself keeps pre-upgrade deletions readable.
const TRASH_PDFS_DIR = path.join(TRASH_DIR, "pdfs");
const TRASH_COVERS_DIR = path.join(TRASH_DIR, "covers");
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
  await mkdir(TRASH_PDFS_DIR, { recursive: true });
  await mkdir(TRASH_COVERS_DIR, { recursive: true });
}

// Every index or trash change is a read-modify-write of a JSON file. One queue
// per process stops overlapping requests from overwriting each other's changes.
let mutations: Promise<unknown> = Promise.resolve();
function serialized<T>(change: () => Promise<T>): Promise<T> {
  const run = mutations.then(change, change);
  mutations = run.then(() => undefined, () => undefined);
  return run;
}

/** Writes through a temporary file so a failed or interrupted save never truncates the current one. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
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

function isTrashRecord(value: unknown): value is TrashRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isPdfItem(v.item) && typeof v.deletedAt === "string";
}

async function readIndex(): Promise<PdfItem[]> {
  const parsed = await readJson(INDEX_FILE);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isPdfItem);
}

function writeIndex(items: PdfItem[]): Promise<void> {
  return writeJson(INDEX_FILE, items);
}

async function readTrash(): Promise<TrashRecord[]> {
  const parsed = await readJson(TRASH_FILE);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isTrashRecord);
}

function writeTrash(records: TrashRecord[]): Promise<void> {
  return writeJson(TRASH_FILE, records);
}

export async function findPdf(id: string): Promise<PdfItem | null> {
  if (!isValidPdfId(id)) return null;
  const items = await readIndex();
  return items.find((item) => item.id === id) ?? null;
}

const coverUrl = (id: string, version: string) => `/api/pdfs/${id}/cover?v=${encodeURIComponent(version)}`;

function applyCoverMetadata(item: PdfItem, fileName: string, version?: string): PdfItem {
  // A new version on every saved cover changes the URL, so an open page cannot
  // keep showing the replaced image from its cache.
  const current = version ?? item.coverVersion ?? "1";
  const url = coverUrl(item.id, current);
  return {
    ...item,
    hasCover: true,
    cover: url,
    coverImage: url,
    coverUrl: url,
    coverFileName: fileName,
    coverVersion: current,
    coverExt: path.extname(fileName).toLowerCase() || undefined,
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
    coverVersion: undefined,
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

function startsWith(data: Uint8Array, text: string, offset = 0): boolean {
  if (data.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (data[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

const IMAGE_SIGNATURES: { extension: string; matches: (data: Uint8Array) => boolean }[] = [
  { extension: ".png", matches: (data) => data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 },
  { extension: ".jpg", matches: (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { extension: ".gif", matches: (data) => startsWith(data, "GIF87a") || startsWith(data, "GIF89a") },
  { extension: ".webp", matches: (data) => startsWith(data, "RIFF") && startsWith(data, "WEBP", 8) },
  { extension: ".avif", matches: (data) => startsWith(data, "ftyp", 4) && (startsWith(data, "avif", 8) || startsWith(data, "avis", 8)) },
  { extension: ".bmp", matches: (data) => data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d },
];

/** The file name and MIME type come from the uploader; only the bytes decide what this is. */
function imageExtension(data: Uint8Array): string | null {
  return IMAGE_SIGNATURES.find(({ matches }) => matches(data))?.extension ?? null;
}

async function saveCoverToItem(item: PdfItem, data: Uint8Array, extension: string): Promise<PdfItem> {
  const fileName = `${item.id}${extension}`;
  const previous = item.coverFileName ?? (await findCoverFileName(COVERS_DIR, item.id));
  // Write the new image first: a failed write must not leave the old cover deleted.
  await writeFile(path.join(COVERS_DIR, fileName), data);
  if (previous && previous !== fileName) {
    await rm(path.join(COVERS_DIR, previous), { force: true });
  }
  return applyCoverMetadata(item, fileName, randomUUID());
}

export async function listPdfs(): Promise<PdfItem[]> {
  await ensureDirs();
  const items = await readIndex();
  // One directory read for the whole list; the old code scanned covers once per item.
  const coverByOwner = new Map<string, string>();
  try {
    for (const name of await readdir(COVERS_DIR)) {
      const dot = name.indexOf(".");
      if (dot > 0 && !name.toLowerCase().endsWith(".pdf")) coverByOwner.set(name.slice(0, dot), name);
    }
  } catch {
    // A missing covers directory simply means no covers.
  }
  const enriched = items.map((item) => {
    const fileName = coverByOwner.get(item.id);
    if (!fileName) return item.hasCover ? clearCoverMetadata(item) : item;
    return applyCoverMetadata(item, fileName);
  });
  return enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Streams one uploaded PDF to disk and adds it to the index; a failure removes the bytes again. */
export async function savePdf(body: ReadableStream<Uint8Array>, name: string): Promise<PdfItem> {
  await ensureDirs();
  const id = randomUUID();
  const file = path.join(UPLOADS_DIR, `${id}.pdf`);
  try {
    await pipeline(Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>), createWriteStream(file));
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  const item: PdfItem = {
    id,
    name: name || `${id}.pdf`,
    size: (await stat(file)).size,
    mimeType: "application/pdf",
    createdAt: new Date().toISOString(),
  };
  return serialized(async () => {
    const items = await readIndex();
    items.push(item);
    try {
      await writeIndex(items);
    } catch (error) {
      // The index never learned about this file, so the bytes must not stay.
      await rm(file, { force: true });
      throw error;
    }
    return item;
  });
}

export type CoverSaveResult =
  | { ok: true; item: PdfItem }
  | { ok: false; reason: "missing" | "unsupported" };

export async function saveCover(id: string, file: File): Promise<CoverSaveResult> {
  if (!isValidPdfId(id) || !(file instanceof File)) return { ok: false, reason: "missing" };
  const data = new Uint8Array(await file.arrayBuffer());
  const extension = imageExtension(data);
  if (!extension) return { ok: false, reason: "unsupported" };
  await ensureDirs();
  return serialized(async () => {
    const items = await readIndex();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, reason: "missing" };
    const updated = await saveCoverToItem(items[index], data, extension);
    items[index] = updated;
    await writeIndex(items);
    return { ok: true, item: updated };
  });
}

export async function deleteCover(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  await ensureDirs();
  return serialized(async () => {
    const items = await readIndex();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    const item = items[index];
    const fileName = item.coverFileName ?? (await findCoverFileName(COVERS_DIR, id));
    if (fileName) {
      await rm(path.join(COVERS_DIR, fileName), { force: true });
    }
    items[index] = clearCoverMetadata(item);
    await writeIndex(items);
    return true;
  });
}

export async function resolveCoverFilePath(id: string): Promise<string | null> {
  await ensureDirs();
  const item = await findPdf(id);
  const fromMeta = item?.coverFileName ? path.join(COVERS_DIR, item.coverFileName) : null;
  if (fromMeta && await fileExists(fromMeta)) return fromMeta;
  const found = await findCoverFileName(COVERS_DIR, id);
  return found ? path.join(COVERS_DIR, found) : null;
}

async function findStashedPdf(id: string): Promise<string | null> {
  for (const dir of [TRASH_PDFS_DIR, TRASH_DIR]) {
    const file = path.join(dir, `${id}.pdf`);
    if (await fileExists(file)) return file;
  }
  return null;
}

/** Removes every byte a trash record owns, in the current and the pre-upgrade layout. */
async function removeTrashedFiles(record: TrashRecord): Promise<void> {
  const id = record.item.id;
  const coverName = record.item.coverFileName
    ?? (await findCoverFileName(TRASH_COVERS_DIR, id))
    ?? (await findCoverFileName(TRASH_DIR, id))
    ?? (await findCoverFileName(COVERS_DIR, id));
  const targets = [
    path.join(TRASH_PDFS_DIR, `${id}.pdf`),
    path.join(TRASH_DIR, `${id}.pdf`),
    ...(coverName ? [
      path.join(TRASH_COVERS_DIR, coverName),
      path.join(TRASH_DIR, coverName),
      path.join(COVERS_DIR, coverName),
    ] : []),
  ];
  for (const target of targets) await rm(target, { force: true });
}

async function purgeExpiredTrash(records: TrashRecord[]): Promise<TrashRecord[]> {
  const cutoff = Date.now() - TRASH_TTL_MS;
  const live: TrashRecord[] = [];
  for (const record of records) {
    const deletedAt = Date.parse(record.deletedAt);
    if (Number.isFinite(deletedAt) && deletedAt < cutoff) await removeTrashedFiles(record);
    else live.push(record);
  }
  return live;
}

async function unstash(id: string, coverName: string | null, coverMoved: boolean): Promise<void> {
  await rename(path.join(TRASH_PDFS_DIR, `${id}.pdf`), path.join(UPLOADS_DIR, `${id}.pdf`)).catch(() => {});
  if (coverMoved && coverName) {
    await rename(path.join(TRASH_COVERS_DIR, coverName), path.join(COVERS_DIR, coverName)).catch(() => {});
  }
}

export async function deletePdf(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  await ensureDirs();
  return serialized(async () => {
    const items = await readIndex();
    const target = items.find((item) => item.id === id);
    if (!target) return false;
    const upload = path.join(UPLOADS_DIR, `${id}.pdf`);
    const stashed = path.join(TRASH_PDFS_DIR, `${id}.pdf`);
    let moved = false;
    try {
      await rename(upload, stashed);
      moved = true;
    } catch (error) {
      // ENOENT: the bytes were already gone, so there is nothing to restore.
      // Anything else leaves the book in place and reports the failure.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Only a book whose bytes actually reached the trash can be restored, so only
    // then does its cover move with it. A book that was already gone keeps its
    // cover in place; moving it would leave the image stranded with no trash record.
    const coverName = moved
      ? target.coverFileName ?? (await findCoverFileName(COVERS_DIR, id))
      : null;
    let coverMoved = false;
    if (coverName) {
      try {
        await rename(path.join(COVERS_DIR, coverName), path.join(TRASH_COVERS_DIR, coverName));
        coverMoved = true;
      } catch {
        // The cover file is already gone or cannot move; the book is what matters.
      }
    }
    const purged = await purgeExpiredTrash((await readTrash()).filter((entry) => entry.item.id !== id));
    const next = moved ? [...purged, { item: target, deletedAt: new Date().toISOString() }] : purged;
    try {
      await writeTrash(next);
    } catch (error) {
      if (moved) await unstash(id, coverName, coverMoved);
      throw error;
    }
    try {
      await writeIndex(items.filter((item) => item.id !== id));
    } catch (error) {
      // Put the bytes back and drop the recovery record, so the book stays whole.
      await writeTrash(purged).catch(() => {});
      if (moved) await unstash(id, coverName, coverMoved);
      throw error;
    }
    return true;
  });
}

export async function restorePdf(id: string): Promise<PdfItem | null> {
  if (!isValidPdfId(id)) return null;
  await ensureDirs();
  return serialized(async () => {
    const records = await readTrash();
    const record = records.find((entry) => entry.item.id === id);
    if (!record) return null;
    const upload = path.join(UPLOADS_DIR, `${id}.pdf`);
    if (!await fileExists(upload)) {
      const source = await findStashedPdf(id);
      if (!source) {
        // No bytes to bring back; drop the stale record so it cannot linger.
        await writeTrash(records.filter((entry) => entry.item.id !== id));
        return null;
      }
      await rename(source, upload);
    }
    const coverName = record.item.coverFileName
      ?? (await findCoverFileName(TRASH_COVERS_DIR, id))
      ?? (await findCoverFileName(TRASH_DIR, id));
    if (coverName) {
      const destination = path.join(COVERS_DIR, coverName);
      await rename(path.join(TRASH_COVERS_DIR, coverName), destination)
        .catch(() => rename(path.join(TRASH_DIR, coverName), destination))
        .catch(() => {});
    }
    const items = await readIndex();
    if (!items.some((item) => item.id === id)) {
      items.push(record.item);
      await writeIndex(items);
    }
    await writeTrash(await purgeExpiredTrash(records.filter((entry) => entry.item.id !== id)));
    return record.item;
  });
}

export function pdfFilePath(id: string): string {
  return path.join(UPLOADS_DIR, `${id}.pdf`);
}
