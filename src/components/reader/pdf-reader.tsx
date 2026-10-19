"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Document, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import Link from "next/link";
import { AlertTriangle, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearStorageFailures, markStorageResult, storageBlockedSnapshot, subscribeStorageBlocked } from "@/lib/storage-health";
import { THEME_STORAGE_KEY, useTheme, writeTheme } from "@/components/theme";
import { KeyboardShortcuts, ReaderDialog } from "./chrome/reader-controls";
import { ReaderHeader, ReaderMobileFooter } from "./chrome/reader-toolbar";
import { ReaderSettingsDialog } from "./chrome/reader-settings-dialog";
import { useReaderKeyboard } from "./navigation/use-reader-keyboard";
import { useReadingSession } from "./navigation/use-reading-session";
import { ReaderViewport } from "./viewport/reader-viewport";
import { optionsForPdfSize } from "./reader-load-options";
import { ReaderSearchPanel, useReaderSearch } from "./search/reader-search";
import { ReaderScrubber } from "./chrome/reader-scrubber";
import { ReaderSidebar, type SidebarTab } from "./chrome/reader-sidebar";
import { activeChapter, useReaderOutline } from "./navigation/reader-outline";
import { clampZoom, paperPageColors } from "./reader-preferences";
import { readingProgress } from "@/lib/reading-progress";
import type { Size } from "./viewport/reader-geometry";
import styles from "./reader.module.css";

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
  return <BookReader key={id} id={id} title={title} fileSize={fileSize} />;
}

