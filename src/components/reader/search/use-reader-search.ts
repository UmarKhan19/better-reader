"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readerSearchSnapshot, ReaderSearchController } from "./reader-search-state";

export function useReaderSearch(pdf: PDFDocumentProxy | null, query: string, enabled: boolean) {
  const controller = useMemo(() => new ReaderSearchController(pdf), [pdf]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.search(query, enabled);
    return controller.cancel;
  }, [controller, query, enabled]);
  useEffect(() => () => controller.dispose(), [controller]);

  // Do not expose a previous query/PDF's results during the render before effect cleanup.
  return readerSearchSnapshot(state, pdf ? query : "", enabled && Boolean(pdf));
}
