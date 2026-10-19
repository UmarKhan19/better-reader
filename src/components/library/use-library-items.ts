import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfItem } from "@/types/pdf";
import * as client from "./library-client";
import { parseLibraryProgress, type ReadingProgress } from "./library-model";
import { progressStorageKey } from "@/lib/reading-progress";
import { readStorage } from "@/lib/browser-storage";

export function useLibraryItems() {
  const [items, setItems] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestRef = useRef(0);

  const progress = useMemo(() => {
    const map: Record<string, ReadingProgress> = {};
    if (typeof window === "undefined") return map;
    for (const item of items) {
      try {
        const value = parseLibraryProgress(readStorage(progressStorageKey(item.id)));
        if (value) map[item.id] = value;
      } catch {
        // Storage may be blocked; the library still works without saved progress.
      }
    }
    return map;
  }, [items]);

  const fetchLibrary = useCallback(async (request: number) => {
    try {
      const next = await client.listPdfs();
      if (request !== requestRef.current) return;
      setItems(next);
      setLoadError(false);
    } catch {
      if (request !== requestRef.current) return;
      setLoadError(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(false);
    void fetchLibrary(request);
  }, [fetchLibrary]);

  const syncAfterMutation = useCallback(() => {
    void fetchLibrary(++requestRef.current);
  }, [fetchLibrary]);

  useEffect(() => {
    void fetchLibrary(++requestRef.current);
    return () => { requestRef.current += 1; };
  }, [fetchLibrary]);

  return {
    items, setItems, loading, loadError, progress, reload, syncAfterMutation,
  };
}
