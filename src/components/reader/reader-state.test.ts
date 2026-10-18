import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFERENCES, THUMBNAIL_ROW_HEIGHT,
  clampPage, clampZoom, pageSize, parseBookmarks,
  parsePreferences, parseProgress, readStorage, storageBlockedSnapshot, storageKey,
  subscribeStorageBlocked, thumbnailWindow, writeStorage, clampOffset, createProgressWriter, initialNavigation,
  LOCATION_HISTORY_LIMIT, parseReadingLocation, readerNavigationReducer, readingProgress,
  type SavedReadingProgress,
} from "./reader-state";

test("page numbers stay finite and within the document", () => {
  assert.equal(clampPage(NaN, 419, 23), 23);
  assert.equal(clampPage(Infinity, 419), 1);
  assert.equal(clampPage(-5, 419), 1);
  assert.equal(clampPage(500, 419), 419);
  assert.equal(clampPage(2.6, 419), 3);
  assert.equal(clampPage(10, 0), 1);
});

test("legacy and current progress formats remain readable", () => {
  assert.equal(parseProgress("17"), 17);
  assert.equal(parseProgress('{"page":42,"numPages":419}'), 42);
  assert.equal(parseProgress('{"page":900}', 419), 419);
  assert.equal(parseProgress("not json"), 1);
  assert.equal(parseProgress('{"page":"nonsense"}'), 1);
  assert.equal(parseProgress(null), 1);
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

test("settings validate values and recover from corrupt or unavailable storage", () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences("broken"), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('{"viewMode":"unsafe","paper":"invert","zoom":"huge"}'), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('{"viewMode":"fit-page","zoom":1.7,"paper":"sepia"}'),
    { ...DEFAULT_PREFERENCES, viewMode: "fit-page", zoom: 1.7, paper: "sepia" });
  assert.deepEqual(parsePreferences('{"paper":"dark"}'), { ...DEFAULT_PREFERENCES, paper: "dark" });
  assert.equal(readStorage("unavailable-in-node"), null);
  assert.equal(storageKey("progress", "book"), "better-reader:progress:book");
});

test("zoom is bounded and invalid zoom values recover", () => {
  assert.equal(clampZoom(0), 0.25);
  assert.equal(clampZoom(20), 4);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(1.104), 1.1);
});

test("bookmarks are sorted, unique, valid document pages", () => {
  assert.deepEqual(parseBookmarks('[9,1,9,3,0,-1,2.5,"8",100]', 10), [1, 3, 9]);
  assert.deepEqual(parseBookmarks("broken"), []);
  assert.deepEqual(parseBookmarks('{"page":3}'), []);
});

test("fit width uses the available reader width and caps oversized desktop pages", () => {
  assert.deepEqual(pageSize({ width: 600, height: 900 }, { width: 350, height: 700 }, "fit-width", 1), { width: 350, height: 525 });
  assert.equal(pageSize({ width: 600, height: 900 }, { width: 2000, height: 700 }, "fit-width", 1).width, 1120);
});

test("fit page fits both portrait and landscape pages without changing their aspect ratio", () => {
  const portrait = pageSize({ width: 600, height: 900 }, { width: 900, height: 600 }, "fit-page", 1);
  assert.deepEqual(portrait, { width: 400, height: 600 });
  const landscape = pageSize({ width: 900, height: 600 }, { width: 350, height: 700 }, "fit-page", 1);
  assert.deepEqual(landscape, { width: 350, height: 233 });
});

test("actual size ignores stale custom zoom; custom size uses it", () => {
  const natural = { width: 600, height: 900 }, available = { width: 350, height: 700 };
  assert.deepEqual(pageSize(natural, available, "actual-size", 3), natural);
  assert.deepEqual(pageSize(natural, available, "custom", 2), { width: 1200, height: 1800 });
  assert.ok(pageSize(natural, { width: 0, height: 0 }, "fit-page", 1).height >= 1);
});

test("thumbnail virtualization only mounts the viewport and a bounded buffer", () => {
  for (const total of [1, 20, 419, 10000]) {
    for (const top of [0, 500, 12000, Math.ceil(total / 2) * THUMBNAIL_ROW_HEIGHT - 700]) {
      const result = thumbnailWindow(total, top, 700);
      assert.ok(result.start >= 0);
      assert.ok(result.end <= Math.ceil(total / 2));
      assert.ok(result.end >= result.start);
      assert.ok(result.end - result.start <= 9);
    }
  }
  assert.deepEqual(thumbnailWindow(0, 0, 700), { start: 0, end: 0, rows: 0 });
  assert.equal(thumbnailWindow(419, -300, 700).start, 0);
});

test("reader-state migrates old settings to continuous without losing their paper mode or zoom", () => {
  assert.deepEqual(parsePreferences('{"viewMode":"custom","zoom":2,"theme":"dark","paper":"dimmed"}'), {
    ...DEFAULT_PREFERENCES, viewMode: "custom", zoom: 2, paper: "dimmed",
  });
  assert.deepEqual(parsePreferences('{"layout":"spread","cropMargins":true,"focusMode":true}'), {
    ...DEFAULT_PREFERENCES, layout: "spread", cropMargins: true, focusMode: true,
  });
  assert.deepEqual(parsePreferences('{"layout":"bad","cropMargins":"true","focusMode":1}'), DEFAULT_PREFERENCES);
  for (const layout of ["single", "continuous", "spread"]) {
    assert.equal(parsePreferences(JSON.stringify({ layout })).layout, layout);
  }
  assert.notEqual(storageKey("settings", "a"), storageKey("settings", "b"));
  assert.notEqual(storageKey("progress", "a"), storageKey("progress", "b"));
  assert.notEqual(storageKey("bookmarks", "a"), storageKey("bookmarks", "b"));
});

