import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { launchBrowser, readConfig, readyExpression, waitFor } from "./reader-browser.mjs";

test("reader checks share validated controls and have no personal-library defaults", () => {
  const config = readConfig({ BENCH_CPU: "4", BENCH_LATENCY_MS: "150", BENCH_DOWNLOAD_BPS: "200000", BENCH_WIDTH: "390", BENCH_HEIGHT: "844" });
  assert.equal(config.cpu, 4);
  assert.equal(config.latency, 150);
  assert.equal(config.download, 200000);
  assert.equal(config.upload, -1);
  assert.equal(config.width, 390);
  assert.equal(config.height, 844);
  assert.equal(config.origin, "http://127.0.0.1:3100");
  assert.deepEqual(config.ids, []);
  assert.deepEqual(readConfig({ READER_PDF_IDS: " a, b, " }).ids, ["a", "b"]);
  for (const env of [{ BENCH_CPU: "0" }, { BENCH_REPEATS: "1.5" }, { BENCH_DOWNLOAD_BPS: "-3" }, { BENCH_TIMEOUT_MS: "NaN" }]) {
    assert.throws(() => readConfig(env), /Invalid/);
  }
});

test("readiness requires the active visible canvas, for old and new stages", () => {
  const rect = { top: 0, bottom: 800, left: 0, right: 600, width: 600, height: 800 };
  const canvas = { width: 600, height: 800, getBoundingClientRect: () => rect };
  const holder = { querySelectorAll: () => [canvas] };
  let hasHolder = false;
  const stage = { dataset: { pageNumber: "2" }, querySelector: () => hasHolder ? holder : null, querySelectorAll: () => [canvas] };
  const context = { document: { querySelector: (selector) => selector === "main" ? { getBoundingClientRect: () => rect } : stage }, getComputedStyle: () => ({ visibility: "visible", display: "block" }) };
  assert.equal(vm.runInNewContext(readyExpression(2), context), true);
  hasHolder = true;
  assert.equal(vm.runInNewContext(readyExpression(2), context), true);
  assert.equal(vm.runInNewContext(readyExpression(3), context), false);
  canvas.width = 0;
  assert.equal(vm.runInNewContext(readyExpression(2), context), false);
  canvas.width = 600;
  context.getComputedStyle = () => ({ visibility: "hidden" });
  assert.equal(vm.runInNewContext(readyExpression(2), context), false);
});

test("polling checks actual readiness and reports a timeout", async () => {
  let calls = 0;
  await waitFor({ evaluate: async () => ++calls === 2 }, "ready", 500);
  assert.equal(calls, 2);
  await assert.rejects(waitFor({ evaluate: async () => false }, "not ready", 1), /Readiness timeout/);
});

test("browser launch failures are reported without leaving a live process", async () => {
  await assert.rejects(launchBrowser({ chrome: "/nonexistent/better-reader-chromium" }), /ENOENT/);
});
