"use client";

import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  readerSearchSnapshot, ReaderSearchController, SEARCH_LIMITS,
} from "./reader-search-state";
import type { ReaderSearchState } from "./reader-search-state";
import styles from "./reader-search.module.css";

export type { SearchResult, SearchTextContext } from "./reader-search-state";

export function useReaderSearch(pdf: PDFDocumentProxy | null, query: string, enabled: boolean) {
  const controller = useMemo(() => new ReaderSearchController(pdf), [pdf]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.search(query, enabled);
    return controller.cancel;
  }, [controller, query, enabled]);
  useEffect(() => () => controller.dispose(), [controller]);

  // Do not expose a previous query/PDF's results during the render before effect cleanup.
  return readerSearchSnapshot(state, pdf ? query : "", enabled && Boolean(pdf));
}

export function readerSearchStatus(state: ReaderSearchState, query: string) {
  if (!query.trim()) return "Search this PDF's text. Image-only pages cannot be searched.";
  if (state.searching) {
    const progress = state.scanned === 0 ? "Preparing search…" : `Searching… ${state.scanned} of ${state.total} pages checked.`;
    return state.error ? `${progress} ${state.error}` : progress;
  }
  if (state.error) return `${state.scanned} of ${state.total} pages checked. ${state.error}`;
  if (!state.total || state.activeQuery !== query.trim()) return "Search will be available when the PDF is ready.";
  if (!state.results.length) return "No matches in searchable text. Image-only or scanned pages may have no text; OCR is not available.";
  return `${state.results.length} ${state.results.length === 1 ? "page" : "pages"} with matches. ${state.scanned} of ${state.total} pages checked.`;
}

export function ReaderSearchPanel({ query, onQueryChange, state, onNavigate, currentPage }: {
  query: string;
  onQueryChange: (query: string) => void;
  state: ReturnType<typeof useReaderSearch>;
  onNavigate: (page: number) => void;
  currentPage: number;
}) {
  const id = useId();
  const statusId = `${id}-status`;
  return (
    <section className={styles.panel} aria-label="Search PDF" data-reader-search>
      <div className={styles.inputGroup}>
        <label htmlFor={id}>Search in this book</label>
        <input id={id} type="search" value={query} maxLength={SEARCH_LIMITS.queryChars}
          placeholder="Word or phrase" autoComplete="off" spellCheck={false}
          aria-describedby={statusId} onChange={(event) => onQueryChange(event.currentTarget.value)} />
      </div>
      <div className={styles.status} id={statusId} role="status" aria-live="polite" aria-atomic="true">
        <p>{readerSearchStatus(state, query)}</p>
        {state.truncated && <p>Search limits reached. Some text, matches or highlights were omitted. Refine your phrase for more complete results.</p>}
      </div>
      <ol className={styles.results} aria-label="Search results" aria-busy={state.searching}>
        {state.results.map((result) => (
          <li key={result.page}>
            <button type="button" className={styles.result} data-search-result-page={result.page}
              aria-current={result.page === currentPage ? "page" : undefined}
              onClick={() => onNavigate(result.page)}>
              <span className={styles.resultHeading}>
                <span>Page {result.page}</span>
                <span>{result.matches} {result.matches === 1 ? "match" : "matches"}</span>
              </span>
              <span className={styles.snippet} dangerouslySetInnerHTML={{ __html: result.snippet }} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
