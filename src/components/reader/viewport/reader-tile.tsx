"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { readerRenderQueue } from "./reader-render-scheduler";
import type { ReaderTile } from "./reader-tiles";
import type { PdfPageColors } from "../reader-preferences";
import styles from "./reader-viewport.module.css";

export function Tile({ pdf, pageNumber, fullWidth, tile, pageColors }: { pdf: PDFDocumentProxy; pageNumber: number; fullWidth: number; tile: ReaderTile; pageColors?: PdfPageColors }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const { x, y, pixelWidth, pixelHeight, ratio } = tile;
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | undefined;
    const element = canvas.current;
    const ticket = readerRenderQueue.schedule(0, () => {
      void (async () => {
        try {
          const page = await pdf.getPage(pageNumber);
          if (cancelled || !element) return;
          element.width = pixelWidth; element.height = pixelHeight;
          const natural = page.getViewport({ scale: 1 });
          task = page.render({ canvas: element, viewport: page.getViewport({ scale: fullWidth / natural.width * ratio }),
            transform: [1, 0, 0, 1, -x * ratio, -y * ratio], pageColors: pageColors ?? undefined });
          await task.promise;
          if (!cancelled) setReady(true);
        } catch { /* The readable base stays in place if a tile fails or is cancelled. */ }
        finally { ticket.release(); }
      })();
    });
    return () => { cancelled = true; task?.cancel(); ticket.cancel(); if (element) { element.width = 0; element.height = 0; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNumber, fullWidth, x, y, pixelWidth, pixelHeight, ratio, pageColors?.background, pageColors?.foreground]);
  return <canvas ref={canvas} aria-hidden="true" data-reader-tile className={styles.tile}
    style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height, visibility: ready ? "visible" : "hidden" }} />;
}
