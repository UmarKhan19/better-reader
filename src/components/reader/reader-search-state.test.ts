import { test } from "node:test";
import assert from "node:assert/strict";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  emptyReaderSearchState, escapeSearchHtml, highlightSearchText, readerSearchSnapshot, ReaderSearchController, SEARCH_LIMITS,
} from "./reader-search-state";

type Item = { str: string; hasEOL?: boolean; transform?: number[]; width?: number; height?: number; dir?: string };
function document(pages: (string | Item[] | Error)[], calls: number[] = []) {
  return {
    numPages: pages.length,
    getPage: async (page: number) => {
      calls.push(page);
      if (pages[page - 1] instanceof Error) throw pages[page - 1];
      return { getTextContent: async () => ({ items: typeof pages[page - 1] === "string" ? [{ str: pages[page - 1] }] : pages[page - 1] }) };
    },
  } as unknown as PDFDocumentProxy;
}
function schedule(yieldWork: () => Promise<void> = () => Promise.resolve()) {
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  let nextId = 0, yields = 0;
  return {
    delay: (callback: () => void, ms: number) => {
      assert.equal(ms, SEARCH_LIMITS.debounceMs);
      const id = ++nextId as unknown as ReturnType<typeof setTimeout>;
      timers.set(id, callback);
      return id;
    },
    clear: (id: ReturnType<typeof setTimeout>) => { timers.delete(id); },
    yield: async () => { yields++; await yieldWork(); },
    flush: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); },
    get pending() { return timers.size; },
    get yields() { return yields; },
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("Search did not settle");
}
async function search(controller: ReaderSearchController, scheduler: ReturnType<typeof schedule>, query: string) {
  controller.search(query, true);
  scheduler.flush();
  await until(() => !controller.getSnapshot().searching);
  return controller.getSnapshot();
}
function placed(str: string, x: number, y = 0): Item {
  return { str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10 };
}

