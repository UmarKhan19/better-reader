import { test } from "node:test";
import assert from "node:assert/strict";
import { anchoredScroll, distance, midpoint, wheelZoom, zoomRatio } from "./reader-gestures";

test("pinch distance and centroid allow simultaneous pan and zoom", () => {
  assert.equal(distance({ x: 10, y: 20 }, { x: 40, y: 60 }), 50);
  assert.deepEqual(midpoint({ x: 10, y: 20 }, { x: 40, y: 60 }), { x: 25, y: 40 });
  assert.equal(zoomRatio(100, 250, 1), 2.5);
});
test("anchored zoom keeps the same content point under the finger", () => {
  const content = { x: 600, y: 1000 }, screen = { x: 180, y: 300 };
  const scroll = anchoredScroll(content, screen, 2);
  assert.equal(content.x * 2 - scroll.x, screen.x);
  assert.equal(content.y * 2 - scroll.y, screen.y);
  const moved = anchoredScroll(content, { x: 210, y: 330 }, 2);
  assert.equal(moved.x, scroll.x - 30); assert.equal(moved.y, scroll.y - 30);
});
test("pinch, double-tap and wheel ratios respect absolute zoom bounds", () => {
  assert.equal(zoomRatio(100, 1000, 2), 2);
  assert.equal(zoomRatio(100, 1, 0.5), 0.5);
  assert.equal(zoomRatio(0, 100, 1), 1);
  assert.ok(wheelZoom(-20) > 1); assert.ok(wheelZoom(20) < 1);
  assert.equal(wheelZoom(10000), wheelZoom(100));
  assert.ok(Math.abs(wheelZoom(-20) * wheelZoom(20) - 1) < 1e-10);
});
