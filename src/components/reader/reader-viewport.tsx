"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfPageColors, Size, ViewMode } from "./reader-state";
import { clampPage } from "./reader-state";
import { readerGeometry, type CropBox, type ReaderLayout, type ReadingLocation } from "./reader-geometry";
import { ReaderPageSurface } from "./reader-page-surface";
import { ReaderRasterBudget } from "./reader-raster-budget";
import { pageIntersection } from "./reader-render-window";
import type { ReaderHighlightText } from "./reader-text-renderer";
import { useReaderZoom } from "./reader-use-zoom";
import { getPdfKey, lowResourceDevice, boundedMeasure } from "./reader-viewport-runtime";
import { useReaderScrollPlacement } from "./use-reader-scroll-placement";
import { useReaderWindow } from "./use-reader-window";
import styles from "./reader-viewport.module.css";

export type ReaderViewportProps = {
  pdf: PDFDocumentProxy; pageNumber: number; layout: ReaderLayout; viewMode: ViewMode; zoom: number;
  cropMargins: boolean; available: Size; scrollRef: RefObject<HTMLElement | null>;
  navigation: ReadingLocation & { revision: number };
  onLocationChange: (location: ReadingLocation) => void; onScaleChange: (scale: number) => void;
  onReady: () => void; onBusyChange: (busy: boolean) => void; onZoomChange: (zoom: number) => void;
  highlightText?: ReaderHighlightText;
  pageColors?: PdfPageColors;
};
const NO_CROPS = new Map<number, CropBox>();