test("highlightSearchText escapes hostile PDF/query HTML and only inserts literal marks", () => {
  const hostile = '<img src=x onerror="alert(1)"><script>bad</script> & \'quote\'';
  assert.equal(highlightSearchText(hostile, '<script>'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<mark>&lt;script&gt;</mark>bad&lt;/script&gt; &amp; &#39;quote&#39;');
  assert.equal(highlightSearchText(hostile, ""), escapeSearchHtml(hostile));
  assert.equal(highlightSearchText("<&", "<"), "<mark>&lt;</mark>&amp;");
});

test("empty search snapshots keep a stable text renderer across scroll-driven renders", () => {
  const empty = emptyReaderSearchState(24);
  const before = readerSearchSnapshot(empty, "", false);
  const after = readerSearchSnapshot(empty, "", false);
  assert.equal(after.highlightText, before.highlightText);
  assert.equal(after.highlightText('<script>', { pageNumber: 1, itemIndex: 0 }), '&lt;script&gt;');
});

test("highlightSearchText treats every regex metacharacter literally, case-insensitively", () => {
  const query = String.raw`a.*+?^${"${}"}()|[]\\Z`;
  assert.equal(highlightSearchText(`before ${query.toUpperCase()} after`, query), `before <mark>${escapeSearchHtml(query.toUpperCase())}</mark> after`);
  assert.equal(highlightSearchText("x A.B axb a.b", "a.b"), "x <mark>A.B</mark> axb <mark>a.b</mark>");
  assert.equal(highlightSearchText("İ A.B", "a.b"), "İ <mark>A.B</mark>");
  assert.equal(highlightSearchText("xx", " "), "xx");
});

test("search joins phrase items and projects exact repeated matches back to item offsets", async () => {
  const scheduler = schedule();
  const controller = new ReaderSearchController(document([[
    { str: "prefix Alpha " }, { str: "BETA suffix Alpha" }, { str: " " }, { str: "beta" },
  ]]), scheduler);
  const state = await search(controller, scheduler, "alpha beta");
  assert.deepEqual(state.results, [{ page: 1, matches: 2, snippet: "prefix <mark>Alpha BETA</mark> suffix <mark>Alpha beta</mark>" }]);
  assert.equal(state.highlightText("prefix Alpha ", { pageNumber: 1, itemIndex: 0 }), "prefix <mark>Alpha </mark>");
  assert.equal(state.highlightText("BETA suffix Alpha", { pageNumber: 1, itemIndex: 1 }), "<mark>BETA</mark> suffix <mark>Alpha</mark>");
  assert.equal(state.highlightText(" ", { pageNumber: 1, itemIndex: 2 }), "<mark> </mark>");
  assert.equal(state.highlightText("beta", { pageNumber: 1, itemIndex: 3 }), "<mark>beta</mark>");
  assert.equal(state.highlightText("beta", { pageNumber: 2, itemIndex: 3 }), "beta");
  assert.equal(state.highlightText("different <b>", { pageNumber: 1, itemIndex: 3 }), "different &lt;b&gt;");
});

test("synthetic geometry/EOL separators do not shift visible marks; adjacent word fragments stay joined", async () => {
  const scheduler = schedule();
  const controller = new ReaderSearchController(document([[
    placed("Re", 0), placed("ader", 10), placed("search", 35),
    { ...placed("next", 0, 15), hasEOL: true }, placed("line", 0, 30),
  ]]), scheduler);
  let state = await search(controller, scheduler, "reader search");
  assert.equal(state.results[0].snippet, "<mark>Reader search</mark> next line");
  for (const [itemIndex, text] of ["Re", "ader", "search"].entries()) {
    assert.equal(state.highlightText(text, { pageNumber: 1, itemIndex }), `<mark>${text}</mark>`);
  }
  state = await search(controller, scheduler, "next line");
  assert.equal(state.highlightText("next", { pageNumber: 1, itemIndex: 3 }), "<mark>next</mark>");
  assert.equal(state.highlightText("line", { pageNumber: 1, itemIndex: 4 }), "<mark>line</mark>");
});

test("marked-content entries, empty items, explicit spaces and hostile split items preserve offsets", async () => {
  const scheduler = schedule();
  const pages = [[{ str: "<img " }, { type: "beginMarkedContent" }, { str: "" }, { str: 'src="X">' }]];
  const controller = new ReaderSearchController(document(pages as Item[][]), scheduler);
  const state = await search(controller, scheduler, '<img src="x">');
  assert.equal(state.results[0].snippet, "<mark>&lt;img src=&quot;X&quot;&gt;</mark>");
  assert.equal(state.highlightText("<img ", { pageNumber: 1, itemIndex: 0 }), "<mark>&lt;img </mark>");
  assert.equal(state.highlightText('src="X">', { pageNumber: 1, itemIndex: 3 }), "<mark>src=&quot;X&quot;&gt;</mark>");
});

test("debounce starts only the latest phrase and disabled/empty queries do no PDF work", async () => {
  const scheduler = schedule();
  const calls: number[] = [];
  const controller = new ReaderSearchController(document(["alpha beta"], calls), scheduler);
  controller.search("alpha", true);
  controller.search("beta", true);
  assert.deepEqual(calls, []);
  assert.equal(scheduler.pending, 1);
  scheduler.flush();
  await until(() => !controller.getSnapshot().searching);
  assert.equal(controller.getSnapshot().activeQuery, "beta");
  assert.deepEqual(calls, [1]);
  controller.search("beta", false);
  scheduler.flush();
  assert.deepEqual(controller.getSnapshot().results.map((result) => result.page), [1]);
  assert.equal(controller.getSnapshot().searching, false);
  assert.equal(controller.getSnapshot().highlightText("alpha beta", { pageNumber: 1, itemIndex: 0 }), "alpha <mark>beta</mark>");
  controller.search("  ", true);
  assert.equal(scheduler.pending, 0);
  assert.deepEqual(calls, [1]);
});

test("query generations cancel in-flight extraction, serialise replacements, and discard stale caches/marks", async () => {
  const scheduler = schedule();
  let resolveText!: (content: { items: Item[] }) => void;
  const oldContent = new Promise<{ items: Item[] }>((resolve) => { resolveText = resolve; });
  let requests = 0;
  const pdf = {
    numPages: 2,
    getPage: async () => ({ getTextContent: () => ++requests === 1 ? oldContent : Promise.resolve({ items: [{ str: "new phrase" }] }) }),
  } as unknown as PDFDocumentProxy;
  const controller = new ReaderSearchController(pdf, scheduler);
  const published: string[] = [];
  controller.subscribe(() => { published.push(controller.getSnapshot().activeQuery); });
  controller.search("old phrase", true);
  scheduler.flush();
  await until(() => requests === 1);
  const obsoleteHighlight = controller.getSnapshot().highlightText;
  controller.search("new phrase", true);
  scheduler.flush();
  assert.equal(requests, 1);
  const publishedBeforeResolve = published.length;
  resolveText({ items: [{ str: "old phrase" }] });
  await until(() => !controller.getSnapshot().searching);
  assert.ok(published.slice(publishedBeforeResolve).every((query) => query === "new phrase"));
  assert.equal(requests, 3);
  assert.equal(controller.getSnapshot().results.length, 2);
  assert.equal(obsoleteHighlight("<old>"), "&lt;old&gt;");
  assert.equal(controller.getCacheSize().pages, 2);
  assert.ok(controller.getSnapshot().results.every((result) => result.snippet === "<mark>new phrase</mark>"));
});

test("cooperative yields cancel before processing a large page or requesting following pages", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = schedule(() => blocked);
  const calls: number[] = [];
  const controller = new ReaderSearchController(document([Array.from({ length: 1000 }, () => ({ str: "target " })), "target"], calls), scheduler);
  controller.search("target", true);
  scheduler.flush();
  await until(() => scheduler.yields > 0);
  controller.search("", false);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1]);
  assert.deepEqual(controller.getCacheSize(), { pages: 0, chars: 0 });
  assert.deepEqual(controller.getSnapshot().results, []);
});

