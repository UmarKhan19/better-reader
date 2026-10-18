import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Play } from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import { PosterArtwork } from "./library-artwork";
import { coverSrc, displayName, formatBytes, formatDate, isFinished, progressPercent, type ReadingProgress } from "./library-model";
import { DISPLAY, FOCUS_OFFSET, FOCUS_RED } from "./library-styles";

export function LibraryHero({ item, progress, coverFailed, onCoverError }: {
  item: PdfItem;
  progress?: ReadingProgress;
  coverFailed: boolean;
  onCoverError: () => void;
}) {
  const name = displayName(item.name);
  const cover = coverSrc(item);
  const hasCover = cover && !coverFailed;

  return (
    <section aria-labelledby="featured-title" className="relative isolate w-full overflow-hidden">
      {hasCover ? (
        <Image
          src={cover}
          alt=""
          fill
          unoptimized
          loading="eager"
          className="absolute inset-0 h-full w-full object-cover"
          decoding="async"
          onError={onCoverError}
        />
      ) : (
        <PosterArtwork title={name} className="absolute inset-0 h-full w-full" mark="" showTitle={false} />
      )}
      <div className="bk-hero-scrim absolute inset-0" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-neutral-50 to-transparent dark:from-[#141414]" aria-hidden="true" />
      <div className="relative grid items-center gap-7 px-4 pt-8 pb-9 md:min-h-[33rem] md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-10 md:px-12 md:py-12 lg:min-h-[36rem] lg:px-16">
        <div className="min-w-0 max-w-2xl md:py-4">
          <h2 id="featured-title" className={`${DISPLAY} bk-rise line-clamp-3 text-4xl leading-[0.98] tracking-[0.02em] text-balance wrap-anywhere text-neutral-900 sm:text-5xl lg:text-6xl xl:text-7xl dark:text-white`}>
            {name}
          </h2>
          <div className="bk-rise mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-neutral-600 md:text-sm dark:text-neutral-300" style={{ animationDelay: "90ms" }}>
            <span className="tabular-nums">{formatBytes(item.size)}</span>
            <span aria-hidden="true" className="text-neutral-400 dark:text-white/30">·</span>
            <span>Added {formatDate(item.createdAt)}</span>
            {isFinished(progress) && (
              <span className={`${DISPLAY} rounded-full border border-neutral-900/15 px-2 py-0.5 text-[11px] tracking-[0.18em] text-neutral-700 dark:border-white/25 dark:text-white/80`}>
                Finished
              </span>
            )}
          </div>
          {progress && (
            <div className="bk-rise mt-5 max-w-80" style={{ animationDelay: "150ms" }}>
              <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                <span>Page {progress.page}{progress.numPages ? ` of ${progress.numPages}` : ""}</span>
                {progress.numPages > 0 && <span className="font-medium text-neutral-900 dark:text-white">{progressPercent(progress)}% read</span>}
              </div>
              {progress.numPages > 0 && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-900/15 dark:bg-white/15">
                  <div className="h-full rounded-full bg-[#e50914]" style={{ width: `${progressPercent(progress)}%` }} />
                </div>
              )}
            </div>
          )}
          <div className="bk-rise mt-6 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "210ms" }}>
            <Link
              href={`/read/${item.id}`}
              prefetch={false}
              className={cn(
                "inline-flex items-center gap-2.5 rounded-md bg-neutral-900 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200",
                FOCUS_RED, FOCUS_OFFSET,
              )}
            >
              <Play className="h-5 w-5 fill-current" aria-hidden="true" />
              {progress ? "Resume" : "Start reading"}
            </Link>
            <a href="#library" className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-white", FOCUS_RED)}>
              Your library
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
        <div aria-hidden="true" className="bk-rise order-first flex justify-center px-5 md:order-last" style={{ animationDelay: "90ms" }}>
          <div className="bk-hero-jacket relative aspect-[2/3] w-28 overflow-hidden rounded-sm bg-neutral-900 sm:w-36 md:w-56 lg:w-64 xl:w-72">
            {hasCover ? (
              <Image
                src={cover}
                alt=""
                fill
                unoptimized
                loading="eager"
                fetchPriority="high"
                className="h-full w-full object-cover"
                onError={onCoverError}
              />
            ) : (
              <PosterArtwork title={name} className="h-full w-full" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
