"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Document, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { AlertTriangle, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearStorageFailures, markStorageResult, storageBlockedSnapshot, subscribeStorageBlocked } from "@/lib/storage-health";
import { THEME_STORAGE_KEY, useTheme, writeTheme } from "@/components/theme";
import { ReaderDialog } from "./chrome/reader-dialog";
import { KeyboardShortcuts } from "./chrome/reader-shortcuts";
import { ReaderHeader } from "./chrome/reader-header";
import { ReaderMobileFooter } from "./chrome/reader-mobile-footer";
import { ReaderSettingsDialog } from "./chrome/reader-settings-dialog";
import { useReaderKeyboard } from "./chrome/use-reader-keyboard";
import { useReaderChrome } from "./chrome/use-reader-chrome";
import { useReadingSession } from "./navigation/use-reading-session";
import { ReaderViewport } from "./viewport/reader-viewport";
import { optionsForPdfSize } from "./reader-load-options";
import { ReaderSearchPanel } from "./search/reader-search-panel";
import { useReaderSearch } from "./search/use-reader-search";
import { ReaderScrubber } from "./chrome/reader-scrubber";
import { ReaderSidebar } from "./chrome/reader-sidebar";
import { activeChapter } from "./navigation/reader-outline";
import { useReaderOutline } from "./navigation/use-reader-outline";
import { clampZoom, paperPageColors } from "./reader-preferences";
import { readingProgress } from "@/lib/reading-progress";
import { usePdfDocument } from "./use-pdf-document";
import { useViewerSize } from "./use-viewer-size";
import { ReaderDocumentError, ReaderDocumentLoading } from "./reader-document-status";
import styles from "./reader.module.css";
import chromeStyles from "./chrome/reader-chrome.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

function useMediaQuery(query: string) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

type PdfReaderProps = { id: string; title: string; fileSize?: number };

