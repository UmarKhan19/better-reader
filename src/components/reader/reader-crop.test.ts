import { test } from "node:test";
import assert from "node:assert/strict";
import { paperColor, renderedInkCrop } from "./reader-crop";
import { FULL_PAGE } from "./reader-geometry";

function paper() { const pixels = new Uint8ClampedArray(100 * 100 * 4); pixels.fill(255); return pixels; }
function ink(pixels: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * 100 + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
  }
}
function text() { const pixels = paper(); for (let y = 20; y < 80; y += 5) ink(pixels, 20, y, 80, y + 1); return pixels; }
function darkText() {
  const pixels = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  for (let y = 20; y < 80; y += 5) for (let x = 20; x < 80; x++) {
    const i = (y * 100 + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
  }
  return pixels;
}

test("rendered white margins get padded conservative ink bounds", () => {
  const crop = renderedInkCrop(text(), 100, 100);
  assert.ok(crop.x > 0.1 && crop.x < 0.2);
  assert.ok(crop.y > 0.1 && crop.y < 0.2);
  assert.ok(crop.x + crop.width > 0.8);
  assert.ok(crop.y + crop.height > 0.75);
});
test("blank, invalid, dense image and full-bleed pages stay uncropped", () => {
  assert.deepEqual(renderedInkCrop(paper(), 100, 100), FULL_PAGE);
  assert.deepEqual(renderedInkCrop(text(), 100, 100, [], true), FULL_PAGE);
  assert.deepEqual(renderedInkCrop(new Uint8ClampedArray(), 100, 100), FULL_PAGE);
  const image = paper(); ink(image, 10, 10, 90, 90);
  assert.deepEqual(renderedInkCrop(image, 100, 100), FULL_PAGE);
  const edge = text(); ink(edge, 0, 20, 2, 30);
  assert.deepEqual(renderedInkCrop(edge, 100, 100), FULL_PAGE);
  const tiny = paper(); ink(tiny, 45, 45, 50, 50);
  assert.deepEqual(renderedInkCrop(tiny, 100, 100), FULL_PAGE);
});
test("annotations outside ink remain inside presentation crop", () => {
  const crop = renderedInkCrop(text(), 100, 100, [{ x: 0.01, y: 0.9, width: 0.3, height: 0.08 }]);
  assert.equal(crop.x, 0);
  assert.equal(crop.y + crop.height, 1);
  assert.deepEqual(renderedInkCrop(text(), 100, 100, [{ x: NaN, y: 0, width: 0, height: 0 }]), FULL_PAGE);
});
test("transparent backgrounds do not count as dark ink", () => {
  assert.deepEqual(renderedInkCrop(new Uint8ClampedArray(100 * 100 * 4), 100, 100), FULL_PAGE);
});
test("dark paper crops on its white text instead of its black background", () => {
  const crop = renderedInkCrop(darkText(), 100, 100, [], false, paperColor("#000000"));
  assert.ok(crop.x > 0.1 && crop.x < 0.2);
  assert.ok(crop.y > 0.1 && crop.y < 0.2);
  assert.ok(crop.x + crop.width > 0.8);
  // Read as white paper, the same pixels are one dense ink block and keep the full page.
  assert.deepEqual(renderedInkCrop(darkText(), 100, 100), FULL_PAGE);
});
test("paper colours parse only as #rrggbb and default to white", () => {
  assert.deepEqual(paperColor(undefined), { r: 255, g: 255, b: 255 });
  assert.deepEqual(paperColor("#FFFFFF"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(paperColor("#000000"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(paperColor("black"), { r: 255, g: 255, b: 255 });
});
