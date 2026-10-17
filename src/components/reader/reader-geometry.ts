import { pageSize, type Size, type ViewMode } from "./reader-state";

export type ReaderLayout = "continuous" | "single" | "spread";
export type ReadingLocation = { page: number; offset: number };
export type CropBox = { x: number; y: number; width: number; height: number };
export const FULL_PAGE: CropBox = { x: 0, y: 0, width: 1, height: 1 };
export const ESTIMATED_PAGE: Size = { width: 612, height: 792 };
export const PAGE_GAP = 20;
export type PageBox = Size & { page: number; top: number; left: number; fullWidth: number; fullHeight: number; crop: CropBox };
export type ReaderGeometry = Size & { pages: PageBox[]; layout: ReaderLayout };
export function fraction(value: number) { return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0; }
export function effectiveLayout(layout: ReaderLayout, width: number): ReaderLayout {
  return layout === "spread" && width < 900 ? "continuous" : layout;
}
export function adjacentWindowPage(pages: readonly { page: number }[], direction: number, total: number) {
  const edge = direction < 0 ? Math.min(...pages.map((p) => p.page)) : Math.max(...pages.map((p) => p.page));
  const next = edge + (direction < 0 ? -1 : 1);
  return next >= 1 && next <= total ? next : null;
}
export function spreadPages(page: number, total: number) {
  const first = Math.max(1, Math.min(total, page % 2 === 0 ? page - 1 : page));
  return [first, first + 1].filter((n) => n <= total);
}

/** Unknown pages are estimates only: geometry never fetches PDF bytes. */
export function readerGeometry({ total, active, layout: requestedLayout, available, mode, zoom, sizes, crops }: {
  total: number; active: number; layout: ReaderLayout; available: Size; mode: ViewMode; zoom: number;
  sizes: ReadonlyMap<number, Size>; crops: ReadonlyMap<number, CropBox>;
}): ReaderGeometry {
  const layout = effectiveLayout(requestedLayout, available.width);
  const numbers = layout === "continuous" ? Array.from({ length: total }, (_, i) => i + 1)
    : layout === "spread" ? spreadPages(active, total) : [active];
  const slot = layout === "spread" ? { ...available, width: (Math.min(1120, available.width) - PAGE_GAP) / 2 } : available;
  const pages = numbers.map((page): PageBox => {
    const natural = sizes.get(page) ?? sizes.values().next().value ?? ESTIMATED_PAGE;
    const crop = crops.get(page) ?? FULL_PAGE;
    const size = pageSize({ width: natural.width * crop.width, height: natural.height * crop.height }, slot, mode, zoom);
    const fullWidth = size.width / crop.width;
    const fullHeight = fullWidth * natural.height / natural.width;
    return { width: size.width, height: fullHeight * crop.height, page, crop, top: 0, left: 0, fullWidth, fullHeight };
  });
  const width = Math.max(1, ...pages.map((page) => page.width), layout === "spread" ? pages.reduce((sum, p) => sum + p.width, 0) + (pages.length - 1) * PAGE_GAP : 0);
  let height = 0;
  let left = 0;
  for (const page of pages) {
    page.left = layout === "spread" ? left : (width - page.width) / 2;
    page.top = layout === "continuous" ? height : 0;
    left += page.width + PAGE_GAP;
    height = layout === "continuous" ? height + page.height + PAGE_GAP : Math.max(height, page.height);
  }
  return { pages, width, height: Math.max(1, height - (layout === "continuous" ? PAGE_GAP : 0)), layout };
}
export function locationAt(geometry: ReaderGeometry, top: number, preferredPage?: number): ReadingLocation {
  const pages = geometry.pages;
  // Browser scrollTop rounds to CSS pixels. Keep an explicit target when its
  // fractional top rounds just into the preceding page gap.
  const preferred = geometry.layout === "continuous" && preferredPage !== undefined ? pages[preferredPage - 1] : undefined;
  if (preferred && top < preferred.top && preferred.top - top <= 1) return { page: preferred.page, offset: 0 };
  // Binary search avoids scanning the long document on each scroll frame.
  let low = 0, high = pages.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (pages[mid].top + pages[mid].height + PAGE_GAP <= top) low = mid + 1;
    else high = mid;
  }
  const page = geometry.layout === "spread" ? pages.find((p) => p.page === preferredPage) ?? pages[0] : pages[low];
  return page ? { page: page.page, offset: fraction((top - page.top) / page.height) } : { page: 1, offset: 0 };
}
export function locationTop(geometry: ReaderGeometry, location: ReadingLocation) {
  const page = geometry.pages.find((p) => p.page === location.page);
  return page ? page.top + fraction(location.offset) * page.height : 0;
}
export function pageWindow(geometry: ReaderGeometry, top: number, height: number, direction: number, lowResource: boolean) {
  if (geometry.layout !== "continuous") return geometry.pages.map((p) => p.page);
  const start = locationAt(geometry, Math.max(0, top)).page;
  const end = locationAt(geometry, Math.max(0, top) + Math.max(1, height)).page;
  const visible = geometry.pages.slice(start - 1, end).map((p) => p.page);
  const next = direction < 0 ? start - 1 : end + 1;
  if (!lowResource && next >= 1 && next <= geometry.pages.length) visible.push(next);
  return visible;
}