test("replacement PDFs have isolated results, progress, metadata and text caches", async () => {
  const scheduler = schedule();
  const first = new ReaderSearchController(document(["first phrase"]), scheduler);
  const state = await search(first, scheduler, "first phrase");
  first.dispose();
  assert.deepEqual(first.getCacheSize(), { pages: 0, chars: 0 });
  assert.deepEqual(first.getSnapshot().results, []);
  const second = new ReaderSearchController(document(["second phrase", "unmatched"]), scheduler);
  assert.deepEqual(second.getCacheSize(), { pages: 0, chars: 0 });
  assert.equal(second.getSnapshot().scanned, 0);
  assert.equal(second.getSnapshot().total, 2);
  assert.equal(state.highlightText("first phrase", { pageNumber: 1, itemIndex: 0 }), "first phrase");
  assert.deepEqual((await search(second, scheduler, "first phrase")).results, []);
});

test("progress is incremental, image-only pages are empty, extraction failures retain honest partial results", async () => {
  const scheduler = schedule();
  const controller = new ReaderSearchController(document([[], "needle", new Error("bad PDF"), "needle"]), scheduler);
  const progress: number[] = [];
  controller.subscribe(() => { progress.push(controller.getSnapshot().scanned); });
  const state = await search(controller, scheduler, "needle");
  assert.deepEqual(state.results.map((result) => result.page), [2, 4]);
  assert.equal(state.scanned, 4);
  assert.match(state.error!, /Could not read text on 1 page/);
  assert.ok(progress.includes(1) && progress.includes(2) && progress.includes(3));
  assert.ok(scheduler.yields >= 4);
  const empty = await search(new ReaderSearchController(document([[], []]), scheduler), scheduler, "needle");
  assert.deepEqual(empty.results, []);
  assert.equal(empty.error, null);
  assert.equal(empty.scanned, 2);
});

