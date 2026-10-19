import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateRasterWindow, BASE_PIXEL_BUDGET, PAGE_PIXEL_LIMIT, ReaderRasterBudget, SHOWN_PIXEL_BUDGET, type RasterReservation } from "./reader-raster-budget";
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const check = (budget: ReaderRasterBudget) => {
  assert.ok(budget.counts.pixels <= BASE_PIXEL_BUDGET);
  assert.ok(budget.counts.shownPixels <= SHOWN_PIXEL_BUDGET);
};

test("area allocation includes twelve constrained visible pages before any prefetch", () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, size: { width: 20000, height: 120 }, visibleArea: i === 0 ? 2000 : 1000, priority: 0 as const }));
  const plan = allocateRasterWindow([...pages, { ...pages[0], page: 99, priority: 1 }], 2);
  for (const page of pages) assert.ok(plan.has(page.page));
  assert.ok(plan.get(1)!.pixels > plan.get(2)!.pixels);
  assert.ok([...plan.values()].every((allocation) => allocation.pixels <= PAGE_PIXEL_LIMIT));
  assert.ok([...plan.values()].reduce((sum, allocation) => sum + allocation.pixels, 0) <= SHOWN_PIXEL_BUDGET);
  const visibleOnly = allocateRasterWindow(pages, 2);
  for (const page of pages) assert.deepEqual(plan.get(page.page), visibleOnly.get(page.page));
  const unused = SHOWN_PIXEL_BUDGET - [...visibleOnly.values()].reduce((sum, allocation) => sum + allocation.pixels, 0);
  assert.ok((plan.get(99)?.pixels ?? 0) <= unused);
});

test("old canvases remain reserved until cleanup, and ready shrinkage unlocks growth", async () => {
  const budget = new ReaderRasterBudget(), promoted: string[] = [];
  const old = [1_000_000, 3_000_000, 2_000_000].map((pixels, i) => budget.reserve(i + 1, pixels, 0, false, () => {}, () => { promoted.push(`old${i}`); }));
  await tick(); old.forEach((ticket) => ticket.ready()); await tick();
  assert.equal(budget.counts.shownPixels, SHOWN_PIXEL_BUDGET);
  const next = [3_000_000, 1_000_000, 2_000_000].map((pixels, i) => budget.reserve(i + 1, pixels, 0, false, () => {}, () => { promoted.push(`new${i}`); }));
  await tick(); assert.equal(budget.counts.pixels, BASE_PIXEL_BUDGET);
  next[0].ready(); await tick(); assert.ok(!promoted.includes("new0")); check(budget);
  next[1].ready(); await tick(); assert.ok(promoted.includes("new1") && promoted.includes("new0"));
  next[2].ready(); await tick(); check(budget);
  assert.equal(budget.counts.pixels, BASE_PIXEL_BUDGET, "superseded canvases still occupy backing memory until actual unmount");
  const count = promoted.length; old.forEach((ticket) => ticket.ready()); await tick(); assert.equal(promoted.length, count);
  old.forEach((ticket) => ticket.cancel()); await tick(); assert.equal(budget.counts.pixels, SHOWN_PIXEL_BUDGET);
  next.forEach((ticket) => ticket.cancel()); await tick(); assert.equal(budget.counts.pixels, 0);
});

test("cancelled stale generations can neither start nor promote over the current frame", async () => {
  const budget = new ReaderRasterBudget(); const calls: string[] = [];
  const stale = budget.reserve(1, 3_000_000, 0, false, () => { calls.push("stale grant"); }, () => { calls.push("stale promotion"); });
  stale.cancel(); stale.ready();
  const current = budget.reserve(1, 3_000_000, 0, false, () => { calls.push("current grant"); }, () => { calls.push("current promotion"); });
  await tick(); current.ready(); await tick();
  stale.ready(); stale.cancel(); await tick();
  assert.deepEqual(calls, ["current grant", "current promotion"]); check(budget);
  current.cancel(); await tick(); assert.equal(budget.counts.pixels, 0);
});

test("a granted but obsolete ready raster cannot promote after cancellation", async () => {
  const budget = new ReaderRasterBudget(); const promotions: string[] = [];
  const old = budget.reserve(1, 3_000_000, 0, false, () => {}, () => { promotions.push("old"); });
  await tick(); old.ready(); await tick();
  const stale = budget.reserve(1, 3_000_000, 0, false, () => {}, () => { promotions.push("stale"); });
  await tick(); stale.ready(); stale.cancel();
  const latest = budget.reserve(1, 3_000_000, 0, false, () => {}, () => { promotions.push("latest"); });
  await tick(); latest.ready(); await tick();
  assert.deepEqual(promotions, ["old", "latest"]); check(budget);
  old.cancel(); latest.cancel(); await tick(); assert.equal(budget.counts.pixels, 0);
});

test("retained single/spread pages count physically without blocking the new readable window", async () => {
  const budget = new ReaderRasterBudget(); let shown = 0;
  const old = [1, 2].map((page) => budget.reserve(page, 3_000_000, 0, false, () => {}, () => {}));
  await tick(); old.forEach((ticket) => ticket.ready()); await tick();
  old.forEach((ticket) => ticket.update(1, true));
  const next = [3, 4].map((page) => budget.reserve(page, 3_000_000, 0, false, () => {}, () => { shown++; }));
  await tick(); next.forEach((ticket) => ticket.ready()); await tick();
  assert.equal(shown, 2); assert.equal(budget.counts.pixels, BASE_PIXEL_BUDGET); check(budget);
  old.forEach((ticket) => ticket.cancel()); next.forEach((ticket) => ticket.cancel()); await tick();
  assert.equal(budget.counts.pixels, 0);
});

test("rapid resize/zoom generations over twelve pages keep physical and shown budgets bounded", async () => {
  const budget = new ReaderRasterBudget();
  const displayed = new Map<number, RasterReservation>();
  let pending: RasterReservation[] = [];
  for (let generation = 0; generation < 18; generation++) {
    pending.filter((ticket) => ![...displayed.values()].includes(ticket)).forEach((ticket) => ticket.cancel());
    const candidates = Array.from({ length: 12 }, (_, index) => ({ page: index + 1,
      size: { width: 15000 + generation * 111, height: 100 + index }, visibleArea: 10 + (index + generation) % 12, priority: 0 as const }));
    const plan = allocateRasterWindow(candidates, generation % 2 ? 1 : 2);
    pending = candidates.map(({ page }) => {
      const allocation = plan.get(page)!;
      const ticket: RasterReservation = budget.reserve(page, allocation.pixels, 0, false, () => {}, () => {
        displayed.get(page)?.cancel(); displayed.set(page, ticket);
      });
      return ticket;
    });
    await tick(); check(budget);
    // Some generations finish only partially before another resize supersedes them.
    const ready = generation % 3 ? pending : pending.slice(0, 5);
    ready.slice().reverse().forEach((ticket) => ticket.ready()); await tick(); check(budget);
  }
  pending.forEach((ticket) => ticket.ready()); await tick(); check(budget);
  assert.equal(displayed.size, 12);
  pending.forEach((ticket, index) => assert.equal(displayed.get(index + 1), ticket, "only the latest generation remains shown"));
  pending.forEach((ticket) => ticket.cancel()); displayed.forEach((ticket) => ticket.cancel()); await tick();
  assert.equal(budget.counts.pixels, 0);
});
