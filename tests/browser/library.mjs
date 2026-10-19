import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, readConfig, waitFor } from "../../scripts/lib/reader-browser.mjs";
import { pdfFixture } from "../fixtures/pdf.mjs";
import { assertDisposableLibrary } from "./library-safety.mjs";

const { directory, origin, id: baselineId } = await assertDisposableLibrary(
  process.env, fileURLToPath(new URL("../../", import.meta.url)),
);
const config = { ...readConfig(), origin };
const timeout = 15000;
const json = JSON.stringify;
const baselineFile = path.join(directory, "uploads", `${baselineId}.pdf`);
const baselineBytes = await readFile(baselineFile);
const initialRecords = JSON.parse(await readFile(path.join(directory, "pdfs.json"), "utf8"));
assert.ok(Array.isArray(initialRecords) && initialRecords.some((item) => item.id === baselineId), "Baseline must belong to the supplied fixture");

async function request(url) {
  const target = new URL(url, origin);
  assert.equal(target.origin, origin, "Library checks must not leave the owned loopback server");
  return fetch(target, { signal: AbortSignal.timeout(timeout), redirect: "error", cache: "no-store" });
}
async function list() {
  const response = await request("/api/pdfs");
  assert.equal(response.status, 200, "Library listing must succeed");
  const { items } = await response.json();
  assert.ok(Array.isArray(items));
  return items;
}
async function bytes(url, expected) {
  const response = await request(url);
  assert.equal(response.status, 200, `Expected original bytes at ${url}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, `Bytes changed at ${url}`);
}

// Match the server to the owned directory before allowing any UI mutation.
const initialItems = await list();
const membership = (items) => items.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(membership(initialItems), membership(initialRecords), "READER_URL must serve BETTER_READER_DATA_DIR");
await bytes(`/api/pdfs/${baselineId}`, baselineBytes);
const initialIds = initialItems.map((item) => item.id);
const token = randomUUID().replaceAll("-", "");
const uploads = ["first", "retry"].map((suffix, index) => {
  const title = `Library browser ${token} ${suffix}`;
  return { title, name: `${title}.pdf`, bytes: Buffer.from(pdfFixture({ pages: 1, width: 600 + index, height: 800, blank: true })) };
});
const ownedIds = new Set();
const uploadAttempts = new Map();
let deleteRequests = 0;
let uploadDirectory;
const { cdp, cleanup } = await launchBrowser(config);
const waiting = new Set();
const held = new Map();
const rules = [];
const finished = new Set();
let interceptionError;
const recordError = (error) => { interceptionError ??= error; };
const healthy = () => { if (interceptionError) throw interceptionError; };

function deadline(label) {
  let resolve, reject, settled = false;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    waiting.delete(cancel);
    callback(value);
  };
  const cancel = () => finish(reject, new Error(`Cancelled ${label}`));
  const timer = setTimeout(() => {
    const error = new Error(`Timed out waiting for ${label}`);
    recordError(error);
    finish(reject, error);
  }, timeout);
  waiting.add(cancel);
  // A failed earlier assertion can leave a later network expectation unawaited.
  void promise.catch(() => {});
  return { promise, resolve: (value) => finish(resolve, value), reject: (error) => finish(reject, error) };
}
function pauseNext(matches, label) {
  const next = deadline(label);
  rules.push({ matches, resolve: next.resolve });
  return next.promise;
}
const pauseList = () => pauseNext((event) => event.request.method === "GET"
  && event.request.url === `${origin}/api/pdfs` && event.responseStatusCode !== undefined, "library list response");

cdp.on("Network.loadingFinished", (event) => finished.add(event.requestId));
cdp.on("Fetch.requestPaused", (event) => {
  void (async () => {
    const response = event.responseStatusCode !== undefined || event.responseErrorReason !== undefined;
    const url = new URL(event.request.url);
    if (!response && !["GET", "HEAD"].includes(event.request.method)) {
      if (url.pathname === "/api/pdfs" && event.request.method === "POST") {
        const encodedName = Object.entries(event.request.headers).find(([key]) => key.toLowerCase() === "x-file-name")?.[1];
        assert.ok(uploads.some((file) => encodeURIComponent(file.name) === encodedName), "Refusing an unexpected upload");
        const attempt = (uploadAttempts.get(encodedName) ?? 0) + 1;
        uploadAttempts.set(encodedName, attempt);
        if (encodedName === encodeURIComponent(uploads[1].name) && attempt === 1) {
          await cdp.send("Fetch.fulfillRequest", {
            requestId: event.requestId, responseCode: 503,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(json({ error: "Controlled retryable upload failure" })).toString("base64"),
          });
          return;
        }
      } else {
        const target = url.pathname.split("/")[3];
        assert.ok(target !== baselineId && ownedIds.has(target), "Refusing a mutation outside this workflow's uploads");
        if (event.request.method === "DELETE" && url.pathname === `/api/pdfs/${target}`) deleteRequests++;
      }
    }
    healthy();
    const index = rules.findIndex((rule) => rule.matches(event));
    if (index !== -1) {
      const [rule] = rules.splice(index, 1);
      const timer = setTimeout(() => {
        held.delete(event.requestId);
        recordError(new Error(`Intercepted request was not released: ${event.request.url}`));
        void cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }).catch(recordError);
      }, timeout * 2);
      held.set(event.requestId, timer);
      rule.resolve(event);
    } else await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  })().catch((error) => {
    recordError(error);
    void cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }).catch(recordError);
  });
});

async function readList(event) {
  assert.equal(event.responseStatusCode, 200);
  const result = await cdp.send("Fetch.getResponseBody", { requestId: event.requestId });
  const body = result.base64Encoded ? Buffer.from(result.body, "base64") : Buffer.from(result.body);
  event.body = body.toString("base64");
  const { items } = JSON.parse(body.toString("utf8"));
  assert.ok(Array.isArray(items));
  return items;
}
async function frames() {
  await cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
}
async function release(event) {
  healthy();
  assert.ok(held.has(event.requestId), "Expected a held request");
  assert.ok(event.networkId, "Intercepted request must have a Network identifier");
  const loaded = deadline(`response completion for ${event.request.url}`);
  if (finished.has(event.networkId)) loaded.resolve();
  cdp.on("Network.loadingFinished", (data) => { if (data.requestId === event.networkId) loaded.resolve(); });
  cdp.on("Network.loadingFailed", (data) => { if (data.requestId === event.networkId) loaded.reject(new Error(data.errorText)); });
  clearTimeout(held.get(event.requestId));
  held.delete(event.requestId);
  if (event.responseStatusCode !== undefined) {
    assert.ok(event.body, "Read the real list snapshot before delivering it");
    await cdp.send("Fetch.fulfillRequest", {
      requestId: event.requestId, responseCode: event.responseStatusCode, body: event.body,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
    });
  } else await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  await loaded.promise;
  await frames();
  healthy();
}
async function wait(expression) {
  healthy();
  await waitFor(cdp, expression, timeout);
  healthy();
}
async function click(selector) {
  await wait(`(() => { const node = document.querySelector(${json(selector)}); return node && !node.disabled; })()`);
  await cdp.evaluate(`document.querySelector(${json(selector)}).click()`);
}
async function clickText(text, scope) {
  const expression = `([...document.querySelectorAll(${json(`:is(${scope}) button`)})].find(button => button.textContent.trim() === ${json(text)} && !button.disabled))`;
  assert.ok(await cdp.evaluate(`Boolean(${expression})`), `Missing enabled '${text}' button in ${scope}`);
  await cdp.evaluate(`${expression}.click()`);
}
async function chooseFiles(selector, files) {
  await wait(`(() => { const node = document.querySelector(${json(selector)}); return node && !node.disabled; })()`);
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `Missing file input: ${selector}`);
  await cdp.send("DOM.setFileInputFiles", { nodeId, files });
}
async function escape() {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await frames();
}
const card = (id) => `#library a[href="/read/${id}"]`;
async function visible(ids) {
  const actual = await cdp.evaluate(`([...document.querySelectorAll('#library a[href^="/read/"]')].map(link => {
    const rect = link.getBoundingClientRect();
    return { href: link.getAttribute('href'), visible: rect.width > 0 && rect.height > 0 && getComputedStyle(link).visibility !== 'hidden' };
  }))`);
  assert.ok(actual.every((item) => item.visible), "Library cards must remain visible");
  assert.deepEqual(actual.map((item) => item.href).sort(), ids.map((id) => `/read/${id}`).sort(), "Visible library membership must reconcile without duplicates");
}
function uploadedItem(items, file) {
  const matches = items.filter((item) => item.name === file.name);
  assert.equal(matches.length, 1, `Expected one saved copy of ${file.name}`);
  assert.match(matches[0].id, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i);
  assert.ok(!initialIds.includes(matches[0].id), "An upload must never reuse a baseline record");
  ownedIds.add(matches[0].id);
  return matches[0];
}
async function mutateAndList(action) {
  const next = pauseList();
  await action();
  const event = await next;
  const items = await readList(event);
  await release(event);
  return items;
}

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: `${origin}/api/pdfs*`, requestStage: "Request" },
    { urlPattern: `${origin}/api/pdfs`, requestStage: "Response" },
  ] });
  await cdp.send("Page.navigate", { url: `${origin}/` });
  await wait(`Boolean(document.querySelector(${json(card(baselineId))}))`);
  await visible(initialIds);
  console.log("PASS library UI lists the owned baseline fixture");

  uploadDirectory = await mkdtemp(path.join(directory, "library-browser-"));
  for (const file of uploads) {
    file.path = path.join(uploadDirectory, file.name);
    await writeFile(file.path, file.bytes);
  }
  const uploadInput = 'input[type="file"][multiple][accept="application/pdf,.pdf"]';
  const staleUploadPromise = pauseList();
  await chooseFiles(uploadInput, uploads.map((file) => file.path));
  await wait(`Boolean(document.querySelector('header button[aria-label="Upload PDFs"][aria-busy="false"]'))
    && [...document.querySelectorAll('main [role="status"], main [role="alert"]')].some(notice => notice.textContent.includes('1 PDF uploaded')
      && notice.textContent.includes('1 failed') && notice.textContent.includes(${json(uploads[1].name)}))`);
  const staleUpload = await staleUploadPromise;
  const partialItems = await readList(staleUpload);
  const first = uploadedItem(partialItems, uploads[0]);
  assert.ok(!partialItems.some((item) => item.name === uploads[1].name), "Failed upload must not be saved");
  await visible([...initialIds, first.id]);
  assert.ok(await cdp.evaluate(`([...document.querySelectorAll('main [role="status"] button, main [role="alert"] button')]
    .some(button => button.textContent.trim() === 'Try again' && !button.disabled))`),
  "Partial success must offer Try again for failed files");
  const retriedItems = await mutateAndList(() => clickText("Try again", "main [role='status'], main [role='alert']"));
  const retried = uploadedItem(retriedItems, uploads[1]);
  assert.equal(uploadedItem(retriedItems, uploads[0]).id, first.id);
  await wait(`document.querySelector(${json(uploadInput)}).value === '' && Boolean(document.querySelector(${json(card(retried.id))}))`);
  const expectedIds = [...initialIds, first.id, retried.id];
  await visible(expectedIds);
  await release(staleUpload);
  await visible(expectedIds);
  assert.deepEqual([...uploadAttempts.entries()].sort(), [
    [encodeURIComponent(uploads[0].name), 1], [encodeURIComponent(uploads[1].name), 2],
  ].sort(), "Retry must submit only the failed file, not duplicate the successful upload");
  console.log("PASS partial upload retains success, retries failure through UI and ignores an older list response");

  const coverInput = `#library input[aria-label=${json(`Add cover image for ${uploads[0].title}`)}]`;
  const removeCover = `#library button[aria-label=${json(`Remove cover image for ${uploads[0].title}`)}]`;
  const covers = [];
  for (const color of ["#e50914", "#1464e5"]) {
    const encoded = await cdp.evaluate(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      const context = canvas.getContext('2d'); context.fillStyle = ${json(color)}; context.fillRect(0, 0, 2, 2);
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    })()`);
    const cover = { bytes: Buffer.from(encoded, "base64"), path: path.join(uploadDirectory, `cover-${covers.length}.png`) };
    await writeFile(cover.path, cover.bytes);
    covers.push(cover);
  }
  assert.notDeepEqual(covers[0].bytes, covers[1].bytes);
  async function assertCover(item, expected) {
    assert.equal(item.hasCover, true);
    assert.ok(item.coverUrl && item.coverVersion, "Saved cover must have a versioned URL");
    await cdp.evaluate(`document.querySelector(${json(card(first.id))}).scrollIntoView({ block: 'center' })`);
    await wait(`(() => { const image = document.querySelector(${json(`${card(first.id)} img`)});
      if (!image || !image.complete || image.naturalWidth === 0) return false;
      const source = new URL(image.currentSrc || image.src, location.href);
      return source.origin === location.origin && source.pathname + source.search === ${json(item.coverUrl)}
        && !document.querySelector(${json(coverInput)}).disabled; })()`);
    await bytes(item.coverUrl, expected);
    await visible(expectedIds);
  }
  let items = await mutateAndList(() => chooseFiles(coverInput, [covers[0].path]));
  let covered = items.find((item) => item.id === first.id);
  await assertCover(covered, covers[0].bytes);
  const originalCoverUrl = covered.coverUrl;
  items = await mutateAndList(() => chooseFiles(coverInput, [covers[1].path]));
  covered = items.find((item) => item.id === first.id);
  assert.notEqual(covered.coverUrl, originalCoverUrl, "Replacing a cover must invalidate its URL");
  await assertCover(covered, covers[1].bytes);
  items = await mutateAndList(() => click(removeCover));
  const uncovered = items.find((item) => item.id === first.id);
  assert.ok(!uncovered.hasCover && !uncovered.coverUrl, "Removal must reconcile cover metadata");
  await wait(`!document.querySelector(${json(`${card(first.id)} img`)}) && !document.querySelector(${json(removeCover)})`);
  assert.equal((await request(`/api/pdfs/${first.id}/cover`)).status, 404);
  await visible(expectedIds);
  items = await mutateAndList(() => chooseFiles(coverInput, [covers[1].path]));
  covered = items.find((item) => item.id === first.id);
  await assertCover(covered, covers[1].bytes);
  console.log("PASS cover add, replacement, removal and re-add use the real file input and reconcile the UI");

  const deleteButton = `#library button[aria-label=${json(`Delete ${uploads[0].title}`)}]`;
  await click(deleteButton);
  await wait(`Boolean(document.querySelector('dialog[open]')) && document.querySelector('dialog[open]').textContent.includes(${json(uploads[0].title)})`);
  assert.equal(await cdp.evaluate("document.querySelector('dialog[open] h2').textContent"), "Delete this PDF?");
  await escape();
  await wait("!document.querySelector('dialog[open]')");
  await click(deleteButton);
  await clickText("Cancel", "dialog[open]");
  await wait("!document.querySelector('dialog[open]')");
  assert.equal(deleteRequests, 0, "Cancel and non-pending Escape must not delete");
  await visible(expectedIds);

  await click(deleteButton);
  await wait("Boolean(document.querySelector('dialog[open]'))");
  const deleting = pauseNext((event) => event.request.method === "DELETE"
    && event.request.url === `${origin}/api/pdfs/${first.id}` && event.responseStatusCode === undefined, "pending delete request");
  const deletedListPromise = pauseList();
  // Keep focus on Cancel as it becomes disabled, the native-dialog Escape regression case.
  await cdp.evaluate("[...document.querySelectorAll('dialog[open] button')].find(button => button.textContent.trim() === 'Cancel').focus()");
  await clickText("Delete", "dialog[open]");
  const deleteRequest = await deleting;
  await wait("Boolean(document.querySelector('dialog[open] button[aria-busy=\"true\"][disabled]')) && [...document.querySelectorAll('dialog[open] button')].every(button => button.disabled)");
  await frames();
  await escape();
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('dialog[open] button[aria-busy=\"true\"]'))"), true,
    "Escape must not close an in-flight delete dialog");
  await visible(expectedIds);
  await bytes(`/api/pdfs/${first.id}`, uploads[0].bytes);
  await release(deleteRequest);
  const deletedList = await deletedListPromise;
  const deletedItems = await readList(deletedList);
  assert.ok(!deletedItems.some((item) => item.id === first.id));
  await wait(`!document.querySelector('dialog[open]') && !document.querySelector(${json(card(first.id))})
    && [...document.querySelectorAll('main [role="status"] button')].some(button => button.textContent.trim() === 'Undo delete')`);
  await visible(expectedIds.filter((id) => id !== first.id));
  assert.equal(deleteRequests, 1);
  assert.equal((await request(`/api/pdfs/${first.id}`)).status, 404);
  assert.deepEqual(await readFile(path.join(directory, "trash", "pdfs", `${first.id}.pdf`)), uploads[0].bytes);
  await assert.rejects(readFile(path.join(directory, "uploads", `${first.id}.pdf`)), { code: "ENOENT" });

  const restoredItems = await mutateAndList(() => clickText("Undo delete", "main [role='status']"));
  const restored = restoredItems.find((item) => item.id === first.id);
  assert.ok(restored, "Undo must restore the same PDF id");
  assert.equal(restored.coverUrl, covered.coverUrl, "Undo must restore the cover too");
  await wait(`Boolean(document.querySelector(${json(card(first.id))}))
    && [...document.querySelectorAll('main [role="status"]')].some(notice => notice.textContent.includes('Restored'))`);
  await assertCover(restored, covers[1].bytes);
  await release(deletedList);
  await assertCover(restored, covers[1].bytes);
  await visible(expectedIds);
  console.log("PASS delete dialog cancellation, trusted pending Escape guard, delete and undo ignore a delayed deleted-list response");

  const finalItems = await list();
  assert.deepEqual(finalItems.map((item) => item.id).sort(), [...expectedIds].sort());
  assert.deepEqual(finalItems.find((item) => item.id === baselineId), initialItems.find((item) => item.id === baselineId));
  for (const file of uploads) {
    const item = uploadedItem(finalItems, file);
    assert.deepEqual(await readFile(path.join(directory, "uploads", `${item.id}.pdf`)), file.bytes, "Library mutations must preserve uploaded originals on disk");
    await bytes(`/api/pdfs/${item.id}`, file.bytes);
  }
  await bytes(`/api/pdfs/${baselineId}`, baselineBytes);
  healthy();
  console.log("PASS uploaded originals and baseline bytes remain unchanged after the complete library workflow");
} finally {
  for (const cancel of waiting) cancel();
  for (const timer of held.values()) clearTimeout(timer);
  try {
    await cdp.send("Fetch.disable");
  } finally {
    try { await cleanup(); }
    finally {
      if (uploadDirectory) await rm(uploadDirectory, { recursive: true, force: true });
      assert.deepEqual(await readFile(baselineFile), baselineBytes, "Baseline fixture PDF was modified");
    }
  }
}
