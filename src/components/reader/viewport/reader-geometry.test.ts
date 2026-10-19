import { test } from "node:test";
import assert from "node:assert/strict";
import { adjacentWindowPage, effectiveLayout, FULL_PAGE, fraction, locationAt, locationTop, MAX_PAGE_WIDTH, pageSize, pageWindow, readerGeometry, SPREAD_MIN_WIDTH, spreadPages } from "./reader-geometry";
import type { Size } from "./reader-geometry";

function geometry(overrides: Partial<Parameters<typeof readerGeometry>[0]> = {}) {
  return readerGeometry({ total: 419, active: 1, layout: "continuous", available: { width: 1000, height: 800 },
    mode: "fit-width", zoom: 1, sizes: new Map(), crops: new Map(), ...overrides });
}

test("fit width uses the available reader width and caps oversized desktop pages", () => {
  assert.deepEqual(pageSize({ width: 600, height: 900 }, { width: 350, height: 700 }, "fit-width", 1), { width: 350, height: 525 });
  assert.equal(pageSize({ width: 600, height: 900 }, { width: 2000, height: 700 }, "fit-width", 1).width, MAX_PAGE_WIDTH);
});

test("fit page fits portrait and landscape without changing aspect ratios", () => {
  assert.deepEqual(pageSize({ width: 600, height: 900 }, { width: 900, height: 600 }, "fit-page", 1), { width: 400, height: 600 });
  assert.deepEqual(pageSize({ width: 900, height: 600 }, { width: 350, height: 700 }, "fit-page", 1), { width: 350, height: 233 });
});

test("actual size ignores stale custom zoom and custom size uses it", () => {
  const natural = { width: 600, height: 900 }, available = { width: 350, height: 700 };
  assert.deepEqual(pageSize(natural, available, "actual-size", 3), natural);
  assert.deepEqual(pageSize(natural, available, "custom", 2), { width: 1200, height: 1800 });
  assert.ok(pageSize(natural, { width: 0, height: 0 }, "fit-page", 1).height >= 1);
});

test("lazy geometry estimates the long document without inspecting any page", () => {
  const sizes = new Map<number, Size>();
  const result = geometry({ sizes });
  assert.equal(sizes.size, 0);
  assert.equal(result.pages.length, 419);
  assert.equal(result.pages[0].width, 1000);
  assert.equal(geometry({ available: { width: 2000, height: 800 } }).width, MAX_PAGE_WIDTH);
});

test("mixed-size discovery preserves fractional anchors through recalculation", () => {
  const initial = geometry();
  const anchor = { page: 200, offset: 0.437 };
  const initialLocation = locationAt(initial, locationTop(initial, anchor));
  assert.equal(initialLocation.page, anchor.page);
  assert.ok(Math.abs(initialLocation.offset - anchor.offset) < 1e-10);
  const discovered = geometry({ sizes: new Map([[1, { width: 600, height: 900 }], [199, { width: 900, height: 300 }], [200, { width: 700, height: 400 }]]) });
  assert.notEqual(locationTop(initial, anchor), locationTop(discovered, anchor));
  const restored = locationAt(discovered, locationTop(discovered, anchor));
  assert.equal(restored.page, anchor.page);
  assert.ok(Math.abs(restored.offset - anchor.offset) < 1e-10);
  assert.ok(discovered.pages[198].height < discovered.pages[197].height);
});

test("integer browser scroll positions keep explicit fractional page-top jumps on their target", () => {
  const result = geometry({ available: { width: MAX_PAGE_WIDTH, height: 740 } });
  for (const page of result.pages) {
    // scrollTop rounds CSS pixels while PDF page heights and accumulated tops do not.
    const actualTop = Math.round(28 + page.top) - 28;
    assert.equal(locationAt(result, actualTop, page.page).page, page.page, `Rounded page ${page.page} top`);
  }
});