export function PdfReader({ id, title, fileSize }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const { pdf, attempt, loadError, firstPageReady, setFirstPageReady, onDocumentLoad: setDocument, onLoadError, retry } = usePdfDocument();
  const pageCount = pdf?.numPages ?? null;
  const {
    reading, preferences, bookmarks, navigate, jump, goBack: back, observeLocation: onLocationChange,
    restore, toggleBookmark, updatePreferences, zoomBy: changeZoom, save,
  } = useReadingSession(id, pageCount);
  const pageNumber = reading.location.page;
  const available = useViewerSize(viewerRef, pdf);
  const [effectiveScale, setEffectiveScale] = useState(1);
  const focusMode = preferences.focusMode;
  const pageColors = useMemo(() => paperPageColors(preferences.paper), [preferences.paper]);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const onFocusModeChange = useCallback((focusMode: boolean) => updatePreferences({ focusMode }), [updatePreferences]);
  const {
    sidebarOpen, sidebarTab, panel, controlsVisible, chromeVisible, feedback, programmaticFocus,
    isFullscreen, fullscreenSupported, closeSidebar, toggleSidebar, selectSidebarTab,
    closePanel, openSettings, openShortcuts, openSearch, closeTopmostPanel, toggleFullscreen,
    toggleFocus, revealControls, hideControls, showFeedback, clearProgrammaticFocus,
  } = useReaderChrome({ containerRef, viewerRef, desktop, ready: firstPageReady, focusMode, onFocusModeChange });
  const storageBlocked = useSyncExternalStore(subscribeStorageBlocked, storageBlockedSnapshot, () => false);
  const { theme, dark, setTheme } = useTheme();
  const outline = useReaderOutline(pdf, firstPageReady);
  const search = useReaderSearch(pdf, query, firstPageReady && sidebarOpen && sidebarTab === "search");
  const chapter = activeChapter(outline, pageNumber);
  const progress = pageCount ? readingProgress(reading.location, pageCount) : 0;
  const bookmarked = bookmarks.includes(pageNumber);

  // react-pdf's internal-link viewer retains its initial onItemClick callback.
  const latestJump = useRef(jump);
  useLayoutEffect(() => { latestJump.current = jump; }, [jump]);
  const onItemClick = useCallback(({ pageNumber }: { pageNumber: number }) => {
    if (pageNumber) latestJump.current(pageNumber);
  }, []);
  const goBack = useCallback(() => {
    if (!pageCount) return;
    back();
    if (!desktop) closeSidebar();
  }, [pageCount, desktop, back, closeSidebar]);
  const onReady = useCallback(() => setFirstPageReady(true), [setFirstPageReady]);

  const sidebarNavigate = useCallback((page: number) => {
    jump(page);
    if (!desktop) closeSidebar();
  }, [jump, desktop, closeSidebar]);

  const retryStorage = useCallback(() => {
    clearStorageFailures();
    const saved = save();
    // A retry writes every value that can fail; each key then clears only its own failure.
    const themeSaved = writeTheme(theme);
    markStorageResult(THEME_STORAGE_KEY, themeSaved);
    if (saved && themeSaved) {
      showFeedback("Browser storage works again. Your place and bookmarks will be saved on this device.");
    }
  }, [save, showFeedback, theme]);

  const onGestureZoom = useCallback((zoom: number) => {
    updatePreferences({ viewMode: "custom", zoom: clampZoom(zoom) });
  }, [updatePreferences]);

  const zoomBy = useCallback((delta: number) => {
    changeZoom(delta, effectiveScale);
  }, [changeZoom, effectiveScale]);

  useReaderKeyboard({
    navigate,
    pageNumber,
    toggleBookmark,
    toggleFocus,
    toggleFullscreen,
    updatePreferences,
    zoomBy,
    openSearch,
    goBack,
    canGoBack: reading.history.length > 0,
    ready: Boolean(pdf),
    panelOpen: panel !== null,
    clearProgrammaticFocus,
    toggleSidebar,
    openShortcuts,
    closeTopmostPanel,
  });

  const onDocumentLoad = useCallback((document: PDFDocumentProxy) => {
    restore(document.numPages);
    setDocument(document);
  }, [restore, setDocument]);

  const pageControls = { page: pageNumber, pageCount, onNavigate: navigate, onSeek: jump, onMessage: showFeedback };
  const toggleCurrentBookmark = () => toggleBookmark(pageNumber);

  const sidebar = pageCount && pdf ? <ReaderSidebar pdf={pdf} outline={outline} pageCount={pageCount} current={pageNumber}
    tab={sidebarTab} onTabChange={selectSidebarTab} bookmarks={bookmarks}
    pageColors={pageColors}
    onNavigate={sidebarNavigate} onToggleBookmark={toggleBookmark}
    searchPanel={<ReaderSearchPanel query={query} onQueryChange={setQuery} state={search}
      currentPage={pageNumber} onNavigate={sidebarNavigate} />} /> : null;

  return (
    <div ref={containerRef} className={cn(styles.root, dark && "dark")} data-reader-root
      data-theme={dark ? "dark" : "light"} data-paper={preferences.paper}
      data-focus-mode={focusMode} data-controls-visible={chromeVisible} data-reader-busy={busy}
      onPointerDown={clearProgrammaticFocus}
      onPointerMove={(event) => {
        if (!focusMode || event.pointerType !== "mouse" || event.buttons || !(event.movementX || event.movementY) || window.getSelection()?.toString()) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientY < bounds.top + 64 || event.clientY > bounds.bottom - 64) revealControls();
      }} onFocusCapture={(event) => {
        if ((event.target as Element).closest("[data-reader-chrome]")) revealControls();
      }}>
      <ReaderHeader
        title={title}
        chapterTitle={chapter?.title ?? (pageCount ? `${pageCount} pages` : "PDF reader")}
        pageControls={pageControls}
        sidebarOpen={sidebarOpen}
        searchExpanded={sidebarOpen && sidebarTab === "search"}
        onToggleSidebar={toggleSidebar}
        ready={Boolean(pdf)}
        coarsePointer={coarsePointer}
        readingHistoryLength={reading.history.length}
        goBack={goBack}
        openSearch={openSearch}
        preferences={preferences}
        updatePreferences={updatePreferences}
        zoomBy={zoomBy}
        bookmarked={bookmarked}
        onToggleBookmark={toggleCurrentBookmark}
        toggleFocus={toggleFocus}
        settingsOpen={panel === "settings"}
        onOpenSettings={openSettings}
        chromeVisible={chromeVisible}
      />

      <div className={styles.progress} role="region" aria-label="Reading status">
        <div role="progressbar" aria-label="Reading progress" aria-valuenow={progress}
          aria-valuemin={0} aria-valuemax={100} style={{ transform: `scaleX(${progress / 100})` }} />
      </div>

      {storageBlocked && (
        <div className={styles.storageWarning} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <p>Browser storage is unavailable. Your place and bookmarks won&apos;t be saved on this device.</p>
          <Button variant="outline" size="touch" onClick={retryStorage}>Retry saving</Button>
        </div>
      )}

      <Document key={attempt} className={styles.document} file={`/api/pdfs/${id}`} options={optionsForPdfSize(fileSize)} suspense={false}
        onLoadSuccess={onDocumentLoad} onLoadError={onLoadError}
        onItemClick={onItemClick}
        loading={<ReaderDocumentLoading />}
        error={<ReaderDocumentError loadError={loadError} onRetry={retry} />}>
        {sidebarOpen && desktop && <aside id="reader-sidebar" className={chromeStyles.sidebar} data-reader-sidebar>
          <div className={chromeStyles.sidebarHeading}><h2>Document navigation</h2>
            <Button variant="ghost" size="icon-touch" shape="pill" aria-label="Close document navigation" onClick={closeSidebar}><X /></Button>
          </div>{sidebar}
        </aside>}
        <main ref={viewerRef} className={styles.viewer} tabIndex={0} aria-label="PDF page viewer"
          data-programmatic-focus={programmaticFocus || undefined}
          onClick={(event) => {
            if (event.defaultPrevented || !focusMode || (event.target as Element).closest("a, button, input, select") || window.getSelection()?.toString()) return;
            if (controlsVisible) hideControls(); else revealControls();
          }}>
          {pdf && <ReaderViewport pdf={pdf} pageNumber={pageNumber} layout={preferences.layout} viewMode={preferences.viewMode}
            zoom={preferences.zoom} cropMargins={preferences.cropMargins} available={available} scrollRef={viewerRef}
            navigation={reading.navigation} onLocationChange={onLocationChange} onScaleChange={setEffectiveScale}
            onReady={onReady} onBusyChange={setBusy} highlightText={search.highlightText}
            onZoomChange={onGestureZoom} pageColors={pageColors} />}
        </main>
        <ReaderDialog open={sidebarOpen && !desktop} title="Document navigation" navigation onClose={closeSidebar}>
          <div className={chromeStyles.mobileSidebar} data-reader-sidebar>{sidebarOpen && !desktop ? sidebar : null}</div>
        </ReaderDialog>
      </Document>

      {pdf && firstPageReady && <ReaderScrubber pdf={pdf} page={pageNumber} progress={progress} outline={outline}
        pageColors={pageColors} onCommit={jump} hidden={!chromeVisible} />}

      <ReaderMobileFooter
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        ready={Boolean(pdf)}
        pageControls={pageControls}
        bookmarked={bookmarked}
        onToggleBookmark={toggleCurrentBookmark}
        chromeVisible={chromeVisible}
      />

      {feedback && <div className={styles.toast} role="status" aria-live="polite">{feedback}</div>}

      {focusMode && !chromeVisible && <div className={styles.revealControl}>
        <Button variant="secondary" size="icon-touch" aria-label="Show reading controls" title="Show reading controls"
          onClick={revealControls}><Eye /></Button>
      </div>}

      <ReaderSettingsDialog
        open={panel === "settings"}
        onClose={closePanel}
        preferences={preferences}
        updatePreferences={updatePreferences}
        ready={Boolean(pdf)}
        effectiveScale={effectiveScale}
        zoomBy={zoomBy}
        theme={theme}
        setTheme={setTheme}
        focusMode={focusMode}
        toggleFocus={toggleFocus}
        fullscreenSupported={fullscreenSupported}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onOpenShortcuts={openShortcuts}
        storageBlocked={storageBlocked}
      />
      <ReaderDialog open={panel === "shortcuts"} title="Keyboard shortcuts" onClose={closePanel}><KeyboardShortcuts /></ReaderDialog>
      <div className="sr-only" role="status" aria-live="polite">Page {pageNumber}{pageCount ? ` of ${pageCount}` : ""}. {bookmarked ? "Bookmarked." : ""}</div>
    </div>
  );
}
