"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Size, ViewMode } from "./reader-state";
import { clampPage } from "./reader-state";
import { adjacentWindowPage, fraction, locationAt, locationTop, pageWindow, readerGeometry,
  type CropBox, type PageBox, type ReaderLayout, type ReadingLocation } from "./reader-geometry";
import { ReaderPageSurface, rasterFrame } from "./reader-page-surface";
import { ReaderRasterBudget } from "./reader-raster-budget";
import { pageIntersection, planReaderWindow } from "./reader-render-window";
import type { ReaderHighlightText } from "./reader-text-renderer";
import { useReaderZoom, type ZoomAnchor } from "./reader-use-zoom";
import { anchoredScroll } from "./reader-gestures";
import { retainedPageWindow } from "./reader-render-state";
import styles from "./reader-viewport.module.css";

export type ReaderViewportProps = {
  pdf: PDFDocumentProxy; pageNumber: number; layout: ReaderLayout; viewMode: ViewMode; zoom: number;
  cropMargins: boolean; available: Size; scrollRef: RefObject<HTMLElement | null>;
  navigation: ReadingLocation & { revision: number };
  onLocationChange: (location: ReadingLocation) => void; onScaleChange: (scale: number) => void;
  onReady: () => void; onBusyChange: (busy: boolean) => void; onZoomChange: (zoom: number) => void;
  highlightText?: ReaderHighlightText;
  pageColors?: { background: string; foreground: string } | null;
};
const pdfKeys = new WeakMap<PDFDocumentProxy, number>();
let nextPdfKey = 0;
const NO_CROPS = new Map<number, CropBox>();
function lowResourceDevice() {
  const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  return Boolean((device.deviceMemory && device.deviceMemory <= 4) || device.connection?.saveData || /(^|-)2g$/.test(device.connection?.effectiveType ?? ""));
}
function boundedMeasure(name: string, start: number) {
  performance.clearMeasures(name); performance.measure(name, { start, end: performance.now() });
}
function stagePosition(stage: HTMLElement, scroller: HTMLElement) {
  const box = stage.getBoundingClientRect(), scroll = scroller.getBoundingClientRect();
  return { top: box.top - scroll.top + scroller.scrollTop - scroller.clientTop,
    left: box.left - scroll.left + scroller.scrollLeft - scroller.clientLeft };
}

