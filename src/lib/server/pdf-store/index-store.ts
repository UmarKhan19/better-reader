import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";
import type { PdfItem } from "@/types/pdf";
import * as storage from "./storage";
import { serialized, isValidPdfId, isPdfItem, INDEX_FILE, UPLOADS_DIR, ensureDirs } from "./storage";

// Normalize a stored record to canonical cover fields only.
export function normalizeItem(value: unknown): PdfItem | null {
  if (!isPdfItem(value)) return null;
  const v = value as Record<string, unknown>;
  const item: PdfItem = {
    id: v.id as string,
    name: v.name as string,
    size: v.size as number,
    mimeType: v.mimeType as string,
    createdAt: v.createdAt as string,
  };
  if (v.hasCover === true) item.hasCover = true;
  if (typeof v.coverUrl === "string") item.coverUrl = v.coverUrl;
  if (typeof v.coverFileName === "string") item.coverFileName = v.coverFileName;
  if (typeof v.coverVersion === "string") item.coverVersion = v.coverVersion;
  return item;
}

export async function readIndex(): Promise<PdfItem[]> {
  const parsed = await storage.readJson(INDEX_FILE);
  if (!Array.isArray(parsed)) return [];
  const out: PdfItem[] = [];
  for (const entry of parsed) {
    const normalized = normalizeItem(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}

export async function writeIndex(items: PdfItem[]): Promise<void> {
  await storage.writeJson(INDEX_FILE, items);
}

export async function findPdf(id: string): Promise<PdfItem | null> {
  if (!isValidPdfId(id)) return null;
  const items = await readIndex();
  return items.find((item) => item.id === id) ?? null;
}

export function pdfFilePath(id: string): string {
  return path.join(UPLOADS_DIR, `${id}.pdf`);
}

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
      await rm(file, { force: true });
      throw error;
    }
    return item;
  });
}
