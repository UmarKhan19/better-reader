import { test } from "node:test";
import assert from "node:assert/strict";
import { initialNavigation, LOCATION_HISTORY_LIMIT, readerNavigationReducer } from "./reader-navigation";

test("scroll callbacks never change the stable explicit navigation request", () => {
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

test("jumps and Back restore fractional departures while ordinary page turns do not grow history", () => {
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

test("history is bounded, no-op jumps do not add entries, and restore clamps to the loaded PDF", () => {
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
