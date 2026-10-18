import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markStorageResult,
  storageBlockedSnapshot,
  subscribeStorageBlocked,
  clearStorageFailures,
} from "./storage-health";

test("storage health tracks failures per key", () => {
  clearStorageFailures();
  markStorageResult("a", false);
  assert.equal(storageBlockedSnapshot(), true);
  markStorageResult("b", true);
  assert.equal(storageBlockedSnapshot(), true, "success on b does not clear a");
  markStorageResult("a", true);
  assert.equal(storageBlockedSnapshot(), false);
});

test("storage health notifies listeners only on blocked-state transitions", () => {
  clearStorageFailures();
  let calls = 0;
  const unsubscribe = subscribeStorageBlocked(() => { calls++; });
  markStorageResult("x", false);
  assert.equal(calls, 1);
  markStorageResult("x", false);
  assert.equal(calls, 1, "no transition, no notification");
  markStorageResult("x", true);
  assert.equal(calls, 2);
  unsubscribe();
  markStorageResult("x", false);
  assert.equal(calls, 2, "unsubscribed listener is not called");
  clearStorageFailures();
});

test("clearStorageFailures clears blocked state and notifies listeners", () => {
  clearStorageFailures();
  markStorageResult("x", false);
  assert.equal(storageBlockedSnapshot(), true);
  let calls = 0;
  const unsubscribe = subscribeStorageBlocked(() => { calls++; });
  clearStorageFailures();
  assert.equal(storageBlockedSnapshot(), false);
  assert.equal(calls, 1);
  markStorageResult("y", false);
  assert.equal(storageBlockedSnapshot(), true);
  clearStorageFailures();
  unsubscribe();
});
