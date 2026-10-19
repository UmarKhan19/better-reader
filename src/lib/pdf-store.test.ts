import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The store reads BETTER_READER_DATA_DIR lazily, so this file owns a disposable
// data directory without changing the process working directory. Route handlers
// are exercised here too: they share this module instance, so they must not have
// a second importer in another test file.
const dir = await mkdtemp(path.join(tmpdir(), "better-reader-store-"));
process.env.BETTER_READER_DATA_DIR = path.join(dir, "data");
assert.notEqual(path.resolve(process.env.BETTER_READER_DATA_DIR), path.resolve(process.cwd(), "data"),
  "tests must never point at the real library");
const store = await import("./pdf-store");
const ai = await import("./ai");
const routes = {
  library: await import("../app/api/pdfs/route"),
  pdf: await import("../app/api/pdfs/[id]/route"),
  cover: await import("../app/api/pdfs/[id]/cover/route"),
};

after(async () => {
  await chmod(path.join(dir, "data"), 0o755).catch(() => {});
  delete process.env.BETTER_READER_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

let serial = 0;
function pdfUpload(bytes = "%PDF-1.4\n%%EOF", name = `book-${++serial}.pdf`): [ReadableStream<Uint8Array>, string] {
  return [new Blob([bytes]).stream(), name];
}
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=",
  "base64",
);

test("uploads keep their exact bytes and show up in the list", async () => {
  const bytes = "%PDF-1.4\noriginal library file\n%%EOF";
  const item = await store.savePdf(...pdfUpload(bytes, "kept.pdf"));
  assert.equal(await readFile(store.pdfFilePath(item.id), "utf8"), bytes);
  assert.ok((await store.listPdfs()).some((entry) => entry.id === item.id));
  assert.deepEqual(await store.findPdf(item.id), item);
});

test("delete and restore return the same original bytes", async () => {
  const bytes = "%PDF-1.4\nrestore me exactly\n%%EOF";
  const item = await store.savePdf(...pdfUpload(bytes, "restore.pdf"));
  assert.equal(await store.deletePdf(item.id), true);
  assert.equal(await store.findPdf(item.id), null);
  await assert.rejects(stat(store.pdfFilePath(item.id)), "the live path must be empty while in the trash");
  assert.equal((await store.restorePdf(item.id))?.id, item.id);
  assert.equal(await readFile(store.pdfFilePath(item.id), "utf8"), bytes);
  assert.equal(await store.restorePdf(item.id), null, "a consumed record cannot restore twice");
});

test("a cover named cover.pdf cannot replace the PDF bytes", async () => {
  const bytes = "%PDF-1.4\noriginal cannot be replaced\n%%EOF";
  const item = await store.savePdf(...pdfUpload(bytes, "keeper.pdf"));
  const result = await store.saveCover(item.id, new File([PNG], "cover.pdf", { type: "image/png" }));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.item.coverFileName, `${item.id}.png`, "the extension comes from the bytes");
  assert.equal(await store.deletePdf(item.id), true);
  const restored = await store.restorePdf(item.id);
  assert.ok(restored?.coverFileName, "the cover comes back with the book");
  assert.equal(await readFile(store.pdfFilePath(item.id), "utf8"), bytes);
  assert.notEqual(await store.resolveCoverFilePath(item.id), null);
});

test("only real image bytes are accepted as covers", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "covered.pdf"));
  const html = new File(["<!doctype html><script>alert(1)</script>"], "cover.html", { type: "text/html" });
  assert.deepEqual(await store.saveCover(item.id, html), { ok: false, reason: "unsupported" });
  const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"], "cover.svg", { type: "image/svg+xml" });
  assert.deepEqual(await store.saveCover(item.id, svg), { ok: false, reason: "unsupported" });
  assert.equal(await store.resolveCoverFilePath(item.id), null, "nothing was written for a rejected cover");
  const accepted = await store.saveCover(item.id, new File([PNG], "actually-a-webp.webp", { type: "image/webp" }));
  assert.ok(accepted.ok);
  if (!accepted.ok) return;
  assert.equal(accepted.item.coverFileName, `${item.id}.png`, "the file name and MIME type do not decide");
  assert.deepEqual(await store.saveCover("not-a-uuid", new File([PNG], "c.png", { type: "image/png" })), { ok: false, reason: "missing" });
});

