"use client";

import { useEffect, useRef } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Bookmark, Grid2X2, List, Search, Trash2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import type { PdfPageColors } from "../reader-preferences";
import { activeChapter, type OutlineEntry } from "../navigation/reader-outline";
import { ThumbnailList } from "./reader-thumbnail-list";
import styles from "./reader-chrome.module.css";

import type { SidebarTab } from "./reader-ui-state";

export function ReaderSidebar({
  pdf, outline, pageCount, current, tab, onTabChange, bookmarks, onNavigate, onToggleBookmark, searchPanel, pageColors,
}: {
  pdf: PDFDocumentProxy;
  searchPanel: React.ReactNode;
  outline: OutlineEntry[] | null;
  pageCount: number;
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
        {tab === "pages" && <ThumbnailList pdf={pdf} pageCount={pageCount} current={current} onNavigate={onNavigate} pageColors={pageColors} />}
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
