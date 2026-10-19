import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Play } from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import { PosterArtwork } from "./library-artwork";
import { displayName } from "@/lib/pdf-title";
import { coverSrc, formatBytes, formatDate, isFinished, progressPercent, type ReadingProgress } from "./library-model";
import { DISPLAY, FOCUS_OFFSET, FOCUS_RED } from "./library-styles";
import styles from "./library.module.css";

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
      <div className={`${styles["bk-hero-scrim"]} absolute inset-0`} aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-library-background to-transparent" aria-hidden="true" />
      <div className={`${styles["bk-hero-layout"]} relative grid items-center gap-7 px-4 pt-8 pb-9 md:min-h-132 md:gap-10 md:px-12 md:py-12 lg:min-h-144 lg:px-16`}>
        <div className="min-w-0 max-w-2xl md:py-4">
          <h2 id="featured-title" className={`${DISPLAY} ${styles["bk-rise"]} line-clamp-3 text-4xl leading-display tracking-display text-balance wrap-anywhere text-library-foreground sm:text-5xl lg:text-6xl xl:text-7xl`}>
            {name}
          </h2>
          <div className={`${styles["bk-rise"]} ${styles["bk-rise-meta"]} mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-library-muted md:text-sm`}>
            <span className="tabular-nums">{formatBytes(item.size)}</span>
            <span aria-hidden="true" className="text-strong-line dark:text-white/30">·</span>
            <span>Added {formatDate(item.createdAt)}</span>
            {isFinished(progress) && (
              <span className={`${DISPLAY} rounded-full border border-ink/15 px-2 py-0.5 text-label tracking-stamp text-library-detail dark:border-white/25 dark:text-white/80`}>
                Finished
              </span>
            )}
          </div>
          {progress && (
            <div className={`${styles["bk-rise"]} ${styles["bk-rise-progress"]} mt-5 max-w-80`}>
              <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-library-muted">
                <span>Page {progress.page}{progress.numPages ? ` of ${progress.numPages}` : ""}</span>
                {progress.numPages > 0 && <span className="font-medium text-library-foreground">{progressPercent(progress)}% read</span>}
              </div>
              {progress.numPages > 0 && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-library-foreground/15">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${progressPercent(progress)}%` }} />
                </div>
              )}
            </div>
          )}
          <div className={`${styles["bk-rise"]} ${styles["bk-rise-actions"]} mt-6 flex flex-wrap items-center gap-x-6 gap-y-3`}>
            <Link
              href={`/read/${item.id}`}
              prefetch={false}
              className={cn(
                "inline-flex items-center gap-2.5 rounded-md bg-library-foreground px-7 py-3 text-base font-semibold text-library-inverse transition-colors hover:bg-library-primary-hover",
                FOCUS_RED, FOCUS_OFFSET,
              )}
            >
              <Play className="h-5 w-5 fill-current" aria-hidden="true" />
              {progress ? "Resume" : "Start reading"}
            </Link>
            <a href="#library" className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-library-muted underline-offset-4 hover:text-library-foreground hover:underline", FOCUS_RED)}>
              Your library
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
        <div aria-hidden="true" className={`${styles["bk-rise"]} ${styles["bk-rise-meta"]} order-first flex justify-center px-5 md:order-last`}>
          <div className={`${styles["bk-hero-jacket"]} relative aspect-poster w-28 overflow-hidden rounded-sm bg-ink sm:w-36 md:w-56 lg:w-64 xl:w-72`}>
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
