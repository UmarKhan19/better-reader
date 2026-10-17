import type { PageBox } from "./reader-geometry";
import { allocateRasterWindow } from "./reader-raster-budget";
import { MAX_TILES, type VisibleRect } from "./reader-tiles";

export type ReaderWindowView = { top: number; left: number; width: number; height: number };
export function pageIntersection(box: PageBox, view: ReaderWindowView): VisibleRect {
  return {
    x: Math.max(0, view.left - box.left + box.crop.x * box.fullWidth),
    y: Math.max(0, view.top - box.top + box.crop.y * box.fullHeight),
    width: Math.max(0, Math.min(view.left + view.width, box.left + box.width) - Math.max(view.left, box.left)),
    height: Math.max(0, Math.min(view.top + view.height, box.top + box.height) - Math.max(view.top, box.top)),
  };
}

/** No page-count cap: every intersection competes by area within the same budget. */
export function planReaderWindow(boxes: readonly PageBox[], view: ReaderWindowView, active: number, deviceRatio: number, lowResource: boolean, prefetchPages: readonly number[] = []) {
  const candidates = boxes.map((box) => {
    const visible = pageIntersection(box, view);
    const prefetch = prefetchPages.includes(box.page);
    const area = prefetch ? 0 : visible.width * visible.height;
    return { box, visible, area, priority: !prefetch && (area > 0 || box.page === active) ? 0 as const : 1 as const };
  });
  const allocations = allocateRasterWindow(candidates.map(({ box, area, priority }) => ({
    page: box.page, size: { width: box.fullWidth, height: box.fullHeight }, visibleArea: area, priority,
  })), deviceRatio);
  const visible = candidates.filter((entry) => entry.area > 0).sort((a, b) => b.area - a.area || a.box.page - b.box.page);
  const tileLimits = new Map(visible.map((entry, index) => [entry.box.page, lowResource ? 0 :
    Math.floor(MAX_TILES / visible.length) + (index < MAX_TILES % visible.length ? 1 : 0)]));
  return candidates.flatMap((entry) => {
    const allocation = allocations.get(entry.box.page);
    return allocation ? [{ ...entry, allocation, tileLimit: tileLimits.get(entry.box.page) ?? 0 }] : [];
  });
}
