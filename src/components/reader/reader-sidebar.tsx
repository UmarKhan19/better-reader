"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScheduledPdfPage } from "./reader-render-queue";
import { Tabs } from "@base-ui/react/tabs";
import { Bookmark, Grid2X2, List, Search, Trash2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { THUMBNAIL_ROW_HEIGHT, thumbnailWindow, activeChapter, type PdfPageColors } from "./reader-state";
import type { OutlineEntry } from "./reader-outline";
import styles from "./reader.module.css";

export * from "./reader-outline";

export type SidebarTab = "contents" | "pages" | "bookmarks" | "search";

const Thumbnail = memo(function Thumbnail({
  pdf, page, current, onNavigate, onKeyDown, pageColors,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  current: boolean;
  onNavigate: (page: number) => void;
  onKeyDown: (event: React.KeyboardEvent, page: number) => void;
  pageColors?: PdfPageColors;
}) {
  return (
    <button type="button" className={styles.thumbnail} data-thumb-page={page}
      aria-label={`Go to page ${page}`} aria-current={current ? "page" : undefined}
      onClick={() => onNavigate(page)} onKeyDown={(event) => onKeyDown(event, page)}>
      <span className={styles.thumbnailImage}>
        <ScheduledPdfPage pdf={pdf} priority={2} pageNumber={page} width={104} devicePixelRatio={1}
          pageColors={pageColors ?? undefined}
          renderTextLayer={false} renderAnnotationLayer={false} suspense={false}
          loading={<span className={styles.thumbnailSkeleton} aria-hidden="true"><i /><i /><i /></span>}
          error={<span className={styles.thumbnailLoading}>No preview</span>} />
      </span>
      <span className={styles.thumbnailNumber}>{page}</span>
    </button>
  );
});

function ThumbnailList({ pdf, total, current, onNavigate, pageColors }: {
  pdf: PDFDocumentProxy; total: number; current: number; onNavigate: (page: number) => void;
  pageColors?: PdfPageColors;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 480 });
  const [focusPage, setFocusPage] = useState<number | null>(null);
  const windowed = thumbnailWindow(total, viewport.top, viewport.height);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setViewport({ top: node.scrollTop, height: node.clientHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const top = Math.floor((current - 1) / 2) * THUMBNAIL_ROW_HEIGHT;
    if (top < node.scrollTop || top + THUMBNAIL_ROW_HEIGHT > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.max(0, top - (node.clientHeight - THUMBNAIL_ROW_HEIGHT) / 2);
    }
  }, [current]);

  useLayoutEffect(() => {
    if (focusPage !== null) {
      ref.current?.querySelector<HTMLButtonElement>(`[data-thumb-page="${focusPage}"]`)?.focus();
    }
  }, [focusPage, windowed.start, windowed.end]);

  function onThumbnailKey(event: React.KeyboardEvent, page: number) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
    let next = page;
    if (event.key in offsets) next += offsets[event.key];
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = total;
    else return;
    event.preventDefault();
    next = Math.max(1, Math.min(total, next));
    const node = ref.current;
    if (!node) return;
    const top = Math.floor((next - 1) / 2) * THUMBNAIL_ROW_HEIGHT;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + THUMBNAIL_ROW_HEIGHT > node.scrollTop + node.clientHeight) {
      node.scrollTop = top + THUMBNAIL_ROW_HEIGHT - node.clientHeight;
    }
    setViewport({ top: node.scrollTop, height: node.clientHeight });
    setFocusPage(next);
  }

  return (
    <div ref={ref} className={styles.thumbnailList} data-thumbnail-list tabIndex={0}
      role="region" aria-label="Page thumbnails"
      onScroll={(event) => {
        const node = event.currentTarget;
        setViewport({ top: node.scrollTop, height: node.clientHeight });
      }}>
      <div className={styles.thumbnailSpacer} style={{ height: windowed.rows * THUMBNAIL_ROW_HEIGHT }}>
        {Array.from({ length: Math.max(0, windowed.end - windowed.start) }, (_, index) => {
          const row = windowed.start + index;
          return (
            <div key={row} className={styles.thumbnailRow} style={{ top: row * THUMBNAIL_ROW_HEIGHT }}>
              {[row * 2 + 1, row * 2 + 2].filter((n) => n <= total).map((n) => (
                <Thumbnail key={n} pdf={pdf} page={n} current={n === current} onNavigate={onNavigate} onKeyDown={onThumbnailKey} pageColors={pageColors} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReaderSidebar({
  pdf, outline, total, current, tab, onTabChange, bookmarks, onNavigate, onToggleBookmark, searchPanel, pageColors,
}: {
  pdf: PDFDocumentProxy;
  searchPanel: React.ReactNode;
  outline: OutlineEntry[] | null;
  total: number;
  current: number;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  bookmarks: number[];
  onNavigate: (page: number) => void;
  onToggleBookmark: (page: number) => void;
  pageColors?: PdfPageColors;
}) {
  const contentsRef = useRef<HTMLOListElement>(null);
  const active = activeChapter(outline, current);
  useEffect(() => {
    contentsRef.current?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest" });
  }, [active?.id, tab]);

  return (
    <Tabs.Root className={styles.sidebarTabs} value={tab} onValueChange={(value) => {
      if (value === "contents" || value === "pages" || value === "bookmarks" || value === "search") onTabChange(value);
    }}>
      <Tabs.List className={styles.tabList} aria-label="Document navigation">
        <Tabs.Tab className={styles.tab} value="contents"><List aria-hidden="true" /><span>Contents</span></Tabs.Tab>
        <Tabs.Tab className={styles.tab} value="pages"><Grid2X2 aria-hidden="true" /><span>Pages</span></Tabs.Tab>
        <Tabs.Tab className={styles.tab} value="bookmarks"><Bookmark aria-hidden="true" /><span>Bookmarks</span></Tabs.Tab>
        <Tabs.Tab className={styles.tab} value="search"><Search aria-hidden="true" /><span>Search</span></Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="contents" className={styles.tabPanel}>
        {outline === null ? <p className={styles.emptyState} role="status">Loading contents…</p>
          : outline.length === 0 ? <div className={styles.emptyState}>
            <p>This PDF has no table of contents.</p>
            <p>Use Pages to browse, or bookmark a page.</p>
            <Button variant="outline" size="touch" onClick={() => onTabChange("pages")}>Browse pages</Button>
          </div> : (
            <ol ref={contentsRef} className={styles.contentsList}>
              {outline.map((entry) => (
                <li key={entry.id}>
                  {entry.page !== null ? (
                    <button type="button" className={styles.chapter}
                      style={{ paddingInlineStart: 16 + Math.min(6, entry.depth) * 12 }}
                      aria-current={entry.id === active?.id ? "location" : undefined}
                      onClick={() => onNavigate(entry.page!)}>
                      <span>{entry.title}</span><span className={styles.chapterPage}>{entry.page}</span>
                    </button>
                  ) : entry.url ? (
                    <a className={styles.chapter} href={entry.url} target="_blank" rel="noreferrer">{entry.title}</a>
                  ) : <span className={styles.unavailableChapter}>{entry.title}</span>}
                </li>
              ))}
            </ol>
          )}
      </Tabs.Panel>
      <Tabs.Panel value="pages" className={styles.tabPanel}>
        {tab === "pages" && <ThumbnailList pdf={pdf} total={total} current={current} onNavigate={onNavigate} pageColors={pageColors} />}
      </Tabs.Panel>
      <Tabs.Panel value="search" className={styles.tabPanel}>
        {tab === "search" && <div className={styles.searchPanel} data-reader-search>{searchPanel}</div>}
      </Tabs.Panel>
      <Tabs.Panel value="bookmarks" className={styles.tabPanel}>
        {bookmarks.length === 0 ? <div className={styles.emptyState}>
          <Bookmark size={22} aria-hidden="true" />
          <p>No bookmarks yet.</p>
          <p>Save a page to return to it later.</p>
          <Button variant="outline" size="touch" onClick={() => onToggleBookmark(current)}>Bookmark page {current}</Button>
        </div> : <ul className={styles.bookmarkList}>
          {bookmarks.map((page) => (
            <li key={page} className={styles.bookmarkRow}>
              <button type="button" className={styles.chapter} onClick={() => onNavigate(page)}
                aria-current={page === current ? "page" : undefined}>
                <Bookmark size={16} aria-hidden="true" /><span>Page {page}</span>
              </button>
              <Button variant="ghost" size="icon-touch" aria-label={`Remove bookmark for page ${page}`}
                onClick={() => onToggleBookmark(page)}><Trash2 /></Button>
            </li>
          ))}
        </ul>}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
