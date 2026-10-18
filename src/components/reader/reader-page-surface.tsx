"use client";

import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { ScheduledPdfPage, type ScheduledPdfPageProps } from "./reader-render-queue";
import { ReaderRasterBudget, rasterPixels, type RasterReservation } from "./reader-raster-budget";
import { readerRenderQueue, type RenderPriority } from "./reader-render-scheduler";
import { renderedInkCrop } from "./reader-crop";
import { FULL_PAGE, type CropBox, type PageBox } from "./reader-geometry";
import { finishRaster, requestRaster, type RasterFrame, type RasterState } from "./reader-render-state";
import { visibleTiles, type ReaderTile, type VisibleRect } from "./reader-tiles";
import { pageTextRenderer, type ReaderHighlightText } from "./reader-text-renderer";
import styles from "./reader-viewport.module.css";

export function rasterFrame(box: PageBox, ratio: number, retry = 0): RasterFrame {
  const width = Math.max(1, Math.floor(box.fullWidth));
  const height = box.fullHeight * width / box.fullWidth;
  return { key: `${width}:${height.toFixed(5)}:${ratio.toPrecision(14)}:${retry}`, width, height, ratio };
}

function BudgetedRaster({ frame, budget, retained, onPromoted, ...props }: ScheduledPdfPageProps & {
  frame: RasterFrame; budget: ReaderRasterBudget; retained: boolean; onPromoted: () => void;
}) {
  const [permitted, setPermitted] = useState(false);
  const reservation = useRef<RasterReservation | null>(null);
  const promote = useEffectEvent(onPromoted);
  useEffect(() => {
    const ticket = budget.reserve(props.pageNumber!, rasterPixels(frame, frame.ratio), props.priority, retained,
      () => setPermitted(true), () => promote());
    reservation.current = ticket;
    return () => { ticket.cancel(); reservation.current = null; };
    // Priority/presentation update the live reservation without losing its canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, props.pageNumber, frame.key]);
  useEffect(() => { reservation.current?.update(props.priority, retained); }, [props.priority, retained]);
  const rendered = useCallback(() => reservation.current?.ready(), []);
  return permitted ? <ScheduledPdfPage {...props} onRenderSuccess={rendered} /> : null;
}

function Tile({ pdf, pageNumber, fullWidth, tile, pageColors }: { pdf: PDFDocumentProxy; pageNumber: number; fullWidth: number; tile: ReaderTile; pageColors?: { background: string; foreground: string } | null }) {
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

async function canvasCrop(canvas: HTMLCanvasElement, page: PDFPageProxy): Promise<CropBox> {
  let sample: HTMLCanvasElement | undefined;
  try {
    const [annotations, operators] = await Promise.all([page.getAnnotations({ intent: "display" }), page.getOperatorList()]);
    const imageOps = [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintInlineImageXObjectGroup,
      pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup,
      pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintSolidColorImageMask];
    const hasImages = operators.fnArray.some((op) => imageOps.includes(op));
    if (!canvas.width || !canvas.height || !canvas.isConnected) return FULL_PAGE;
    const viewport = page.getViewport({ scale: 1 });
    const boxes: CropBox[] = [];
    for (const annotation of annotations) {
      if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4) return FULL_PAGE;
      const rect = [...viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]),
        ...viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])];
      boxes.push({ x: Math.min(rect[0], rect[2]) / viewport.width, y: Math.min(rect[1], rect[3]) / viewport.height,
        width: Math.abs(rect[2] - rect[0]) / viewport.width, height: Math.abs(rect[3] - rect[1]) / viewport.height });
    }
    sample = document.createElement("canvas");
    const ratio = Math.min(256 / canvas.width, 256 / canvas.height, 1);
    sample.width = Math.max(1, Math.round(canvas.width * ratio)); sample.height = Math.max(1, Math.round(canvas.height * ratio));
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) return FULL_PAGE;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    return renderedInkCrop(context.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height, boxes, hasImages);
  } catch { return FULL_PAGE; }
  finally { if (sample) { sample.width = 0; sample.height = 0; } }
}

export const ReaderPageSurface = memo(function ReaderPageSurface({ pdf, box, ratio, priority, visible, tileLimit, crop,
  highlightText, pageColors, onCrop, onStatus, onSize, sizeKnown, budget, presentation = "visible" }: {
  pdf: PDFDocumentProxy; box: PageBox; ratio: number; priority: RenderPriority; visible: VisibleRect; tileLimit: number; crop: boolean;
  highlightText?: ReaderHighlightText;
  pageColors?: { background: string; foreground: string } | null;
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
    void canvasCrop(canvas, sourcePage.current).then((result) => {
      if (!cancelled && alive.current) onCrop(box.page, result);
    });
    return () => { cancelled = true; };
  }, [crop, frames.shown, box.page, onCrop]);
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