test("parallel uploads all survive the shared index", async () => {
  const before = (await store.listPdfs()).length;
  const saved = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    store.savePdf(...pdfUpload(`%PDF-1.4\nbook ${index}\n%%EOF`, `parallel-${index}.pdf`))));
  const items = await store.listPdfs();
  for (const item of saved) assert.ok(items.some((entry) => entry.id === item.id));
  assert.equal(items.length, before + saved.length);
});

test("a failed index write leaves the previous library readable and no orphan upload", async () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) return; // permission checks need a normal user
  const before = await store.listPdfs();
  const data = path.join(dir, "data");
  const uploadsBefore = (await readdir(path.join(data, "uploads"))).sort();
  await chmod(data, 0o555);
  try {
    await assert.rejects(store.savePdf(...pdfUpload(undefined, "blocked.pdf")));
    await assert.rejects(store.deletePdf(before[0].id), "a delete that cannot finish must fail loudly");
  } finally {
    await chmod(data, 0o755);
  }
  assert.deepEqual((await store.listPdfs()).map((item) => item.id), before.map((item) => item.id));
  assert.deepEqual((await readdir(path.join(data, "uploads"))).sort(), uploadsBefore, "the rejected upload must not stay on disk");
  assert.equal(await store.restorePdf(before[0].id), null, "no recovery record was written for the failed delete");
});

test("a cover file that vanished is cleared from the index instead of 404ing forever", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "lost-cover.pdf"));
  const result = await store.saveCover(item.id, new File([PNG], "gone.png", { type: "image/png" }));
  assert.ok(result.ok);
  if (!result.ok) return;
  await rm(path.join(dir, "data/covers", result.item.coverFileName!), { force: true });
  const listed = (await store.listPdfs()).find((entry) => entry.id === item.id);
  assert.equal(listed?.hasCover, false);
  assert.equal(listed?.coverUrl, undefined);
  assert.equal(await store.resolveCoverFilePath(item.id), null);
});

test("deleting a book whose bytes are already gone strands neither cover nor trash record", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "already-gone.pdf"));
  const withCover = await store.saveCover(item.id, new File([PNG], "keep.png", { type: "image/png" }));
  assert.ok(withCover.ok);
  if (!withCover.ok) return;
  await rm(store.pdfFilePath(item.id), { force: true });
  assert.equal(await store.deletePdf(item.id), true);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "data/trash.json"), "utf8")), []);
  assert.deepEqual(await readdir(path.join(dir, "data/trash/covers")), [], "no cover may be moved without a trash record");
  assert.ok(!(await readdir(path.join(dir, "data/covers"))).includes(withCover.item.coverFileName!), "the cover file is removed with the book");
  assert.equal(await store.resolveCoverFilePath(item.id), null);
});

test("replacing a cover changes the URL so an open page cannot show the old image", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "cover-url.pdf"));
  const first = await store.saveCover(item.id, new File([PNG], "first.png", { type: "image/png" }));
  const second = await store.saveCover(item.id, new File([PNG, Buffer.from("more")], "second.png", { type: "image/png" }));
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.notEqual(first.item.coverUrl, second.item.coverUrl);
  assert.equal(second.item.coverUrl, `/api/pdfs/${item.id}/cover?v=${encodeURIComponent(second.item.coverVersion ?? "")}`);
  assert.equal((await store.listPdfs()).find((entry) => entry.id === item.id)?.coverUrl, second.item.coverUrl);
});

test("cover metadata is canonical only", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "canonical.pdf"));
  const covered = await store.saveCover(item.id, new File([PNG], "c.png", { type: "image/png" }));
  assert.ok(covered.ok);
  if (!covered.ok) return;
  const found = await store.findPdf(item.id) as Record<string, unknown> | null;
  assert.ok(found);
  assert.equal(found?.hasCover, true);
  assert.ok(typeof found?.coverUrl === "string");
  assert.ok(typeof found?.coverFileName === "string");
  assert.ok(typeof found?.coverVersion === "string");
  for (const key of ["cover", "coverImage", "thumbnail", "thumbnailUrl", "coverExt", "coverMimeType"]) {
    assert.equal(found?.[key], undefined, `${key} must not be written`);
  }
  const listed = (await store.listPdfs()).find((entry) => entry.id === item.id) as Record<string, unknown> | undefined;
  assert.equal(listed?.cover, undefined);
});

