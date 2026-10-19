import { rename, rm } from "node:fs/promises";
import path from "node:path";
import type { StoredPdfRecord } from "./record";
import * as storage from "./storage";
import { serialized, fileExists, isValidPdfId, ensureDirs, AI_DIR, COVERS_DIR, TRASH_COVERS_DIR, TRASH_DIR, TRASH_FILE, TRASH_PDFS_DIR, UPLOADS_DIR } from "./storage";
import { normalizeItem, readIndex, writeIndex } from "./index-store";
import { findCoverFileName, invalidateCoverMap } from "./covers";

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TrashRecord = { item: StoredPdfRecord; deletedAt: string };
type StoredTrashRecord = { item: unknown; deletedAt: string };

function isTrashRecord(value: unknown): value is StoredTrashRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.deletedAt === "string" && "item" in v;
}

async function readTrash(): Promise<TrashRecord[]> {
  const parsed = await storage.readJson(TRASH_FILE);
  if (!Array.isArray(parsed)) return [];
  const records: TrashRecord[] = [];
  for (const value of parsed) {
    if (!isTrashRecord(value)) continue;
    const item = normalizeItem(value.item);
    if (item) records.push({ item, deletedAt: value.deletedAt });
  }
  return records;
}

async function writeTrash(records: TrashRecord[]): Promise<void> {
  await storage.writeJson(TRASH_FILE, records);
}

async function findStashedPdf(id: string): Promise<string | null> {
  for (const dir of [TRASH_PDFS_DIR, TRASH_DIR]) {
    const file = path.join(dir, `${id}.pdf`);
    if (await fileExists(file)) return file;
  }
  return null;
}

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
      path.join(/* turbopackIgnore: true */ TRASH_COVERS_DIR, coverName),
      path.join(/* turbopackIgnore: true */ TRASH_DIR, coverName),
      path.join(/* turbopackIgnore: true */ COVERS_DIR, coverName),
    ] : []),
  ];
  for (const target of targets) await rm(target, { force: true });
  if (isValidPdfId(id)) await rm(path.join(AI_DIR, id), { recursive: true, force: true });
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

// Remove any stashed PDF copies for an id.
async function removeStashedPdfs(id: string): Promise<void> {
  for (const dir of [TRASH_PDFS_DIR, TRASH_DIR]) {
    await rm(path.join(dir, `${id}.pdf`), { force: true });
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
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (moved) {
      const coverName = target.coverFileName ?? (await findCoverFileName(COVERS_DIR, id));
      let coverMoved = false;
      if (coverName) {
        try {
          await rename(path.join(/* turbopackIgnore: true */ COVERS_DIR, coverName), path.join(/* turbopackIgnore: true */ TRASH_COVERS_DIR, coverName));
          coverMoved = true;
        } catch {
          // cover already gone or cannot move
        }
      }
      const purged = await purgeExpiredTrash((await readTrash()).filter((entry) => entry.item.id !== id));
      const next = [...purged, { item: target, deletedAt: new Date().toISOString() }];
      try {
        await writeTrash(next);
      } catch (error) {
        if (moved) await unstash(id, coverName, coverMoved);
        throw error;
      }
      try {
        await writeIndex(items.filter((item) => item.id !== id));
      } catch (error) {
        await writeTrash(purged).catch(() => {});
        if (moved) await unstash(id, coverName, coverMoved);
        throw error;
      }
      invalidateCoverMap();
      return true;
    }

    // Upload already missing: no trash record. Write the metadata first so a failed
    // write cannot destroy the only remaining cover bytes of a book still in the index.
    const coverName = target.coverFileName ?? (await findCoverFileName(COVERS_DIR, id));
    const purged = await purgeExpiredTrash((await readTrash()).filter((entry) => entry.item.id !== id));
    await writeTrash(purged);
    await writeIndex(items.filter((item) => item.id !== id));
    if (coverName) {
      await rm(path.join(/* turbopackIgnore: true */ COVERS_DIR, coverName), { force: true });
      await rm(path.join(/* turbopackIgnore: true */ TRASH_COVERS_DIR, coverName), { force: true });
      await rm(path.join(/* turbopackIgnore: true */ TRASH_DIR, coverName), { force: true });
    }
    await removeStashedPdfs(id);
    await rm(path.join(AI_DIR, id), { recursive: true, force: true });
    invalidateCoverMap();
    return true;
  });
}

export async function restorePdf(id: string): Promise<StoredPdfRecord | null> {
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
        await writeTrash(records.filter((entry) => entry.item.id !== id));
        await rm(path.join(AI_DIR, id), { recursive: true, force: true });
        return null;
      }
      await rename(source, upload);
    }
    const coverName = record.item.coverFileName
      ?? (await findCoverFileName(TRASH_COVERS_DIR, id))
      ?? (await findCoverFileName(TRASH_DIR, id));
    if (coverName) {
      const destination = path.join(/* turbopackIgnore: true */ COVERS_DIR, coverName);
      await rename(path.join(/* turbopackIgnore: true */ TRASH_COVERS_DIR, coverName), destination)
        .catch(() => rename(path.join(/* turbopackIgnore: true */ TRASH_DIR, coverName), destination))
        .catch(() => {});
    }
    const items = await readIndex();
    if (!items.some((item) => item.id === id)) {
      items.push(record.item);
      await writeIndex(items);
    }
    await writeTrash(await purgeExpiredTrash(records.filter((entry) => entry.item.id !== id)));
    // Remove any stashed copies left behind (e.g. when the upload already existed).
    await removeStashedPdfs(id);
    invalidateCoverMap();
    return record.item;
  });
}
