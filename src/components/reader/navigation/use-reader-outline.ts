"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolveOutline, type OutlineEntry } from "./reader-outline";

export function useReaderOutline(pdf: PDFDocumentProxy | null, enabled = true) {
  const [resolved, setResolved] = useState<{ pdf: PDFDocumentProxy; outline: OutlineEntry[] } | null>(null);
  useEffect(() => {
    if (!pdf || !enabled) return;
    let cancelledFlag = false;
    const isCancelled = () => cancelledFlag;
    const timer = window.setTimeout(async () => {
      try {
        const entries = await resolveOutline(pdf, isCancelled, () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
        if (!cancelledFlag) setResolved({ pdf, outline: entries });
      } catch {
        if (!cancelledFlag) setResolved({ pdf, outline: [] });
      }
    }, 350);
    return () => { cancelledFlag = true; window.clearTimeout(timer); };
  }, [pdf, enabled]);
  return resolved?.pdf === pdf && enabled ? resolved.outline : null;
}
