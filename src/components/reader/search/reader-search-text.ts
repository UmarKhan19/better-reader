import { escapeSearchHtml, SEARCH_LIMITS } from "./reader-search-state";

export type Range = { start: number; end: number };
type TextItem = {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
  dir?: string;
};
type IndexedItem = Range & { index: number; text: string };
export type PageText = { text: string; items: IndexedItem[]; truncated: boolean };
type ItemHighlight = { text: string; ranges: Range[] };
export type PageHighlights = Map<number, ItemHighlight>;
export type SearchScheduler = {
  delay: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
  yield: () => Promise<void>;
};

function literalPattern(query: string) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

export function matchRanges(text: string, query: string) {
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

export function markRanges(text: string, ranges: Range[]) {
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

export async function indexPage(items: unknown[], current: () => boolean, scheduler: SearchScheduler): Promise<PageText | null> {
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

export function snippetFor(text: string, ranges: Range[]) {
  const first = ranges[0];
  const start = Math.max(0, first.start - 60);
  const end = Math.min(text.length, Math.max(first.end, start + SEARCH_LIMITS.snippetChars));
  // The query length is capped; keep a complete first match even for a long literal phrase.
  const visible = ranges.filter((range) => range.start >= start && range.end <= end)
    .map((range) => ({ start: range.start - start, end: range.end - start }));
  return `${start ? "…" : ""}${markRanges(text.slice(start, end), visible)}${end < text.length ? "…" : ""}`;
}
