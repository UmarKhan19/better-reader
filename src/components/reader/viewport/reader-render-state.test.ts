import { test } from "node:test";
import assert from "node:assert/strict";
import { finishRaster, rasterFrame, requestRaster, retainedPageWindow, type RasterFrame, type RasterState } from "./reader-render-state";
const frame = (key: string): RasterFrame => ({ key, width: 1000, height: 1500, ratio: 1 });

test("frame identity is pure geometry and changes with scale or retry generation", () => {
  const box = { fullWidth: 1000.5, fullHeight: 1500.75 };
  const first = rasterFrame(box, 1);
  assert.equal(first.width, 1000);
  assert.equal(first.height, 1500);
  assert.equal(rasterFrame(box, 1).key, first.key);
  assert.notEqual(rasterFrame(box, 2).key, first.key);
  assert.notEqual(rasterFrame(box, 1, 1).key, first.key);
});

test("old readable canvas survives resize/zoom until its replacement is ready", () => {
  const old = frame("old"), target = frame("zoomed");
  let state: RasterState = { shown: old, target: old };
  state = requestRaster(state, target);
  assert.equal(state.shown, old); assert.equal(state.target, target);
  state = finishRaster(state, target.key);
  assert.equal(state.shown, target);
});
test("late obsolete raster generations cannot replace the shown page", () => {
  const old = frame("old"), intermediate = frame("intermediate"), target = frame("latest");
  let state: RasterState = { shown: old, target: old };
  state = requestRaster(state, intermediate); state = requestRaster(state, target);
  const unchanged = finishRaster(state, intermediate.key);
  assert.equal(unchanged, state); assert.equal(unchanged.shown, old);
  state = finishRaster(state, target.key);
  assert.equal(finishRaster(state, old.key), state);
});
test("single/spread navigation retains only the last readable non-target holders", () => {
  const old = [{ page: 1 }, { page: 2 }];
  assert.deepEqual(retainedPageWindow(old, [{ page: 3 }, { page: 4 }]), old);
  assert.deepEqual(retainedPageWindow(old, [{ page: 2 }]), [{ page: 1 }]);
  assert.deepEqual(retainedPageWindow(old, old), []);
  assert.deepEqual(retainedPageWindow([], [{ page: 1 }]), []);
  // An unready intermediate jump does not become the retained readable window.
  assert.deepEqual(retainedPageWindow(old, [{ page: 99 }]), old);
});

test("first paint and repeated raster requests preserve stable state", () => {
  const target = frame("first");
  const state: RasterState = { shown: null, target };
  assert.equal(requestRaster(state, target), state);
  assert.equal(finishRaster(state, "unmounted").shown, null);
  assert.equal(finishRaster(state, target.key).shown, target);
});
