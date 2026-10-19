import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_READER_UI, readerUiReducer } from "./reader-ui-state";

test("Search opens its sidebar, closes modal panels and reveals controls together", () => {
  const before = { ...INITIAL_READER_UI, panel: "settings" as const, sidebarTab: "pages" as const };
  assert.deepEqual(readerUiReducer(before, { type: "search" }), {
    sidebarOpen: true, sidebarTab: "search", panel: null, controlsVisible: true,
  });
  assert.equal(before.panel, "settings");
});

test("dismiss closes one UI layer at a time without losing the selected sidebar tab", () => {
  const layered = { ...INITIAL_READER_UI, sidebarOpen: true, sidebarTab: "search" as const, panel: "shortcuts" as const };
  const sidebar = readerUiReducer(layered, { type: "dismiss" });
  assert.equal(sidebar.panel, null);
  assert.equal(sidebar.sidebarOpen, true);
  const closed = readerUiReducer(sidebar, { type: "dismiss" });
  assert.equal(closed.sidebarOpen, false);
  assert.equal(closed.sidebarTab, "search");
  assert.equal(readerUiReducer(closed, { type: "dismiss" }), closed);
});

test("focus transitions close chrome without resetting the book's selected navigation tab", () => {
  const shown = { ...INITIAL_READER_UI, sidebarOpen: true, sidebarTab: "bookmarks" as const,
    panel: "settings" as const, controlsVisible: true };
  assert.deepEqual(readerUiReducer(shown, { type: "focus" }), {
    ...INITIAL_READER_UI, sidebarTab: "bookmarks",
  });
});

test("sidebar, panel and reveal commands preserve unrelated UI state", () => {
  let state = readerUiReducer(INITIAL_READER_UI, { type: "toggle-sidebar" });
  state = readerUiReducer(state, { type: "tab", tab: "pages" });
  state = readerUiReducer(state, { type: "panel", panel: "settings" });
  state = readerUiReducer(state, { type: "controls", visible: true });
  assert.deepEqual(state, { sidebarOpen: true, sidebarTab: "pages", panel: "settings", controlsVisible: true });
  assert.equal(readerUiReducer(state, { type: "controls", visible: true }), state);
  state = readerUiReducer(state, { type: "close-sidebar" });
  assert.equal(state.panel, "settings");
  assert.equal(readerUiReducer(state, { type: "close-sidebar" }), state);
  state = readerUiReducer(state, { type: "panel", panel: null });
  assert.equal(state.sidebarTab, "pages");
  assert.equal(readerUiReducer(state, { type: "toggle-sidebar" }).sidebarOpen, true);
});
