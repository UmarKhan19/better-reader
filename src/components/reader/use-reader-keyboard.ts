"use client";

import { useEffect, type RefObject } from "react";
import type { ReaderPreferences } from "./reader-state";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type ReaderKeyboardOptions = {
  navigate: (page: number) => void;
  pageNumber: number;
  toggleBookmark: (page: number) => void;
  toggleFocus: () => void;
  toggleFullscreen: () => void | Promise<void>;
  updatePreferences: (update: Partial<ReaderPreferences>) => void;
  zoomBy: (delta: number) => void;
  openSearch: () => void;
  goBack: () => void;
  historyLength: number;
  markViewerFocus: (value: boolean) => void;
  programmaticFocusRef: RefObject<boolean>;
  pdf: PDFDocumentProxy | null;
  panel: "settings" | "shortcuts" | null;
  sidebarOpen: boolean;
  focusMode: boolean;
  setSidebarOpen: (value: boolean | ((previous: boolean) => boolean)) => void;
  setPanel: (value: "settings" | "shortcuts" | null) => void;
};

export function useReaderKeyboard(options: ReaderKeyboardOptions) {
  const {
    navigate, pageNumber, toggleBookmark, toggleFocus, toggleFullscreen, updatePreferences, zoomBy,
    openSearch, goBack, historyLength, markViewerFocus, programmaticFocusRef, pdf, panel,
    sidebarOpen, focusMode, setSidebarOpen, setPanel,
  } = options;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Tab" && programmaticFocusRef.current) markViewerFocus(false);
      const target = event.target instanceof Element ? event.target : null;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f" && pdf && panel === null) {
        event.preventDefault(); openSearch(); return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft" && historyLength && panel === null) {
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
  }, [navigate, pageNumber, toggleBookmark, toggleFocus, toggleFullscreen, updatePreferences, zoomBy, pdf, panel, openSearch, goBack, historyLength, markViewerFocus, programmaticFocusRef, sidebarOpen, focusMode, setSidebarOpen, setPanel]);
}