test("legacy cover aliases are normalized away on read and on the next write", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "legacy.pdf"));
  const indexFile = path.join(dir, "data", "pdfs.json");
  const records = JSON.parse(await readFile(indexFile, "utf8")) as Record<string, unknown>[];
  const record = records.find((entry) => entry.id === item.id)!;
  record.cover = "/api/pdfs/legacy/cover";
  record.coverImage = record.cover;
  record.thumbnail = record.cover;
  record.thumbnailUrl = record.cover;
  record.coverExt = ".png";
  record.coverMimeType = "image/png";
  await writeFile(indexFile, JSON.stringify(records), "utf8");

  const found = await store.findPdf(item.id) as Record<string, unknown> | null;
  assert.ok(found);
  for (const key of ["cover", "coverImage", "thumbnail", "thumbnailUrl", "coverExt", "coverMimeType"]) {
    assert.equal(found?.[key], undefined, `${key} must be dropped on read`);
  }

  await store.deleteCover(item.id);
  const written = JSON.parse(await readFile(indexFile, "utf8")) as Record<string, unknown>[];
  const next = written.find((entry) => entry.id === item.id)!;
  for (const key of ["cover", "coverImage", "thumbnail", "thumbnailUrl", "coverExt", "coverMimeType"]) {
    assert.equal(next[key], undefined, `${key} must be dropped on write`);
  }
});

test("an oversized cover is rejected as too-large", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "big-cover.pdf"));
  const big = new File([Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1)])], "big.png", { type: "image/png" });
  assert.deepEqual(await store.saveCover(item.id, big), { ok: false, reason: "too-large" });
});

test("restore removes stashed copies when the upload already exists", async () => {
  const item = await store.savePdf(...pdfUpload("orig", "restore-existing.pdf"));
  const covered = await store.saveCover(item.id, new File([PNG], "c.png", { type: "image/png" }));
  assert.ok(covered.ok);
  if (!covered.ok) return;
  assert.equal(await store.deletePdf(item.id), true);
  const stashed = path.join(dir, "data", "trash", "pdfs", `${item.id}.pdf`);
  await stat(stashed);
  await writeFile(store.pdfFilePath(item.id), "existing");
  const restored = await store.restorePdf(item.id);
  assert.ok(restored);
  await assert.rejects(stat(stashed), "the stashed copy must be removed");
  assert.equal(await readFile(store.pdfFilePath(item.id), "utf8"), "existing");
});

async function aiIndex(id: string, content = "saved embeddings") {
  const file = path.join(dir, "data", "ai", id, "index.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

test("AI indexes survive delete/undo but deleted books cannot return evidence", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "indexed.pdf"));
  const file = await aiIndex(item.id);
  assert.equal(await store.deletePdf(item.id), true);
  assert.equal(await readFile(file, "utf8"), "saved embeddings", "the undo window retains the index");
  assert.deepEqual(await ai.searchBook(item.id, "question"), [], "trash is never searchable");
  assert.equal((await store.restorePdf(item.id))?.id, item.id);
  assert.equal(await readFile(file, "utf8"), "saved embeddings", "undo can reuse the same index");
});

test("an index finishing after delete cannot publish or resurrect a book", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "index-race.pdf"));
  const file = await aiIndex(item.id, "old index");
  await writeFile(`${file}.tmp`, "new index");
  assert.equal(await ai.publishBookIndex(item.id, `${file}.tmp`), true);
  assert.equal(await readFile(file, "utf8"), "new index");
  await store.deletePdf(item.id);
  await writeFile(`${file}.tmp`, "late index");
  assert.equal(await ai.publishBookIndex(item.id, `${file}.tmp`), false);
  assert.equal(await readFile(file, "utf8"), "new index");
  assert.equal(await store.findPdf(item.id), null);
});

