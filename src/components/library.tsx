"use client";

import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { LibraryCardProps } from "./library/library-card";
import { LibraryFeedback } from "./library/library-feedback";
import { LibraryGrid } from "./library/library-grid";
import { LibraryHeader } from "./library/library-header";
import { LibraryHero } from "./library/library-hero";
import { displayName, formatBytes, selectReadingItems, selectVisibleItems, type SortMode } from "./library/library-model";
import { LibraryShelf } from "./library/library-shelf";
import { DISPLAY, FOCUS_RED } from "./library/library-styles";
import { useLibrary } from "./library/use-library";

export function Library() {
  const {
    items, progress, loading, loadError, reload, notice, dismissNotice, warnThemeStorage,
    upload, deletion, covers,
  } = useLibrary();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const parkFocusRef = useRef(false);
  const query = filter.trim();
  const visible = useMemo(() => selectVisibleItems(items, filter, sort), [items, filter, sort]);
  const inProgress = useMemo(() => selectReadingItems(items, progress), [items, progress]);
  const heroItem = inProgress[0] ?? items[0];
  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + (item.size || 0), 0), [items]);

  const cardProps = (item: PdfItem): LibraryCardProps => ({
    item,
    progress: progress[item.id],
    coverFailed: covers.failed.has(item.id),
    coverBusy: covers.busy.has(item.id),
    onCoverError: () => covers.markFailed(item.id),
    onAddCover: (file) => void covers.add(item, file),
    onRemoveCover: () => void covers.remove(item),
    onDelete: () => deletion.request(item),
  });

  const chooseFiles = () => fileInputRef.current?.click();
  const uploadFiles = async (files: FileList | File[]) => {
    await upload.start(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const confirmDelete = async () => {
    // Set before the mutation closes the dialog and native focus restoration runs.
    parkFocusRef.current = true;
    if (!await deletion.confirm()) parkFocusRef.current = false;
  };

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-neutral-50 text-neutral-900 dark:bg-[#141414] dark:text-white"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files?.length) return;
        event.preventDefault();
        setDragOver(false);
        if (!upload.busy) void uploadFiles(event.dataTransfer.files);
      }}
    >
      <a
        href="#library"
        className={cn("fixed top-3 left-4 z-50 -translate-y-24 rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white focus-visible:translate-y-0 dark:bg-white dark:text-neutral-900", FOCUS_RED)}
      >
        Skip to library
      </a>
      <LibraryHeader
        filter={filter}
        onFilterChange={setFilter}
        uploading={upload.busy}
        onUpload={chooseFiles}
        onThemeStorageFailure={warnThemeStorage}
      />
      <main>
        <LibraryFeedback
          loadError={loadError}
          notice={notice}
          onReload={reload}
          onDismiss={dismissNotice}
          onRetryUpload={upload.retry}
          onUndoDelete={deletion.restore}
          undoing={deletion.restoring}
        />
        <h1 ref={headingRef} tabIndex={-1} className="sr-only">Library</h1>
        {heroItem && !query && (
          <LibraryHero
            item={heroItem}
            progress={progress[heroItem.id]}
            coverFailed={covers.failed.has(heroItem.id)}
            onCoverError={() => covers.markFailed(heroItem.id)}
          />
        )}
        <div className="space-y-10 px-4 pt-7 pb-12 md:space-y-12 md:px-12 md:pt-8 lg:px-16">
          {inProgress.length > 0 && !query && <LibraryShelf cards={inProgress.map(cardProps)} />}
          <LibraryGrid
            cards={visible.map(cardProps)}
            total={items.length}
            loading={loading}
            filter={filter}
            sort={sort}
            onSortChange={setSort}
            onClearSearch={() => setFilter("")}
            uploading={upload.busy}
            uploadProgress={upload.progress}
            dragOver={dragOver}
            onUpload={chooseFiles}
          />
        </div>
        {items.length > 0 && (
          <footer className="border-t border-neutral-200 px-4 py-8 text-xs text-neutral-600 md:px-12 lg:px-16 dark:border-white/5 dark:text-neutral-400">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="tabular-nums">
                {items.length} {items.length === 1 ? "title" : "titles"} · {formatBytes(totalBytes)}
              </p>
              <p>Stored locally.</p>
            </div>
          </footer>
        )}
      </main>
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 p-3 sm:p-6" aria-hidden="true">
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#e50914]/80 bg-neutral-950/80 backdrop-blur-sm">
            <Upload className="h-8 w-8 text-[#e50914]" aria-hidden="true" />
            <p className={`${DISPLAY} text-3xl tracking-wider text-white md:text-4xl`}>Drop to upload</p>
            <p className="text-sm text-white/60">PDFs stay on this device</p>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void uploadFiles(event.target.files);
        }}
      />
      <ConfirmDialog
        open={deletion.item !== null}
        title="Delete this PDF?"
        description={<>&ldquo;{deletion.item ? displayName(deletion.item.name) : ""}&rdquo; will be removed from your library. You can undo this from the message shown after deletion.</>}
        confirmLabel="Delete"
        pending={deletion.busy}
        error={deletion.error}
        onConfirm={() => void confirmDelete()}
        onCancel={deletion.cancel}
        onClosed={() => {
          if (parkFocusRef.current) {
            parkFocusRef.current = false;
            headingRef.current?.focus();
          }
        }}
      />
    </div>
  );
}
