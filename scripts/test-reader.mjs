// Requires an existing production build, Chromium and agent-browser. Owns its server and library.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createReaderLibrary } from "../tests/fixtures/reader-library.mjs";
import { sleep } from "./lib/reader-browser.mjs";
import { browserGroups, isolatedBrowserEnv, requireBrowserRuntime, selectBrowserGroups } from "./lib/browser-groups.mjs";

requireBrowserRuntime();
const groups = selectBrowserGroups(process.argv.slice(2));
await readFile(new URL("../.next/BUILD_ID", import.meta.url)).catch(() => {
  throw new Error("Run bun run build before bun run test:browser.");
});
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
const { port } = reservation.address();
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const library = await createReaderLibrary();
const origin = `http://127.0.0.1:${port}`;
const env = isolatedBrowserEnv(process.env, library, origin);
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
const serverExited = new Promise((resolve) => server.once("close", resolve));
let serverError, logs = "", activeCheck, checkExited, cleaning;
server.on("error", (error) => { serverError = error; });
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk).slice(-16000); });

async function stop(child, exited) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
}
const cleanup = () => cleaning ??= (async () => {
  await stop(activeCheck, checkExited);
  await stop(server, serverExited);
  await library.cleanup();
})();
process.once("SIGINT", () => { void cleanup().finally(() => process.exit(130)); });
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Test server exited (${server.exitCode})`);
    try {
      const response = await fetch(`${origin}/api/pdfs`, { signal: AbortSignal.timeout(1000) });
      ready = response.ok && (await response.json()).items.some((item) => item.id === library.id);
      if (ready) break;
    } catch { /* The owned server is still starting. */ }
    await sleep(200);
  }
  assert.ok(ready, "The isolated test library did not become ready");
  for (const group of groups) {
    console.log(`Browser group: ${group}`);
    for (const command of browserGroups[group]) {
      activeCheck = spawn(process.execPath, command, { env: isolatedBrowserEnv(env, library, origin, group), stdio: "inherit" });
      checkExited = new Promise((resolve, reject) => {
        activeCheck.once("error", reject);
        activeCheck.once("close", (code) => resolve(code));
      });
      const code = await checkExited;
      assert.equal(code, 0, `${command.join(" ")} failed`);
      activeCheck = null;
    }
    assert.deepEqual(await readFile(library.pdfFile), library.bytes, `${group} changed the original PDF`);
  }
  console.log("PASS isolated browser suite; original fixture bytes unchanged");
} catch (error) {
  console.error(logs);
  throw error;
} finally { await cleanup(); }
