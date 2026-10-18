import { test } from "node:test";
import assert from "node:assert/strict";
import type { PdfItem } from "@/types/pdf";
import {
  coverSrc, displayName, formatBytes, formatDate, isFinished, mergeUploadedItems,
  parseLibraryProgress, progressPercent, selectReadingItems, selectVisibleItems, uploadNotice, withoutCover,
} from "./library-model";

function pdf(id: string, name = `${id}.pdf`): PdfItem {
  return { id, name, size: 1024, mimeType: "application/pdf", createdAt: "2026-01-01T00:00:00Z" };
}

test("display titles clean filenames without rewriting intentional capitalization", () => {
  assert.equal(displayName("the_art-of_reading.PDF"), "The Art of Reading");
  assert.equal(displayName("NASA_handbook.pdf"), "NASA handbook");
  assert.equal(displayName("  a___quiet--page.pdf"), "A Quiet Page");
  assert.equal(displayName(".pdf"), ".pdf");
  assert.equal(displayName(""), "");
});

test("metadata formatting keeps byte thresholds and invalid-date fallback", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(formatDate("not a date"), "not a date");
  const old = "2001-04-15T12:00:00Z";
  assert.equal(formatDate(old), new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(old)));
});

test("missing and corrupt progress do not turn unread PDFs into started titles", () => {
  for (const raw of [null, "", "broken", "null", "{}", '{"page":0}', '{"page":-1}', '{"page":"bad"}']) {
    assert.equal(parseLibraryProgress(raw), undefined, String(raw));
  }
  assert.deepEqual(parseLibraryProgress('{"page":1}'), { page: 1, numPages: 0 });
});

test("progress extraction preserves current coercion and numeric-only behavior", () => {
  assert.deepEqual(parseLibraryProgress('{"page":"12.6","numPages":"100","offset":0.5}'), { page: 13, numPages: 100 });
  assert.deepEqual(parseLibraryProgress('{"page":7,"numPages":"bad"}'), { page: 7, numPages: 0 });
  assert.deepEqual(parseLibraryProgress("+17"), { page: 17, numPages: 0 });
  // Unlike the reader parser, the existing library ignores JSON number values.
  assert.equal(parseLibraryProgress("17"), undefined);
});

test("library progress remains page-based and finished status requires a known total", () => {
  assert.equal(progressPercent(), 0);
  assert.equal(progressPercent({ page: 1, numPages: 40 }), 3);
  assert.equal(progressPercent({ page: 50, numPages: 40 }), 100);
  assert.equal(progressPercent({ page: 4, numPages: 0 }), 0);
  assert.equal(isFinished({ page: 4, numPages: 0 }), false);
  assert.equal(isFinished({ page: 40, numPages: 40 }), true);
  assert.equal(isFinished({ page: 41, numPages: 40 }), true);
});

test("search matches original filenames and dressed-up titles without changing recent order", () => {
  const items = [pdf("b", "the_art-of-reading.pdf"), pdf("a", "Another Book.pdf")];
  assert.equal(selectVisibleItems(items, "  ", "recent"), items);
  assert.deepEqual(selectVisibleItems(items, " ART OF ", "recent"), [items[0]]);
  assert.deepEqual(selectVisibleItems(items, ".PDF", "recent"), items);
  assert.deepEqual(selectVisibleItems(items, "missing", "recent"), []);
});

test("name sorting is numeric and never mutates collection order", () => {
  const items = [pdf("b", "book 10.pdf"), pdf("a", "Book 2.pdf")];
  assert.deepEqual(selectVisibleItems(items, "", "name"), [items[1], items[0]]);
  assert.equal(items[0].id, "b");
});

test("the reading shelf preserves library order and still includes finished titles", () => {
  const items = [pdf("finished"), pdf("unread"), pdf("started")];
  assert.deepEqual(selectReadingItems(items, {
    started: { page: 2, numPages: 10 }, finished: { page: 10, numPages: 10 },
  }), [items[0], items[2]]);
});

test("cover resolution respects alias precedence and removal clears every displayed alias", () => {
  const aliases = ["coverUrl", "cover", "coverImage", "thumbnailUrl", "thumbnail"] as const;
  let item = { ...pdf("book"), hasCover: true };
  assert.equal(coverSrc(item), "/api/pdfs/book/cover");
  for (const alias of [...aliases].reverse()) {
    item = { ...item, [alias]: `/${alias}.png` };
    assert.equal(coverSrc(item), `/${alias}.png`);
  }
  const removed = withoutCover(item);
  assert.equal(coverSrc(removed), undefined);
  assert.equal(removed.hasCover, false);
  assert.equal(removed.id, item.id);
  assert.equal(item.hasCover, true);
});

test("uploads prepend new items without replacing existing IDs", () => {
  const existing = pdf("existing");
  const fresh = pdf("fresh");
  assert.deepEqual(mergeUploadedItems([existing], [fresh, { ...existing, name: "duplicate.pdf" }]), [fresh, existing]);
});

test("upload notices distinguish complete, partial and entirely skipped batches", () => {
  const skipped = [{ name: "notes.txt", reason: "not a PDF" }];
  assert.deepEqual(uploadNotice(1, []), { tone: "success", text: "1 PDF uploaded." });
  assert.deepEqual(uploadNotice(2, []), { tone: "success", text: "2 PDFs uploaded." });
  assert.deepEqual(uploadNotice(1, skipped), {
    tone: "warning", text: "1 PDF uploaded, 1 skipped.", details: ["notes.txt, not a PDF"],
  });
  assert.deepEqual(uploadNotice(0, skipped), {
    tone: "warning", text: "No files were uploaded.", details: ["notes.txt, not a PDF"],
  });
});
