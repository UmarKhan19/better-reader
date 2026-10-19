import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CDP, sleep, trackCleanup } from "./reader-cdp.mjs";

export async function launchBrowser(config) {
  const profile = await mkdtemp(path.join(tmpdir(), "reader-browser-"));
  const browser = spawn(config.chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let exitError;
  browser.on("error", (error) => { exitError = error; });
  let cdp, cleanupPromise, untrack;
  const interrupt = () => { void cleanup().finally(() => process.exit(130)); };
  const terminate = () => { void cleanup().finally(() => process.exit(143)); };
  const cleanup = () => cleanupPromise ??= (async () => {
    untrack?.();
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
  untrack = trackCleanup(cleanup);
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
  let browserStarted = false, cleaning, untrack;
  const interrupt = () => { void cleanup().finally(() => process.exit(130)); };
  const terminate = () => { void cleanup().finally(() => process.exit(143)); };
  const cleanup = () => cleaning ??= (async () => {
    untrack?.();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    try { if (browserStarted) browser("close"); } catch (error) { console.warn("Browser cleanup:", error.message); }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  untrack = trackCleanup(cleanup);
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
