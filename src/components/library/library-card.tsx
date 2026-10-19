import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ImagePlus, Trash2, X } from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import { prewarmReader } from "@/components/reader/reader-preload";
import { PosterArtwork } from "./library-artwork";
import { displayName } from "@/lib/pdf-title";
import { coverSrc, isFinished, progressPercent, type ReadingProgress } from "./library-model";

export type LibraryCardProps = {
  item: PdfItem;
  progress?: ReadingProgress;
  coverFailed: boolean;
  coverBusy: boolean;
  onCoverError: (id: string) => void;
  onAddCover: (item: PdfItem, file: File) => void;
  onRemoveCover: (item: PdfItem) => void;
  onDelete: (item: PdfItem) => void;
};

const CARD_CONTROL = cn(
  "grid h-8 w-8 place-items-center rounded-md bg-black/75 text-white ring-1 ring-white/15 transition-colors [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9",
  "hover:bg-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50",
);
/** Visible on touch and keyboard, revealed on hover where hover exists. */
const CARD_CONTROL_REVEAL =
  "opacity-100 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";

/** Memoized: the grid re-renders on every filter keystroke, but cards rarely change. */
export const LibraryCard = memo(function LibraryCard({
  item, progress, coverFailed, coverBusy, onCoverError, onAddCover, onRemoveCover, onDelete,
}: LibraryCardProps) {
  const name = displayName(item.name);
  const src = coverSrc(item);
  const hasCover = Boolean(src) && !coverFailed;
  const done = isFinished(progress);
  const pageSummary = progress
    ? progress.numPages > 0 ? `Page ${progress.page} of ${progress.numPages}` : `Page ${progress.page}`
    : undefined;

  return (
    <div className="group relative aspect-[2/3] overflow-hidden rounded-md bg-neutral-200 ring-1 ring-neutral-900/10 transition duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/25 hover:ring-neutral-900/20 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:bg-neutral-900 dark:ring-white/10 dark:hover:ring-white/25">
      <Link
        href={`/read/${item.id}`}
        prefetch={false}
        onPointerEnter={prewarmReader}
        onFocus={prewarmReader}
        onTouchStart={prewarmReader}
        className="block h-full w-full focus-visible:outline-none"
        title={name}
        aria-label={`Read ${name}${pageSummary ? `, ${pageSummary}${done ? ", finished" : ""}` : ""}`}
      >
        {hasCover && src ? (
          <Image
            src={src}
            alt=""
            fill
            unoptimized
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            onError={() => onCoverError(item.id)}
          />
        ) : (
          <PosterArtwork
            title={name}
            className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-3 pt-10 pb-2.5">
          <div className="flex items-end gap-1.5">
            <p className="line-clamp-2 flex-1 text-xs leading-snug font-semibold wrap-anywhere text-white">{name}</p>
            {done && (
              <span className="mb-0.5 shrink-0 text-white/85">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Finished</span>
              </span>
            )}
          </div>
          {progress && (
            <>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs leading-none text-white/80">
                <span className="tabular-nums">{pageSummary}</span>
                {progress.numPages > 0 && <span className="shrink-0 tabular-nums">{progressPercent(progress)}%</span>}
              </div>
              {progress.numPages > 0 && (
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${progressPercent(progress)}%` }} />
                </div>
              )}
            </>
          )}
        </div>
      </Link>
      <div className={cn("absolute top-1.5 left-1.5 flex gap-1.5", CARD_CONTROL_REVEAL)}>
        <label className={cn(CARD_CONTROL, "cursor-pointer hover:bg-white hover:text-black", "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-brand")} title="Add cover image">
          {coverBusy ? "…" : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={coverBusy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAddCover(item, file);
              event.target.value = "";
            }}
            aria-label={`Add cover image for ${name}`}
          />
        </label>
        {(item.hasCover || src) && (
          <button
            type="button"
            disabled={coverBusy}
            onClick={() => onRemoveCover(item)}
            className={CARD_CONTROL}
            aria-label={`Remove cover image for ${name}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDelete(item)}
        className={cn(CARD_CONTROL, "absolute top-1.5 right-1.5", CARD_CONTROL_REVEAL)}
        aria-label={`Delete ${name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
});
