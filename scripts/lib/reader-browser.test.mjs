import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { waitFor } from "./reader-cdp.mjs";
import { launchBrowser } from "./reader-launch.mjs";
import { readConfig, readyExpression, resetStorageExpression } from "./reader-expressions.mjs";

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

test("independent browser setups clear progress, bookmarks, theme and previous settings", () => {
  const entries = new Map([
    ["better-reader:progress:book", '{"page":40,"offset":0.5}'],
    ["better-reader:bookmarks:book", "[40]"],
    ["better-reader:settings:book", '{"layout":"spread"}'],
    ["better-reader:theme", "dark"],
  ]);
  const localStorage = { clear: () => entries.clear(), setItem: (key, value) => entries.set(key, value) };
  const preferences = { layout: "single", viewMode: "custom", zoom: 4, cropMargins: false };
  vm.runInNewContext(resetStorageExpression("book", preferences), { localStorage });
  assert.deepEqual([...entries], [["better-reader:settings:book", JSON.stringify(preferences)]]);
  vm.runInNewContext(resetStorageExpression("book"), { localStorage });
  assert.equal(entries.size, 0, "Default layout checks must start without persisted preferences");
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

test("agent transport keeps explicit profile/Chromium flags, stdin evaluation and owned cleanup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "reader-agent-cli-test-"));
  const log = path.join(directory, "calls.jsonl");
  try {
    // This fake CLI exercises the adapter without starting a browser or requiring agent-browser.
    await writeFile(path.join(directory, "agent-browser"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), source = args.includes("eval") ? fs.readFileSync(0, "utf8") : undefined;
fs.appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ args, source }) + "\\n");
if (args.includes("fail")) process.exit(1);
console.log(source === undefined ? "done" : JSON.stringify(source === "bad" ? { success: false, error: "bad eval" } : { success: true, data: { result: source.startsWith("new Promise") ? true : 4 } }));
`, { mode: 0o755 });
    const result = spawnSync("node", ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { launchAgentBrowser } from ${JSON.stringify(new URL("./reader-launch.mjs", import.meta.url).href)};
      for (const chrome of ["/owned/chromium", undefined]) {
        const agent = await launchAgentBrowser({ chrome }, chrome ? "isolated-adapter-test" : "default-executable-test");
        try {
          assert.equal(agent.browser("open", "http://fixture"), "done");
          assert.equal(agent.evaluate("2 + 2"), 4);
          agent.wait("true");
          assert.throws(() => agent.evaluate("bad"), /bad eval/);
          assert.throws(() => agent.browser("fail"));
        } finally { await agent.cleanup(); await agent.cleanup(); }
      }
    `], { encoding: "utf8", timeout: 10000, env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, FAKE_AGENT_LOG: log } });
    assert.equal(result.status, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const profiles = new Set();
    for (const { args } of calls) {
      profiles.add(args[args.indexOf("--profile") + 1]);
      if (args[args.indexOf("--session") + 1] === "isolated-adapter-test") {
        assert.equal(args[args.indexOf("--executable-path") + 1], "/owned/chromium");
      } else assert.equal(args.includes("--executable-path"), false, "Keep CLI executable discovery when CHROME_BIN is absent");
      assert.equal(args[args.indexOf("--headed") + 1], "false");
    }
    assert.equal(profiles.size, 2);
    assert.equal(calls.filter(call => call.args.includes("close")).length, 2);
    assert.equal(calls.find(call => call.source === "2 + 2").args.at(-1), "--stdin");
    for (const profile of profiles) await assert.rejects(stat(profile), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
