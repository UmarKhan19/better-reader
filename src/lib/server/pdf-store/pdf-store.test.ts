import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ai, cleanupLibrary, dir, pdfUpload, PNG, resetLibrary, store } from "../../../../tests/helpers/library";

beforeEach(resetLibrary);
after(cleanupLibrary);

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
  await store.savePdf(...pdfUpload(undefined, "kept-before-failure.pdf"));
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

test("index coordinates are canonical and missing originals cannot publish derived data", async () => {
  const item = await store.savePdf(...pdfUpload());
  const files = store.bookIndexPaths(item.id);
  assert.equal(files.pdfFile, store.pdfFilePath(item.id));
  assert.equal(files.indexFile, path.join(dir, "data", "ai", item.id, "index.json"));
  assert.equal(files.tempFile, `${files.indexFile}.tmp`);
  assert.equal(files.cacheDir, path.join(dir, "data", "ai", "models"));
  assert.equal(await store.livePdfPath(item.id), files.pdfFile);
  assert.throws(() => store.bookIndexPaths("../uploads"), /Invalid book ID/);
  assert.equal(await store.livePdfPath("../uploads"), null);
  await aiIndex(item.id);
  await writeFile(files.tempFile, "unfinished replacement");
  await rm(files.pdfFile);
  assert.equal(await store.livePdfPath(item.id), null);
  assert.equal(await store.publishBookIndex(item.id), false);
  assert.equal(await readFile(files.indexFile, "utf8"), "saved embeddings");
});

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
  assert.equal(await store.publishBookIndex(item.id), true);
  assert.equal(await readFile(file, "utf8"), "new index");
  await store.deletePdf(item.id);
  await writeFile(`${file}.tmp`, "late index");
  assert.equal(await store.publishBookIndex(item.id), false);
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
