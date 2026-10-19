"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { ScheduledPdfPage } from "./reader-render-queue";
import { BudgetedRaster } from "./reader-budgeted-raster";
import { Tile } from "./reader-tile";
import { canvasCrop } from "./reader-crop-canvas";
import type { ReaderRasterBudget } from "./reader-raster-budget";
import { finishRaster, rasterFrame, requestRaster, type RasterState } from "./reader-render-state";
import type { RenderPriority } from "./reader-render-scheduler";
import { visibleTiles, type VisibleRect } from "./reader-tiles";
import { pageTextRenderer, type ReaderHighlightText } from "./reader-text-renderer";
import type { CropBox, PageBox } from "./reader-geometry";
import type { PdfPageColors } from "../reader-preferences";
import styles from "./reader-viewport.module.css";

export const ReaderPageSurface = memo(function ReaderPageSurface({ pdf, box, ratio, priority, visible, tileLimit, crop,
  highlightText, pageColors, onCrop, onStatus, onSize, sizeKnown, budget, presentation = "visible" }: {
  pdf: PDFDocumentProxy; box: PageBox; ratio: number; priority: RenderPriority; visible: VisibleRect; tileLimit: number; crop: boolean;
  highlightText?: ReaderHighlightText;
  pageColors?: PdfPageColors;
  onCrop: (page: number, crop: CropBox) => void;
  onStatus: (page: number, identity: string, busy: boolean, readable: boolean, ready: boolean) => void;
  onSize: (page: number, size: { width: number; height: number }) => void;
  presentation?: "visible" | "retained" | "prefetch";
  sizeKnown: boolean;
  budget: ReaderRasterBudget;
}) {
  const [retry, setRetry] = useState(0);
  const textRenderer = useMemo(() => pageTextRenderer(highlightText, box.page), [highlightText, box.page]);
  const requested = rasterFrame(box, ratio, retry);
  const [frames, setFrames] = useState<RasterState>({ shown: null, target: requested });
  const target = presentation === "retained" ? frames.shown ?? frames.target : requested;
  const [failed, setFailed] = useState<string | null>(null);
  const sourcePage = useRef<PDFPageProxy | null>(null);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => onStatus(box.page, "unmounted", true, false, false), [box.page, onStatus]);
  if (frames.target.key !== target.key) setFrames(requestRaster(frames, target));
  const busy = frames.shown?.key !== target.key;
  const error = failed === target.key;
  const identity = rasterFrame(box, ratio).key;
  useEffect(() => { onStatus(box.page, identity, busy && !error, Boolean(frames.shown), !busy && !error); }, [box.page, identity, busy, error, frames.shown, onStatus]);
  useEffect(() => {
    if (!crop || !frames.shown || !sourcePage.current) return;
    const canvas = canvases.current.get(frames.shown.key);
    if (!canvas) return;
    let cancelled = false;
    void canvasCrop(canvas, sourcePage.current, pageColors?.background).then((result) => {
      if (!cancelled && alive.current) onCrop(box.page, result);
    });
    return () => { cancelled = true; };
  }, [crop, frames.shown, box.page, onCrop, pageColors?.background]);
  const storeCanvas = useCallback((key: string, canvas: HTMLCanvasElement | null) => {
    if (canvas) canvases.current.set(key, canvas); else canvases.current.delete(key);
  }, []);
  const loaded = useCallback((page: PDFPageProxy) => {
    if (!alive.current) return;
    sourcePage.current = page;
    const natural = page.getViewport({ scale: 1 }); onSize(box.page, { width: natural.width, height: natural.height });
  }, [box.page, onSize]);
  const rasterScale = (frames.shown?.width ?? box.fullWidth) / box.fullWidth;
  const fullSize = { width: box.fullWidth * rasterScale, height: box.fullHeight * rasterScale };
  const rasterVisible = { x: visible.x * rasterScale, y: visible.y * rasterScale, width: visible.width * rasterScale, height: visible.height * rasterScale };
  // Tiles follow the shown frame: computed from its raster and keyed by its identity,
  // so they survive a pending target change instead of dropping to the blurry base.
  const tiles = frames.shown && priority === 0 ? visibleTiles(fullSize, rasterVisible, typeof window === "undefined" ? 1 : window.devicePixelRatio, ratio, tileLimit) : [];
  const entries = !sizeKnown ? [] : presentation === "retained" ? (frames.shown ? [frames.shown] : []) :
    frames.shown && frames.shown.key !== frames.target.key ? [frames.shown, frames.target] : [frames.target];
  return <div className={styles.page} data-cached-page={box.page} aria-hidden={presentation !== "visible" || undefined} inert={presentation !== "visible"}
    style={{ left: presentation === "prefetch" ? 0 : box.left, top: presentation === "prefetch" ? 0 : box.top,
      width: presentation === "prefetch" ? 0 : box.width, height: presentation === "prefetch" ? 0 : box.height,
      maxWidth: presentation === "retained" ? "100%" : undefined, maxHeight: presentation === "retained" ? "100%" : undefined,
      zIndex: error && presentation === "visible" ? 2 : presentation === "retained" ? 1 : 0,
      pointerEvents: presentation === "retained" ? "none" : undefined }}>
    <div className={styles.clipped} style={{ left: -box.crop.x * box.fullWidth, top: -box.crop.y * box.fullHeight, width: box.fullWidth, height: box.fullHeight }}>
      {!sizeKnown && presentation !== "retained" && <ScheduledPdfPage key={`dimensions:${retry}`} pdf={pdf} pageNumber={box.page} priority={priority}
        renderMode="none" renderTextLayer={false} renderAnnotationLayer={false} loading="" error="" suspense={false}
        pageColors={pageColors ?? undefined}
        onLoadSuccess={loaded} onLoadError={() => { if (alive.current) setFailed(target.key); }} />}
      {/* Every canvas bakes pageColors into itself: tiles only cover the visible
          area, so a bare raster would stay white wherever they are missing. */}
      {entries.map((frame) => {
        const shown = frame.key === frames.shown?.key;
        return <div key={frame.key} className={styles.raster} aria-hidden={!shown} inert={!shown}
          style={{ visibility: shown ? "visible" : "hidden", transform: `scale(${box.fullWidth / frame.width})`, width: frame.width }}>
          <BudgetedRaster pdf={pdf} pageNumber={box.page} priority={priority} width={frame.width} devicePixelRatio={frame.ratio}
            frame={frame} budget={budget} retained={presentation === "retained"} pageColors={pageColors ?? undefined}
            onPromoted={() => { if (alive.current) setFrames((state) => finishRaster(state, frame.key)); }}
            canvasRef={(canvas) => storeCanvas(frame.key, canvas)}
            renderTextLayer renderAnnotationLayer customTextRenderer={textRenderer}
            onLoadSuccess={loaded}
            onRenderError={() => { if (alive.current) setFailed(frame.key); }}
            onLoadError={() => { if (alive.current) setFailed(frame.key); }} loading="" error="" suspense={false}>
            {shown && tiles.map((tile) => <Tile key={`${frame.key}:${tile.key}`} pdf={pdf} pageNumber={box.page} fullWidth={frame.width} tile={tile} pageColors={pageColors ?? undefined} />)}
          </BudgetedRaster>
        </div>;
      })}
    </div>
    {error && <div className={styles.error} role="alert"><p>This page couldn&apos;t be rendered.</p>
      <Button variant="outline" size="touch" onClick={() => setRetry((n) => n + 1)}>Try again</Button></div>}
  </div>;
});
