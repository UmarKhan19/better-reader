import { test } from "node:test";
import assert from "node:assert/strict";
import { readStorage, storageKey, writeStorage } from "./browser-storage";
import { progressStorageKey } from "./reading-progress";
import { clearStorageFailures, storageBlockedSnapshot, subscribeStorageBlocked } from "./storage-health";

test("storage keys stay per-book and unavailable storage reads as missing", () => {
  assert.equal(readStorage("unavailable-in-node"), null);
  assert.equal(progressStorageKey("book"), "better-reader:progress:book");
  assert.notEqual(storageKey("settings", "a"), storageKey("settings", "b"));
  assert.notEqual(storageKey("bookmarks", "a"), storageKey("bookmarks", "b"));
  assert.notEqual(progressStorageKey("a"), progressStorageKey("b"));
});

test("writes report the save outcome and keep each key's failure separate", () => {
  clearStorageFailures();
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const store = new Map<string, string>();
  let failing: string | null = null;
  const local = { setItem: (key: string, value: string) => { if (key === failing) throw new Error("QuotaExceededError"); store.set(key, value); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: local } });
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
    clearStorageFailures();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
