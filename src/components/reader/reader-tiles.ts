import type { Size } from "./reader-state";
// Raster reservations enforce 12 MP across all visible, incoming and retained
// pages, with a 3 MP per-canvas ceiling. Six 1 MP tiles add <=6 MP.
// Crop sampling uses one <=256x256 scratch canvas. Total <=18.07 MP
// (~73 MB RGBA), excluding browser/PDF.js internals and external previews.
export const TILE_PIXEL_BUDGET = 6_000_000;
export const MAX_TILES = 6;
export const TILE_EDGE = 1000;
export type VisibleRect = { x: number; y: number; width: number; height: number };
export type ReaderTile = VisibleRect & { key: string; pixelWidth: number; pixelHeight: number; ratio: number };
export function visibleTiles(size: Size, visible: VisibleRect, deviceRatio: number, baseRatio: number, limit = MAX_TILES): ReaderTile[] {
  const ratio = Math.min(2, Math.max(1, deviceRatio || 1));
  if (baseRatio >= ratio * 0.9 || visible.width <= 0 || visible.height <= 0) return [];
  const edge = TILE_EDGE / ratio;
  const x0 = Math.max(0, Math.floor(visible.x / edge));
  const y0 = Math.max(0, Math.floor(visible.y / edge));
  const x1 = Math.ceil(Math.min(size.width, visible.x + visible.width) / edge);
  const y1 = Math.ceil(Math.min(size.height, visible.y + visible.height) / edge);
  const tiles: ReaderTile[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const width = Math.min(edge, size.width - x * edge), height = Math.min(edge, size.height - y * edge);
    if (width <= 0 || height <= 0) continue;
    tiles.push({ key: `${x}:${y}:${ratio}`, x: x * edge, y: y * edge, width, height,
      pixelWidth: Math.min(TILE_EDGE, Math.ceil(width * ratio)), pixelHeight: Math.min(TILE_EDGE, Math.ceil(height * ratio)), ratio });
  }
  const cx = visible.x + visible.width / 2, cy = visible.y + visible.height / 2;
  return tiles.sort((a, b) => Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) - Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy))
    .slice(0, Math.max(0, Math.min(MAX_TILES, Math.floor(limit))));
}
