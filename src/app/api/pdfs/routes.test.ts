import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupLibrary, pdfUpload, PNG, resetLibrary, store } from "../../../../tests/helpers/library";

const routes = {
  library: await import("./route"),
  pdf: await import("./[id]/route"),
  cover: await import("./[id]/cover/route"),
};
beforeEach(async () => {
  await resetLibrary();
  await store.savePdf(...pdfUpload(undefined, "Route fixture.pdf"));
});
after(cleanupLibrary);

const api = "http://127.0.0.1:3000/api/pdfs";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function req(url: string, init: RequestInit = {}, host = "localhost") {
  return new Request(url, { ...init, headers: { ...init.headers as Record<string, string>, host } });
}
const library = async () => (await (await routes.library.GET(req(api))).json()) as { items: { id: string; name: string }[] };
const postPdf = (name: string, body: BodyInit, contentType: string) => routes.library.POST(req(api, {
  method: "POST", headers: { "content-type": contentType, "x-file-name": encodeURIComponent(name) }, body,
}));

test("a foreign Host is refused by every PDF endpoint", async () => {
  assert.equal((await routes.library.GET(req(api, {}, "evil.com"))).status, 403);
  assert.equal((await postPdf("books.pdf", "%PDF-1.4\n%%EOF", "application/pdf")).status, 201);
  const [item] = (await library()).items;
  assert.equal((await routes.pdf.GET(req(`${api}/${item.id}`, {}, "evil.com"), context(item.id))).status, 403);
  assert.equal((await routes.cover.GET(req(`${api}/${item.id}/cover`, {}, "evil.com"), context(item.id))).status, 403);
  assert.equal((await routes.pdf.DELETE(req(`${api}/${item.id}`, { method: "DELETE" }, "evil.com"), context(item.id))).status, 403);
  assert.ok((await library()).items.some((entry) => entry.id === item.id), "the refused delete changed nothing");
});

test("POST /api/pdfs streams a named PDF into the library", async () => {
  const bytes = "%PDF-1.4\nroute test pdf\n%%EOF";
  const response = await postPdf("My Book.pdf", bytes, "application/pdf");
  assert.equal(response.status, 201);
  const body = await response.json() as { items: { id: string; name: string; size: number }[] };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, "My Book.pdf");
  assert.equal(body.items[0].size, Buffer.byteLength(bytes), "the size is measured after writing, not taken from the header");
});

test("POST /api/pdfs refuses a body that is not a PDF", async () => {
  for (const contentType of ["text/plain", "application/octet-stream"]) {
    const response = await postPdf("notes.txt", "hello", contentType);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "not a PDF" });
  }
});

test("GET /api/pdfs lists what was uploaded", async () => {
  await postPdf("My Book.pdf", "%PDF-1.4\n%%EOF", "application/pdf");
  assert.ok((await library()).items.some((item) => item.name === "My Book.pdf"));
});

test("delete and restore work through the route handlers", async () => {
  const before = (await library()).items;
  const [item] = before;
  assert.equal((await routes.pdf.DELETE(req(`${api}/${item.id}`, { method: "DELETE" }), context(item.id))).status, 200);
  assert.deepEqual((await library()).items.map((entry) => entry.id), before.slice(1).map((entry) => entry.id));
  assert.equal((await routes.pdf.POST(req(`${api}/${item.id}?action=restore`, { method: "POST" }), context(item.id))).status, 200);
  assert.deepEqual((await library()).items.map((entry) => entry.id).sort(), before.map((entry) => entry.id).sort());
});

test("restore is reachable only through the explicit action", async () => {
  const [item] = (await library()).items;
  assert.equal((await routes.pdf.POST(req(`${api}/${item.id}`, { method: "POST" }), context(item.id))).status, 404);
});

test("the cover route stores an image and answers conditional requests", async () => {
  const [item] = (await library()).items;
  const posted = await routes.cover.POST(req(`${api}/${item.id}/cover`, { method: "POST", body: PNG, headers: { "content-type": "image/png" } }), context(item.id));
  assert.equal(posted.status, 201);
  assert.equal((await posted.json() as { item: { hasCover: boolean } }).item.hasCover, true);
  const first = await routes.cover.GET(req(`${api}/${item.id}/cover`), context(item.id));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/png");
  const etag = first.headers.get("etag");
  assert.ok(etag);
  await first.body?.cancel();
  assert.equal((await routes.cover.GET(req(`${api}/${item.id}/cover`, { headers: { "if-none-match": etag } }), context(item.id))).status, 304);
  assert.equal((await routes.cover.GET(req(`${api}/${item.id}/cover`, { headers: { "if-modified-since": first.headers.get("last-modified")! } }), context(item.id))).status, 304);
  assert.equal((await routes.cover.DELETE(req(`${api}/${item.id}/cover`, { method: "DELETE" }), context(item.id))).status, 200);
  assert.equal((await routes.cover.GET(req(`${api}/${item.id}/cover`), context(item.id))).status, 404);
});

test("the cover route accepts only the cover field and reports an oversized image", async () => {
  const [item] = (await library()).items;
  const otherField = new FormData();
  otherField.append("file", new File([PNG], "cover.png", { type: "image/png" }));
  assert.equal((await routes.cover.POST(req(`${api}/${item.id}/cover`, { method: "POST", body: otherField }), context(item.id))).status, 400);
  const tooLarge = new File([Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1)])], "big.png", { type: "image/png" });
  assert.equal((await routes.cover.POST(req(`${api}/${item.id}/cover`, {
    method: "POST", body: tooLarge, headers: { "content-type": "image/png" },
  }), context(item.id))).status, 413);
});
