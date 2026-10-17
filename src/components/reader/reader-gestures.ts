export type Point = { x: number; y: number };
export function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function midpoint(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
export function zoomRatio(startDistance: number, currentDistance: number, scale: number) {
  const requested = startDistance > 0 ? currentDistance / startDistance : 1;
  return Math.max(0.25 / Math.max(0.001, scale), Math.min(4 / Math.max(0.001, scale), requested));
}
export function anchoredScroll(anchor: Point, viewportPoint: Point, ratio: number): Point {
  return { x: anchor.x * ratio - viewportPoint.x, y: anchor.y * ratio - viewportPoint.y };
}
export function wheelZoom(delta: number) { return Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002); }
export function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, select, [contenteditable=true]"));
}