function ViewportDocument({ pdf, pageNumber, layout, viewMode, zoom, cropMargins, available, scrollRef,
  navigation, onLocationChange, onScaleChange, onReady, onBusyChange, onZoomChange, highlightText, pageColors }: ReaderViewportProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [budget] = useState(() => new ReaderRasterBudget());
  const [sizes, setSizes] = useState(new Map<number, Size>());
  const [crops, setCrops] = useState(new Map<number, CropBox>());
  const [lastReadablePages, setLastReadablePages] = useState<PageBox[]>([]);
  const [statuses, setStatuses] = useState(new Map<number, { identity: string; busy: boolean; readable: boolean; ready: boolean }>());
  const [view, setView] = useState({ top: 0, left: 0, height: available.height, width: available.width, direction: 1 });
  const [lowResource] = useState(() => typeof navigator !== "undefined" && lowResourceDevice());
  const active = clampPage(pageNumber, pdf.numPages);
  const [turn, setTurn] = useState({ page: active, direction: 1 });
  if (turn.page !== active) setTurn({ page: active, direction: active > turn.page ? 1 : -1 });
  const geometry = useMemo(() => readerGeometry({ total: pdf.numPages, active, layout, available, mode: viewMode, zoom,
    sizes, crops: cropMargins ? crops : NO_CROPS }), [pdf.numPages, active, layout, available, viewMode, zoom, sizes, cropMargins, crops]);
  const location = useRef<ReadingLocation>({ page: clampPage(navigation.page, pdf.numPages), offset: fraction(navigation.offset) });
  const previousRevision = useRef<number | null>(null);
  const previousGeometry = useRef<typeof geometry | null>(null);
  const placedScrollTop = useRef<number | null>(null);
  const zoomAnchor = useRef<(ZoomAnchor & { zoom: number }) | null>(null);
  const horizontalFraction = useRef(0.5);
  const firstReadable = useRef(false);
  const previousZoom = useRef({ zoom, viewMode });
  useLayoutEffect(() => {
    const previous = previousZoom.current;
    if (firstReadable.current && (previous.zoom !== zoom || previous.viewMode !== viewMode) && !performance.getEntriesByName("reader:zoom-request").length) {
      performance.clearMarks("reader:zoom-request"); performance.mark("reader:zoom-request");
    }
    previousZoom.current = { zoom, viewMode };
  }, [zoom, viewMode]);
  const notifyLocation = useEffectEvent(onLocationChange);
  const notifyScale = useEffectEvent(onScaleChange);
  const notifyReady = useEffectEvent(onReady);
  const notifyBusy = useEffectEvent(onBusyChange);

  const readView = useCallback(() => {
    const stage = stageRef.current, scroller = scrollRef.current;
    if (!stage || !scroller) return;
    const position = stagePosition(stage, scroller);
    const top = scroller.scrollTop - position.top;
    setView((old) => ({ top, left: scroller.scrollLeft - position.left,
      height: scroller.clientHeight, width: scroller.clientWidth, direction: top === old.top ? old.direction : top > old.top ? 1 : -1 }));
  }, [scrollRef]);

  useLayoutEffect(() => {
    const stage = stageRef.current, scroller = scrollRef.current;
    if (!stage || !scroller || available.width <= 0 || available.height <= 0) return;
    stage.style.transform = "";
    const position = stagePosition(stage, scroller);
    const repositioned = previousRevision.current !== navigation.revision || previousGeometry.current !== geometry;
    if (previousRevision.current !== navigation.revision) {
      location.current = { page: clampPage(navigation.page, pdf.numPages), offset: fraction(navigation.offset) };
      scroller.scrollTop = position.top + locationTop(geometry, location.current);
      scroller.scrollLeft = 0;
      zoomAnchor.current = null;
      previousRevision.current = navigation.revision;
    } else if (previousGeometry.current !== geometry) {
      const pendingAnchor = zoomAnchor.current;
      const anchor = pendingAnchor && viewMode === "custom" && Math.abs(zoom - pendingAnchor.zoom) < 0.005 ? pendingAnchor : null;
      const box = anchor && geometry.pages.find((p) => p.page === anchor.page);
      if (anchor && box) {
        const scroll = anchoredScroll({ x: position.left + box.left + anchor.x * box.width,
          y: position.top + box.top + anchor.y * box.height }, anchor.screen, 1);
        scroller.scrollTop = scroll.y; scroller.scrollLeft = scroll.x;
        location.current = locationAt(geometry, scroller.scrollTop - position.top, active);
        horizontalFraction.current = fraction((scroller.scrollLeft - position.left + scroller.clientWidth / 2 - box.left) / box.width);
      } else {
        scroller.scrollTop = position.top + locationTop(geometry, location.current);
        const readingPage = geometry.pages.find((p) => p.page === location.current.page);
        if (readingPage) scroller.scrollLeft = position.left + readingPage.left + horizontalFraction.current * readingPage.width - scroller.clientWidth / 2;
      }
    }
    previousGeometry.current = geometry;
    // At the end of a short document the browser clamps an explicit jump. Its
    // resulting scroll event must not replace the requested page with an earlier one.
    if (repositioned) placedScrollTop.current = scroller.scrollTop - position.top;
    readView();
  }, [geometry, navigation.revision, navigation.page, navigation.offset, pdf.numPages, active, available, scrollRef, readView, viewMode, zoom]);

  const onScroll = useEffectEvent(() => {
    const stage = stageRef.current, scroller = scrollRef.current;
    if (!stage || !scroller || stage.style.transform) return;
    const position = stagePosition(stage, scroller);
    const top = scroller.scrollTop - position.top;
    const placed = placedScrollTop.current !== null && Math.abs(top - placedScrollTop.current) < 0.5;
    const next = placed ? location.current : locationAt(geometry, top, active);
    if (!placed) { placedScrollTop.current = null; zoomAnchor.current = null; }
    const readingPage = geometry.pages.find((p) => p.page === next.page);
    if (readingPage) horizontalFraction.current = fraction((scroller.scrollLeft - position.left + scroller.clientWidth / 2 - readingPage.left) / readingPage.width);
    if (next.page !== location.current.page || Math.abs(next.offset - location.current.offset) > 0.0001) {
      location.current = next; notifyLocation(next);
    }
    readView();
  });
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const scroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; onScroll(); }); };
    scroller.addEventListener("scroll", scroll, { passive: true });
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener("scroll", scroll); };
  }, [scrollRef]);

  const numbers = available.width > 0 && available.height > 0 ? pageWindow(geometry, view.top, view.height, view.direction, lowResource) : [];

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
    zoomAnchor.current = { ...anchor, zoom: next }; onZoomChange(next);
  } });
  const targetBoxes = geometry.pages.filter((box) => numbers.includes(box.page));
  const deviceRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const targetPlan = planReaderWindow(targetBoxes, view, active, deviceRatio, lowResource);
  const visibleTargets = targetPlan.filter((entry) => entry.priority === 0);
  const currentStatus = statuses.get(active);
  const cropPending = cropMargins && visibleTargets.some(({ box }) => !crops.has(box.page));
  const busy = cropPending || !targetPlan.some((entry) => entry.box.page === active) || visibleTargets.some(({ box, allocation }) => {
    const status = statuses.get(box.page);
    return status?.identity !== rasterFrame(box, allocation.ratio).key || status.busy;
  });
  const readable = Boolean(currentStatus?.readable);
  const settled = !busy && Boolean(currentStatus?.ready) && visibleTargets.every(({ box }) => statuses.get(box.page)?.ready);
  useEffect(() => { notifyBusy(busy); }, [busy]);
  useEffect(() => {
    if (!readable) return;
    if (!firstReadable.current) {
      firstReadable.current = true;
      performance.clearMarks("reader:first-page"); performance.mark("reader:first-page"); notifyReady();
    }
    if (!settled) return;
    zoomAnchor.current = null;
    const request = performance.getEntriesByName("reader:page-request").at(-1) as PerformanceMark | undefined;
    if (request?.detail?.page === active) {
      boundedMeasure("reader:page-turn", request.startTime); performance.clearMarks("reader:page-request");
    }
    const zoomRequest = performance.getEntriesByName("reader:zoom-request").at(-1);
    if (zoomRequest) { boundedMeasure("reader:zoom-settled", zoomRequest.startTime); performance.clearMarks("reader:zoom-request"); }
  }, [active, settled, readable]);
  if (geometry.layout === "continuous" && lastReadablePages.length) setLastReadablePages([]);
  else if (geometry.layout !== "continuous" && readable && lastReadablePages !== geometry.pages) setLastReadablePages(geometry.pages);
  const retained = geometry.layout !== "continuous" && !readable ? retainedPageWindow(lastReadablePages, geometry.pages) : [];
  const nextPage = adjacentWindowPage(geometry.pages, turn.direction, pdf.numPages);
  const prefetch = geometry.layout !== "continuous" && settled && !lowResource && nextPage !== null
    ? readerGeometry({ total: pdf.numPages, active: nextPage, layout: geometry.layout, available, mode: viewMode, zoom, sizes,
      crops: cropMargins ? crops : NO_CROPS }).pages.filter((box) => !numbers.includes(box.page)).slice(turn.direction < 0 ? -1 : 0, turn.direction < 0 ? undefined : 1)
    : [];
  const renderPlan = planReaderWindow([...targetBoxes, ...prefetch], view, active, deviceRatio, lowResource, prefetch.map((box) => box.page))
    .filter((entry) => entry.priority === 0 || settled);
  const renderBoxes = [...renderPlan.map((entry) => entry.box), ...retained];
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
  if (!pdfKeys.has(props.pdf)) pdfKeys.set(props.pdf, ++nextPdfKey);
  return <ViewportDocument key={pdfKeys.get(props.pdf)} {...props} />;
}
