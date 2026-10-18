import type { PdfItem } from "@/types/pdf";

export type SortMode = "recent" | "name";
export type ReadingProgress = { page: number; numPages: number };
export type LibraryNotice = {
  tone: "success" | "warning" | "error";
  text: string;
  details?: string[];
  undo?: PdfItem;
  retry?: () => void;
  retryLabel?: string;
};

export const TITLE_SMALL_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
]);

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

/** The filename is the only title we have; preserve existing capitalization. */
export function displayName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return name;
  if (base !== base.toLowerCase()) return base;
  return base.split(" ").map((word, index) => {
    const bare = word.replace(/[^a-z0-9]/gi, "");
    if (index > 0 && TITLE_SMALL_WORDS.has(bare)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

/** Missing progress must stay distinct from a reader's default page of 1. */
export function parseLibraryProgress(raw: string | null): ReadingProgress | undefined {
  if (!raw) return undefined;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const page = Number(raw);
    if (Number.isFinite(page)) parsed = { page };
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const value = parsed as { page?: unknown; numPages?: unknown };
  const page = Number(value.page);
  if (!Number.isFinite(page) || page < 1) return undefined;
  return {
    page: Math.round(page),
    numPages: Number.isFinite(Number(value.numPages)) ? Number(value.numPages) : 0,
  };
}

export function progressPercent(value?: ReadingProgress): number {
  if (!value || !value.numPages) return 0;
  return Math.min(100, Math.round((value.page / value.numPages) * 100));
}

export function isFinished(value?: ReadingProgress): boolean {
  return Boolean(value && value.numPages > 0 && value.page >= value.numPages);
}

export function coverSrc(item: PdfItem): string | undefined {
  return item.coverUrl || item.cover || item.coverImage || item.thumbnailUrl || item.thumbnail
    || (item.hasCover ? `/api/pdfs/${item.id}/cover` : undefined);
}

export function withoutCover(item: PdfItem): PdfItem {
  return {
    ...item, hasCover: false, cover: undefined, coverImage: undefined,
    coverUrl: undefined, thumbnail: undefined, thumbnailUrl: undefined,
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

export function uploadNotice(saved: number, skipped: ReadonlyArray<{ name: string; reason: string }>): LibraryNotice {
  const details = skipped.map((file) => `${file.name}, ${file.reason}`);
  if (saved === 0) return { tone: "warning", text: "No files were uploaded.", details };
  const uploaded = `${saved} ${saved === 1 ? "PDF" : "PDFs"} uploaded`;
  if (skipped.length) return { tone: "warning", text: `${uploaded}, ${skipped.length} skipped.`, details };
  return { tone: "success", text: `${uploaded}.` };
}
