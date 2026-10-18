import type { PdfItem } from "@/types/pdf";

export type SkippedFile = { name: string; reason: string };
type UploadResponse = { items?: PdfItem[] };
export type UploadResult = { items: PdfItem[]; skipped: SkippedFile[] };

/** Must match the server's rule in app/api/pdfs/route.ts; the server re-checks anyway. */
function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function listPdfs(): Promise<PdfItem[]> {
  const response = await fetch("/api/pdfs", { cache: "no-store" });
  if (!response.ok) throw new Error("Library request failed");
  const data = await response.json() as { items?: PdfItem[] };
  return data.items ?? [];
}

/** Marks a per-file rejection; the batch keeps going and the user sees the reason. */
class UploadRejected extends Error {}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** One file per request: the route streams the raw body straight to disk. */
function uploadPdf(file: File, onProgress: (loaded: number) => void): Promise<PdfItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/pdfs");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        // A file the server refuses is a per-file outcome, not a failed batch.
        if (xhr.status >= 400 && xhr.status < 500) {
          const body = parseJson(xhr.responseText) as { error?: string } | null;
          reject(new UploadRejected(body?.error ?? "couldn't be saved (rejected by the server)"));
          return;
        }
        reject(new Error("Couldn't upload. Check your connection and try again."));
        return;
      }
      const item = (parseJson(xhr.responseText) as UploadResponse | null)?.items?.[0];
      if (item && typeof item.id === "string") resolve(item);
      else reject(new UploadRejected("saved, but the reply couldn't be read — reload the library"));
    };
    xhr.onerror = () => reject(new Error("Couldn't upload. Check your connection and try again."));
    xhr.send(file);
  });
}

/** XHR supplies upload progress; one request per file keeps the server's memory flat. */
export async function uploadPdfs(files: readonly File[], onProgress: (percent: number) => void): Promise<UploadResult> {
  const total = Math.max(1, files.reduce((sum, file) => sum + file.size, 0));
  const items: PdfItem[] = [];
  const skipped: SkippedFile[] = [];
  let done = 0;
  for (const file of files) {
    const name = file.name || "Unnamed file";
    if (isPdfFile(file)) {
      try {
        items.push(await uploadPdf(file, (loaded) => onProgress(Math.round(((done + loaded) / total) * 100))));
      } catch (error) {
        if (!(error instanceof UploadRejected)) throw error;
        skipped.push({ name, reason: error.message });
      }
    } else {
      skipped.push({ name, reason: "not a PDF" });
    }
    done += file.size;
  }
  return { items, skipped };
}

export async function deletePdf(id: string): Promise<void> {
  const response = await fetch(`/api/pdfs/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Delete failed");
}

export async function restorePdf(id: string): Promise<void> {
  const response = await fetch(`/api/pdfs/${id}?action=restore`, { method: "POST" });
  if (!response.ok) throw new Error("Restore failed");
}

export async function addCover(id: string, file: File): Promise<PdfItem | undefined> {
  const formData = new FormData();
  formData.append("cover", file);
  const response = await fetch(`/api/pdfs/${id}/cover`, { method: "POST", body: formData });
  if (!response.ok) throw new Error("Cover upload failed");
  const data = await response.json() as { item?: PdfItem };
  return data.item;
}

export async function removeCover(id: string): Promise<void> {
  const response = await fetch(`/api/pdfs/${id}/cover`, { method: "DELETE" });
  if (!response.ok) throw new Error("Cover remove failed");
}
