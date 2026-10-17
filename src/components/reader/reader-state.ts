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
  return `better-kindle:${kind}:${id}`;
}

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Storage health is an external store: every write records whether the browser kept the
// value, so screens can show an honest warning without effect-driven setState.
let storageBlocked = false;
const storageBlockedListeners = new Set<() => void>();

export function storageBlockedSnapshot() {
  return storageBlocked;
}

export function subscribeStorageBlocked(listener: () => void) {
  storageBlockedListeners.add(listener);
  return () => {
    storageBlockedListeners.delete(listener);
  };
}

export function setStorageBlocked(blocked: boolean) {
  if (storageBlocked === blocked) return;
  storageBlocked = blocked;
  for (const listener of storageBlockedListeners) listener();
}

/** Returns false when the browser refuses to keep the value, so callers can say saving failed. */
export function writeStorage(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    setStorageBlocked(false);
    return true;
  } catch {
    // Reading still works when browser storage is unavailable or full.
    setStorageBlocked(true);
    return false;
  }
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

// Each canvas has a 3 MP budget, including on high-DPI screens and at large zoom.
export function rasterRatio(size: Size, deviceRatio: number) {
  return Math.min(
    Math.max(1, deviceRatio || 1),
    2,
    Math.sqrt(3_000_000 / (size.width * size.height)),
    16384 / Math.max(size.width, size.height),
  );
}

export const THUMBNAIL_ROW_HEIGHT = 184;

export function thumbnailWindow(totalPages: number, scrollTop: number, height: number) {
  const rows = Math.ceil(Math.max(0, totalPages) / 2);
  const top = Math.max(0, scrollTop);
  const start = Math.max(0, Math.min(rows, Math.floor(top / THUMBNAIL_ROW_HEIGHT) - 2));
  const end = Math.min(rows, Math.ceil((top + Math.max(1, height)) / THUMBNAIL_ROW_HEIGHT) + 2);
  return { start, end, rows };
}

export type RenderSpec = Size & {
  key: string;
  generation: string;
  page: number;
  pixelRatio: number;
};

type CacheEntry = { spec: RenderSpec; ready: boolean; failed?: boolean };
export type PageCache = {
  target: RenderSpec | null;
  shown: RenderSpec | null;
  entries: CacheEntry[];
  error: boolean;
};
export const EMPTY_PAGE_CACHE: PageCache = {
  target: null, shown: null, entries: [], error: false,
};
export type CacheAction =
  | { type: "request"; spec: RenderSpec }
  | { type: "ready"; key: string }
  | { type: "prefetch"; targetKey: string; specs: RenderSpec[] }
  | { type: "error"; key: string };

export function pageCacheReducer(state: PageCache, action: CacheAction): PageCache {
  if (action.type === "request") {
    const target = action.spec;
    if (target.key === state.target?.key) return state;
    const cached = state.entries.find((entry) => entry.spec.key === target.key);
    const shown = cached?.ready ? target : state.shown;
    const keys = new Set<string>();
    const entries = [
      cached ?? { spec: target, ready: false },
      ...state.entries.filter((entry) =>
        entry.spec.key === shown?.key ||
        (entry.spec.generation === target.generation && Math.abs(entry.spec.page - target.page) <= 1),
      ),
    ].filter((entry) => {
      if (keys.has(entry.spec.key)) return false;
      keys.add(entry.spec.key);
      return true;
    }).slice(0, 4);
    return { target, shown, entries, error: cached?.failed ?? false };
  }
  if (action.type === "ready") {
    if (!state.entries.some((entry) => entry.spec.key === action.key)) return state;
    const shown = action.key === state.target?.key ? state.target : state.shown;
    const entries = state.entries
      .map((entry) => entry.spec.key === action.key ? { ...entry, ready: true } : entry)
      .filter((entry) => entry.spec.key === shown?.key || entry.spec.key === state.target?.key ||
        (entry.spec.generation === state.target?.generation &&
          Math.abs(entry.spec.page - (state.target?.page ?? 0)) <= 1));
    return { ...state, shown, entries };
  }
  if (action.type === "prefetch") {
    if (action.targetKey !== state.target?.key || state.shown?.key !== action.targetKey) return state;
    const specs = [state.target, ...action.specs.filter((spec) =>
      spec.generation === state.target?.generation && Math.abs(spec.page - state.target.page) === 1,
    )].slice(0, 3);
    return {
      ...state,
      entries: specs.map((spec) =>
        state.entries.find((entry) => entry.spec.key === spec.key) ?? { spec, ready: false },
      ),
    };
  }
  return {
    ...state,
    entries: state.entries.map((entry) => entry.spec.key === action.key ? { ...entry, failed: true } : entry),
    error: action.key === state.target?.key ? true : state.error,
  };
}
