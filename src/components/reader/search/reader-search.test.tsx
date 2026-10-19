import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderSearchPanel, readerSearchStatus } from "./reader-search-panel";
import { emptyReaderSearchState, readerSearchSnapshot } from "./reader-search-state";
import { highlightSearchText } from "./reader-search-text";

const noChange = () => {};

test("ReaderSearchPanel has a labelled input, live progress, named results and current-page navigation", () => {
  const state = {
    ...emptyReaderSearchState(5), activeQuery: "needle", scanned: 3, searching: true,
    results: [{ page: 2, matches: 1, snippet: highlightSearchText("a needle in text", "needle") }],
  };
  const html = renderToStaticMarkup(<ReaderSearchPanel query="needle" onQueryChange={noChange}
    state={state} onNavigate={noChange} currentPage={2} />);
  const inputId = html.match(/<input id="([^"]+)"/)?.[1];
  assert.ok(inputId);
  assert.ok(html.includes(`<label for="${inputId}">Search in this book</label>`));
  assert.match(html, /<section[^>]*data-reader-search="true"/);
  assert.ok(html.includes('type="search"'));
  assert.ok(html.includes('maxLength="512"'));
  assert.ok(html.includes('aria-label="Search results" aria-busy="true"'));
  assert.ok(html.includes('role="status" aria-live="polite"'));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('Searching… 3 of 5 pages checked.'));
  assert.ok(html.includes('a <mark>needle</mark> in text'));
});

test("ReaderSearchPanel does not interpret hostile query/PDF text as HTML", () => {
  const query = '<img src=x onerror="alert(1)">';
  const state = {
    ...emptyReaderSearchState(1), activeQuery: query, scanned: 1,
    results: [{ page: 1, matches: 1, snippet: highlightSearchText(query, query) }],
  };
  const html = renderToStaticMarkup(<ReaderSearchPanel query={query} onQueryChange={noChange}
    state={state} onNavigate={noChange} currentPage={1} />);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('<mark>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</mark>'));
});

test("ReaderSearchPanel offers a named clear action only when a query is present", () => {
  const render = (query: string) => renderToStaticMarkup(<ReaderSearchPanel query={query}
    onQueryChange={noChange} state={emptyReaderSearchState(5)} onNavigate={noChange} currentPage={1} />);
  assert.ok(!render("").includes('aria-label="Clear search"'));
  assert.match(render("node"), /<button[^>]*type="button"[^>]*aria-label="Clear search"/);
});

test("ReaderSearchPanel reports no OCR, empty/loading/error states and explicit bounded search", () => {
  const blank = emptyReaderSearchState(10);
  assert.match(readerSearchStatus(blank, ""), /Image-only pages cannot be searched/);
  assert.equal(readerSearchStatus({ ...blank, searching: true }, "text"), "Preparing search…");
  assert.match(readerSearchStatus({ ...blank, scanned: 10, activeQuery: "text" }, "text"), /No matches.*OCR is not available/);
  assert.match(readerSearchStatus(blank, "text"), /when the PDF is ready/);
  assert.match(readerSearchStatus(emptyReaderSearchState(0), "text"), /when the PDF is ready/);
  assert.equal(readerSearchStatus({ ...blank, error: "Text unavailable" }, "text"), "0 of 10 pages checked. Text unavailable");
  assert.match(readerSearchStatus({ ...blank, searching: true, scanned: 3, error: "Text unavailable" }, "text"), /Searching… 3 of 10 pages checked.*Text unavailable/);
  const html = renderToStaticMarkup(<ReaderSearchPanel query="text" onQueryChange={noChange}
    state={{ ...blank, scanned: 3, truncated: true }} onNavigate={noChange} currentPage={1} />);
  assert.ok(html.includes("Search limits reached."));
  assert.ok(html.includes("Some text, matches or highlights were omitted."));
});

test("useReaderSearch snapshot retains same-query results and marks immediately when disabled", () => {
  const highlightText = (text: string) => highlightSearchText(text, "needle");
  const scanning = {
    ...emptyReaderSearchState(5), activeQuery: "needle", scanned: 3, searching: true, highlightText,
    results: [{ page: 2, matches: 1, snippet: highlightText("needle") }],
  };
  const paused = readerSearchSnapshot(scanning, " needle ", false);
  assert.equal(paused.results, scanning.results);
  assert.equal(paused.scanned, 3);
  assert.equal(paused.searching, false);
  assert.equal(paused.highlightText("needle"), "<mark>needle</mark>");
  assert.equal(readerSearchSnapshot(paused, "needle", false), paused);
});

test("useReaderSearch snapshot hides stale query and PDF metadata before effects run", () => {
  const old = {
    ...emptyReaderSearchState(5), activeQuery: "old", scanned: 5,
    results: [{ page: 2, matches: 1, snippet: "<mark>old</mark>" }],
    highlightText: (text: string) => highlightSearchText(text, "old"),
  };
  for (const enabled of [true, false]) {
    const changed = readerSearchSnapshot(old, "new", enabled);
    assert.deepEqual(changed.results, []);
    assert.equal(changed.scanned, 0);
    assert.equal(changed.searching, enabled);
    assert.equal(changed.highlightText("<old>"), "&lt;old&gt;");
    assert.deepEqual(readerSearchSnapshot(old, "", enabled).results, []);
    const replacedPdf = readerSearchSnapshot(emptyReaderSearchState(8), "old", enabled);
    assert.equal(replacedPdf.pageCount, 8);
    assert.deepEqual(replacedPdf.results, []);
    assert.equal(replacedPdf.highlightText("old"), "old");
  }
});