test("expired trash purges its AI index but not another book or the model cache", async () => {
  const expired = await store.savePdf(...pdfUpload(undefined, "expired.pdf"));
  const kept = await store.savePdf(...pdfUpload(undefined, "kept-index.pdf"));
  const expiredFile = await aiIndex(expired.id);
  const keptFile = await aiIndex(kept.id);
  const modelFile = await aiIndex("models", "cached model");
  await store.deletePdf(expired.id);
  const trashFile = path.join(dir, "data", "trash.json");
  const records = JSON.parse(await readFile(trashFile, "utf8")) as { item: { id: string }; deletedAt: string }[];
  records.find((entry) => entry.item.id === expired.id)!.deletedAt = "2000-01-01T00:00:00.000Z";
  await writeFile(trashFile, JSON.stringify(records));
  await store.deletePdf(kept.id);
  await assert.rejects(stat(expiredFile));
  assert.equal(await readFile(keptFile, "utf8"), "saved embeddings");
  assert.equal(await readFile(modelFile, "utf8"), "cached model");
});

test("deleting missing PDF bytes also removes an unusable AI index", async () => {
  const item = await store.savePdf(...pdfUpload(undefined, "missing-indexed.pdf"));
  const file = await aiIndex(item.id);
  await rm(store.pdfFilePath(item.id));
  await store.deletePdf(item.id);
  await assert.rejects(stat(file));
});

test("retrieval rejects unsafe IDs and empty or oversized questions before worker work", async () => {
  await assert.rejects(ai.searchBook("../uploads", "question"), /Invalid book ID/);
  const item = await store.savePdf(...pdfUpload());
  await assert.rejects(ai.searchBook(item.id, "  "), /Question/);
  await assert.rejects(ai.searchBook(item.id, "x".repeat(2001)), /Question/);
});

// Route handlers: the same store instance, driven the way Next calls them.

const api = "http://127.0.0.1:3000/api/pdfs";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
// Real HTTP requests always carry a Host header; the guard needs one.
function req(url: string, init: RequestInit = {}, host = "localhost") {
  return new Request(url, { ...init, headers: { ...init.headers as Record<string, string>, host } });
}
const library = async () => (await (await routes.library.GET(req(api))).json()) as { items: { id: string; name: string }[] };
const postPdf = (name: string, body: BodyInit, contentType: string) => routes.library.POST(req(api, {
  method: "POST",
  headers: { "content-type": contentType, "x-file-name": encodeURIComponent(name) },
  body,
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
  const { items } = await library();
  assert.ok(items.some((item) => item.name === "My Book.pdf"));
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
  const response = await routes.pdf.POST(req(`${api}/${item.id}`, { method: "POST" }), context(item.id));
  assert.equal(response.status, 404);
});

test("the cover route stores an image and answers conditional requests", async () => {
  const [item] = (await library()).items;
  const posted = await routes.cover.POST(req(`${api}/${item.id}/cover`, { method: "POST", body: PNG, headers: { "content-type": "image/png" } }), context(item.id));
  assert.equal(posted.status, 201);
  const saved = (await posted.json() as { item: { hasCover: boolean } }).item;
  assert.equal(saved.hasCover, true);

  const first = await routes.cover.GET(req(`${api}/${item.id}/cover`), context(item.id));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/png");
  const etag = first.headers.get("etag");
  assert.ok(etag);
  await first.body?.cancel();

  const cached = await routes.cover.GET(req(`${api}/${item.id}/cover`, { headers: { "if-none-match": etag } }), context(item.id));
  assert.equal(cached.status, 304);
  const byDate = await routes.cover.GET(req(`${api}/${item.id}/cover`, { headers: { "if-modified-since": first.headers.get("last-modified")! } }), context(item.id));
  assert.equal(byDate.status, 304);

  assert.equal((await routes.cover.DELETE(req(`${api}/${item.id}/cover`, { method: "DELETE" }), context(item.id))).status, 200);
  assert.equal((await routes.cover.GET(req(`${api}/${item.id}/cover`), context(item.id))).status, 404);
});

test("the cover route accepts only the cover field and reports an oversized image", async () => {
  const [item] = (await library()).items;
  const otherField = new FormData();
  otherField.append("file", new File([PNG], "cover.png", { type: "image/png" }));
  const rejected = await routes.cover.POST(req(`${api}/${item.id}/cover`, { method: "POST", body: otherField }), context(item.id));
  assert.equal(rejected.status, 400, "an undocumented field name must not be stored");

  const tooLarge = new File([Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1)])], "big.png", { type: "image/png" });
  const oversized = await routes.cover.POST(req(`${api}/${item.id}/cover`, {
    method: "POST", body: tooLarge, headers: { "content-type": "image/png" },
  }), context(item.id));
  assert.equal(oversized.status, 413);
});
