import type { PdfItem } from "@/types/pdf";
import { displayName } from "@/lib/pdf-title";
import { parseSavedProgress } from "@/lib/reading-progress";

export type SortMode = "recent" | "name";
export type ReadingProgress = { page: number; numPages: number };
export type LibraryNotice = {
  tone: "success" | "warning" | "error";
  text: string;
  details?: string[];
  undo?: PdfItem;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    const datePart = new Intl.DateTimeFormat(undefined, sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }).format(date);
    if (!sameYear) return datePart;
    const timePart = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    return `${datePart}, ${timePart}`;
  } catch {
    return iso;
  }
}

/** Missing progress must stay distinct from a reader's default page of 1. */
export function parseLibraryProgress(raw: string | null): ReadingProgress | undefined {
  if (!raw) return undefined;
  // Keep the library's legacy non-JSON numeric fallback, including "+17".
  const value = parseSavedProgress(raw) ?? parseSavedProgress(String(Number(raw)));
  if (!value || !Number.isFinite(value.page) || value.page < 1) return undefined;
  return { page: Math.round(value.page), numPages: value.numPages };
}

export function progressPercent(value?: ReadingProgress): number {
  if (!value || !value.numPages) return 0;
  return Math.min(100, Math.round((value.page / value.numPages) * 100));
}

export function isFinished(value?: ReadingProgress): boolean {
  return Boolean(value && value.numPages > 0 && value.page >= value.numPages);
}

export function coverSrc(item: PdfItem): string | undefined {
  return item.coverUrl;
}

export function withoutCover(item: PdfItem): PdfItem {
  return {
    ...item, hasCover: false, coverUrl: undefined,
  };
}

export function selectVisibleItems(items: PdfItem[], filter: string, sort: SortMode): PdfItem[] {
  const query = filter.trim().toLowerCase();
  const base = query
    ? items.filter((item) => item.name.toLowerCase().includes(query) || displayName(item.name).toLowerCase().includes(query))
    : items;
  return sort === "name"
    ? [...base].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    : base;
}

/** Preserve library order and include finished titles, as the existing shelf does. */
export function selectReadingItems(items: PdfItem[], progress: Record<string, ReadingProgress>): PdfItem[] {
  return items.filter((item) => progress[item.id]);
}

export function mergeUploadedItems(items: PdfItem[], saved: PdfItem[]): PdfItem[] {
  const ids = new Set(items.map((item) => item.id));
  return [...saved.filter((item) => !ids.has(item.id)), ...items];
}

export function uploadNotice(
  saved: number,
  skipped: ReadonlyArray<{ name: string; reason: string }>,
  failedCount = 0,
): LibraryNotice {
  const details = skipped.map((file) => `${file.name}, ${file.reason}`);
  if (saved === 0 && failedCount > 0) {
    return { tone: "error", text: "Couldn't upload. Check your connection and try again.", details };
  }
  if (saved === 0) {
    return { tone: "warning", text: "No files were uploaded.", details };
  }
  const uploaded = `${saved} ${saved === 1 ? "PDF" : "PDFs"} uploaded`;
  if (skipped.length || failedCount > 0) {
    const parts: string[] = [];
    if (skipped.length) parts.push(`${skipped.length} skipped`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    return { tone: "warning", text: `${uploaded}, ${parts.join(", ")}.`, details };
  }
  return { tone: "success", text: `${uploaded}.` };
}
