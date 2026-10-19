import { test } from "node:test";
import assert from "node:assert/strict";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryCard, type LibraryCardProps } from "./library-card";
import { LibraryFeedback } from "./library-feedback";
import { LibraryGrid } from "./library-grid";
import { LibraryHero } from "./library-hero";
import { uploadNotice } from "./library-model";

const noop = () => {};
const card: LibraryCardProps = {
  item: { id: "book", name: "the_open-book.pdf", size: 100, mimeType: "application/pdf", createdAt: "2026-01-01T00:00:00Z" },
  coverFailed: false, coverBusy: false,
  onCoverError: noop, onAddCover: noop, onRemoveCover: noop, onDelete: noop,
};

function grid(overrides: Partial<ComponentProps<typeof LibraryGrid>> = {}) {
  return renderToStaticMarkup(<LibraryGrid
    cards={[card]} total={1} loading={false} filter="" sort="recent"
    onSortChange={noop} onClearSearch={noop} uploading={false} uploadProgress={null}
    dragOver={false} onUpload={noop} {...overrides}
  />);
}

test("loading and empty library states stay distinct and retain accessible status", () => {
  const loading = grid({ cards: [], total: 0, loading: true });
  assert.match(loading, /role="status"[^>]*>Loading your library/);
  assert.equal([...loading.matchAll(/animate-pulse/g)].length, 6);
  assert.doesNotMatch(loading, /Your library is empty/);
  const empty = grid({ cards: [], total: 0 });
  assert.match(empty, /Your library is empty/);
  assert.match(empty, /Choose PDFs/);
  assert.match(empty, /id="library" tabindex="-1"/);
});

test("search results hide the upload tile and announce their count", () => {
  const html = grid({ filter: "open", total: 3 });
  assert.match(html, /Search results/);
  assert.match(html, /1 of 3/);
  assert.match(html, /1 title matches your search/);
  assert.doesNotMatch(html, /aria-label="Upload PDFs"/);
  assert.match(grid({ cards: [], filter: "  missing  " }), /No titles match.*missing.*Clear search/);
});

test("upload tile preserves busy progress and drop-target feedback", () => {
  const busy = grid({ uploading: true, uploadProgress: 67 });
  assert.match(busy, /disabled=""[^>]*aria-busy="true" aria-label="Upload PDFs"/);
  assert.match(busy, /Uploading 67%/);
  assert.match(busy, /width:67%/);
  assert.match(grid({ dragOver: true }), /Drop to upload/);
});

test("cards retain reading labels, finished status and per-item cover controls", () => {
  const html = renderToStaticMarkup(<LibraryCard {...card} progress={{ page: 10, numPages: 10 }} />);
  assert.match(html, /href="\/read\/book"/);
  assert.match(html, /aria-label="Read The Open Book, Page 10 of 10, finished"/);
  assert.match(html, /aria-label="Add cover image for The Open Book"/);
  assert.match(html, /aria-label="Delete The Open Book"/);
  assert.match(html, /width:100%/);
});

test("failed cover images fall back to artwork without hiding cover removal", () => {
  const html = renderToStaticMarkup(<LibraryCard {...card}
    item={{ ...card.item, hasCover: true }} coverFailed coverBusy />);
  assert.match(html, /<span[^>]*>OB<\/span>/);
  assert.match(html, /<span[^>]*>The Open Book<\/span>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /disabled=""[^>]*aria-label="Add cover image/);
  assert.match(html, /disabled=""[^>]*aria-label="Remove cover image/);
});

test("hero still distinguishes starting, resuming and finished progress", () => {
  const hero = (progress?: { page: number; numPages: number }) => renderToStaticMarkup(
    <LibraryHero item={card.item} progress={progress} coverFailed={false} onCoverError={noop} />,
  );
  assert.match(hero(), /Start reading/);
  assert.match(hero({ page: 1, numPages: 10 }), /Resume/);
  const finished = hero({ page: 10, numPages: 10 });
  assert.match(finished, /Finished/);
  assert.match(finished, /100% read/);
});

test("feedback keeps load errors and failed-restore undo without a stale upload action", () => {
  const html = renderToStaticMarkup(<LibraryFeedback
    loadError notice={{ tone: "error", text: "Restore failed", undo: card.item }}
    onReload={noop} onDismiss={noop} onRetryUpload={noop} onUndoDelete={noop} undoing={false}
  />);
  assert.equal([...html.matchAll(/role="alert"/g)].length, 2);
  assert.match(html, /Your PDFs are still on disk/);
  assert.equal([...html.matchAll(/Try again/g)].length, 1);
  assert.match(html, /Undo delete/);
  assert.match(html, /aria-label="Dismiss message"/);
});

test("partial upload warnings offer retry for the failed remainder", () => {
  const html = renderToStaticMarkup(<LibraryFeedback
    loadError={false} notice={uploadNotice(1, [], 1)}
    onReload={noop} onDismiss={noop} onRetryUpload={noop} onUndoDelete={noop} undoing={false}
  />);
  assert.match(html, /1 PDF uploaded, 1 failed/);
  assert.match(html, /Try again/);
});

test("only failed upload notices expose a supplied upload retry callback", () => {
  for (const notice of [uploadNotice(0, [], 1), uploadNotice(1, [], 1)]) {
    const html = renderToStaticMarkup(<LibraryFeedback
      loadError={false} notice={notice} onReload={noop} onDismiss={noop}
      onRetryUpload={noop} onUndoDelete={noop} undoing={false}
    />);
    assert.match(html, /Try again/);
  }
  for (const notice of [uploadNotice(1, []), uploadNotice(0, [{ name: "notes.txt", reason: "not a PDF" }])]) {
    const html = renderToStaticMarkup(<LibraryFeedback
      loadError={false} notice={notice} onReload={noop} onDismiss={noop}
      onRetryUpload={noop} onUndoDelete={noop} undoing={false}
    />);
    assert.doesNotMatch(html, /Try again/);
  }
});
