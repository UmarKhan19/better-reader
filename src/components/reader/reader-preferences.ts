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

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  viewMode: "fit-width", zoom: 1, paper: "original", layout: "continuous", cropMargins: false, focusMode: false,
};

export function paperPageColors(paper: PaperMode): PdfPageColors {
  return paper === "dark" ? { background: "#000000", foreground: "#ffffff" } : null;
}

export function clampZoom(zoom: number) {
  return Number.isFinite(zoom) ? Math.round(Math.max(0.25, Math.min(4, zoom)) * 100) / 100 : 1;
}

function parse(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parsePreferences(raw: string | null): ReaderPreferences {
  const value = parse(raw);
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
  const prefs = value as Partial<ReaderPreferences>;
  return {
    viewMode: ["fit-width", "fit-page", "actual-size", "custom"].includes(prefs.viewMode ?? "")
      ? prefs.viewMode! : DEFAULT_PREFERENCES.viewMode,
    zoom: typeof prefs.zoom === "number" ? clampZoom(prefs.zoom) : 1,
    paper: ["original", "dimmed", "sepia", "dark"].includes(prefs.paper ?? "") ? prefs.paper! : "original",
    layout: ["continuous", "single", "spread"].includes(prefs.layout ?? "") ? prefs.layout! : "continuous",
    cropMargins: prefs.cropMargins === true,
    focusMode: prefs.focusMode === true,
  };
}

export function parseBookmarks(raw: string | null, total = Number.MAX_SAFE_INTEGER): number[] {
  const value = parse(raw);
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((n): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= total,
  ))].sort((a, b) => a - b);
}
