"use client";

import Link from "next/link";
import { ArrowLeft, Bookmark, BookOpen, Focus, History, PanelLeft, Search, Settings2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageControls, type PageControlsProps } from "./reader-page-controls";
import { displayName } from "@/lib/pdf-title";
import type { ReaderPreferences, ViewMode } from "../reader-preferences";
import styles from "./reader-chrome.module.css";

export type ReaderHeaderProps = {
  title: string;
  chapterTitle: string;
  pageControls: PageControlsProps;
  sidebarOpen: boolean;
  searchExpanded: boolean;
  onToggleSidebar: () => void;
  ready: boolean;
  coarsePointer: boolean;
  readingHistoryLength: number;
  goBack: () => void;
  openSearch: () => void;
  preferences: ReaderPreferences;
  updatePreferences: (update: Partial<ReaderPreferences>) => void;
  zoomBy: (delta: number) => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  toggleFocus: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  chromeVisible: boolean;
};

export function ReaderHeader(props: ReaderHeaderProps) {
  const {
    title, chapterTitle, pageControls, sidebarOpen, searchExpanded, onToggleSidebar, ready, coarsePointer,
    readingHistoryLength, goBack, openSearch, preferences, updatePreferences, zoomBy, bookmarked,
    onToggleBookmark, toggleFocus, settingsOpen, onOpenSettings, chromeVisible,
  } = props;
  const focusMode = preferences.focusMode;
  return (
    <header className={styles.header} data-reader-chrome inert={!chromeVisible}>
      <div className={styles.titleGroup}>
        <Button variant="ghost" size="reader-home" shape="pill" className="lg:me-3" aria-label="Back to library" title="Back to library"
          nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft /><span className={styles.wordmark} aria-hidden="true">Better Reader</span>
          <span className={styles.compactWordmark} aria-hidden="true">BK</span>
        </Button>
        <div className={styles.desktopOnly}>
          <Button variant="ghost" size="icon-touch" shape="pill" aria-label="Toggle document navigation" title="Document navigation (T)"
            aria-expanded={sidebarOpen} onClick={onToggleSidebar}><PanelLeft /></Button>
        </div>
        <div className={styles.titleText}>
          <h1 title={title}>{displayName(title)}</h1>
          <p><BookOpen aria-hidden="true" /><span>{chapterTitle}</span></p>
        </div>
      </div>
      <div className={styles.desktopOnly}>
        <PageControls {...pageControls} />
      </div>
      <div className={styles.toolbarActions}>
        <Button variant="ghost" size={coarsePointer ? "touch" : "icon-touch"} shape="pill" className="max-lg:data-[empty=true]:hidden"
          data-empty={!readingHistoryLength} aria-label="Back to previous location"
          title="Back to previous location" disabled={!readingHistoryLength} onClick={goBack}>
          <History />{coarsePointer && <span className={styles.backLabel}>Previous</span>}
        </Button>
        <Button variant="ghost" size="touch" shape="pill" aria-label="Search document" title="Search document (/ or Ctrl+F)" aria-keyshortcuts="/ Control+f Meta+f"
          aria-expanded={searchExpanded} disabled={!ready} onClick={openSearch}>
          <Search />
          <span className={styles.actionLabel}>Search</span>
        </Button>
        <div className={cn(styles.wideOnly, styles.zoomToolbar)}>
          <Button variant="ghost" size="icon-touch" shape="pill" aria-label="Zoom out" title="Zoom out (-)" disabled={!ready}
            onClick={() => zoomBy(-0.1)}><ZoomOut /></Button>
          <label className="sr-only" htmlFor="reader-view-mode">Page sizing</label>
          <select id="reader-view-mode" className={styles.modeSelect} value={preferences.viewMode}
            onChange={(event) => updatePreferences({ viewMode: event.target.value as ViewMode })}>
            <option value="fit-width">Fit width</option><option value="fit-page">Fit page</option>
            <option value="actual-size">100%</option><option value="custom">Custom · {Math.round(preferences.zoom * 100)}%</option>
          </select>
          <Button variant="ghost" size="icon-touch" shape="pill" aria-label="Zoom in" title="Zoom in (+)" disabled={!ready}
            onClick={() => zoomBy(0.1)}><ZoomIn /></Button>
        </div>
        <div className={cn(styles.desktopOnly, styles.toolbarGroup)}>
          <Button variant="ghost" size="icon-touch" shape="pill" aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
            title={bookmarked ? "Remove bookmark (B)" : "Bookmark this page (B)"} aria-pressed={bookmarked}
            disabled={!ready} onClick={onToggleBookmark}><Bookmark fill={bookmarked ? "currentColor" : "none"} /></Button>
          <Button variant="ghost" size={coarsePointer ? "touch" : "icon-touch"} shape="pill" aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
            title={focusMode ? "Exit focus mode (Z)" : "Focus mode (Z)"} aria-pressed={focusMode} onClick={toggleFocus}>
            <Focus />{coarsePointer && <span>Focus</span>}
          </Button>
        </div>
        <Button variant="reader-settings" size="touch" shape="pill" className="lg:ms-1" aria-label="Reading settings" title="Reading settings"
          aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={onOpenSettings}>
          <Settings2 />
          <span className={styles.actionLabel}>Settings</span>
        </Button>
      </div>
    </header>
  );
}
