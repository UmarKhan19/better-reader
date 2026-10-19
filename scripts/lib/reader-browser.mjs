import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activeCleanups = new Set();
export async function cleanupBrowsers() { await Promise.allSettled([...activeCleanups].map((cleanup) => cleanup())); }

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }
  on(event, listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}

export async function launchBrowser(config) {
  const profile = await mkdtemp(path.join(tmpdir(), "reader-browser-"));
  const browser = spawn(config.chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let exitError;
  browser.on("error", (error) => { exitError = error; });
  let cdp, cleanupPromise;
  const interrupt = () => { void cleanup().finally(() => process.exit(130)); };
  const terminate = () => { void cleanup().finally(() => process.exit(143)); };
  const cleanup = () => cleanupPromise ??= (async () => {
    activeCleanups.delete(cleanup);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    cdp?.close();
    if (browser.exitCode === null && browser.pid) {
      browser.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), sleep(3000)]);
      if (browser.exitCode === null) { browser.kill("SIGKILL"); await new Promise((resolve) => browser.once("exit", resolve)); }
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  activeCleanups.add(cleanup);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      if (exitError) throw exitError;
      if (browser.exitCode !== null) throw new Error(`Chromium exited (${browser.exitCode})`);
      try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
      catch { await sleep(100); }
    }
    if (!port) throw new Error("Chromium did not expose a debugging port");
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`Chromium target discovery failed (${response.status})`);
    const targets = await response.json();
    const target = Array.isArray(targets) && targets.find((entry) => entry.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error("Chromium did not expose a page target");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    cdp = new CDP(socket);
    return { cdp, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function launchAgentBrowser(config, session) {
  // Explicit profiles keep user defaults and other named sessions out of these checks.
  const profile = await mkdtemp(path.join(tmpdir(), "better-reader-browser-"));
  const flags = ["--session", session, "--profile", profile, "--headed", "false"];
  if (config.chrome) flags.push("--executable-path", config.chrome);
  let browserStarted = false, cleaning;
  const interrupt = () => { void cleanup().finally(() => process.exit(130)); };
  const terminate = () => { void cleanup().finally(() => process.exit(143)); };
  const cleanup = () => cleaning ??= (async () => {
    activeCleanups.delete(cleanup);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    try { if (browserStarted) browser("close"); } catch (error) { console.warn("Browser cleanup:", error.message); }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  activeCleanups.add(cleanup);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  function browser(...args) {
    browserStarted = args[0] !== "close";
    return execFileSync("agent-browser", [...flags, ...args], {
      encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }
  function evaluate(source) {
    const output = execFileSync("agent-browser", [...flags, "--json", "eval", "--stdin"], {
      input: source, encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
    });
    const result = JSON.parse(output);
    assert.equal(result.success, true, JSON.stringify(result.error));
    return result.data.result;
  }
  function wait(source) {
    const settled = evaluate(`new Promise(resolve => {
      const deadline=Date.now()+18000;
      let readySince=0;
      function poll() {
        let ready=false;
        try { ready=Boolean(${source}); } catch {}
        if (ready) {
          readySince ||= Date.now();
          if (Date.now()-readySince >= 80) { resolve(true); return; }
        } else readySince=0;
        if (Date.now() >= deadline) { resolve(false); return; }
        setTimeout(poll,20);
      }
      poll();
    })`);
    assert.equal(settled, true, `Readiness was not established: ${source}`);
  }
  return { browser, evaluate, wait, cleanup };
}

export const resetStorageExpression = (id, preferences) => `localStorage.clear(); ${preferences
  ? `localStorage.setItem(${JSON.stringify(`better-reader:settings:${id}`)}, JSON.stringify(${JSON.stringify(preferences)}))`
  : ""}`;

export const readyExpression = (page) => `(() => {
  const stage = document.querySelector('[data-reader-stage][aria-busy="false"]');
  if (!stage ${page ? `|| Number(stage.dataset.pageNumber) !== ${page}` : ""}) return false;
  const main = document.querySelector('main'), mr = main?.getBoundingClientRect();
  const holder = stage.querySelector('[data-cached-page="' + stage.dataset.pageNumber + '"]') ?? stage;
  return [...holder.querySelectorAll('canvas')].some(canvas => {
    const r = canvas.getBoundingClientRect(), s = getComputedStyle(canvas);
    return canvas.width > 0 && canvas.height > 0 && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && mr && r.bottom > mr.top && r.top < mr.bottom && r.right > mr.left && r.left < mr.right;
  });
})()`;

export async function waitFor(cdp, expression, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await cdp.evaluate(expression)) return; await sleep(40); }
  throw new Error(`Readiness timeout: ${expression}`);
}

export function readConfig(env = process.env) {
  const numeric = (key, fallback, min = 0) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${key}`);
    return value;
  };
  const integer = (key, fallback, min) => {
    const value = numeric(key, fallback, min);
    if (!Number.isInteger(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    origin: (env.READER_URL ?? "http://127.0.0.1:3100").replace(/\/$/, ""),
    chrome: env.CHROME_BIN ?? "/usr/bin/chromium",
    ids: (env.READER_PDF_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
    repeats: integer("BENCH_REPEATS", 5, 1), steps: integer("BENCH_STEPS", 12, 0), cpu: numeric("BENCH_CPU", 1, 1),
    latency: numeric("BENCH_LATENCY_MS", 0), download: numeric("BENCH_DOWNLOAD_BPS", 0) || -1, upload: numeric("BENCH_UPLOAD_BPS", 0) || -1,
    width: integer("BENCH_WIDTH", 1440, 1), height: integer("BENCH_HEIGHT", 900, 1),
    timeout: numeric("BENCH_TIMEOUT_MS", 60000, 1), cacheWait: numeric("BENCH_CACHE_WAIT_MS", 5000, 1), settle: numeric("BENCH_SETTLE_MS", 1000),
    output: env.BENCH_OUTPUT ?? path.join(tmpdir(), `reader-benchmark-${Date.now()}.json`),
  };
}
