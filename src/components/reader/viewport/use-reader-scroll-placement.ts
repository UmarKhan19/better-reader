"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ViewMode } from "../reader-preferences";
import { clampPage, type ReadingLocation } from "@/lib/reading-progress";
import { fraction, locationAt, locationTop, type ReaderGeometry, type Size } from "./reader-geometry";
import { anchoredScroll } from "./reader-gestures";
import { stagePosition } from "./reader-viewport-runtime";
import type { ZoomAnchor } from "./use-reader-zoom";

export function useReaderScrollPlacement({
  pdf, active, available, scrollRef, stageRef, navigation, viewMode, zoom, geometry, onLocationChange,
}: {
  pdf: PDFDocumentProxy;
  active: number;
  available: Size;
  scrollRef: RefObject<HTMLElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  navigation: { page: number; offset: number; revision: number };
  viewMode: ViewMode;
  zoom: number;
  geometry: ReaderGeometry;
  onLocationChange: (location: ReadingLocation) => void;
}) {
  const location = useRef<ReadingLocation>({ page: clampPage(navigation.page, pdf.numPages), offset: fraction(navigation.offset) });
  const previousRevision = useRef<number | null>(null);
  const previousGeometry = useRef<ReaderGeometry | null>(null);
  const placedScrollTop = useRef<number | null>(null);
  const zoomAnchor = useRef<(ZoomAnchor & { zoom: number }) | null>(null);
  const horizontalFraction = useRef(0.5);
  const [view, setView] = useState({ top: 0, left: 0, height: available.height, width: available.width, direction: 1 });

  const notifyLocation = useEffectEvent(onLocationChange);

  const readView = useCallback(() => {
    const stage = stageRef.current, scroller = scrollRef.current;
    if (!stage || !scroller) return;
    const position = stagePosition(stage, scroller);
    const top = scroller.scrollTop - position.top;
    setView((old) => ({ top, left: scroller.scrollLeft - position.left,
      height: scroller.clientHeight, width: scroller.clientWidth, direction: top === old.top ? old.direction : top > old.top ? 1 : -1 }));
  }, [scrollRef, stageRef]);

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
    if (repositioned) placedScrollTop.current = scroller.scrollTop - position.top;
    readView();
  }, [geometry, navigation.revision, navigation.page, navigation.offset, pdf.numPages, active, available, scrollRef, stageRef, readView, viewMode, zoom]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const scroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; onScroll(); }); };
    scroller.addEventListener("scroll", scroll, { passive: true });
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener("scroll", scroll); };
  }, [scrollRef]);

  return { view, readView, zoomAnchor, location, placedScrollTop, horizontalFraction };
}
