import { test } from "node:test";
import assert from "node:assert/strict";
import { beginScrub, chapterMarkers, finishScrub, previewScrub, scrubberChapter } from "./reader-scrubber-state";

test("reader-scrubber accepts a drag only once, with no commits during preview", () => {
  let session = beginScrub(1, 419);
  for (let page = 2; page <= 300; page++) session = previewScrub(session, page, 419);
  assert.deepEqual(session, { active: true, draft: 300 });
  const drop = finishScrub(session, true);
  assert.equal(drop.page, 300);
  assert.equal(finishScrub(drop.session, true).page, null);
  assert.equal(previewScrub(drop.session, 42, 419), drop.session);
});

test("reader-scrubber cancellation, escape and lost capture never commit", () => {
  const session = previewScrub(beginScrub(17, 419), 100, 419);
  const cancelled = finishScrub(session, false);
  assert.equal(cancelled.page, null);
  assert.equal(finishScrub(cancelled.session, true).page, null);
});

test("reader-scrubber keyboard sessions clamp endpoints and can commit independently", () => {
  const end = previewScrub(beginScrub(17, 419), 999, 419);
  assert.equal(finishScrub(end, true).page, 419);
  const home = previewScrub(beginScrub(419, 419), -1, 419);
  assert.equal(finishScrub(home, true).page, 1);
  assert.equal(beginScrub(NaN, 419).draft, 1);
});

test("reader-scrubber chapter labels use the closest preceding destination", () => {
  const outline = [{ title: "External", page: null }, { title: "Second", page: 20 }, { title: "First", page: 3 }];
  assert.equal(scrubberChapter(outline, 1), null);
  assert.equal(scrubberChapter(outline, 19), "First");
  assert.equal(scrubberChapter(outline, 20), "Second");
  assert.equal(scrubberChapter(null, 20), null);
});

test("reader-scrubber chapter markers are unique, finite and bounded even for huge outlines", () => {
  const outline = Array.from({ length: 10000 }, (_, index) => ({ title: String(index), page: index + 1 }));
  const markers = chapterMarkers(outline, 10000);
  assert.ok(markers.length <= 64);
  assert.ok(markers.every((marker) => marker.fraction >= 0 && marker.fraction <= 1));
  assert.deepEqual(chapterMarkers([{ title: "Single", page: 1 }, { title: "Repeat", page: 1 }, { title: "Bad", page: 4 }], 1), [{ page: 1, fraction: 0 }]);
  assert.deepEqual(chapterMarkers(null, 419), []);
});
