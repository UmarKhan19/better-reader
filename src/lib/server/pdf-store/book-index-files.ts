import { rename } from "node:fs/promises";
import path from "node:path";
import { AI_DIR, fileExists, isValidPdfId, serialized } from "./storage";
import { findPdf, pdfFilePath } from "./index-store";

export function bookIndexPaths(id: string) {
  if (!isValidPdfId(id)) throw new Error("Invalid book ID");
  const indexFile = path.join(AI_DIR, id, "index.json");
  return { pdfFile: pdfFilePath(id), indexFile, tempFile: `${indexFile}.tmp`, cacheDir: path.join(AI_DIR, "models") };
}

export async function livePdfPath(id: string): Promise<string | null> {
  if (!await findPdf(id)) return null;
  const file = pdfFilePath(id);
  return await fileExists(file) ? file : null;
}

/** Only publication shares the delete lock; extraction and inference run outside it. */
export async function publishBookIndex(id: string): Promise<boolean> {
  if (!isValidPdfId(id)) return false;
  return serialized(async () => {
    if (!await livePdfPath(id)) return false;
    const { tempFile, indexFile } = bookIndexPaths(id);
    await rename(tempFile, indexFile);
    return true;
  });
}
