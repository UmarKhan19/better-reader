import { markStorageResult } from "@/lib/storage-health";

export {
  markStorageResult, storageBlockedSnapshot, subscribeStorageBlocked,
} from "@/lib/storage-health";

export type ViewMode = "fit-width" | "fit-page" | "actual-size" | "custom";
export type PaperMode = "original" | "dimmed" | "sepia" | "dark";
export type PdfPageColors = { background: string; foreground: string } | null;
export type ReaderLayout = "continuous" | "single" | "spread";

export type ReaderPreferences = {
  viewMode: ViewMode;
  zoom: number;
  paper: PaperMode;
  layout: ReaderLayout;
  cropMargins: boolean;
  focusMode: boolean;
};

export function paperPageColors(paper: PaperMode): PdfPageColors {
  if (paper === "dark") return { background: "#000000", foreground: "#ffffff" };
  return null;
}

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  viewMode: "fit-width",
  zoom: 1,
  paper: "original",
  layout: "continuous",
  cropMargins: false,
  focusMode: false,
};

export function storageKey(kind: "progress" | "settings" | "bookmarks", id: string) {
  return `better-reader:${kind}:${id}`;
}

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the browser refuses to keep the value, so callers can say saving failed. */
export function writeStorage(key: string, value: unknown): boolean {
  let saved = false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    saved = true;
  } catch {
    // Reading still works when browser storage is unavailable or full.
  }
  markStorageResult(key, saved);
  return saved;
}

function parse(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clampPage(page: number, total: number, fallback = 1) {
  if (!Number.isFinite(page)) return fallback;
  return Math.max(1, Math.min(Math.max(1, total), Math.round(page)));
}

export function clampZoom(zoom: number) {
  return Number.isFinite(zoom)
    ? Math.round(Math.max(0.25, Math.min(4, zoom)) * 100) / 100
    : 1;
}

export function parsePreferences(raw: string | null): ReaderPreferences {
  const value = parse(raw);
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
  const prefs = value as Partial<ReaderPreferences>;
  return {
    viewMode: ["fit-width", "fit-page", "actual-size", "custom"].includes(prefs.viewMode ?? "")
      ? prefs.viewMode!
      : DEFAULT_PREFERENCES.viewMode,
    zoom: typeof prefs.zoom === "number" ? clampZoom(prefs.zoom) : 1,
    paper: ["original", "dimmed", "sepia", "dark"].includes(prefs.paper ?? "") ? prefs.paper! : "original",
    layout: ["continuous", "single", "spread"].includes(prefs.layout ?? "") ? prefs.layout! : "continuous",
    cropMargins: prefs.cropMargins === true,
    focusMode: prefs.focusMode === true,
  };
}

export function parseProgress(raw: string | null, total = Number.MAX_SAFE_INTEGER) {
  const value = parse(raw);
  const page = typeof value === "number"
    ? value
    : value && typeof value === "object" && "page" in value
      ? Number(value.page)
      : 1;
  return clampPage(page, total);
}

export type ReadingLocation = { page: number; offset: number };

export function clampOffset(offset: number) {
  return Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : 0;
}

export function readingProgress(location: ReadingLocation, total: number) {
  if (!Number.isSafeInteger(total) || total < 1) return 0;
  if (total === 1) return 100;
  return Math.round(Math.min(1, (clampPage(location.page, total) - 1 + clampOffset(location.offset)) / (total - 1)) * 100);
}

export function parseReadingLocation(raw: string | null, total = Number.MAX_SAFE_INTEGER): ReadingLocation {
  const value = parse(raw);
  const offset = value && typeof value === "object" && "offset" in value && typeof value.offset === "number"
    ? clampOffset(value.offset) : 0;
  return { page: parseProgress(raw, total), offset };
}

export const LOCATION_HISTORY_LIMIT = 32;
export type ReaderNavigationState = {
  location: ReadingLocation;
  navigation: ReadingLocation & { revision: number };
  history: ReadingLocation[];
};
export type ReaderNavigationAction =
  | { type: "scroll"; location: ReadingLocation; total: number }
  | { type: "jump"; location: ReadingLocation; total: number; remember?: boolean }
  | { type: "restore"; total: number }
  | { type: "back"; total: number };

export function initialNavigation(location: ReadingLocation): ReaderNavigationState {
  return { location, navigation: { ...location, revision: 0 }, history: [] };
}

function sameLocation(a: ReadingLocation, b: ReadingLocation) {
  return a.page === b.page && a.offset === b.offset;
}

export function readerNavigationReducer(state: ReaderNavigationState, action: ReaderNavigationAction): ReaderNavigationState {
  if (action.type === "back" && state.history.length === 0) return state;
  const requested = action.type === "back" ? state.history[state.history.length - 1]
    : action.type === "restore" ? state.location : action.location;
  const location = { page: clampPage(requested.page, action.total), offset: clampOffset(requested.offset) };
  if (action.type === "scroll") {
    return sameLocation(location, state.location) ? state : { ...state, location };
  }
  let history = state.history;
  if (action.type === "back") history = history.slice(0, -1);
  else if (action.type === "jump" && action.remember && !sameLocation(location, state.location)) {
    history = [...history.filter((entry, index) => index !== history.length - 1 || !sameLocation(entry, state.location)), state.location]
      .slice(-LOCATION_HISTORY_LIMIT);
  }
  return { location, history, navigation: { ...location, revision: state.navigation.revision + 1 } };
}

export type SavedReadingProgress = ReadingLocation & { numPages: number };
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

export function parseBookmarks(raw: string | null, total = Number.MAX_SAFE_INTEGER): number[] {
  const value = parse(raw);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((n): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= total,
  ))].sort((a, b) => a - b);
}

export type Size = { width: number; height: number };

/** The last outline entry that starts at or before the page; shared by the sidebar and the scrubber. */
export function activeChapter<T extends { page: number | null }>(outline: readonly T[] | null, pageNumber: number): T | null {
  return outline?.reduce<T | null>((active, entry) =>
    entry.page !== null && entry.page <= pageNumber &&
      (active?.page == null || entry.page >= active.page) ? entry : active,
  null) ?? null;
}

export function pageSize(natural: Size, available: Size, mode: ViewMode, zoom: number): Size {
  const width = Math.max(1, Math.min(1120, available.width));
  const height = Math.max(1, available.height);
  const ratio = Math.max(1, natural.height) / Math.max(1, natural.width);
  const pageWidth = mode === "fit-width"
    ? width
    : mode === "fit-page"
      ? Math.min(width, height / ratio)
      : natural.width * (mode === "actual-size" ? 1 : clampZoom(zoom));
  const roundedWidth = Math.max(1, Math.floor(pageWidth));
  return { width: roundedWidth, height: Math.max(1, Math.floor(roundedWidth * ratio)) };
}

export const THUMBNAIL_ROW_HEIGHT = 184;

export function thumbnailWindow(totalPages: number, scrollTop: number, height: number) {
  const rows = Math.ceil(Math.max(0, totalPages) / 2);
  const top = Math.max(0, scrollTop);
  const start = Math.max(0, Math.min(rows, Math.floor(top / THUMBNAIL_ROW_HEIGHT) - 2));
  const end = Math.min(rows, Math.ceil((top + Math.max(1, height)) / THUMBNAIL_ROW_HEIGHT) + 2);
  return { start, end, rows };
}

