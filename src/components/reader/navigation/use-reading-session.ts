"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { readStorage, storageKey, writeStorage } from "@/lib/browser-storage";
import { clampPage, createProgressWriter, parseReadingLocation, progressStorageKey, type ReadingLocation } from "@/lib/reading-progress";
import { clampZoom, parseBookmarks, parsePreferences, type ReaderPreferences } from "../reader-preferences";
import { initialNavigation, readerNavigationReducer } from "./reader-navigation";

/** One keyed book lifetime owns navigation and persisted state, including hidden-page flushes. */
export function useReadingSession(id: string, total: number | null) {
  const [reading, dispatch] = useReducer(readerNavigationReducer, id,
    (bookId) => initialNavigation(parseReadingLocation(readStorage(progressStorageKey(bookId)))));
  const [preferences, setPreferences] = useState(() => parsePreferences(readStorage(storageKey("settings", id))));
  const [bookmarks, setBookmarks] = useState(() => parseBookmarks(readStorage(storageKey("bookmarks", id))));

  useEffect(() => { writeStorage(storageKey("settings", id), preferences); }, [id, preferences]);
  useEffect(() => { writeStorage(storageKey("bookmarks", id), bookmarks); }, [id, bookmarks]);
  const progressWriter = useMemo(() => createProgressWriter((value) => writeStorage(progressStorageKey(id), value)), [id]);
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

  const requestNavigation = useCallback((page: number, remember = false) => {
    if (!total || !Number.isFinite(page)) return;
    const next = clampPage(page, total);
    performance.clearMarks("reader:page-request");
    performance.mark("reader:page-request", { detail: { page: next } });
    dispatch({ type: "jump", location: { page: next, offset: 0 }, total, remember });
  }, [total]);
  const navigate = useCallback((page: number) => requestNavigation(page), [requestNavigation]);
  const jump = useCallback((page: number) => requestNavigation(page, true), [requestNavigation]);
  const goBack = useCallback(() => {
    if (!total) return;
    performance.clearMarks("reader:page-request");
    performance.mark("reader:page-request");
    dispatch({ type: "back", total });
  }, [total]);
  const observeLocation = useCallback((location: ReadingLocation) => {
    if (total) dispatch({ type: "scroll", location, total });
  }, [total]);
  const restore = useCallback((loadedTotal: number) => {
    dispatch({ type: "restore", total: loadedTotal });
    setBookmarks((pages) => pages.filter((page) => page <= loadedTotal));
  }, []);
  const toggleBookmark = useCallback((page: number) => {
    if (!total) return;
    const value = clampPage(page, total);
    setBookmarks((previous) => previous.includes(value)
      ? previous.filter((n) => n !== value) : [...previous, value].sort((a, b) => a - b));
  }, [total]);
  const updatePreferences = useCallback((update: Partial<ReaderPreferences>) => {
    setPreferences((previous) => ({ ...previous, ...update }));
  }, []);
  const zoomBy = useCallback((delta: number, effectiveScale: number) => {
    setPreferences((previous) => ({ ...previous, viewMode: "custom",
      zoom: clampZoom((previous.viewMode === "custom" ? previous.zoom : effectiveScale) + delta) }));
  }, []);
  const save = useCallback(() => {
    const saved = [writeStorage(storageKey("settings", id), preferences), writeStorage(storageKey("bookmarks", id), bookmarks)];
    if (total) saved.push(writeStorage(progressStorageKey(id), { ...reading.location, numPages: total }));
    return saved.every(Boolean);
  }, [id, preferences, bookmarks, total, reading.location]);

  return { reading, preferences, bookmarks, navigate, jump, goBack, observeLocation, restore,
    toggleBookmark, updatePreferences, zoomBy, save };
}
