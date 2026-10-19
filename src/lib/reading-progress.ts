export type ReadingLocation = { page: number; offset: number };
export type SavedReadingProgress = ReadingLocation & { numPages: number };

export function progressStorageKey(id: string) {
  return `better-reader:progress:${id}`;
}

export function clampPage(page: number, total: number, fallback = 1) {
  if (!Number.isFinite(page)) return fallback;
  return Math.max(1, Math.min(Math.max(1, total), Math.round(page)));
}

export function clampOffset(offset: number) {
  return Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : 0;
}

function numeric(value: unknown): number {
  try { return Number(value); }
  catch { return NaN; }
}

/** Decode the stored format; callers decide whether an invalid page means unread or page 1. */
export function parseSavedProgress(raw: string | null): SavedReadingProgress | null {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
  const value = parsed && typeof parsed === "object"
    ? parsed as { page?: unknown; offset?: unknown; numPages?: unknown } : null;
  if (typeof parsed !== "number" && !value) return null;
  const numPages = numeric(value?.numPages);
  return {
    page: numeric(typeof parsed === "number" ? parsed : value?.page),
    offset: typeof value?.offset === "number" ? clampOffset(value.offset) : 0,
    numPages: Number.isFinite(numPages) ? numPages : 0,
  };
}

export function parseReadingLocation(raw: string | null, total = Number.MAX_SAFE_INTEGER): ReadingLocation {
  const value = parseSavedProgress(raw);
  return { page: clampPage(value?.page ?? 1, total), offset: value?.offset ?? 0 };
}

export function parseProgress(raw: string | null, total = Number.MAX_SAFE_INTEGER) {
  return parseReadingLocation(raw, total).page;
}

export function readingProgress(location: ReadingLocation, total: number) {
  if (!Number.isSafeInteger(total) || total < 1) return 0;
  if (total === 1) return 100;
  return Math.round(Math.min(1, (clampPage(location.page, total) - 1 + clampOffset(location.offset)) / (total - 1)) * 100);
}

export function createProgressWriter(
  write: (progress: SavedReadingProgress) => void,
  delay = 500,
  clock = {
    set: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: SavedReadingProgress | null = null;
  const flush = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    if (pending) {
      const progress = pending;
      pending = null;
      write(progress);
    }
  };
  return {
    update(location: ReadingLocation, total: number) {
      if (!Number.isInteger(total) || total < 1) return;
      pending = { page: clampPage(location.page, total), offset: clampOffset(location.offset), numPages: total };
      if (timer !== undefined) clock.clear(timer);
      timer = clock.set(flush, delay);
    },
    flush,
  };
}