test("result and match bounds stop work and report truncation", async () => {
  const scheduler = schedule();
  const calls: number[] = [];
  const controller = new ReaderSearchController(document(Array.from({ length: SEARCH_LIMITS.results + 20 }, () => "hit"), calls), scheduler);
  const state = await search(controller, scheduler, "hit");
  assert.equal(state.results.length, SEARCH_LIMITS.results);
  assert.equal(state.scanned, SEARCH_LIMITS.results);
  assert.equal(calls.length, SEARCH_LIMITS.results);
  assert.equal(state.truncated, true);
  const many = new ReaderSearchController(document(["x ".repeat(SEARCH_LIMITS.matchesPerPage + 10)]), scheduler);
  const bounded = await search(many, scheduler, "x");
  assert.equal(bounded.results[0].matches, SEARCH_LIMITS.matchesPerPage);
  assert.equal(bounded.truncated, true);
  assert.equal((highlightSearchText("x".repeat(2000), "x").match(/<mark>/g) ?? []).length, SEARCH_LIMITS.matchesPerPage);
});

test("text cache has independent page/character bounds and is reused without new PDF requests", async () => {
  const scheduler = schedule();
  const calls: number[] = [];
  const controller = new ReaderSearchController(document(Array.from({ length: 50 }, () => "a".repeat(100_000)), calls), scheduler);
  await search(controller, scheduler, "missing");
  assert.ok(controller.getCacheSize().pages <= SEARCH_LIMITS.cachePages);
  assert.ok(controller.getCacheSize().chars <= SEARCH_LIMITS.cacheChars);
  assert.equal(controller.getCacheSize().chars, SEARCH_LIMITS.cacheChars);
  const shortCalls: number[] = [];
  const short = new ReaderSearchController(document(["one", "two"], shortCalls), scheduler);
  await search(short, scheduler, "one");
  await search(short, scheduler, "two");
  assert.deepEqual(shortCalls, [1, 2]);
  const small = new ReaderSearchController(document(Array.from({ length: 50 }, () => "short")), scheduler);
  await search(small, scheduler, "missing");
  assert.equal(small.getCacheSize().pages, SEARCH_LIMITS.cachePages);
  assert.equal(small.getCacheSize().chars, SEARCH_LIMITS.cachePages * 5);
});

test("page text/items and query bounds are explicit rather than silently scanning unbounded input", async () => {
  const scheduler = schedule();
  const chars = new ReaderSearchController(document(["a".repeat(SEARCH_LIMITS.pageChars + 10) + "needle"]), scheduler);
  const charState = await search(chars, scheduler, "needle");
  assert.equal(charState.truncated, true);
  assert.deepEqual(charState.results, []);
  assert.equal(chars.getCacheSize().chars, SEARCH_LIMITS.pageChars);
  const items = new ReaderSearchController(document([Array.from({ length: SEARCH_LIMITS.pageItems + 1 }, () => ({ str: "" }))]), scheduler);
  assert.equal((await search(items, scheduler, "needle")).truncated, true);
  const calls: number[] = [];
  const query = new ReaderSearchController(document(["anything"], calls), scheduler);
  const queryState = await search(query, scheduler, "q".repeat(SEARCH_LIMITS.queryChars + 1));
  assert.match(queryState.error!, /512 characters/);
  assert.deepEqual(calls, []);
});

