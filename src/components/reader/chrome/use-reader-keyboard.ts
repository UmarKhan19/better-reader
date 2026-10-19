"use client";

import { useEffect, useEffectEvent } from "react";
import type { ReaderPreferences } from "../reader-preferences";

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
  canGoBack: boolean;
  ready: boolean;
  panelOpen: boolean;
  clearProgrammaticFocus: () => void;
  toggleSidebar: () => void;
  openShortcuts: () => void;
  closeTopmostPanel: () => void;
};

export function useReaderKeyboard(options: ReaderKeyboardOptions) {
  const {
    navigate, pageNumber, toggleBookmark, toggleFocus, toggleFullscreen, updatePreferences, zoomBy,
    openSearch, goBack, canGoBack, ready, panelOpen, clearProgrammaticFocus,
    toggleSidebar, openShortcuts, closeTopmostPanel,
  } = options;

  const handler = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Tab") clearProgrammaticFocus();
    const target = event.target instanceof Element ? event.target : null;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f" && ready && !panelOpen) {
      event.preventDefault(); openSearch(); return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft" && canGoBack && !panelOpen) {
      event.preventDefault(); goBack(); return;
    }
    if (target?.closest("input, textarea, select, [contenteditable='true'], dialog[open]")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      closeTopmostPanel();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "/") openSearch();
    else if (key === "t") toggleSidebar();
    else if (key === "b") toggleBookmark(pageNumber);
    else if (key === "z") toggleFocus();
    else if (key === "f") void toggleFullscreen();
    else if (key === "?") openShortcuts();
    else if (target?.closest("[data-reader-sidebar]")) return;
    else if (event.key === "ArrowLeft" || event.key === "PageUp") navigate(pageNumber - 1);
    else if (event.key === "ArrowRight" || event.key === "PageDown") navigate(pageNumber + 1);
    else if (event.key === "+" || event.key === "=") zoomBy(0.1);
    else if (event.key === "-") zoomBy(-0.1);
    else if (event.key === "0") updatePreferences({ viewMode: "fit-width" });
    else if (event.key === "1") updatePreferences({ viewMode: "actual-size", zoom: 1 });
    else return;
    event.preventDefault();
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handler(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
}
