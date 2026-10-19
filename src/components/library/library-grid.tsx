import { ChevronDown, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyPosterWall } from "./library-artwork";
import { LibraryCard, type LibraryCardProps } from "./library-card";
import type { SortMode } from "./library-model";
import { DISPLAY, FOCUS_OFFSET, FOCUS_RED } from "./library-styles";

export function LibraryGrid({
  cards, total, loading, filter, sort, onSortChange, onClearSearch,
  uploading, uploadProgress, dragOver, onUpload,
}: {
  cards: LibraryCardProps[];
  total: number;
  loading: boolean;
  filter: string;
  sort: SortMode;
  onSortChange: (sort: SortMode) => void;
  onClearSearch: () => void;
  uploading: boolean;
  uploadProgress: number | null;
  dragOver: boolean;
  onUpload: () => void;
}) {
  const query = filter.trim();

  return (
    <section id="library" tabIndex={-1} className="scroll-mt-28 focus:outline-none">
      {total > 0 && (
        <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className={`${DISPLAY} text-2xl tracking-wider text-library-foreground md:text-3xl`}>{query ? "Search results" : "Your library"}</h2>
            <span className="text-xs tabular-nums text-library-subtle">{query ? `${cards.length} of ${total}` : total}</span>
          </div>
          <div className="relative">
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SortMode)}
              aria-label="Sort library"
              className={cn("h-9 appearance-none rounded-full border border-library-border bg-library-field pr-9 pl-4 text-xs text-library-detail transition-colors hover:border-strong-line dark:hover:border-white/25", FOCUS_RED)}
            >
              <option value="recent">Recent</option>
              <option value="name">Name (A–Z)</option>
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-library-subtle" aria-hidden="true" />
          </div>
        </div>
      )}

      {loading && total === 0 ? (
        <div aria-busy="true">
          <p role="status" className="sr-only">Loading your library…</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-poster animate-pulse rounded-md bg-library-surface" />
            ))}
          </div>
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center md:py-32">
          <EmptyPosterWall />
          <h2 className={`${DISPLAY} text-4xl tracking-wider text-library-foreground md:text-5xl`}>Your library is empty</h2>
          <p className="max-w-md text-library-caption">
            Drop PDFs anywhere on this page, or pick them from your device. They&rsquo;ll line up here as posters.
          </p>
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className={cn(
              "mt-2 inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-hover active:translate-y-px disabled:cursor-progress disabled:opacity-60",
              FOCUS_RED, FOCUS_OFFSET,
            )}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {uploading ? "Uploading…" : "Choose PDFs"}
          </button>
        </div>
      ) : (
        <>
          <p role="status" className="sr-only">{query ? `${cards.length} ${cards.length === 1 ? "title matches" : "titles match"} your search.` : ""}</p>
          {(!query || cards.length > 0) && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 xl:grid-cols-6">
              {!query && (
                <button
                  type="button"
                  onClick={onUpload}
                  disabled={uploading}
                  className={cn(
                    "relative flex aspect-poster flex-col items-center justify-center gap-3 overflow-hidden rounded-md border border-dashed border-library-upload-border bg-library-upload-surface text-library-caption transition-colors duration-200 hover:border-library-upload-border-hover hover:bg-library-upload-hover hover:text-library-foreground disabled:cursor-progress",
                    "dark:hover:text-library-detail",
                    FOCUS_RED,
                    dragOver && "border-brand bg-brand/5 text-brand dark:border-brand dark:bg-brand/10 dark:text-brand",
                  )}
                  aria-busy={uploading}
                  aria-label="Upload PDFs"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-current opacity-80">
                    {uploading ? <Upload className="h-5 w-5 animate-pulse" aria-hidden="true" /> : <Plus className="h-5 w-5" aria-hidden="true" />}
                  </span>
                  <span aria-live="polite" className="px-2 text-center text-sm font-medium">
                    {uploading
                      ? uploadProgress !== null && uploadProgress > 0 ? `Uploading ${uploadProgress}%` : "Uploading…"
                      : dragOver ? "Drop to upload" : "Add PDFs"}
                  </span>
                  {!uploading && <span className="-mt-1 px-2 text-center text-xs text-library-caption">or drop them here</span>}
                  {uploading && (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-library-foreground/10" aria-hidden="true">
                      <span className="block h-full w-full origin-left bg-brand transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${(uploadProgress ?? 0) / 100})` }} />
                    </span>
                  )}
                </button>
              )}
              {cards.map((card) => <LibraryCard key={card.item.id} {...card} />)}
            </div>
          )}
          {query && cards.length === 0 && (
            <p className="flex min-h-64 flex-col items-center justify-center gap-3 py-12 text-center text-sm text-library-caption">
              No titles match &ldquo;{query}&rdquo;.{" "}
              <button
                type="button"
                className={cn("rounded px-1 text-library-foreground underline underline-offset-4", FOCUS_RED)}
                onClick={onClearSearch}
              >
                Clear search
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
