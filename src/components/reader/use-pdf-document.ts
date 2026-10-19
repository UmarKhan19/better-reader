"use client";

import { useCallback, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Owns one PDF document lifetime: load, retry and first-readable readiness. */
export function usePdfDocument() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [firstPageReady, setFirstPageReady] = useState(false);

  const onDocumentLoad = useCallback((document: PDFDocumentProxy) => {
    setFirstPageReady(false);
    setPdf(document);
    setLoadError(false);
  }, []);

  const onLoadError = useCallback(() => setLoadError(true), []);

  const retry = useCallback(() => {
    setPdf(null);
    setFirstPageReady(false);
    setLoadError(false);
    setAttempt((value) => value + 1);
  }, []);

  return { pdf, attempt, loadError, firstPageReady, setFirstPageReady, onDocumentLoad, onLoadError, retry };
}
