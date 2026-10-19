import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibraryProgress, progressPercent } from "../components/library/library-model";
import { clampPage, clampOffset, createProgressWriter, parseReadingLocation, parseSavedProgress, progressStorageKey, readingProgress, type SavedReadingProgress } from "./reading-progress";

test("page numbers stay finite and within the document", () => {
  assert.equal(clampPage(NaN, 419, 23), 23);
  assert.equal(clampPage(Infinity, 419), 1);
  assert.equal(clampPage(-5, 419), 1);
  assert.equal(clampPage(500, 419), 419);
  assert.equal(clampPage(2.6, 419), 3);
  assert.equal(clampPage(10, 0), 1);
});

test("legacy and current progress formats remain readable", () => {
  assert.equal(parseReadingLocation("17").page, 17);
  assert.equal(parseReadingLocation('{"page":42,"numPages":419}').page, 42);
  assert.equal(parseReadingLocation('{"page":900}', 419).page, 419);
  assert.equal(parseReadingLocation("not json").page, 1);
  assert.equal(parseReadingLocation('{"page":"nonsense"}').page, 1);
  assert.equal(parseReadingLocation(null).page, 1);
});

test("reading progress reaches both page-navigation endpoints and stays bounded", () => {
  assert.equal(readingProgress({ page: 1, offset: 0 }, 40), 0);
  assert.equal(readingProgress({ page: 40, offset: 0 }, 40), 100);
  assert.equal(readingProgress({ page: 40, offset: 1 }, 40), 100);
  assert.equal(readingProgress({ page: 2, offset: 0.5 }, 4), 50);
  assert.equal(readingProgress({ page: 1, offset: 0 }, 1), 100);
  assert.equal(readingProgress({ page: 999, offset: -4 }, 40), 100);
  assert.equal(readingProgress({ page: 1, offset: 0 }, 0), 0);
});

test("fractional locations validate offsets and retain legacy progress compatibility", () => {
  assert.deepEqual(parseReadingLocation("17"), { page: 17, offset: 0 });
  assert.deepEqual(parseReadingLocation('{"page":42,"numPages":419}'), { page: 42, offset: 0 });
  assert.deepEqual(parseReadingLocation('{"page":42,"offset":0.625,"numPages":419}'), { page: 42, offset: 0.625 });
  assert.equal(parseReadingLocation('{"page":42,"offset":0.625}').page, 42);
  assert.deepEqual(parseReadingLocation('{"page":900,"offset":2}', 419), { page: 419, offset: 1 });
  assert.deepEqual(parseReadingLocation('{"page":-3,"offset":-1}'), { page: 1, offset: 0 });
  for (const offset of ["0.5", null, {}, []]) assert.equal(parseReadingLocation(JSON.stringify({ page: 2, offset })).offset, 0);
  assert.equal(clampOffset(NaN), 0);
  assert.equal(clampOffset(Infinity), 0);
  assert.deepEqual(parseReadingLocation("broken"), { page: 1, offset: 0 });
});

test("progress writer debounces scroll bursts and flushes the latest location once", () => {
  const written: SavedReadingProgress[] = [];
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  let serial = 0;
  const clock = {
    set(callback: () => void) {
      const id = ++serial as unknown as ReturnType<typeof setTimeout>;
      timers.set(id, callback);
      return id;
    },
    clear(id: ReturnType<typeof setTimeout>) { timers.delete(id); },
  };
  const writer = createProgressWriter((value) => written.push(value), 500, clock);
  for (let index = 0; index < 100; index++) writer.update({ page: 17, offset: index / 100 }, 419);
  assert.equal(written.length, 0);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.deepEqual(written, [{ page: 17, offset: 0.99, numPages: 419 }]);
  assert.equal(timers.size, 0);
  writer.update({ page: 18, offset: 0.2 }, 419);
  writer.flush();
  writer.flush();
  assert.deepEqual(written[1], { page: 18, offset: 0.2, numPages: 419 });
  assert.equal(written.length, 2);
  assert.equal(timers.size, 0);
  writer.update({ page: 1, offset: 0 }, 0);
  writer.flush();
  assert.equal(written.length, 2);
});

test("library and reader share the saved format without sharing their missing-data policy", () => {
  for (const raw of [null, "", "broken", "null", '"17"', "{}", '{"page":"bad"}']) {
    assert.equal(parseLibraryProgress(raw), undefined, String(raw));
    assert.deepEqual(parseReadingLocation(raw), { page: 1, offset: 0 }, String(raw));
  }
  for (const raw of ["17", "17.4", '{"page":"17.4","numPages":"100","offset":0.625}']) {
    assert.deepEqual(parseLibraryProgress(raw), { page: 17, numPages: raw.startsWith("{") ? 100 : 0 });
    assert.deepEqual(parseReadingLocation(raw), { page: 17, offset: raw.startsWith("{") ? 0.625 : 0 });
  }
  assert.equal(progressStorageKey("book"), "better-reader:progress:book");
});

test("legacy consumer differences remain explicit", () => {
  assert.equal(parseSavedProgress("+17"), null);
  assert.deepEqual(parseLibraryProgress("+17"), { page: 17, numPages: 0 });
  assert.deepEqual(parseReadingLocation("+17"), { page: 1, offset: 0 });
  assert.equal(parseLibraryProgress('{"page":-2,"offset":0.5}'), undefined);
  assert.deepEqual(parseReadingLocation('{"page":-2,"offset":0.5}'), { page: 1, offset: 0.5 });
  assert.deepEqual(parseReadingLocation('{"page":"bad","offset":0.5}'), { page: 1, offset: 0.5 });
  assert.equal(progressPercent({ page: 1, numPages: 40 }), 3);
  assert.equal(readingProgress({ page: 1, offset: 0 }, 40), 0);
});

test("malformed numeric metadata cannot prevent restoring an otherwise usable location", () => {
  const raw = '{"page":17,"offset":0.5,"numPages":{"toString":null}}';
  assert.deepEqual(parseReadingLocation(raw), { page: 17, offset: 0.5 });
  assert.deepEqual(parseLibraryProgress(raw), { page: 17, numPages: 0 });
  const invalid = '{"page":{"toString":null},"offset":0.5}';
  assert.deepEqual(parseReadingLocation(invalid), { page: 1, offset: 0.5 });
  assert.equal(parseLibraryProgress(invalid), undefined);
});
