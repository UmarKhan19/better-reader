import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { browserGroups, isolatedBrowserEnv, requireBrowserRuntime, selectBrowserGroups } from "./browser-groups.mjs";

test("the default isolated browser suite includes every group and both existing transports", () => {
  assert.deepEqual(selectBrowserGroups([]), ["navigation", "search", "rendering", "gestures", "library"]);
  assert.deepEqual(browserGroups.search, [["scripts/check-reader.mjs", "search"]]);
  assert.deepEqual(browserGroups.library, [["tests/browser/library.mjs"]]);
  for (const group of ["navigation", "rendering"]) {
    assert.deepEqual(browserGroups[group], [["scripts/check-reader.mjs", group], ["scripts/check-reader-interactions.mjs", group]]);
  }
  assert.deepEqual(browserGroups.gestures, [["scripts/check-reader-interactions.mjs", "gestures"]]);
});

test("groups run independently, accept Bun's separator, and reject typos before starting a server", () => {
  for (const group of Object.keys(browserGroups)) assert.deepEqual(selectBrowserGroups(["--", group]), [group]);
  assert.deepEqual(selectBrowserGroups(["search", "navigation", "search"]), ["search", "navigation"]);
  assert.deepEqual(selectBrowserGroups(["--"]), Object.keys(browserGroups));
  assert.throws(() => selectBrowserGroups(["serach"]), /Unknown browser group: serach/);
  assert.deepEqual(selectBrowserGroups([], ["navigation", "search", "rendering"]), ["navigation", "search", "rendering"]);
  assert.throws(() => selectBrowserGroups(["library"], ["navigation", "search", "rendering"]), /Unknown browser group/);
});

test("destructive library permission is only granted to an owned library group", () => {
  const inherited = { READER_URL: "http://personal-server", READER_PDF_ID: "personal", BETTER_READER_DATA_DIR: "/personal", READER_DISPOSABLE_LIBRARY: "1", PATH: "/bin" };
  const library = { directory: "/owned/fixture", id: "fixture" };
  for (const group of [undefined, ...Object.keys(browserGroups)]) {
    const env = isolatedBrowserEnv(inherited, library, "http://127.0.0.1:12345", group);
    assert.equal(env.BETTER_READER_DATA_DIR, library.directory);
    assert.equal(env.READER_URL, "http://127.0.0.1:12345");
    assert.equal(env.READER_PDF_ID, library.id);
    assert.equal(env.READER_REQUIRE_TEXT, "1");
    assert.equal(env.READER_DISPOSABLE_LIBRARY, group === "library" ? "1" : "0");
    assert.equal(env.PATH, "/bin");
  }
  assert.equal(inherited.READER_URL, "http://personal-server");
});

test("browser runners require Node 22 or newer", () => {
  assert.throws(() => requireBrowserRuntime("20.19.0"), /Node 22/);
  requireBrowserRuntime("22.0.0");
  requireBrowserRuntime("25.8.2");
});

test("all browser entry scripts validate arguments before accessing a build, server or library", () => {
  for (const script of ["test-reader.mjs", "check-reader.mjs", "check-reader-interactions.mjs"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../${script}`, import.meta.url)), "--", "not-a-group"], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unknown browser group: not-a-group/);
  }
});
