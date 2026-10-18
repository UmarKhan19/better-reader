import type { PdfItem } from "@/types/pdf";

export type SkippedFile = { name: string; reason: string };
type UploadResponse = { items?: PdfItem[]; skipped?: SkippedFile[]; error?: string };
export type UploadResult = { items: PdfItem[]; skipped: SkippedFile[] };

export async function listPdfs(): Promise<PdfItem[]> {
  const response = await fetch("/api/pdfs", { cache: "no-store" });
  if (!response.ok) throw new Error("Library request failed");
  const data = await response.json() as { items?: PdfItem[] };
  return data.items ?? [];
}

/** XHR supplies upload progress, which the fetch-based mutations do not need. */
export function uploadPdfs(files: readonly File[], onProgress: (percent: number) => void): Promise<UploadResult> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/pdfs");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // Preserve the existing empty-result handling for malformed success bodies.
      }
      const body = parsed && typeof parsed === "object" ? parsed as UploadResponse : {};
      // A rejected batch can still contain saved items or useful per-file reasons.
      if ((xhr.status >= 200 && xhr.status < 300) || body.items?.length || body.skipped?.length) {
        resolve({ items: body.items ?? [], skipped: body.skipped ?? [] });
      } else {
        reject(new Error("Couldn't upload. Check your connection and try again."));
      }
    };
    xhr.onerror = () => reject(new Error("Couldn't upload. Check your connection and try again."));
    xhr.send(formData);
  });
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
