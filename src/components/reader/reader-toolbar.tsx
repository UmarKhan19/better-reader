"use client";

import Link from "next/link";
import { ArrowLeft, Bookmark, BookOpen, Focus, History, PanelLeft, Search, Settings2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageControls } from "./reader-controls";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ReaderPreferences, ViewMode } from "./reader-state";
import styles from "./reader.module.css";

export type ReaderHeaderProps = {
  displayTitle: string;
  title: string;
  chapterTitle: string;
  total: number | null;
  pageNumber: number;
  sidebarOpen: boolean;
  searchExpanded: boolean;
  setSidebarOpen: (value: boolean | ((previous: boolean) => boolean)) => void;
  pdf: PDFDocumentProxy | null;
  coarsePointer: boolean;
  readingHistoryLength: number;
  goBack: () => void;
  openSearch: () => void;
  preferences: ReaderPreferences;
  updatePreferences: (update: Partial<ReaderPreferences>) => void;
  zoomBy: (delta: number) => void;
  bookmarked: boolean;
  toggleBookmark: (page: number) => void;
  focusMode: boolean;
  toggleFocus: () => void;
  panel: "settings" | "shortcuts" | null;
  setPanel: (value: "settings" | "shortcuts" | null) => void;
  navigate: (page: number) => void;
  jump: (page: number) => void;
  showFeedback: (text: string) => void;
  chromeVisible: boolean;
};

export function ReaderHeader(props: ReaderHeaderProps) {
  const {
    displayTitle, title, chapterTitle, total, pageNumber, sidebarOpen, searchExpanded, setSidebarOpen, pdf, coarsePointer,
    readingHistoryLength, goBack, openSearch, preferences, updatePreferences, zoomBy, bookmarked,
    toggleBookmark, focusMode, toggleFocus, panel, setPanel, navigate, jump, showFeedback, chromeVisible,
  } = props;
  return (
    <header className={styles.header} data-reader-chrome inert={!chromeVisible}>
      <div className={styles.titleGroup}>
        <Button variant="ghost" size="touch" className={styles.libraryLink} aria-label="Back to library" title="Back to library"
          nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft /><span className={styles.wordmark} aria-hidden="true">Better Reader</span>
          <span className={styles.compactWordmark} aria-hidden="true">BK</span>
        </Button>
        <div className={styles.desktopOnly}>
          <Button variant="ghost" size="icon-touch" aria-label="Toggle document navigation" title="Document navigation (T)"
            aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}><PanelLeft /></Button>
        </div>
        <div className={styles.titleText}>
          <h1 title={title}>{displayTitle}</h1>
          <p><BookOpen aria-hidden="true" /><span>{chapterTitle}</span></p>
        </div>
      </div>
      <div className={styles.desktopOnly}>
        <PageControls page={pageNumber} total={total} onNavigate={navigate} onSeek={jump} onMessage={showFeedback} />
      </div>
      <div className={styles.toolbarActions}>
        <Button variant="ghost" size={coarsePointer ? "touch" : "icon-touch"} className={styles.historyAction}
          data-empty={!readingHistoryLength} aria-label="Back to previous location"
          title="Back to previous location" disabled={!readingHistoryLength} onClick={goBack}>
          <History />{coarsePointer && <span className={styles.backLabel}>Previous</span>}
        </Button>
        <Button variant="ghost" size="touch" aria-label="Search document" title="Search document (/ or Ctrl+F)" aria-keyshortcuts="/ Control+f Meta+f"
          aria-expanded={searchExpanded} disabled={!pdf} onClick={openSearch}>
          <Search />
          <span className={styles.actionLabel}>Search</span>
        </Button>
        <div className={cn(styles.wideOnly, styles.zoomToolbar)}>
          <Button variant="ghost" size="icon-touch" aria-label="Zoom out" title="Zoom out (-)" disabled={!pdf}
            onClick={() => zoomBy(-0.1)}><ZoomOut /></Button>
          <label className="sr-only" htmlFor="reader-view-mode">Page sizing</label>
          <select id="reader-view-mode" className={styles.modeSelect} value={preferences.viewMode}
            onChange={(event) => updatePreferences({ viewMode: event.target.value as ViewMode })}>
            <option value="fit-width">Fit width</option><option value="fit-page">Fit page</option>
            <option value="actual-size">100%</option><option value="custom">Custom · {Math.round(preferences.zoom * 100)}%</option>
          </select>
          <Button variant="ghost" size="icon-touch" aria-label="Zoom in" title="Zoom in (+)" disabled={!pdf}
            onClick={() => zoomBy(0.1)}><ZoomIn /></Button>
        </div>
        <div className={cn(styles.desktopOnly, styles.toolbarGroup)}>
          <Button variant="ghost" size="icon-touch" aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
            title={bookmarked ? "Remove bookmark (B)" : "Bookmark this page (B)"} aria-pressed={bookmarked}
            disabled={!pdf} onClick={() => toggleBookmark(pageNumber)}><Bookmark fill={bookmarked ? "currentColor" : "none"} /></Button>
          <Button variant="ghost" size={coarsePointer ? "touch" : "icon-touch"} aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
            title={focusMode ? "Exit focus mode (Z)" : "Focus mode (Z)"} aria-pressed={focusMode} onClick={toggleFocus}>
            <Focus />{coarsePointer && <span>Focus</span>}
          </Button>
        </div>
        <Button variant="default" size="touch" className={styles.settingsButton} aria-label="Reading settings" title="Reading settings"
          aria-haspopup="dialog" aria-expanded={panel === "settings"} onClick={() => setPanel("settings")}>
          <Settings2 />
          <span className={styles.actionLabel}>Settings</span>
        </Button>
      </div>
    </header>
  );
}

export type ReaderMobileFooterProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean | ((previous: boolean) => boolean)) => void;
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  total: number | null;
  navigate: (page: number) => void;
  jump: (page: number) => void;
  showFeedback: (text: string) => void;
  bookmarked: boolean;
  toggleBookmark: (page: number) => void;
  chromeVisible: boolean;
};

export function ReaderMobileFooter(props: ReaderMobileFooterProps) {
  const { sidebarOpen, setSidebarOpen, pdf, pageNumber, total, navigate, jump, showFeedback, bookmarked, toggleBookmark, chromeVisible } = props;
  return (
    <nav className={styles.mobileFooter} aria-label="Page navigation" data-reader-chrome inert={!chromeVisible}>
      <Button variant="ghost" size="icon-touch" aria-label="Toggle document navigation" aria-expanded={sidebarOpen}
        disabled={!pdf} onClick={() => setSidebarOpen((value) => !value)}><PanelLeft /></Button>
      <PageControls page={pageNumber} total={total} onNavigate={navigate} onSeek={jump} onMessage={showFeedback} />
      <Button variant="ghost" size="icon-touch" aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
        aria-pressed={bookmarked} disabled={!pdf} onClick={() => toggleBookmark(pageNumber)}>
        <Bookmark fill={bookmarked ? "currentColor" : "none"} /></Button>
    </nav>
  );
}