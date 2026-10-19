import type { ReaderHighlightText, ReaderTextContext } from "../viewport/reader-text-renderer";

export type SearchResult = { page: number; snippet: string; matches: number };
export type SearchTextContext = ReaderTextContext;
export type SearchHighlight = ReaderHighlightText;
export type ReaderSearchState = {
  results: SearchResult[];
  scanned: number;
  pageCount: number;
  searching: boolean;
  error: string | null;
  truncated: boolean;
  activeQuery: string;
  highlightText: SearchHighlight;
};

export const SEARCH_LIMITS = {
  debounceMs: 250,
  queryChars: 512,
  results: 200,
  retryPages: 200,
  pageChars: 200_000,
  pageItems: 20_000,
  matchesPerPage: 1_000,
  cachePages: 32,
  cacheChars: 2_000_000,
  highlightPages: 200,
  highlightChars: 2_000_000,
  highlightRanges: 20_000,
  snippetChars: 240,
  yieldItems: 256,
} as const;

/** Only our mark tags are HTML; PDF strings and literal queries are never interpreted as markup. */
export function escapeSearchHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function emptyReaderSearchState(pageCount: number): ReaderSearchState {
  return {
    results: [], scanned: 0, pageCount, searching: false, error: null, truncated: false, activeQuery: "",
    highlightText: escapeSearchHtml,
  };
}

export function readerSearchSnapshot(state: ReaderSearchState, query: string, enabled: boolean): ReaderSearchState {
  const normalized = query.trim();
  if (!normalized || state.activeQuery !== normalized) {
    return { ...emptyReaderSearchState(state.pageCount), activeQuery: normalized, searching: enabled && Boolean(normalized) };
  }
  return !enabled && state.searching ? { ...state, searching: false } : state;
}