test("single and desktop spreads only include the requested page pair", () => {
  assert.deepEqual(spreadPages(2, 419), [1, 2]);
  assert.deepEqual(spreadPages(419, 419), [419]);
  assert.deepEqual(geometry({ layout: "single", active: 37 }).pages.map((p) => p.page), [37]);
  const spread = geometry({ layout: "spread", active: 38 });
  assert.deepEqual(spread.pages.map((p) => p.page), [37, 38]);
  assert.ok(spread.width <= MAX_PAGE_WIDTH);
  assert.equal(spread.pages[1].top, 0);
  assert.ok(spread.pages[1].left > spread.pages[0].width);
  assert.equal(locationAt(spread, 120, 38).page, 38);
});

test("directional prefetch uses spread edges, including the final odd page", () => {
  assert.equal(adjacentWindowPage([{ page: 417 }, { page: 418 }], 1, 419), 419);
  assert.equal(adjacentWindowPage([{ page: 37 }, { page: 38 }], -1, 419), 36);
  assert.equal(adjacentWindowPage([{ page: 419 }], 1, 419), null);
  assert.equal(adjacentWindowPage([{ page: 1 }, { page: 2 }], -1, 419), null);
  assert.equal(adjacentWindowPage([{ page: 10 }], 1, 419), 11);
});

test("spread fallback does not mutate the saved preference and fits 320px", () => {
  assert.equal(effectiveLayout("spread", SPREAD_MIN_WIDTH - 1), "continuous");
  assert.equal(effectiveLayout("spread", SPREAD_MIN_WIDTH), "spread");
  for (const width of [320, 390, 844]) {
    const result = geometry({ layout: "spread", available: { width, height: 700 } });
    assert.equal(result.layout, "continuous"); assert.ok(result.width <= width);
  }
});

test("viewport window includes intersections, directional prefetch and low-resource reduction", () => {
  const result = geometry();
  const top = locationTop(result, { page: 200, offset: 0.2 });
  assert.deepEqual(pageWindow(result, top, 800, 1, false), [200, 201]);
  assert.deepEqual(pageWindow(result, top, 800, -1, false), [200, 199]);
  assert.deepEqual(pageWindow(result, top, 800, 1, true), [200]);
  const tallWindow = pageWindow(result, 0, 100000, 1, false);
  const intersecting = result.pages.filter((page) => page.top < 100000).map((page) => page.page);
  assert.deepEqual(tallWindow.slice(0, intersecting.length), intersecting);
  assert.ok(tallWindow.length <= intersecting.length + 1);
  assert.deepEqual(pageWindow(geometry({ layout: "single", active: 90 }), 0, 800, 1, false), [90]);
});

test("crop changes presentation geometry, not page coordinates, and anchors round trip", () => {
  const crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
  const result = geometry({ crops: new Map([[2, crop]]), sizes: new Map([[2, { width: 600, height: 900 }]]) });
  const page = result.pages[1];
  assert.equal(page.width, 1000);
  assert.equal(page.fullWidth, 1250);
  assert.equal(page.fullHeight, 1875);
  assert.equal(page.height, 1125);
  assert.deepEqual(page.crop, crop);
  assert.deepEqual(result.pages[0].crop, FULL_PAGE);
  for (const offset of [0, 0.15, 0.99]) {
    assert.ok(Math.abs(locationAt(result, locationTop(result, { page: 2, offset })).offset - offset) < 1e-10);
  }
});

test("resize and custom zoom maintain valid fractional locations", () => {
  for (const width of [320, 900, 1800]) for (const zoom of [0.25, 1, 4]) {
    const result = geometry({ available: { width, height: 700 }, mode: "custom", zoom });
    const restored = locationAt(result, locationTop(result, { page: 419, offset: 0.67 }));
    assert.equal(restored.page, 419); assert.ok(Math.abs(restored.offset - 0.67) < 1e-10);
  }
  assert.equal(fraction(NaN), 0); assert.equal(fraction(Infinity), 0);
  assert.equal(fraction(-1), 0); assert.equal(fraction(2), 1);
});
