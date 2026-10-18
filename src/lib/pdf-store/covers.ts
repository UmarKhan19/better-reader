import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PdfItem } from "@/types/pdf";
import { COVERS_DIR, ensureDirs, fileExists, isValidPdfId, serialized } from "./storage";
import { readIndex, writeIndex } from "./index-store";

export const COVER_MAX_BYTES = 10 * 1024 * 1024;

// In-memory id -> cover file name map, built from a single readdir(COVERS_DIR).
// Invalidated on every cover/trash write.
let coverMap: Map<string, string> | null = null;

export function invalidateCoverMap(): void {
  coverMap = null;
}

export async function getCoverMap(): Promise<Map<string, string>> {
  if (coverMap) return coverMap;
  const map = new Map<string, string>();
  try {
    for (const name of await readdir(COVERS_DIR)) {
      const dot = name.indexOf(".");
      if (dot > 0 && !name.toLowerCase().endsWith(".pdf")) map.set(name.slice(0, dot), name);
    }
  } catch {
    // missing covers dir => no covers
  }
  coverMap = map;
  return map;
}

const coverUrl = (id: string, version: string) => `/api/pdfs/${id}/cover?v=${encodeURIComponent(version)}`;

export function applyCoverMetadata(item: PdfItem, fileName: string, version?: string): PdfItem {
  const current = version ?? item.coverVersion ?? "1";
  const url = coverUrl(item.id, current);
  return {
    ...item,
    hasCover: true,
    coverUrl: url,
    coverFileName: fileName,
    coverVersion: current,
  };
}

export function clearCoverMetadata(item: PdfItem): PdfItem {
  return {
    ...item,
    hasCover: false,
    coverUrl: undefined,
    coverFileName: undefined,
    coverVersion: undefined,
  };
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

export function imageExtension(data: Uint8Array): string | null {
  return IMAGE_SIGNATURES.find(({ matches }) => matches(data))?.extension ?? null;
}

async function findCoverFileName(dir: string, id: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    return entries.find((name) => name.startsWith(`${id}.`) && !name.toLowerCase().endsWith(".pdf")) ?? null;
  } catch {
    return null;
  }
}

export type CoverSaveResult =
  | { ok: true; item: PdfItem }
  | { ok: false; reason: "missing" | "unsupported" | "too-large" };

export async function saveCoverToItem(item: PdfItem, data: Uint8Array, extension: string): Promise<PdfItem> {
  const fileName = `${item.id}${extension}`;
  const previous = item.coverFileName ?? (await findCoverFileName(COVERS_DIR, item.id));
  await writeFile(path.join(COVERS_DIR, fileName), data);
  if (previous && previous !== fileName) {
    await rm(path.join(/* turbopackIgnore: true */ COVERS_DIR, previous), { force: true });
  }
  return applyCoverMetadata(item, fileName, randomUUID());
}

export async function saveCover(id: string, file: File): Promise<CoverSaveResult> {
  if (!isValidPdfId(id) || !(file instanceof File)) return { ok: false, reason: "missing" };
  if (file.size > COVER_MAX_BYTES) return { ok: false, reason: "too-large" };
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
    invalidateCoverMap();
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
      await rm(path.join(/* turbopackIgnore: true */ COVERS_DIR, fileName), { force: true });
    }
    items[index] = clearCoverMetadata(item);
    await writeIndex(items);
    invalidateCoverMap();
    return true;
  });
}

export async function resolveCoverFilePath(id: string): Promise<string | null> {
  if (!isValidPdfId(id)) return null;
  await ensureDirs();
  const map = await getCoverMap();
  let fileName = map.get(id) ?? null;
  if (fileName) {
    const full = path.join(/* turbopackIgnore: true */ COVERS_DIR, fileName);
    if (await fileExists(full)) return full;
    map.delete(id);
    fileName = null;
  }
  // Fallback scan once if map missed (e.g. file added outside process).
  const found = await findCoverFileName(COVERS_DIR, id);
  if (found) {
    map.set(id, found);
    return path.join(/* turbopackIgnore: true */ COVERS_DIR, found);
  }
  return null;
}