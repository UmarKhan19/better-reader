import { test } from "node:test";
import assert from "node:assert/strict";
import { THUMBNAIL_ROW_HEIGHT, thumbnailWindow } from "./reader-thumbnails";

test("thumbnail virtualization only mounts the viewport and a bounded buffer", () => {
  for (const pageCount of [1, 20, 419, 10000]) {
    for (const top of [0, 500, 12000, Math.ceil(pageCount / 2) * THUMBNAIL_ROW_HEIGHT - 700]) {
      const result = thumbnailWindow(pageCount, top, 700);
      assert.ok(result.start >= 0);
      assert.ok(result.end <= Math.ceil(pageCount / 2));
      assert.ok(result.end >= result.start);
      assert.ok(result.end - result.start <= 9);
    }
  }
  assert.deepEqual(thumbnailWindow(0, 0, 700), { start: 0, end: 0, rows: 0 });
  assert.equal(thumbnailWindow(419, -300, 700).start, 0);
});
