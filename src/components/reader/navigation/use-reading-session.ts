"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { readStorage, storageKey, writeStorage } from "@/lib/browser-storage";
import { clampPage, createProgressWriter, parseReadingLocation, progressStorageKey, type ReadingLocation } from "@/lib/reading-progress";
import { clampZoom, parseBookmarks, parsePreferences, type ReaderPreferences } from "../reader-preferences";
import { markReader, READER_MARKS } from "../viewport/reader-performance";
import { initialNavigation, readerNavigationReducer } from "./reader-navigation";

/** One keyed book lifetime owns navigation and persisted state, including hidden-page flushes. */
export function useReadingSession(id: string, pageCount: number | null) {
  const [reading, dispatch] = useReducer(readerNavigationReducer, id,
    (bookId) => initialNavigation(parseReadingLocation(readStorage(progressStorageKey(bookId)))));
  const [preferences, setPreferences] = useState(() => parsePreferences(readStorage(storageKey("settings", id))));
  const [bookmarks, setBookmarks] = useState(() => parseBookmarks(readStorage(storageKey("bookmarks", id))));

  useEffect(() => { writeStorage(storageKey("settings", id), preferences); }, [id, preferences]);
  useEffect(() => { writeStorage(storageKey("bookmarks", id), bookmarks); }, [id, bookmarks]);
  const progressWriter = useMemo(() => createProgressWriter((value) => writeStorage(progressStorageKey(id), value)), [id]);
  useEffect(() => {
    if (pageCount) progressWriter.update(reading.location, pageCount);
  }, [progressWriter, reading.location, pageCount]);
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
    if (!pageCount || !Number.isFinite(page)) return;
    const next = clampPage(page, pageCount);
    markReader(READER_MARKS.pageRequest, { page: next });
    dispatch({ type: "jump", location: { page: next, offset: 0 }, pageCount, remember });
  }, [pageCount]);
  const navigate = useCallback((page: number) => requestNavigation(page), [requestNavigation]);
  const jump = useCallback((page: number) => requestNavigation(page, true), [requestNavigation]);
  const goBack = useCallback(() => {
    if (!pageCount) return;
    markReader(READER_MARKS.pageRequest);
    dispatch({ type: "back", pageCount });
  }, [pageCount]);
  const observeLocation = useCallback((location: ReadingLocation) => {
    if (pageCount) dispatch({ type: "scroll", location, pageCount });
  }, [pageCount]);
  const restore = useCallback((loadedPageCount: number) => {
    dispatch({ type: "restore", pageCount: loadedPageCount });
    setBookmarks((pages) => pages.filter((page) => page <= loadedPageCount));
  }, []);
  const toggleBookmark = useCallback((page: number) => {
    if (!pageCount) return;
    const value = clampPage(page, pageCount);
    setBookmarks((previous) => previous.includes(value)
      ? previous.filter((n) => n !== value) : [...previous, value].sort((a, b) => a - b));
  }, [pageCount]);
  const updatePreferences = useCallback((update: Partial<ReaderPreferences>) => {
    setPreferences((previous) => ({ ...previous, ...update }));
  }, []);
  const zoomBy = useCallback((delta: number, effectiveScale: number) => {
    setPreferences((previous) => ({ ...previous, viewMode: "custom",
      zoom: clampZoom((previous.viewMode === "custom" ? previous.zoom : effectiveScale) + delta) }));
  }, []);
  const save = useCallback(() => {
    const saved = [writeStorage(storageKey("settings", id), preferences), writeStorage(storageKey("bookmarks", id), bookmarks)];
    if (pageCount) saved.push(writeStorage(progressStorageKey(id), { ...reading.location, numPages: pageCount }));
    return saved.every(Boolean);
  }, [id, preferences, bookmarks, pageCount, reading.location]);

  return { reading, preferences, bookmarks, navigate, jump, goBack, observeLocation, restore,
    toggleBookmark, updatePreferences, zoomBy, save };
}
