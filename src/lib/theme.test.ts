import { test } from "node:test";
import assert from "node:assert/strict";
import { readTheme, writeTheme, THEME_STORAGE_KEY } from "./theme";

test("a theme choice survives a failing storage write for the current page", () => {
  const globalScope = globalThis as unknown as { window?: unknown };
  const store = new Map<string, string>();
  const local = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  globalScope.window = { localStorage: local };
  try {
    assert.equal(readTheme(), "system");
    assert.equal(writeTheme("dark"), true);
    assert.equal(readTheme(), "dark");
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    // Storage refuses the next writes; the choice still applies on this page.
    local.setItem = () => { throw new Error("SecurityError"); };
    assert.equal(writeTheme("light"), false);
    assert.equal(readTheme(), "light");
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(writeTheme("system"), false);
    assert.equal(readTheme(), "system");
  } finally {
    delete globalScope.window;
  }
});