test("retained contextual metadata is character/range bounded, with explicit omitted-highlight state", async () => {
  const scheduler = schedule();
  const longItem = "target" + " ".repeat(150_000);
  const chars = new ReaderSearchController(document(Array.from({ length: 20 }, () => longItem)), scheduler);
  const charState = await search(chars, scheduler, "target");
  assert.equal(charState.results.length, 20);
  assert.equal(charState.truncated, true);
  assert.equal(charState.highlightText(longItem, { pageNumber: 20, itemIndex: 0 }), longItem);
  const ranges = new ReaderSearchController(document(Array.from({ length: 22 }, () => "x ".repeat(1000))), scheduler);
  const rangeState = await search(ranges, scheduler, "x");
  assert.equal(rangeState.results.length, 22);
  assert.equal(rangeState.truncated, true);
  assert.equal(rangeState.highlightText("x ".repeat(1000), { pageNumber: 22, itemIndex: 0 }), "x ".repeat(1000));
});

test("literal whitespace is preserved rather than treated as a regex or collapsed", async () => {
  const scheduler = schedule();
  const controller = new ReaderSearchController(document([[{ str: "one  " }, { str: "TWO one two" }]]), scheduler);
  const state = await search(controller, scheduler, "one  two");
  assert.equal(state.results[0].matches, 1);
  assert.equal(state.results[0].snippet, "<mark>one  TWO</mark> one two");
  assert.equal(state.highlightText("TWO one two", { pageNumber: 1, itemIndex: 1 }), "<mark>TWO</mark> one two");
});

test("indexing yields again after a bounded item batch, then respects cancellation mid-page", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let yields = 0;
  const scheduler = schedule(() => ++yields === 2 ? blocked : Promise.resolve());
  const calls: number[] = [];
  const controller = new ReaderSearchController(document([
    Array.from({ length: SEARCH_LIMITS.yieldItems * 3 }, () => ({ str: "target " })), "target",
  ], calls), scheduler);
  controller.search("target", true);
  scheduler.flush();
  await until(() => yields === 2);
  controller.search("", false);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1]);
  assert.deepEqual(controller.getCacheSize(), { pages: 0, chars: 0 });
  assert.deepEqual(controller.getSnapshot().results, []);
});

test("snippets remain bounded around a distant match without clipping or evaluating its literal HTML", async () => {
  const scheduler = schedule();
  const query = "<needle>";
  const controller = new ReaderSearchController(document(["a ".repeat(1000) + query + " b".repeat(1000)]), scheduler);
  const state = await search(controller, scheduler, query);
  const snippet = state.results[0].snippet;
  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.endsWith("…"));
  assert.ok(snippet.includes("<mark>&lt;needle&gt;</mark>"));
  assert.ok(snippet.length < SEARCH_LIMITS.snippetChars + 40);
});

test("reader-search pauses extraction on close without invalidating partial results or split-item marks", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let yields = 0;
  const scheduler = schedule(() => ++yields === 2 ? blocked : Promise.resolve());
  const calls: number[] = [];
  const controller = new ReaderSearchController(document([[{ str: "alpha " }, { str: "beta" }], "alpha beta"], calls), scheduler);
  controller.search("alpha beta", true);
  scheduler.flush();
  await until(() => controller.getSnapshot().scanned === 1);
  const shown = controller.getSnapshot();
  controller.cancel(); // useReaderSearch's effect cleanup runs before disabling.
  controller.search("alpha beta", false);
  const paused = controller.getSnapshot();
  assert.deepEqual(paused.results, shown.results);
  assert.equal(paused.scanned, 1);
  assert.equal(paused.searching, false);
  assert.equal(paused.highlightText("alpha ", { pageNumber: 1, itemIndex: 0 }), "<mark>alpha </mark>");
  assert.equal(shown.highlightText("beta", { pageNumber: 1, itemIndex: 1 }), "<mark>beta</mark>");
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1]);
  assert.equal(controller.getSnapshot(), paused, "Cancelled scan must not publish after the drawer closes");
  const progress: number[][] = [];
  controller.subscribe(() => progress.push(controller.getSnapshot().results.map((result) => result.page)));
  const resumed = await search(controller, scheduler, "alpha beta");
  assert.ok(progress.every((pages) => pages.includes(1)), "Reopening must not erase already-published results while resuming");
  assert.deepEqual(resumed.results.map((result) => result.page), [1, 2]);
  assert.deepEqual(calls, [1, 2], "Reopening reuses cached matched text");
});

