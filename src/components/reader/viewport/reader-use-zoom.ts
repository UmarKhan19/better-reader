"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";
import { clampZoom } from "../reader-preferences";
import { fraction, locationAt, type ReaderGeometry } from "./reader-geometry";
import { distance, isInteractiveTarget, midpoint, wheelZoom, zoomRatio, type Point } from "./reader-gestures";
import { markReader, READER_MARKS } from "./reader-performance";

export type ZoomAnchor = { page: number; x: number; y: number; screen: Point };
export function useReaderZoom({ scrollRef, stageRef, geometry, scale, navigationRevision, onCommit }: {
  scrollRef: RefObject<HTMLElement | null>; stageRef: RefObject<HTMLDivElement | null>;
  geometry: ReaderGeometry; scale: number; navigationRevision: number; onCommit: (zoom: number, anchor: ZoomAnchor) => void;
}) {
  const commit = useEffectEvent(onCommit);
  const snapshot = useEffectEvent(() => ({ geometry, scale }));
  useEffect(() => {
    const scroller = scrollRef.current, stage = stageRef.current;
    if (!scroller || !stage) return;
    let gesture: { origin: Point; screen: Point; current: Point; ratio: number; anchor: ZoomAnchor; startDistance: number; scale: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastTap: { at: number; point: Point } | null = null;
    let touchStart: Point | null = null;
    let wasPinch = false;
    let lastTouch = 0;
    const originalAction = scroller.style.touchAction;
    scroller.style.touchAction = "pan-x pan-y";
    const begin = (point: Point, startDistance = 0) => {
      const { geometry, scale } = snapshot();
      const rect = stage.getBoundingClientRect(), scrollRect = scroller.getBoundingClientRect();
      const origin = { x: point.x - rect.left, y: point.y - rect.top };
      const location = locationAt(geometry, origin.y);
      const box = geometry.pages.find((p) => p.page === location.page && geometry.layout !== "spread")
        ?? geometry.pages.find((p) => origin.x >= p.left && origin.x <= p.left + p.width) ?? geometry.pages[0];
      if (!box) return;
      gesture = { origin, screen: point, current: point, ratio: 1, startDistance, scale,
        anchor: { page: box.page, x: fraction((origin.x - box.left) / box.width), y: fraction((origin.y - box.top) / box.height),
          screen: { x: point.x - scrollRect.left - scroller.clientLeft, y: point.y - scrollRect.top - scroller.clientTop } } };
    };
    const preview = (ratio: number, point: Point) => {
      if (!gesture) return;
      gesture.ratio = zoomRatio(1, ratio, gesture.scale);
      gesture.current = point;
      const { origin } = gesture;
      stage.style.transform = `translate(${point.x - gesture.screen.x}px, ${point.y - gesture.screen.y}px) translate(${origin.x}px, ${origin.y}px) scale(${gesture.ratio}) translate(${-origin.x}px, ${-origin.y}px)`;
    };
    const finish = () => {
      clearTimeout(timer);
      if (!gesture) return;
      const scrollRect = scroller.getBoundingClientRect();
      const anchor = { ...gesture.anchor, screen: {
        x: gesture.current.x - scrollRect.left - scroller.clientLeft,
        y: gesture.current.y - scrollRect.top - scroller.clientTop,
      } };
      const zoom = clampZoom(gesture.scale * gesture.ratio);
      const startScale = gesture.scale;
      gesture = null;
      if (Math.abs(zoom - startScale) < 0.005) { stage.style.transform = ""; return; }
      markReader(READER_MARKS.zoomRequest);
      commit(zoom, anchor);
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      if (!gesture) begin(point);
      preview((gesture?.ratio ?? 1) * wheelZoom(event.deltaY), point);
      clearTimeout(timer); timer = setTimeout(finish, 160);
    };
    const doubleClick = (event: MouseEvent) => {
      if (Date.now() - lastTouch < 450 || isInteractiveTarget(event.target) || !window.getSelection()?.isCollapsed) return;
      event.preventDefault(); begin({ x: event.clientX, y: event.clientY });
      const { scale } = snapshot();
      preview(scale >= 1.8 ? 1 / scale : 2, { x: event.clientX, y: event.clientY }); finish();
    };
    const touchPoint = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY });
    const start = (event: TouchEvent) => {
      if (isInteractiveTarget(event.target)) return;
      if (event.touches.length === 1) { touchStart = touchPoint(event.touches[0]); wasPinch = false; }
      if (event.touches.length === 2) {
        wasPinch = true; lastTap = null;
        const a = touchPoint(event.touches[0]), b = touchPoint(event.touches[1]);
        begin(midpoint(a, b), distance(a, b));
      }
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !gesture) return;
      if (event.cancelable) event.preventDefault();
      const a = touchPoint(event.touches[0]), b = touchPoint(event.touches[1]);
      preview(zoomRatio(gesture.startDistance, distance(a, b), gesture.scale), midpoint(a, b));
    };
    const end = (event: TouchEvent) => {
      lastTouch = Date.now();
      if (wasPinch) { if (event.touches.length < 2) finish(); return; }
      if (event.touches.length || !touchStart || isInteractiveTarget(event.target)) return;
      const point = touchPoint(event.changedTouches[0]);
      if (distance(touchStart, point) > 12 || !window.getSelection()?.isCollapsed) { lastTap = null; return; }
      if (lastTap && lastTouch - lastTap.at < 300 && distance(lastTap.point, point) < 24) {
        if (event.cancelable) event.preventDefault();
        const { scale } = snapshot();
        begin(point); preview(scale >= 1.8 ? 1 / scale : 2, point); finish(); lastTap = null;
      } else lastTap = { at: lastTouch, point };
    };
    const cancel = () => { clearTimeout(timer); gesture = null; stage.style.transform = ""; lastTap = null; };
    scroller.addEventListener("wheel", wheel, { passive: false });
    scroller.addEventListener("dblclick", doubleClick);
    scroller.addEventListener("touchstart", start, { passive: true });
    scroller.addEventListener("touchmove", move, { passive: false });
    scroller.addEventListener("touchend", end, { passive: false });
    scroller.addEventListener("touchcancel", cancel);
    return () => {
      clearTimeout(timer); stage.style.transform = ""; scroller.style.touchAction = originalAction;
      scroller.removeEventListener("wheel", wheel); scroller.removeEventListener("dblclick", doubleClick);
      scroller.removeEventListener("touchstart", start); scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end); scroller.removeEventListener("touchcancel", cancel);
    };
  }, [scrollRef, stageRef, navigationRevision]);
}
