import path from "node:path";
import type { StoredPdfRecord } from "./record";
import { COVERS_DIR, ensureDirs, fileExists } from "./storage";
import { readIndex } from "./index-store";
import { applyCoverMetadata, clearCoverMetadata, getCoverMap } from "./covers";

/** Cover enrichment sits above the raw index so cover mutations never form an import cycle. */
export async function listPdfs(): Promise<StoredPdfRecord[]> {
  await ensureDirs();
  const items = await readIndex();
  const coverByOwner = await getCoverMap();
  const enriched = items.map((item) => {
    const fileName = coverByOwner.get(item.id);
    if (fileName) return applyCoverMetadata(item, fileName, item.coverVersion);
    if (item.hasCover) return clearCoverMetadata(item);
    return item;
  });
  const verified = await Promise.all(enriched.map(async (item) => {
    if (!item.hasCover || !item.coverFileName) return item;
    if (await fileExists(path.join(COVERS_DIR, item.coverFileName))) return item;
    coverByOwner.delete(item.id);
    return clearCoverMetadata(item);
  }));
  return verified.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