test("reader-search clears paused metadata on query change, explicit clear and PDF disposal", async () => {
  const scheduler = schedule();
  const controller = new ReaderSearchController(document(["first second"]), scheduler);
  const first = await search(controller, scheduler, "first");
  controller.search("first", false);
  assert.equal(first.highlightText("first second"), "<mark>first</mark> second");
  controller.search("second", false);
  assert.deepEqual(controller.getSnapshot().results, []);
  assert.equal(first.highlightText("first second", { pageNumber: 1, itemIndex: 0 }), "first second");
  const second = await search(controller, scheduler, "second");
  controller.search("", false);
  assert.equal(second.highlightText("first second"), "first second");
  const fresh = await search(controller, scheduler, "first");
  controller.dispose();
  assert.equal(fresh.highlightText("first second"), "first second");
  assert.deepEqual(controller.getSnapshot().results, []);
});

test("reader-search retries failed pages on reopen without replacing already-matched metadata", async () => {
  const scheduler = schedule();
  const calls: number[] = [];
  let failed = false;
  const pdf = {
    numPages: 3,
    getPage: async (page: number) => {
      calls.push(page);
      if (page === 1 && !failed) { failed = true; throw new Error("temporary text failure"); }
      return { getTextContent: async () => ({ items: [{ str: "needle" }] }) };
    },
  } as unknown as PDFDocumentProxy;
  const controller = new ReaderSearchController(pdf, scheduler);
  const initial = await search(controller, scheduler, "needle");
  assert.deepEqual(initial.results.map((result) => result.page), [2, 3]);
  controller.search("needle", false);
  const retried = await search(controller, scheduler, "needle");
  assert.deepEqual(retried.results.map((result) => result.page), [1, 2, 3]);
  assert.equal(retried.error, null);
  assert.equal(retried.scanned, 3);
  assert.equal(retried.highlightText("needle", { pageNumber: 3, itemIndex: 0 }), "<mark>needle</mark>");
  assert.deepEqual(calls, [1, 2, 3, 1]);
  controller.search("needle", false);
  await search(controller, scheduler, "needle");
  assert.deepEqual(calls, [1, 2, 3, 1], "Completed same-query scans need no repeated extraction");
});

test("reader-search bounds retry metadata as well as results for unreadable PDFs", async () => {
  const scheduler = schedule();
  const total = SEARCH_LIMITS.retryPages + 10;
  const controller = new ReaderSearchController(document(Array.from({ length: total }, () => new Error("no text"))), scheduler);
  const state = await search(controller, scheduler, "needle");
  assert.equal(state.scanned, total);
  assert.ok(state.error!.includes(`${total} pages`));
  assert.equal(state.truncated, true);
});

test("highlightText reference stays stable across per-page progress publishes", async () => {
  const scheduler = schedule();
  const controller = new ReaderSearchController(document(["needle", "needle"]), scheduler);
  const refs: ((text: string, context?: { pageNumber: number; itemIndex: number }) => string)[] = [];
  controller.subscribe(() => { refs.push(controller.getSnapshot().highlightText); });
  controller.search("needle", true);
  scheduler.flush();
  await until(() => !controller.getSnapshot().searching);
  assert.ok(refs.length >= 3, "expected per-page progress publishes");
  assert.equal(refs[1], refs[2], "highlightText reference must stay stable");
  assert.ok(controller.getSnapshot().results.length >= 1, "results still update");
  const stale = refs[1];
  controller.search("other", true);
  scheduler.flush();
  assert.equal(stale("<script>"), "&lt;script&gt;", "stale generation escapes HTML");
});
