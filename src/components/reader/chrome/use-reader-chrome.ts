"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from "react";
import { INITIAL_READER_UI, readerUiReducer, type SidebarTab } from "./reader-ui-state";

/** Owns panels, focus, fullscreen and feedback for one keyed book lifetime. */
export function useReaderChrome({ containerRef, viewerRef, desktop, ready, focusMode, onFocusModeChange }: {
  containerRef: RefObject<HTMLDivElement | null>;
  viewerRef: RefObject<HTMLElement | null>;
  desktop: boolean;
  ready: boolean;
  focusMode: boolean;
  onFocusModeChange: (enabled: boolean) => void;
}) {
  const [ui, dispatch] = useReducer(readerUiReducer, INITIAL_READER_UI);
  const [feedback, setFeedback] = useState("");
  const [programmaticFocus, setProgrammaticFocus] = useState(false);
  const programmaticFocusRef = useRef(false);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFrame = useRef<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;

  useEffect(() => {
    const changed = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [containerRef]);
  useEffect(() => () => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, []);

  const showFeedback = useCallback((text: string) => {
    setFeedback(text);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(""), 4000);
  }, []);
  const markViewerFocus = useCallback((value: boolean) => {
    programmaticFocusRef.current = value;
    setProgrammaticFocus(value);
  }, []);
  const clearProgrammaticFocus = useCallback(() => {
    if (programmaticFocusRef.current) markViewerFocus(false);
  }, [markViewerFocus]);
  const closeSidebar = useCallback(() => dispatch({ type: "close-sidebar" }), []);
  const toggleSidebar = useCallback(() => dispatch({ type: "toggle-sidebar" }), []);
  const selectSidebarTab = useCallback((tab: SidebarTab) => dispatch({ type: "tab", tab }), []);
  const closePanel = useCallback(() => dispatch({ type: "panel", panel: null }), []);
  const openSettings = useCallback(() => dispatch({ type: "panel", panel: "settings" }), []);
  const openShortcuts = useCallback(() => dispatch({ type: "panel", panel: "shortcuts" }), []);
  const openSearch = useCallback(() => {
    dispatch({ type: "search" });
    containerRef.current?.querySelector<HTMLInputElement>("[data-reader-search] input")?.focus();
  }, [containerRef]);
  useEffect(() => {
    if (!ui.sidebarOpen || ui.sidebarTab !== "search") return;
    const timer = setTimeout(() => containerRef.current?.querySelector<HTMLInputElement>("[data-reader-search] input")?.focus(), 0);
    return () => clearTimeout(timer);
  }, [ui.sidebarOpen, ui.sidebarTab, desktop, ready, containerRef]);

  const closeTopmostPanel = useCallback(() => {
    if (ui.panel !== null || ui.sidebarOpen) dispatch({ type: "dismiss" });
    else if (focusMode) onFocusModeChange(false);
  }, [ui.panel, ui.sidebarOpen, focusMode, onFocusModeChange]);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (containerRef.current?.requestFullscreen) await containerRef.current.requestFullscreen();
      else showFeedback("Fullscreen isn't available in this browser.");
    } catch {
      showFeedback("Fullscreen couldn't be opened. You can still use focus mode.");
    }
  }, [containerRef, showFeedback]);
  const revealControls = useCallback(() => {
    dispatch({ type: "controls", visible: true });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    if (!focusMode) return;
    focusTimer.current = setTimeout(() => {
      if (!document.activeElement?.closest("[data-reader-chrome], dialog[open]")) dispatch({ type: "controls", visible: false });
    }, 2400);
  }, [focusMode]);
  const hideControls = useCallback(() => dispatch({ type: "controls", visible: false }), []);
  const toggleFocus = useCallback(() => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    onFocusModeChange(!focusMode);
    dispatch({ type: "focus" });
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest("dialog[open], [data-reader-chrome]")) return;
    // Native modal focus restoration must finish before we focus its previously inert background.
    markViewerFocus(true);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; viewerRef.current?.focus({ preventScroll: true }); });
  }, [focusMode, onFocusModeChange, markViewerFocus, viewerRef]);

  return {
    ...ui, chromeVisible: !focusMode || ui.controlsVisible || ui.panel !== null || ui.sidebarOpen,
    feedback, programmaticFocus, isFullscreen, fullscreenSupported,
    closeSidebar, toggleSidebar, selectSidebarTab, closePanel, openSettings, openShortcuts, openSearch,
    closeTopmostPanel, toggleFullscreen, toggleFocus, revealControls, hideControls, showFeedback, clearProgrammaticFocus,
  };
}
