import { test } from "node:test";
import assert from "node:assert/strict";
import { locationTop, pageWindow, readerGeometry } from "./reader-geometry";
import { planReaderWindow, pageIntersection } from "./reader-render-window";
import { PAGE_PIXEL_LIMIT, SHOWN_PIXEL_BUDGET } from "./reader-raster-budget";
import { MAX_TILES, TILE_PIXEL_BUDGET, visibleTiles } from "./reader-tiles";

function panoramic(width: number, height: number, zoom = 1, custom = false) {
  return readerGeometry({ pageCount: 419, active: 1, layout: "continuous", available: { width, height },
    mode: custom ? "custom" : "fit-width", zoom,
    sizes: new Map([[1, { width: 3000, height: 90 }]]), crops: new Map() });
}

test("every visible panoramic page receives a raster at both document ends", () => {
  for (const lowResource of [false, true]) for (const atEnd of [false, true]) {
    const geometry = panoramic(1000, 800);
    const top = atEnd ? geometry.height - 800 : 0;
    const view = { top, left: 0, width: 1000, height: 800 };
    const expected = geometry.pages.filter((box) => pageIntersection(box, view).height > 0);
    assert.ok(expected.length > 6);
    const numbers = pageWindow(geometry, top, view.height, atEnd ? -1 : 1, lowResource);
    const plan = planReaderWindow(geometry.pages.filter((box) => numbers.includes(box.page)), view,
      expected[0].page, 2, lowResource);
    assert.deepEqual(plan.filter((entry) => entry.area > 0).map((entry) => entry.box.page), expected.map((box) => box.page));
    assert.ok(plan.every((entry) => entry.box.page >= 1 && entry.box.page <= 419));
    assert.ok(plan.reduce((sum, entry) => sum + entry.allocation.pixels, 0) <= SHOWN_PIXEL_BUDGET);
    if (lowResource) assert.ok(plan.every((entry) => entry.tileLimit === 0));
  }
});

test("resize and zoom windows retain every intersection within base and tile budgets", () => {
  for (const width of [320, 1000, 1800]) for (const zoom of [0.25, 1, 4]) {
    const geometry = panoramic(width, 844, zoom, true);
    for (const anchorPage of [1, 200, 419]) {
      const top = Math.max(0, Math.min(geometry.height - 844, locationTop(geometry, { page: anchorPage, offset: 0.4 })));
      const view = { top, left: width / 3, width, height: 844 };
      const numbers = pageWindow(geometry, top, view.height, 1, false);
      const plan = planReaderWindow(geometry.pages.filter((box) => numbers.includes(box.page)), view, anchorPage, 4, false);
      const expected = geometry.pages.filter((box) => {
        const intersection = pageIntersection(box, view); return intersection.width * intersection.height > 0;
      });
      for (const box of expected) assert.ok(plan.some((entry) => entry.box.page === box.page));
      assert.ok(plan.reduce((sum, entry) => sum + entry.allocation.pixels, 0) <= SHOWN_PIXEL_BUDGET);
      assert.ok(plan.every((entry) => entry.allocation.pixels <= PAGE_PIXEL_LIMIT));
      assert.ok(plan.reduce((sum, entry) => sum + entry.tileLimit, 0) <= MAX_TILES);
      const tiles = plan.flatMap((entry) => visibleTiles({ width: entry.box.fullWidth, height: entry.box.fullHeight },
        entry.visible, 4, entry.allocation.ratio, entry.tileLimit));
      assert.ok(tiles.reduce((sum, tile) => sum + tile.pixelWidth * tile.pixelHeight, 0) <= TILE_PIXEL_BUDGET);
    }
  }
});

test("hidden prefetch never steals visible allocation even when its geometry overlaps", () => {
  const geometry = panoramic(1000, 800);
  const view = { top: 0, left: 0, width: 1000, height: 800 };
  const visible = geometry.pages.slice(0, 16);
  const hidden = { ...geometry.pages[20], top: 0 };
  const base = planReaderWindow(visible, view, 1, 2, false);
  const withPrefetch = planReaderWindow([...visible, hidden], view, 1, 2, false, [hidden.page]);
  for (const entry of base) assert.deepEqual(withPrefetch.find((next) => next.box.page === entry.box.page)?.allocation, entry.allocation);
  const prefetch = withPrefetch.find((entry) => entry.box.page === hidden.page);
  assert.equal(prefetch?.priority, 1); assert.equal(prefetch?.tileLimit, 0);
  assert.ok(withPrefetch.reduce((sum, entry) => sum + entry.allocation.pixels, 0) <= SHOWN_PIXEL_BUDGET);
});
