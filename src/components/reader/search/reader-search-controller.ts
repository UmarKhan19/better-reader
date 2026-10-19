import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ReaderSearchState, SearchHighlight, SearchResult } from "./reader-search-state";
import { emptyReaderSearchState, escapeSearchHtml, SEARCH_LIMITS } from "./reader-search-state";
import type { PageHighlights, PageText, Range, SearchScheduler } from "./reader-search-text";
import { highlightSearchText, indexPage, markRanges, matchRanges, snippetFor } from "./reader-search-text";

function emptySearchScan() {
  return {
    results: [] as SearchResult[], highlights: new Map<number, PageHighlights>(),
    highlightChars: 0, highlightRanges: 0, failedPages: new Set<number>(), failed: 0, scanned: 0, truncated: false,
  };
}
const defaultScheduler: SearchScheduler = {
  delay: (callback, ms) => setTimeout(callback, ms),
  clear: (timer) => clearTimeout(timer),
  yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

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

  constructor(private pdf: PDFDocumentProxy | null, private scheduler: SearchScheduler = defaultScheduler) {
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
      results: [...results], scanned: scan.scanned, pageCount: pdf.numPages, searching, truncated: scan.truncated, activeQuery: query,
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
