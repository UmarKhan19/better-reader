"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { Document, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Bookmark, BookOpen, Eye, Focus, History, Keyboard, Maximize, Minimize,
  PanelLeft, Search, Settings2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme";
import { KeyboardShortcuts, PageControls, RadioChoices, ReaderDialog } from "./reader-controls";
import { ReaderViewport } from "./reader-viewport";
import { optionsForPdfSize } from "./reader-load-options";
import { ReaderSearchPanel, useReaderSearch } from "./reader-search";
import { ReaderScrubber } from "./reader-scrubber";
import { activeChapter, ReaderSidebar, useReaderOutline, type SidebarTab } from "./reader-sidebar";
import {
  clampPage, clampZoom, createProgressWriter, initialNavigation, parseBookmarks, parsePreferences, parseReadingLocation,
  paperPageColors, readerNavigationReducer, readingProgress, readStorage, setStorageBlocked, storageBlockedSnapshot, storageKey,
  subscribeStorageBlocked, writeStorage,
  type ReaderLayout, type ReaderPreferences, type ReadingLocation, type Size, type ViewMode,
} from "./reader-state";
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
  const [reading, dispatchNavigation] = useReducer(readerNavigationReducer, id,
    (bookId) => initialNavigation(parseReadingLocation(readStorage(storageKey("progress", bookId)))));
  const pageNumber = reading.location.page;
  const [preferences, setPreferences] = useState(() => parsePreferences(readStorage(storageKey("settings", id))));
  const [bookmarks, setBookmarks] = useState(() => parseBookmarks(readStorage(storageKey("bookmarks", id))));
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
  const total = pdf?.numPages ?? null;
  const progress = total ? readingProgress(reading.location, total) : 0;
  const bookmarked = bookmarks.includes(pageNumber);
  const fullscreenSupported = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  const chromeVisible = !focusMode || controlsVisible || panel !== null || sidebarOpen;

  useEffect(() => {
    writeStorage(storageKey("settings", id), preferences);
  }, [id, preferences]);
  const progressWriter = useMemo(() => createProgressWriter((value) => writeStorage(storageKey("progress", id), value)), [id]);
  useEffect(() => {
    if (total) progressWriter.update(reading.location, total);
  }, [progressWriter, reading.location, total]);
  useEffect(() => {
    const flushHidden = () => { if (document.visibilityState === "hidden") progressWriter.flush(); };
    window.addEventListener("pagehide", progressWriter.flush);
    document.addEventListener("visibilitychange", flushHidden);
    return () => {
      window.removeEventListener("pagehide", progressWriter.flush);
      document.removeEventListener("visibilitychange", flushHidden);
      progressWriter.flush();
    };
  }, [progressWriter]);
  useEffect(() => {
    writeStorage(storageKey("bookmarks", id), bookmarks);
  }, [id, bookmarks]);

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

  const requestNavigation = useCallback((page: number, remember = false) => {
    if (!total || !Number.isFinite(page)) return;
    const next = clampPage(page, total);
    performance.clearMarks("reader:page-request");
    performance.mark("reader:page-request", { detail: { page: next } });
    dispatchNavigation({ type: "jump", location: { page: next, offset: 0 }, total, remember });
  }, [total]);
  const navigate = useCallback((page: number) => requestNavigation(page), [requestNavigation]);
  const jump = useCallback((page: number) => requestNavigation(page, true), [requestNavigation]);
  // react-pdf's internal-link viewer retains its initial onItemClick callback.
  const latestJump = useRef(jump);
  useLayoutEffect(() => { latestJump.current = jump; }, [jump]);
  const onItemClick = useCallback(({ pageNumber }: { pageNumber: number }) => {
    if (pageNumber) latestJump.current(pageNumber);
  }, []);
  const goBack = useCallback(() => {
    if (!total) return;
    performance.clearMarks("reader:page-request");
    performance.mark("reader:page-request");
    dispatchNavigation({ type: "back", total });
    if (!desktop) setSidebarOpen(false);
  }, [total, desktop]);
  const onLocationChange = useCallback((location: ReadingLocation) => {
    if (total) dispatchNavigation({ type: "scroll", location, total });
  }, [total]);
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

  const toggleBookmark = useCallback((page: number) => {
    if (!total) return;
    const value = clampPage(page, total);
    setBookmarks((previous) => previous.includes(value)
      ? previous.filter((n) => n !== value) : [...previous, value].sort((a, b) => a - b));
  }, [total]);

  const updatePreferences = useCallback((update: Partial<ReaderPreferences>) => {
    setPreferences((previous) => ({ ...previous, ...update }));
  }, []);

  const retryStorage = useCallback(() => {
    const saved = [
      writeStorage(storageKey("settings", id), preferences),
      writeStorage(storageKey("bookmarks", id), bookmarks),
    ];
    if (total) {
      saved.push(writeStorage(storageKey("progress", id), {
        page: reading.location.page, offset: reading.location.offset, numPages: total,
      }));
    }
    setStorageBlocked(!saved.every(Boolean));
    if (saved.every(Boolean)) {
      showFeedback("Browser storage works again. Your place and bookmarks will be saved on this device.");
    }
  }, [id, preferences, bookmarks, total, reading.location, showFeedback]);

  const onGestureZoom = useCallback((zoom: number) => {
    updatePreferences({ viewMode: "custom", zoom: clampZoom(zoom) });
  }, [updatePreferences]);

  const zoomBy = useCallback((delta: number) => {
    setPreferences((previous) => ({
      ...previous, viewMode: "custom",
      zoom: clampZoom((previous.viewMode === "custom" ? previous.zoom : effectiveScale) + delta),
    }));
  }, [effectiveScale]);

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
    setPreferences((previous) => ({ ...previous, focusMode: !previous.focusMode }));
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
  }, [markViewerFocus]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Tab" && programmaticFocusRef.current) markViewerFocus(false);
      const target = event.target instanceof Element ? event.target : null;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f" && pdf && panel === null) {
        event.preventDefault(); openSearch(); return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft" && reading.history.length && panel === null) {
        event.preventDefault(); goBack(); return;
      }
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog[open]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        // One thing at a time: Escape first closes the open panel/sidebar, and only
        // a second Escape leaves focus mode.
        if (sidebarOpen) setSidebarOpen(false);
        else if (focusMode) updatePreferences({ focusMode: false });
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "/") openSearch();
      else if (key === "t") setSidebarOpen((value) => !value);
      else if (key === "b") toggleBookmark(pageNumber);
      else if (key === "z") toggleFocus();
      else if (key === "f") void toggleFullscreen();
      else if (key === "?") setPanel("shortcuts");
      else if (target?.closest("[data-reader-sidebar]")) return;
      else if (event.key === "ArrowLeft" || event.key === "PageUp") navigate(pageNumber - 1);
      else if (event.key === "ArrowRight" || event.key === "PageDown") navigate(pageNumber + 1);
      else if (event.key === "+" || event.key === "=") zoomBy(0.1);
      else if (event.key === "-") zoomBy(-0.1);
      else if (event.key === "0") updatePreferences({ viewMode: "fit-width" });
      else if (event.key === "1") updatePreferences({ viewMode: "actual-size", zoom: 1 });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, pageNumber, toggleBookmark, toggleFocus, toggleFullscreen, updatePreferences, zoomBy, pdf, panel, openSearch, goBack, reading.history.length, markViewerFocus, sidebarOpen, focusMode]);

  const onDocumentLoad = useCallback((document: PDFDocumentProxy) => {
    dispatchNavigation({ type: "restore", total: document.numPages });
    setFirstPageReady(false);
    setBookmarks((pages) => pages.filter((page) => page <= document.numPages));
    setPdf(document);
    setLoadError(false);
  }, []);

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
      <header className={styles.header} data-reader-chrome inert={!chromeVisible}>
        <div className={styles.titleGroup}>
          <Button variant="ghost" size="icon-touch" aria-label="Back to library" title="Back to library"
            nativeButton={false} render={<Link href="/" />}><ArrowLeft /></Button>
          <div className={styles.desktopOnly}>
            <Button variant="ghost" size="icon-touch" aria-label="Toggle document navigation" title="Document navigation (T)"
              aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}><PanelLeft /></Button>
          </div>
          <div className={styles.titleText}>
            <h1 title={title}>{title}</h1>
            <p>{chapter?.title ?? (total ? `${total} pages` : "PDF reader")}</p>
          </div>
        </div>
        <div className={styles.desktopOnly}>
          <PageControls page={pageNumber} total={total} onNavigate={navigate} onSeek={jump} onMessage={showFeedback} />
        </div>
        <div className={styles.toolbarActions}>
          <Button variant="ghost" size={coarsePointer ? "touch" : "icon-touch"} aria-label="Back to previous location"
            title="Back to previous location" disabled={!reading.history.length} onClick={goBack}>
            <History />{coarsePointer && <span className={styles.backLabel}>Previous</span>}
          </Button>
          <Button variant="ghost" size="touch" aria-label="Search document" title="Search document (/ or Ctrl+F)" aria-keyshortcuts="/ Control+f Meta+f"
            aria-expanded={sidebarOpen && sidebarTab === "search"} disabled={!pdf} onClick={openSearch}>
            <Search />
            <span className="hidden xl:inline text-sm">Search</span>
          </Button>
          <div className={styles.wideOnly}>
            <label className="sr-only" htmlFor="reader-view-mode">Page sizing</label>
            <select id="reader-view-mode" className={styles.modeSelect} value={preferences.viewMode}
              onChange={(event) => updatePreferences({ viewMode: event.target.value as ViewMode })}>
              <option value="fit-width">Fit width</option><option value="fit-page">Fit page</option>
              <option value="actual-size">100%</option><option value="custom">Custom · {Math.round(preferences.zoom * 100)}%</option>
            </select>
            <Button variant="ghost" size="icon-touch" aria-label="Zoom out" title="Zoom out (-)" disabled={!pdf}
              onClick={() => zoomBy(-0.1)}><ZoomOut /></Button>
            <Button variant="ghost" size="icon-touch" aria-label="Zoom in" title="Zoom in (+)" disabled={!pdf}
              onClick={() => zoomBy(0.1)}><ZoomIn /></Button>
          </div>
          <div className={styles.desktopOnly}>
            <Button variant="ghost" size="icon-touch" aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
              title={bookmarked ? "Remove bookmark (B)" : "Bookmark this page (B)"} aria-pressed={bookmarked}
              disabled={!pdf} onClick={() => toggleBookmark(pageNumber)}><Bookmark fill={bookmarked ? "currentColor" : "none"} /></Button>
            <Button variant="ghost" size={coarsePointer ? "touch" : "icon-touch"} aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
              title={focusMode ? "Exit focus mode (Z)" : "Focus mode (Z)"} aria-pressed={focusMode} onClick={toggleFocus}>
              <Focus />{coarsePointer && <span>Focus</span>}
            </Button>
          </div>
          <Button variant="ghost" size="touch" aria-label="Reading settings" title="Reading settings"
            aria-haspopup="dialog" onClick={() => setPanel("settings")}>
            <Settings2 />
            <span className="hidden xl:inline text-sm">Settings</span>
          </Button>
        </div>
      </header>

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
          <div className={styles.documentStatus} role="status"><BookOpen size={28} /><p>Opening your PDF…</p></div>
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

      {pdf && firstPageReady && <ReaderScrubber pdf={pdf} page={pageNumber} outline={outline}
        pageColors={pageColors} onCommit={jump} hidden={!chromeVisible} />}

      <nav className={styles.mobileFooter} aria-label="Page navigation" data-reader-chrome inert={!chromeVisible}>
        <Button variant="ghost" size="icon-touch" aria-label="Toggle document navigation" aria-expanded={sidebarOpen}
          disabled={!pdf} onClick={() => setSidebarOpen((value) => !value)}><PanelLeft /></Button>
        <PageControls page={pageNumber} total={total} onNavigate={navigate} onSeek={jump} onMessage={showFeedback} />
        <Button variant="ghost" size="icon-touch" aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
          aria-pressed={bookmarked} disabled={!pdf} onClick={() => toggleBookmark(pageNumber)}>
          <Bookmark fill={bookmarked ? "currentColor" : "none"} /></Button>
      </nav>

      {feedback && <div className={styles.toast} role="status" aria-live="polite">{feedback}</div>}

      {focusMode && !chromeVisible && <div className={styles.revealControl}>
        <Button variant="secondary" size="icon-touch" aria-label="Show reading controls" title="Show reading controls"
          onClick={revealControls}><Eye /></Button>
      </div>}

      <ReaderDialog open={panel === "settings"} title="Reading settings" onClose={() => setPanel(null)}>
        <div className={styles.settings}>
          <label className={styles.settingGroup}>
            <span>Reading layout</span>
            <select value={preferences.layout} onChange={(event) => updatePreferences({ layout: event.target.value as ReaderLayout })}>
              <option value="continuous">Continuous scroll</option><option value="single">Single page</option>
              <option value="spread">Two-page spread</option>
            </select>
          </label>
          <p className={styles.settingsNote}>Two-page spread uses continuous scroll on narrow screens. {storageBlocked ? "This choice can't be saved on this device right now." : "Your layout choice stays saved."}</p>
          <label className={styles.toggleSetting}>
            <span>Fit content <small>Hide blank margins without changing the PDF.</small></span>
            <input type="checkbox" role="switch" checked={preferences.cropMargins}
              onChange={(event) => updatePreferences({ cropMargins: event.target.checked })} />
          </label>
          <label className={styles.settingGroup}>
            <span>Page sizing</span>
            <select value={preferences.viewMode} onChange={(event) => updatePreferences({ viewMode: event.target.value as ViewMode })}>
              <option value="fit-width">Fit width</option><option value="fit-page">Fit page</option>
              <option value="actual-size">Actual size · 100%</option><option value="custom">Custom zoom</option>
            </select>
          </label>
          <div className={styles.settingGroup}><span>Zoom</span><div className={styles.zoomControls}>
            <Button variant="outline" size="icon-touch" aria-label="Zoom out" disabled={!pdf} onClick={() => zoomBy(-0.1)}><ZoomOut /></Button>
            <output aria-label="Zoom level">{Math.round((preferences.viewMode === "custom" ? preferences.zoom : effectiveScale) * 100)}%</output>
            <Button variant="outline" size="icon-touch" aria-label="Zoom in" disabled={!pdf} onClick={() => zoomBy(0.1)}><ZoomIn /></Button>
          </div></div>
          <RadioChoices legend="Interface theme" value={theme}
            onChange={(value) => { if (!setTheme(value)) setStorageBlocked(true); }}
            options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          <p className={styles.settingsNote}>The theme applies to your library and every book.{storageBlocked && " It won't survive a reload until browser storage works again."}</p>
          <RadioChoices legend="Paper" value={preferences.paper} onChange={(paper) => updatePreferences({ paper })}
            options={[{ value: "original", label: "Original" }, { value: "dimmed", label: "Dimmed" }, { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" }]} />
          <p className={styles.settingsNote}>Paper modes change brightness, warmth, or contrast. Dark mode recolors the whole page, including diagrams and images. {storageBlocked ? "This setting can't be saved on this device right now." : "These settings are saved for this book."}</p>
          <div className={styles.settingsActions}>
            <Button variant="outline" size="touch" onClick={toggleFocus}><Focus />{focusMode ? "Exit focus mode" : "Enter focus mode"}</Button>
            <Button variant="outline" size="touch" disabled={!fullscreenSupported} title="Toggle fullscreen (F)"
              onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <Minimize /> : <Maximize />}{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</Button>
            <Button variant="ghost" size="touch" onClick={() => setPanel("shortcuts")}><Keyboard />Keyboard shortcuts</Button>
          </div>
          <p className={styles.settingsNote}>Focus mode hides the toolbar so only the page stays in view. Fullscreen fills your screen with the reader. You can use both together.</p>
        </div>
      </ReaderDialog>
      <ReaderDialog open={panel === "shortcuts"} title="Keyboard shortcuts" onClose={() => setPanel(null)}><KeyboardShortcuts /></ReaderDialog>
      <div className="sr-only" role="status" aria-live="polite">Page {pageNumber}{total ? ` of ${total}` : ""}. {bookmarked ? "Bookmarked." : ""}</div>
    </div>
  );
}
