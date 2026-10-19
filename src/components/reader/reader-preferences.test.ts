import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFERENCES, clampZoom, paperPageColors, parseBookmarks, parsePreferences } from "./reader-preferences";

test("settings validate values and recover from corrupt or unavailable storage", () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences("broken"), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('{"viewMode":"unsafe","paper":"invert","zoom":"huge"}'), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('{"viewMode":"fit-page","zoom":1.7,"paper":"sepia"}'),
    { ...DEFAULT_PREFERENCES, viewMode: "fit-page", zoom: 1.7, paper: "sepia" });
  assert.deepEqual(parsePreferences('{"paper":"dark"}'), { ...DEFAULT_PREFERENCES, paper: "dark" });
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

test("old settings migrate to continuous without losing their paper mode or zoom", () => {
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
});

test("only dark paper bakes recoloring into each PDF canvas", () => {
  assert.deepEqual(paperPageColors("dark"), { background: "#000000", foreground: "#ffffff" });
  for (const paper of ["original", "dimmed", "sepia"] as const) assert.equal(paperPageColors(paper), null);
});
