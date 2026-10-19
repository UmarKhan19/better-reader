import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ReaderHighlightText, ReaderTextContext } from "../viewport/reader-text-renderer";

export type SearchResult = { page: number; snippet: string; matches: number };
export type SearchTextContext = ReaderTextContext;
export type SearchHighlight = ReaderHighlightText;
export type ReaderSearchState = {
  results: SearchResult[];
  scanned: number;
  total: number;
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

type Range = { start: number; end: number };
type TextItem = {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
  dir?: string;
};
type IndexedItem = Range & { index: number; text: string };
type PageText = { text: string; items: IndexedItem[]; truncated: boolean };
type ItemHighlight = { text: string; ranges: Range[] };
type PageHighlights = Map<number, ItemHighlight>;
function emptySearchScan() {
  return {
    results: [] as SearchResult[], highlights: new Map<number, PageHighlights>(),
    highlightChars: 0, highlightRanges: 0, failedPages: new Set<number>(), failed: 0, scanned: 0, truncated: false,
  };
}
type Scheduler = {
  delay: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
  yield: () => Promise<void>;
};
const defaultScheduler: Scheduler = {
  delay: (callback, ms) => setTimeout(callback, ms),
  clear: (timer) => clearTimeout(timer),
  yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

export function escapeSearchHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function literalPattern(query: string) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

function matchRanges(text: string, query: string) {
  const ranges: Range[] = [];
  if (!query || query.length > SEARCH_LIMITS.queryChars) return { ranges, truncated: false };
  const pattern = literalPattern(query);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (ranges.length === SEARCH_LIMITS.matchesPerPage) return { ranges, truncated: true };
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return { ranges, truncated: false };
}

function markRanges(text: string, ranges: Range[]) {
  let cursor = 0;
  const html: string[] = [];
  for (const { start, end } of ranges) {
    html.push(escapeSearchHtml(text.slice(cursor, start)), "<mark>", escapeSearchHtml(text.slice(start, end)), "</mark>");
    cursor = end;
  }
  html.push(escapeSearchHtml(text.slice(cursor)));
  return html.join("");
}

/** Only our mark tags are HTML; PDF strings and literal queries are never interpreted as markup. */
export function highlightSearchText(text: string, query: string): string {
  return markRanges(text, matchRanges(text, query.trim()).ranges);
}

// PDF.js splits words into adjacent items and represents some word/line gaps only in geometry.
// Preserve explicit whitespace; synthesize one space for EOL or a real geometric gap.
function needsSeparator(previous: TextItem, next: TextItem) {
  if (!previous.str || !next.str || /\s$/u.test(previous.str) || /^\s/u.test(next.str)) return false;
  if (previous.hasEOL) return true;
  const a = previous.transform, b = next.transform;
  if (!a || !b || previous.width === undefined) return true;
  const height = Math.max(previous.height ?? Math.hypot(a[2], a[3]), 1);
  if (Math.abs(b[5] - a[5]) > height * 0.5) return true;
  const gap = previous.dir === "rtl" ? a[4] - (b[4] + (next.width ?? 0)) : b[4] - (a[4] + previous.width);
  return gap > height * 0.1;
}

async function indexPage(items: unknown[], current: () => boolean, scheduler: Scheduler): Promise<PageText | null> {
  const indexed: IndexedItem[] = [];
  const pieces: string[] = [];
  let length = 0;
  let previous: TextItem | null = null;
  let truncated = items.length > SEARCH_LIMITS.pageItems;
  for (let index = 0; index < Math.min(items.length, SEARCH_LIMITS.pageItems); index++) {
    if (index % SEARCH_LIMITS.yieldItems === 0) {
      await scheduler.yield();
      if (!current()) return null;
    }
    const item = items[index] as Partial<TextItem> | null;
    if (!item || typeof item.str !== "string") continue;
    const typed = item as TextItem;
    if (previous && needsSeparator(previous, typed)) { pieces.push(" "); length++; }
    const text = typed.str.slice(0, Math.max(0, SEARCH_LIMITS.pageChars - length));
    indexed.push({ index, text, start: length, end: length + text.length });
    pieces.push(text);
    length += text.length;
    previous = typed.str ? typed : previous;
    if (text.length < typed.str.length || length >= SEARCH_LIMITS.pageChars) {
      truncated = text.length < typed.str.length || index < items.length - 1 || truncated;
      break;
    }
  }
  return { text: pieces.join(""), items: indexed, truncated };
}

function snippetFor(text: string, ranges: Range[]) {
  const first = ranges[0];
  const start = Math.max(0, first.start - 60);
  const end = Math.min(text.length, Math.max(first.end, start + SEARCH_LIMITS.snippetChars));
  // The query length is capped; keep a complete first match even for a long literal phrase.
  const visible = ranges.filter((range) => range.start >= start && range.end <= end)
    .map((range) => ({ start: range.start - start, end: range.end - start }));
  return `${start ? "…" : ""}${markRanges(text.slice(start, end), visible)}${end < text.length ? "…" : ""}`;
}

export function emptyReaderSearchState(total: number): ReaderSearchState {
  return {
    results: [], scanned: 0, total, searching: false, error: null, truncated: false, activeQuery: "",
    highlightText: escapeSearchHtml,
  };
}

export function readerSearchSnapshot(state: ReaderSearchState, query: string, enabled: boolean): ReaderSearchState {
  const normalized = query.trim();
  if (!normalized || state.activeQuery !== normalized) {
    return { ...emptyReaderSearchState(state.total), activeQuery: normalized, searching: enabled && Boolean(normalized) };
  }
  return !enabled && state.searching ? { ...state, searching: false } : state;
}

/** One extraction at a time; invalidated PDF.js promises may settle, but never publish or populate caches. */
export class ReaderSearchController {
  private state: ReaderSearchState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private highlightGeneration = 0;
  private scanState = emptySearchScan();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cache = new Map<number, PageText>();
  private cacheChars = 0;
  private busy = false;
  private queued: { generation: number; query: string } | null = null;

  constructor(private pdf: PDFDocumentProxy | null, private scheduler: Scheduler = defaultScheduler) {
    this.state = emptyReaderSearchState(pdf?.numPages ?? 0);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;
  getCacheSize = () => ({ pages: this.cache.size, chars: this.cacheChars });

  private publish(state: ReaderSearchState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  cancel = () => {
    this.generation++;
    if (this.timer !== null) this.scheduler.clear(this.timer);
    this.timer = null;
    this.queued = null;
  };

  dispose = () => {
    this.cancel();
    this.highlightGeneration++;
    this.scanState = emptySearchScan();
    this.cache.clear();
    this.cacheChars = 0;
    this.state = emptyReaderSearchState(this.pdf?.numPages ?? 0);
  };

  search(query: string, enabled: boolean) {
    this.cancel();
    const normalized = query.trim();
    const initial = emptyReaderSearchState(this.pdf?.numPages ?? 0);
    const sameQuery = Boolean(this.pdf && normalized && this.state.activeQuery === normalized);
    if (!sameQuery) {
      this.highlightGeneration++;
      this.scanState = emptySearchScan();
    }
    // Closing Search cancels extraction, not the matched text the user is reading.
    if (!enabled && sameQuery) { this.publish({ ...this.state, searching: false }); return; }
    if (!enabled || !this.pdf || !normalized) { this.publish(initial); return; }
    if (normalized.length > SEARCH_LIMITS.queryChars) {
      this.publish({ ...initial, activeQuery: normalized, error: `Use a search phrase of ${SEARCH_LIMITS.queryChars} characters or fewer.` });
      return;
    }
    this.publish({ ...(sameQuery ? this.state : initial), activeQuery: normalized, searching: true });
    const generation = this.generation;
    this.timer = this.scheduler.delay(() => {
      this.timer = null;
      this.queued = { generation, query: normalized };
      this.startQueued();
    }, SEARCH_LIMITS.debounceMs);
  }

  private startQueued() {
    if (this.busy || !this.queued) return;
    const job = this.queued;
    this.queued = null;
    this.busy = true;
    void this.scan(job.generation, job.query).finally(() => {
      this.busy = false;
      this.startQueued();
    });
  }

  private remember(page: number, text: PageText) {
    this.cache.set(page, text);
    this.cacheChars += text.text.length;
    while (this.cache.size > SEARCH_LIMITS.cachePages || this.cacheChars > SEARCH_LIMITS.cacheChars) {
      const first = this.cache.entries().next().value!;
      this.cache.delete(first[0]);
      this.cacheChars -= first[1].text.length;
    }
  }

  private async scan(generation: number, query: string) {
    const current = () => generation === this.generation;
    const highlightGeneration = this.highlightGeneration;
    const pdf = this.pdf;
    if (!pdf || !current()) return;
    const scan = this.scanState;
    const { results, highlights, failedPages } = scan;
    // One stable highlighter per query/generation; reads the mutable highlights map by reference.
    const highlightText: SearchHighlight = (text, context) => {
      if (highlightGeneration !== this.highlightGeneration) return escapeSearchHtml(text);
      if (!context) return highlightSearchText(text, query);
      const item = highlights.get(context.pageNumber)?.get(context.itemIndex);
      return item?.text === text ? markRanges(text, item.ranges) : escapeSearchHtml(text);
    };
    const snapshot = (searching: boolean): ReaderSearchState => ({
      results: [...results], scanned: scan.scanned, total: pdf.numPages, searching, truncated: scan.truncated, activeQuery: query,
      error: scan.failed ? `Could not read text on ${scan.failed} ${scan.failed === 1 ? "page" : "pages"}. Results may be incomplete. Close and reopen Search to retry.` : null,
      highlightText,
    });
    try {
      // Resume unfinished extraction; already-published matches stay mounted while Search is paused or reopened.
      const retryPages = [...failedPages];
      const start = scan.scanned + 1;
      const remaining = Math.max(0, pdf.numPages - scan.scanned);
      for (let index = 0; index < retryPages.length + remaining && results.length < SEARCH_LIMITS.results; index++) {
        if (!current()) return;
        const page = index < retryPages.length ? retryPages[index] : start + index - retryPages.length;
        try {
          let text = this.cache.get(page);
          if (text) { this.cache.delete(page); this.cache.set(page, text); }
          else {
            const proxy = await pdf.getPage(page);
            if (!current()) return;
            const content = await proxy.getTextContent();
            if (!current()) return;
            const indexed = await indexPage(content.items, current, this.scheduler);
            if (!indexed || !current()) return;
            text = indexed;
            this.remember(page, text);
          }
          const matched = matchRanges(text.text, query);
          scan.truncated ||= text.truncated || matched.truncated;
          if (failedPages.delete(page)) scan.failed--;
          if (matched.ranges.length) {
            results.push({ page, snippet: snippetFor(text.text, matched.ranges), matches: matched.ranges.length });
            results.sort((a, b) => a.page - b.page);
            const projected: PageHighlights = new Map();
            let rangeIndex = 0;
            for (const item of text.items) {
              while (rangeIndex < matched.ranges.length && matched.ranges[rangeIndex].end <= item.start) rangeIndex++;
              const ranges: Range[] = [];
              for (let i = rangeIndex; i < matched.ranges.length && matched.ranges[i].start < item.end; i++) {
                const range = matched.ranges[i];
                const start = Math.max(range.start, item.start) - item.start;
                const end = Math.min(range.end, item.end) - item.start;
                if (end > start) ranges.push({ start, end });
              }
              if (!ranges.length) continue;
              if (scan.highlightRanges + ranges.length > SEARCH_LIMITS.highlightRanges ||
                scan.highlightChars + item.text.length > SEARCH_LIMITS.highlightChars ||
                highlights.size >= SEARCH_LIMITS.highlightPages) { scan.truncated = true; continue; }
              projected.set(item.index, { text: item.text, ranges });
              scan.highlightChars += item.text.length;
              scan.highlightRanges += ranges.length;
            }
            highlights.set(page, projected);
          }
        } catch {
          if (!current()) return;
          if (!failedPages.has(page)) {
            scan.failed++;
            if (failedPages.size < SEARCH_LIMITS.retryPages) failedPages.add(page);
            else scan.truncated = true;
          }
        }
        if (!current()) return;
        scan.scanned = Math.max(scan.scanned, page);
        if (results.length >= SEARCH_LIMITS.results && index < retryPages.length + remaining - 1) { scan.truncated = true; break; }
        this.publish(snapshot(true));
        await this.scheduler.yield();
      }
      if (current()) this.publish(snapshot(false));
    } catch {
      if (current()) this.publish({ ...snapshot(false), error: "Search stopped unexpectedly. Close and reopen Search to retry." });
    }
  }
}
