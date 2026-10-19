import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TILES, TILE_PIXEL_BUDGET, visibleTiles } from "./reader-tiles";
import { rasterAllocation, rasterPixels, PAGE_PIXEL_LIMIT } from "./reader-raster-budget";

test("per-raster allocations respect integer pixel and canvas dimension ceilings", () => {
  for (const size of [{ width: 350, height: 500 }, { width: 2500, height: 4000 }, { width: 40000, height: 3000 }]) {
    for (const allowance of [1, 250_000, PAGE_PIXEL_LIMIT]) {
      const allocation = rasterAllocation(size, 4, allowance);
      assert.equal(allocation.pixels, rasterPixels(size, allocation.ratio));
      assert.ok(allocation.pixels <= allowance);
      assert.ok(allocation.pixels <= PAGE_PIXEL_LIMIT);
      assert.ok(Math.max(size.width, size.height) * allocation.ratio <= 16384);
    }
  }
});
test("visible high-resolution tiles stay inside the page and six MP budget", () => {
  const size = { width: 2500, height: 4000 };
  const tiles = visibleTiles(size, { x: 200, y: 1700, width: 1500, height: 1000 }, 3, 0.3);
  assert.equal(tiles.length, MAX_TILES);
  assert.ok(tiles.reduce((n, tile) => n + tile.pixelWidth * tile.pixelHeight, 0) <= TILE_PIXEL_BUDGET);
  for (const tile of tiles) {
    assert.ok(tile.x + tile.width <= size.width); assert.ok(tile.y + tile.height <= size.height);
    assert.ok(tile.pixelWidth <= 1000 && tile.pixelHeight <= 1000);
    assert.ok(tile.y + tile.height > 1700 && tile.y < 2700);
  }
});
test("sharp fallback, hidden pages, zero tile allowance do not allocate tiles", () => {
  const size = { width: 500, height: 800 }, rect = { x: 0, y: 0, ...size };
  assert.deepEqual(visibleTiles(size, rect, 2, 2), []);
  assert.deepEqual(visibleTiles(size, { ...rect, height: 0 }, 2, 0.3), []);
  assert.deepEqual(visibleTiles(size, rect, 2, 0.3, 0), []);
});
test("tile identities track the visible region and per-page allowances share the limit", () => {
  const size = { width: 3000, height: 5000 };
  const first = visibleTiles(size, { x: 0, y: 0, width: 900, height: 700 }, 2, 0.3, 3);
  const next = visibleTiles(size, { x: 1000, y: 2000, width: 900, height: 700 }, 2, 0.3, 3);
  assert.ok(first.every((tile) => !next.some((other) => tile.key === other.key)));
  assert.ok([...first, ...next].reduce((n, tile) => n + tile.pixelWidth * tile.pixelHeight, 0) <= TILE_PIXEL_BUDGET);
});
