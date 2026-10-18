import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import type { PdfItem } from "@/types/pdf";
import { addCover, deletePdf, listPdfs, removeCover, restorePdf, uploadPdfs } from "./library-client";

const item: PdfItem = {
  id: "book", name: "book.pdf", size: 100, mimeType: "application/pdf", createdAt: "2026-01-01T00:00:00Z",
};
const originalFetch = globalThis.fetch;
const originalXhr = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalXhr) Object.defineProperty(globalThis, "XMLHttpRequest", originalXhr);
  else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
});

class UploadRequest {
  static all: UploadRequest[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: File | undefined;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };

  constructor() { UploadRequest.all.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: File) { this.body = body; }
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

function mockUpload() {
  UploadRequest.all = [];
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: UploadRequest });
}

test("listing bypasses cache and defaults a missing collection to empty", async () => {
  const requests: Array<[unknown, RequestInit | undefined]> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push([url, init]);
    return Response.json(requests.length === 1 ? { items: [item] } : {});
  }) as typeof fetch;
  assert.deepEqual(await listPdfs(), [item]);
  assert.deepEqual(await listPdfs(), []);
  assert.deepEqual(requests[0], ["/api/pdfs", { cache: "no-store" }]);
});

test("listing rejects failed HTTP responses and malformed JSON", async () => {
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  await assert.rejects(listPdfs(), /Library request failed/);
  globalThis.fetch = (async () => new Response("not json")) as typeof fetch;
  await assert.rejects(listPdfs());
});

test("uploads send one raw-body request per file with the name header and aggregate progress", async () => {
  mockUpload();
  const files = [new File(["aaaa"], "a.pdf", { type: "application/pdf" }), new File(["bb"], "b.pdf", { type: "application/pdf" })];
  const progress: number[] = [];
  const promise = uploadPdfs(files, (percent) => progress.push(percent));
  await Promise.resolve();

  assert.equal(UploadRequest.all.length, 1, "files upload one at a time");
  const first = UploadRequest.all[0];
  assert.equal(first.method, "POST");
  assert.equal(first.url, "/api/pdfs");
  assert.equal(first.headers["x-file-name"], "a.pdf");
  assert.equal(first.body, files[0], "the File is the raw request body");
  first.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
  first.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 4 });
  first.respond(201, JSON.stringify({ items: [item] }));
  await Promise.resolve();

  const second = UploadRequest.all[1];
  assert.equal(second.headers["x-file-name"], "b.pdf");
  second.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 2 });
  second.respond(201, JSON.stringify({ items: [{ ...item, name: "b.pdf" }] }));
  assert.deepEqual(await promise, { items: [item, { ...item, name: "b.pdf" }], skipped: [], failed: [] });
  assert.deepEqual(progress, [50, 100], "progress covers the whole batch");
});

test("a file the server rejects becomes a per-file reason, not a failed batch", async () => {
  mockUpload();
  const files = [new File(["x"], "notes.txt", { type: "text/plain" }), new File(["y"], "b.pdf", { type: "application/pdf" })];
  const promise = uploadPdfs(files, () => {});
  await Promise.resolve();
  assert.equal(UploadRequest.all.length, 1, "a non-PDF never reaches the server");
  UploadRequest.all[0].respond(400, JSON.stringify({ error: "the upload was rejected" }));
  const result = await promise;
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.skipped, [
    { name: "notes.txt", reason: "not a PDF" },
    { name: "b.pdf", reason: "the upload was rejected" },
  ]);
  assert.deepEqual(result.failed, []);
});

test("server and network failures are reported as failed files instead of rejecting", async () => {
  mockUpload();
  const promise = uploadPdfs([new File(["x"], "a.pdf")], () => {});
  await Promise.resolve();
  UploadRequest.all[0].respond(500, JSON.stringify({ error: "couldn't be saved (no space left on the server)" }));
  assert.deepEqual(await promise, { items: [], skipped: [], failed: [new File(["x"], "a.pdf")] });

  mockUpload();
  const disconnected = uploadPdfs([new File(["x"], "a.pdf")], () => {});
  await Promise.resolve();
  UploadRequest.all[0].onerror?.();
  const result = await disconnected;
  assert.equal(result.items.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].name, "a.pdf");
});

test("a partial batch keeps saved items and reports only the failed remainder", async () => {
  mockUpload();
  const files = [new File(["a"], "a.pdf", { type: "application/pdf" }), new File(["b"], "b.pdf", { type: "application/pdf" })];
  const promise = uploadPdfs(files, () => {});
  await Promise.resolve();
  UploadRequest.all[0].respond(201, JSON.stringify({ items: [item] }));
  await Promise.resolve();
  UploadRequest.all[1].respond(500, JSON.stringify({ error: "boom" }));
  const result = await promise;
  assert.deepEqual(result.items, [item]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.failed, [files[1]]);

  mockUpload();
  const retryPromise = uploadPdfs(result.failed, () => {});
  await Promise.resolve();
  UploadRequest.all[0].respond(201, JSON.stringify({ items: [{ ...item, name: "b.pdf" }] }));
  const retryResult = await retryPromise;
  assert.deepEqual(retryResult.items, [{ ...item, name: "b.pdf" }]);
  assert.deepEqual(retryResult.failed, []);
});

test("a success reply without an item is reported honestly instead of silently dropped", async () => {
  for (const body of ["not json", "null", "17", "{}", JSON.stringify({ items: [] })]) {
    mockUpload();
    const promise = uploadPdfs([new File(["x"], "a.pdf")], () => {});
    await Promise.resolve();
    UploadRequest.all[0].respond(201, body);
    assert.deepEqual(await promise, {
      items: [],
      skipped: [{ name: "a.pdf", reason: "saved, but the reply couldn't be read — reload the library" }],
      failed: [],
    });
  }
});

test("delete, restore and cover removal use the existing routes and methods", async () => {
  const requests: Array<[unknown, RequestInit | undefined]> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push([url, init]);
    return Response.json({ ok: true });
  }) as typeof fetch;
  await deletePdf(item.id);
  await restorePdf(item.id);
  await removeCover(item.id);
  assert.deepEqual(requests, [
    ["/api/pdfs/book", { method: "DELETE" }],
    ["/api/pdfs/book?action=restore", { method: "POST" }],
    ["/api/pdfs/book/cover", { method: "DELETE" }],
  ]);
});

test("cover upload sends the image and permits a missing item for the caller's reload fallback", async () => {
  const file = new File(["image"], "cover.png", { type: "image/png" });
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls += 1;
    assert.equal(url, "/api/pdfs/book/cover");
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    assert.equal((init.body.get("cover") as File).name, file.name);
    return Response.json(calls === 1 ? { item } : {});
  }) as typeof fetch;
  assert.deepEqual(await addCover(item.id, file), item);
  assert.equal(await addCover(item.id, file), undefined);
});

test("all mutations reject failed HTTP responses", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  await assert.rejects(deletePdf(item.id), /Delete failed/);
  await assert.rejects(restorePdf(item.id), /Restore failed/);
  await assert.rejects(addCover(item.id, new File([], "cover.png")), /Cover upload failed/);
  await assert.rejects(removeCover(item.id), /Cover remove failed/);
});
