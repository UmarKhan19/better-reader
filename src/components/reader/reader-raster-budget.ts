import type { Size } from "./reader-state";
import type { RenderPriority } from "./reader-render-scheduler";

export const BASE_PIXEL_BUDGET = 12_000_000;
export const SHOWN_PIXEL_BUDGET = BASE_PIXEL_BUDGET / 2;
export const PAGE_PIXEL_LIMIT = 3_000_000;
export type RasterAllocation = { ratio: number; pixels: number };
export type RasterCandidate = { page: number; size: Size; visibleArea: number; priority: RenderPriority };
export function rasterPixels(size: Size, ratio: number) {
  return Math.ceil(size.width * ratio) * Math.ceil(size.height * ratio);
}
export function rasterAllocation(size: Size, deviceRatio: number, pixels: number): RasterAllocation {
  let low = 0, high = Math.min(Math.max(1, deviceRatio || 1), 2, 16384 / Math.max(1, size.width, size.height));
  const budget = Math.max(1, Math.min(PAGE_PIXEL_LIMIT, Math.floor(pixels)));
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (rasterPixels(size, middle) <= budget) low = middle; else high = middle;
  }
  return { ratio: low, pixels: rasterPixels(size, low) };
}

/** Visible ink area receives the budget first. Prefetch uses only unused capacity. */
export function allocateRasterWindow(candidates: readonly RasterCandidate[], deviceRatio: number) {
  const result = new Map<number, RasterAllocation>();
  let remaining = SHOWN_PIXEL_BUDGET;
  for (const priority of [0, 1, 2] as const) {
    let pending = candidates.filter((page) => page.priority === priority);
    while (pending.length && remaining >= pending.length) {
      const weight = pending.reduce((sum, page) => sum + Math.max(1, page.visibleArea), 0);
      const capped = pending.filter((page) => {
        const cap = rasterAllocation(page.size, deviceRatio, PAGE_PIXEL_LIMIT).pixels;
        return cap <= remaining * Math.max(1, page.visibleArea) / weight;
      });
      const batch = capped.length ? capped : pending;
      const pool = remaining;
      for (const [index, page] of batch.entries()) {
        const allowance = capped.length ? PAGE_PIXEL_LIMIT : Math.floor(pool * Math.max(1, page.visibleArea) / weight);
        const safeAllowance = Math.max(1, Math.min(remaining - (batch.length - index - 1), allowance));
        const allocation = rasterAllocation(page.size, deviceRatio, safeAllowance);
        result.set(page.page, allocation); remaining -= allocation.pixels;
      }
      if (!capped.length) break;
      pending = pending.filter((page) => !result.has(page.page));
    }
  }
  return result;
}

type Reservation = { page: number; pixels: number; priority: RenderPriority; order: number;
  granted: boolean; ready: boolean; shown: boolean; retained: boolean; cancelled: boolean; superseded: boolean;
  grant: () => void; promote: () => void };
export type RasterReservation = { ready: () => void; cancel: () => void;
  update: (priority: RenderPriority, retained: boolean) => void };

/** Physical reservations include retiring canvases until their actual effect cleanup.
 * Current shown frames stay <=6 MP; all physical reservations stay <=12 MP.
 * Ready growth waits for ready shrinkage, so rapid generations cannot accumulate
 * a mixture of individually valid but collectively oversized shown canvases.
 */
export class ReaderRasterBudget {
  private records = new Set<Reservation>();
  private shown = new Map<number, Reservation>();
  private pending = false;
  private order = 0;
  reserve(page: number, pixels: number, priority: RenderPriority, retained: boolean, grant: () => void, promote: () => void): RasterReservation {
    if (!Number.isInteger(pixels) || pixels < 1 || pixels > PAGE_PIXEL_LIMIT) throw new RangeError("Invalid raster pixel reservation");
    const record: Reservation = { page, pixels, priority, retained, grant, promote, order: this.order++,
      granted: false, ready: false, shown: false, cancelled: false, superseded: false };
    this.records.add(record); this.requestDrain();
    return {
      ready: () => { if (!record.cancelled) { record.ready = true; this.requestDrain(); } },
      cancel: () => {
        if (record.cancelled) return;
        record.cancelled = true; this.records.delete(record);
        if (this.shown.get(page) === record) this.shown.delete(page);
        this.requestDrain();
      },
      update: (nextPriority, nextRetained) => {
        if (record.cancelled) return;
        record.priority = nextPriority; record.retained = nextRetained;
        if (nextRetained && this.shown.get(page) === record) { this.shown.delete(page); record.shown = false; }
        this.requestDrain();
      },
    };
  }
  get counts() {
    return { pixels: [...this.records].filter((r) => r.granted).reduce((sum, r) => sum + r.pixels, 0),
      shownPixels: [...this.shown.values()].reduce((sum, r) => sum + r.pixels, 0),
      waiting: [...this.records].filter((r) => !r.granted).length };
  }
  private requestDrain() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.drain(); });
  }
  private drain() {
    const ordered = [...this.records].sort((a, b) => a.priority - b.priority || a.order - b.order);
    for (const record of ordered) {
      if (record.cancelled || record.granted) continue;
      if (this.counts.pixels + record.pixels > BASE_PIXEL_BUDGET) continue;
      record.granted = true; record.grant();
    }
    let promoted: boolean;
    do {
      promoted = false;
      for (const record of ordered) {
        if (record.cancelled || !record.granted || !record.ready || record.shown || record.retained || record.superseded) continue;
        const old = this.shown.get(record.page);
        if (this.counts.shownPixels - (old?.pixels ?? 0) + record.pixels > SHOWN_PIXEL_BUDGET) continue;
        if (old) { old.shown = false; old.superseded = true; }
        this.shown.set(record.page, record); record.shown = true;
        record.promote(); promoted = true;
      }
    } while (promoted && ordered.some((r) => !r.cancelled && r.ready && !r.shown && !r.retained && !r.superseded));
  }
}