function ViewportDocument({ pdf, pageNumber, layout, viewMode, zoom, cropMargins, available, scrollRef,
  navigation, onLocationChange, onScaleChange, onReady, onBusyChange, onZoomChange, highlightText, pageColors }: ReaderViewportProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [budget] = useState(() => new ReaderRasterBudget());
  const [sizes, setSizes] = useState(new Map<number, Size>());
  const [crops, setCrops] = useState(new Map<number, CropBox>());
  const [statuses, setStatuses] = useState(new Map<number, { identity: string; busy: boolean; readable: boolean; ready: boolean }>());
  const [lowResource] = useState(() => typeof navigator !== "undefined" && lowResourceDevice());
  const active = clampPage(pageNumber, pdf.numPages);
  const geometry = useMemo(() => readerGeometry({ total: pdf.numPages, active, layout, available, mode: viewMode, zoom,
    sizes, crops: cropMargins ? crops : NO_CROPS }), [pdf.numPages, active, layout, available, viewMode, zoom, sizes, cropMargins, crops]);

  const scroll = useReaderScrollPlacement({
    pdf, active, available, scrollRef, stageRef, navigation, viewMode, zoom, geometry, onLocationChange,
  });
  const { view, zoomAnchor: zoomAnchorRef } = scroll;

  const firstReadableRef = useRef(false);
  const previousZoom = useRef({ zoom, viewMode });
  useLayoutEffect(() => {
    const previous = previousZoom.current;
    if (firstReadableRef.current && (previous.zoom !== zoom || previous.viewMode !== viewMode) && !performance.getEntriesByName("reader:zoom-request").length) {
      performance.clearMarks("reader:zoom-request"); performance.mark("reader:zoom-request");
    }
    previousZoom.current = { zoom, viewMode };
  }, [zoom, viewMode]);
  const notifyScale = useEffectEvent(onScaleChange);
  const notifyReady = useEffectEvent(onReady);
  const notifyBusy = useEffectEvent(onBusyChange);

  const windowState = useReaderWindow({
    pdf, available, geometry, view, active, statuses, crops, sizes, viewMode, zoom, cropMargins, lowResource,
  });
  const { numbers, busy, readable, settled, retained, renderPlan, renderBoxes } = windowState;

  const onSize = useCallback((page: number, size: Size) => {
    setSizes((old) => {
      const previous = old.get(page);
      return previous?.width === size.width && previous.height === size.height ? old : new Map(old).set(page, size);
    });
  }, []);
  const onCrop = useCallback((page: number, crop: CropBox) => {
    setCrops((old) => old.has(page) ? old : new Map(old).set(page, crop));
  }, []);
  const onStatus = useCallback((page: number, identity: string, busy: boolean, readable: boolean, ready: boolean) => {
    setStatuses((old) => {
      const previous = old.get(page);
      if (previous?.identity === identity && previous.busy === busy && previous.readable === readable && previous.ready === ready) return old;
      return new Map(old).set(page, { identity, busy, readable, ready });
    });
  }, []);
  const activeBox = geometry.pages.find((p) => p.page === active);
  const natural = sizes.get(active);
  const scale = activeBox && natural ? activeBox.fullWidth / natural.width : 1;
  useEffect(() => { if (natural) notifyScale(scale); }, [scale, natural]);
  useReaderZoom({ scrollRef, stageRef, geometry, scale, navigationRevision: navigation.revision, onCommit: (next, anchor) => {
    zoomAnchorRef.current = { ...anchor, zoom: next }; onZoomChange(next);
  } });

  useEffect(() => { notifyBusy(busy); }, [busy]);
  useEffect(() => {
    if (!readable) return;
    if (!firstReadableRef.current) {
      firstReadableRef.current = true;
      performance.clearMarks("reader:first-page"); performance.mark("reader:first-page"); notifyReady();
    }
    if (!settled) return;
    zoomAnchorRef.current = null;
    const request = performance.getEntriesByName("reader:page-request").at(-1) as PerformanceMark | undefined;
    if (request?.detail?.page === active) {
      boundedMeasure("reader:page-turn", request.startTime); performance.clearMarks("reader:page-request");
    }
    const zoomRequest = performance.getEntriesByName("reader:zoom-request").at(-1);
    if (zoomRequest) { boundedMeasure("reader:zoom-settled", zoomRequest.startTime); performance.clearMarks("reader:zoom-request"); }
  }, [active, settled, readable, zoomAnchorRef]);

  // Prune unbounded maps. Stable keys keep the timers from rescheduling on every scroll frame.
  const renderedKey = renderBoxes.map((box) => box.page).join(",");
  const renderedPages = useMemo(() => new Set(renderedKey ? renderedKey.split(",").map(Number) : []), [renderedKey]);
  const windowKey = numbers.join(",");
  const windowPages = useMemo(() => new Set(windowKey ? windowKey.split(",").map(Number) : []), [windowKey]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setStatuses((old) => {
        let changed = false;
        const next = new Map<number, { identity: string; busy: boolean; readable: boolean; ready: boolean }>();
        for (const [page, status] of old) {
          if (renderedPages.has(page) || page === active) next.set(page, status);
          else changed = true;
        }
        return changed ? next : old;
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [renderedPages, active]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setCrops((old) => {
        if (old.size <= 128) return old;
        const next = new Map<number, CropBox>();
        for (const [page, crop] of old) if (windowPages.has(page) || page === active) next.set(page, crop);
        for (const [page, crop] of old) {
          if (next.size >= 128) break;
          if (!windowPages.has(page) && page !== active) next.set(page, crop);
        }
        return next.size === old.size ? old : next;
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [windowPages, active]);

  return <div ref={stageRef} className={styles.viewport} data-reader-stage data-page-number={active} data-reader-layout={geometry.layout}
    aria-busy={busy} style={{ width: geometry.width, height: geometry.height }}>
    {renderBoxes.map((box) => {
      const entry = renderPlan.find((item) => item.box.page === box.page);
      const presentation = retained.includes(box) ? "retained" : entry?.priority === 1 ? "prefetch" : "visible";
      return <ReaderPageSurface key={box.page} pdf={pdf} box={box} budget={budget}
        ratio={entry?.allocation.ratio ?? 1} priority={entry?.priority ?? 1} visible={entry?.visible ?? pageIntersection(box, view)}
        tileLimit={presentation === "visible" ? entry?.tileLimit ?? 0 : 0} crop={presentation === "visible" && cropMargins && !crops.has(box.page)}
        presentation={presentation} sizeKnown={sizes.has(box.page)} highlightText={highlightText} pageColors={pageColors} onCrop={onCrop} onStatus={onStatus} onSize={onSize} />;
    })}
    {busy && <div role="status" className={styles.status}>{readable ? "Rendering pages…" : `Rendering page ${active}…`}</div>}
  </div>;
}

/** Replacing the PDF resets async lifetimes, geometry and the first-readable callback. */
export function ReaderViewport(props: ReaderViewportProps) {
  return <ViewportDocument key={getPdfKey(props.pdf)} {...props} />;
}