test("reader-state fractional locations validate offsets and retain legacy progress compatibility", () => {
  assert.deepEqual(parseReadingLocation("17"), { page: 17, offset: 0 });
  assert.deepEqual(parseReadingLocation('{"page":42,"numPages":419}'), { page: 42, offset: 0 });
  assert.deepEqual(parseReadingLocation('{"page":42,"offset":0.625,"numPages":419}'), { page: 42, offset: 0.625 });
  assert.equal(parseProgress('{"page":42,"offset":0.625}'), 42);
  assert.deepEqual(parseReadingLocation('{"page":900,"offset":2}', 419), { page: 419, offset: 1 });
  assert.deepEqual(parseReadingLocation('{"page":-3,"offset":-1}'), { page: 1, offset: 0 });
  for (const offset of ["0.5", null, {}, []]) {
    assert.equal(parseReadingLocation(JSON.stringify({ page: 2, offset })).offset, 0);
  }
  assert.equal(clampOffset(NaN), 0);
  assert.equal(clampOffset(Infinity), 0);
  assert.deepEqual(parseReadingLocation("broken"), { page: 1, offset: 0 });
});

test("reader-state scroll callbacks never change the stable explicit navigation request", () => {
  const start = initialNavigation({ page: 17, offset: 0.625 });
  const state = readerNavigationReducer(start, { type: "scroll", location: { page: 18, offset: 0.2 }, total: 419 });
  assert.deepEqual(state.location, { page: 18, offset: 0.2 });
  assert.equal(state.navigation, start.navigation);
  assert.deepEqual(state.history, []);
  assert.equal(readerNavigationReducer(state, { type: "scroll", location: state.location, total: 419 }), state);
  const jumped = readerNavigationReducer(state, { type: "jump", location: { page: 300, offset: 0 }, total: 419, remember: true });
  assert.deepEqual(jumped.history, [{ page: 18, offset: 0.2 }]);
  assert.equal(jumped.navigation.revision, 1);
});

test("reader-state jumps and Back restore fractional departures while ordinary page turns do not grow history", () => {
  let state = initialNavigation({ page: 4, offset: 0.75 });
  state = readerNavigationReducer(state, { type: "jump", location: { page: 100, offset: 0 }, total: 419, remember: true });
  state = readerNavigationReducer(state, { type: "jump", location: { page: 101, offset: 0 }, total: 419 });
  assert.equal(state.history.length, 1);
  state = readerNavigationReducer(state, { type: "back", total: 419 });
  assert.deepEqual(state.location, { page: 4, offset: 0.75 });
  assert.deepEqual(state.navigation, { page: 4, offset: 0.75, revision: 3 });
  assert.deepEqual(state.history, []);
  assert.equal(readerNavigationReducer(state, { type: "back", total: 419 }), state);
});

test("reader-state history is bounded, no-op jumps do not add entries, and restore clamps to the loaded PDF", () => {
  let state = initialNavigation({ page: 1, offset: 0 });
  for (let page = 2; page < 100; page++) {
    state = readerNavigationReducer(state, { type: "jump", location: { page, offset: 0 }, total: 419, remember: true });
  }
  assert.equal(state.history.length, LOCATION_HISTORY_LIMIT);
  assert.equal(state.history[0].page, 67);
  const history = state.history;
  state = readerNavigationReducer(state, { type: "jump", location: state.location, total: 419, remember: true });
  assert.equal(state.history, history);
  state = readerNavigationReducer(state, { type: "restore", total: 20 });
  assert.equal(state.location.page, 20);
  assert.equal(state.navigation.page, 20);
  state = readerNavigationReducer(state, { type: "back", total: 20 });
  assert.equal(state.location.page, 20);
});

test("reader-state progress writer debounces scroll bursts and flushes the latest location once", () => {
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
  writer.flush(); // pagehide, hidden visibility, and unmount share this path.
  writer.flush();
  assert.deepEqual(written[1], { page: 18, offset: 0.2, numPages: 419 });
  assert.equal(written.length, 2);
  assert.equal(timers.size, 0);
  writer.update({ page: 1, offset: 0 }, 0);
  writer.flush();
  assert.equal(written.length, 2);
});

test("writeStorage reports the save outcome and keeps each key's failure separate", () => {
  const globalScope = globalThis as unknown as { window?: unknown };
  const store = new Map<string, string>();
  let failing: string | null = null;
  const local = { setItem: (key: string, value: string) => { if (key === failing) throw new Error("QuotaExceededError"); store.set(key, value); } };
  globalScope.window = { localStorage: local };
  let notifications = 0;
  const unsubscribe = subscribeStorageBlocked(() => { notifications += 1; });
  try {
    assert.equal(storageBlockedSnapshot(), false);
    assert.equal(writeStorage("better-reader:bookmarks", [1]), true);
    assert.equal(store.get("better-reader:bookmarks"), "[1]");
    assert.equal(notifications, 0);
    failing = "better-reader:bookmarks";
    assert.equal(writeStorage("better-reader:bookmarks", [2]), false);
    assert.equal(storageBlockedSnapshot(), true);
    assert.equal(notifications, 1);
    assert.equal(store.get("better-reader:bookmarks"), "[1]");
    // A later save of a different key must not hide the bookmarks failure.
    failing = null;
    assert.equal(writeStorage("better-reader:progress", { page: 3 }), true);
    assert.equal(storageBlockedSnapshot(), true);
    assert.equal(notifications, 1);
    assert.equal(writeStorage("better-reader:bookmarks", [3]), true);
    assert.equal(storageBlockedSnapshot(), false);
    assert.equal(notifications, 2);
    assert.equal(store.get("better-reader:bookmarks"), "[3]");
  } finally {
    unsubscribe();
    delete globalScope.window;
  }
});