function BookReader({ id, title, fileSize }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticFocusRef = useRef(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const total = pdf?.numPages ?? null;
  const {
    reading, preferences, bookmarks, navigate, jump, goBack: back, observeLocation: onLocationChange,
    restore, toggleBookmark, updatePreferences, zoomBy: changeZoom, toggleFocusMode, save,
  } = useReadingSession(id, total);
  const pageNumber = reading.location.page;
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("contents");
  const [panel, setPanel] = useState<"settings" | "shortcuts" | null>(null);
  const focusMode = preferences.focusMode;
  const pageColors = useMemo(() => paperPageColors(preferences.paper), [preferences.paper]);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [programmaticFocus, setProgrammaticFocus] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const storageBlocked = useSyncExternalStore(subscribeStorageBlocked, storageBlockedSnapshot, () => false);
  const { theme, dark, setTheme } = useTheme();
  const outline = useReaderOutline(pdf, firstPageReady);
  const search = useReaderSearch(pdf, query, firstPageReady && sidebarOpen && sidebarTab === "search");
  const chapter = activeChapter(outline, pageNumber);
  const progress = total ? readingProgress(reading.location, total) : 0;
  const bookmarked = bookmarks.includes(pageNumber);
  const fullscreenSupported = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const chromeVisible = !focusMode || controlsVisible || panel !== null || sidebarOpen;

  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const css = getComputedStyle(node);
        const width = Math.floor(node.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight));
        const height = Math.floor(node.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom));
        setAvailable((previous) => previous.width === width && previous.height === height
          ? previous : { width, height });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pdf]);

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  useEffect(() => () => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const showFeedback = useCallback((text: string) => {
    setFeedback(text);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(""), 4000);
  }, []);

  // Focus moved by the reader itself must not paint the full-viewer focus ring.
  const markViewerFocus = useCallback((value: boolean) => {
    programmaticFocusRef.current = value;
    setProgrammaticFocus(value);
  }, []);

  // react-pdf's internal-link viewer retains its initial onItemClick callback.
  const latestJump = useRef(jump);
  useLayoutEffect(() => { latestJump.current = jump; }, [jump]);
  const onItemClick = useCallback(({ pageNumber }: { pageNumber: number }) => {
    if (pageNumber) latestJump.current(pageNumber);
  }, []);
  const goBack = useCallback(() => {
    if (!total) return;
    back();
    if (!desktop) setSidebarOpen(false);
  }, [total, desktop, back]);
  const onReady = useCallback(() => setFirstPageReady(true), []);

  const sidebarNavigate = useCallback((page: number) => {
    jump(page);
    if (!desktop) setSidebarOpen(false);
  }, [jump, desktop]);
  const openSearch = useCallback(() => {
    setSidebarTab("search");
    setSidebarOpen(true);
    setPanel(null);
    setControlsVisible(true);
    containerRef.current?.querySelector<HTMLInputElement>("[data-reader-search] input")?.focus();
  }, []);
  useEffect(() => {
    if (!sidebarOpen || sidebarTab !== "search") return;
    const timer = setTimeout(() => containerRef.current?.querySelector<HTMLInputElement>("[data-reader-search] input")?.focus(), 0);
    return () => clearTimeout(timer);
  }, [sidebarOpen, sidebarTab, desktop, firstPageReady]);

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

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (containerRef.current?.requestFullscreen) await containerRef.current.requestFullscreen();
      else showFeedback("Fullscreen isn't available in this browser.");
    } catch {
      showFeedback("Fullscreen couldn't be opened. You can still use focus mode.");
    }
  }, [showFeedback]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (focusTimer.current) clearTimeout(focusTimer.current);
    if (!focusMode) return;
    focusTimer.current = setTimeout(() => {
      const active = document.activeElement;
      if (!active?.closest("[data-reader-chrome], dialog[open]")) setControlsVisible(false);
    }, 2400);
  }, [focusMode]);

  const toggleFocus = useCallback(() => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    toggleFocusMode();
    setControlsVisible(false);
    setPanel(null);
    setSidebarOpen(false);
    // Only chase focus when the element holding it is about to become inert.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest("dialog[open], [data-reader-chrome]")) return;
    // Wait for the native modal to close before moving focus out of its inert background,
    // and keep the programmatic move from painting the full-viewer focus ring.
    markViewerFocus(true);
    requestAnimationFrame(() => viewerRef.current?.focus({ preventScroll: true }));
  }, [markViewerFocus, toggleFocusMode]);

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
    historyLength: reading.history.length,
    markViewerFocus,
    programmaticFocusRef,
    pdf,
    panel,
    sidebarOpen,
    focusMode,
    setSidebarOpen,
    setPanel,
  });

  const onDocumentLoad = useCallback((document: PDFDocumentProxy) => {
    restore(document.numPages);
    setFirstPageReady(false);
    setPdf(document);
    setLoadError(false);
  }, [restore]);

  const pageControls = { page: pageNumber, total, onNavigate: navigate, onSeek: jump, onMessage: showFeedback };
  const toggleSidebar = () => setSidebarOpen((value) => !value);
  const toggleCurrentBookmark = () => toggleBookmark(pageNumber);

  const sidebar = total && pdf ? <ReaderSidebar pdf={pdf} outline={outline} total={total} current={pageNumber}
    tab={sidebarTab} onTabChange={setSidebarTab} bookmarks={bookmarks}
    pageColors={pageColors}
    onNavigate={sidebarNavigate} onToggleBookmark={toggleBookmark}
    searchPanel={<ReaderSearchPanel query={query} onQueryChange={setQuery} state={search}
      currentPage={pageNumber} onNavigate={sidebarNavigate} />} /> : null;

  return (
    <div ref={containerRef} className={cn(styles.root, dark && "dark")} data-reader-root
      data-theme={dark ? "dark" : "light"} data-paper={preferences.paper}
      data-focus-mode={focusMode} data-controls-visible={chromeVisible} data-reader-busy={busy}
      onPointerDown={() => { if (programmaticFocusRef.current) markViewerFocus(false); }}
      onPointerMove={(event) => {
        if (!focusMode || event.pointerType !== "mouse" || event.buttons || !(event.movementX || event.movementY) || window.getSelection()?.toString()) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientY < bounds.top + 64 || event.clientY > bounds.bottom - 64) revealControls();
      }} onFocusCapture={(event) => {
        if ((event.target as Element).closest("[data-reader-chrome]")) revealControls();
      }}>
      <ReaderHeader
        title={title}
        chapterTitle={chapter?.title ?? (total ? `${total} pages` : "PDF reader")}
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
        onOpenSettings={() => setPanel("settings")}
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
        onLoadSuccess={onDocumentLoad} onLoadError={() => setLoadError(true)}
        onItemClick={onItemClick}
        loading={<main className={styles.documentStatusMain}>
          <div className={styles.documentStatus} role="status">
            <div className={styles.loadingPage} aria-hidden="true"><span /><span /><span /><span /><span /></div>
            <p>Opening your PDF…</p>
          </div>
        </main>}
        error={<main className={styles.documentStatusMain}>
          <div className={styles.documentStatus} role="alert"><p>{loadError ? "This PDF couldn't be opened." : "Unable to open this PDF."}</p>
            <p>Try again, or return to your library.</p>
            <Button variant="outline" size="touch" onClick={() => { setPdf(null); setAttempt((n) => n + 1); }}>Try again</Button>
            <Link href="/" className={styles.textLink}>Back to library</Link></div>
        </main>}>
        {sidebarOpen && desktop && <aside id="reader-sidebar" className={styles.sidebar} data-reader-sidebar>
          <div className={styles.sidebarHeading}><h2>Document navigation</h2>
            <Button variant="ghost" size="icon-touch" aria-label="Close document navigation" onClick={() => setSidebarOpen(false)}><X /></Button>
          </div>{sidebar}
        </aside>}
        <main ref={viewerRef} className={styles.viewer} tabIndex={0} aria-label="PDF page viewer"
          data-programmatic-focus={programmaticFocus || undefined}
          onClick={(event) => {
            if (event.defaultPrevented || !focusMode || (event.target as Element).closest("a, button, input, select") || window.getSelection()?.toString()) return;
            if (controlsVisible) setControlsVisible(false); else revealControls();
          }}>
          {pdf && <ReaderViewport pdf={pdf} pageNumber={pageNumber} layout={preferences.layout} viewMode={preferences.viewMode}
            zoom={preferences.zoom} cropMargins={preferences.cropMargins} available={available} scrollRef={viewerRef}
            navigation={reading.navigation} onLocationChange={onLocationChange} onScaleChange={setEffectiveScale}
            onReady={onReady} onBusyChange={setBusy} highlightText={search.highlightText}
            onZoomChange={onGestureZoom} pageColors={pageColors} />}
        </main>
        <ReaderDialog open={sidebarOpen && !desktop} title="Document navigation" navigation onClose={() => setSidebarOpen(false)}>
          <div className={styles.mobileSidebar} data-reader-sidebar>{sidebarOpen && !desktop ? sidebar : null}</div>
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
        onClose={() => setPanel(null)}
        preferences={preferences}
        updatePreferences={updatePreferences}
        pdf={pdf}
        effectiveScale={effectiveScale}
        zoomBy={zoomBy}
        theme={theme}
        setTheme={setTheme}
        focusMode={focusMode}
        toggleFocus={toggleFocus}
        fullscreenSupported={fullscreenSupported}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onOpenShortcuts={() => setPanel("shortcuts")}
        storageBlocked={storageBlocked}
      />
      <ReaderDialog open={panel === "shortcuts"} title="Keyboard shortcuts" onClose={() => setPanel(null)}><KeyboardShortcuts /></ReaderDialog>
      <div className="sr-only" role="status" aria-live="polite">Page {pageNumber}{total ? ` of ${total}` : ""}. {bookmarked ? "Bookmarked." : ""}</div>
    </div>
  );
}
