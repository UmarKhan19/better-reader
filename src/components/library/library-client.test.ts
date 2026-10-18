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
  static latest: UploadRequest;
  method = "";
  url = "";
  body: FormData | undefined;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };

  constructor() { UploadRequest.latest = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  send(body: FormData) { this.body = body; }
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

function mockUpload() {
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

test("uploads send every file and report only computable progress", async () => {
  mockUpload();
  const files = [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")];
  const progress: number[] = [];
  const promise = uploadPdfs(files, (percent) => progress.push(percent));
  const request = UploadRequest.latest;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/pdfs");
  assert.deepEqual(request.body?.getAll("files").map((file) => (file as File).name), ["a.pdf", "b.pdf"]);
  request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
  request.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 3 });
  request.respond(201, JSON.stringify({ items: [item], skipped: [] }));
  assert.deepEqual(await promise, { items: [item], skipped: [] });
  assert.deepEqual(progress, [67]);
});

test("partial and rejected batches retain their per-file outcomes", async () => {
  mockUpload();
  const skipped = [{ name: "notes.txt", reason: "not a PDF" }];
  for (const [status, body] of [
    [201, { items: [item], skipped }],
    [400, { items: [], skipped, error: "No files were uploaded" }],
    [500, { items: [item], skipped: [] }],
  ] as const) {
    const promise = uploadPdfs([], () => {});
    UploadRequest.latest.respond(status, JSON.stringify(body));
    assert.deepEqual(await promise, { items: body.items, skipped: body.skipped });
  }
});

test("failed uploads without useful outcomes reject so the caller can retry", async () => {
  mockUpload();
  for (const body of ["not json", "null", '{"error":"failed","items":[],"skipped":[]}']) {
    const promise = uploadPdfs([], () => {});
    UploadRequest.latest.respond(500, body);
    await assert.rejects(promise, /Couldn't upload/);
  }
  const disconnected = uploadPdfs([], () => {});
  UploadRequest.latest.onerror?.();
  await assert.rejects(disconnected, /Couldn't upload/);
});

test("malformed successful upload bodies preserve the existing empty-result behavior", async () => {
  mockUpload();
  for (const body of ["not json", "null", "17", "{}"]) {
    const promise = uploadPdfs([], () => {});
    UploadRequest.latest.respond(201, body);
    assert.deepEqual(await promise, { items: [], skipped: [] });
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
