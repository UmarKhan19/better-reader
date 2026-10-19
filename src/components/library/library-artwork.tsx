import { cn } from "@/lib/utils";
import { TITLE_SMALL_WORDS } from "@/lib/pdf-title";
import { DISPLAY } from "./library-styles";
import styles from "./library.module.css";

const POSTER_PALETTES = ["forest", "mauve", "rust", "slate", "ochre"] as const;

function posterHash(title: string): number {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function posterMonogram(title: string): string {
  const words = title.split(/\s+/).filter((word) => {
    const bare = word.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return bare && !TITLE_SMALL_WORDS.has(bare);
  });
  return words.slice(0, 2).map((word) => word.charAt(0)).join("").toLocaleUpperCase() || "BK";
}

export function PosterArtwork({
  title, className, mark = posterMonogram(title), showTitle = true,
}: {
  title: string;
  className?: string;
  mark?: string;
  showTitle?: boolean;
}) {
  const hash = posterHash(title);
  const palette = POSTER_PALETTES[hash % POSTER_PALETTES.length];
  const motif = hash % 3;

  return (
    <div
      aria-hidden="true"
      className={cn(styles["bk-poster-art"], "relative isolate overflow-hidden", className)}
      data-palette={palette}
    >
      <span className={styles["bk-poster-frame"]} />
      {motif === 0 ? (
        <span className={styles["bk-poster-orbit"]} />
      ) : motif === 1 ? (
        <span className={styles["bk-poster-arch"]} />
      ) : (
        <span className={styles["bk-poster-plane"]} />
      )}
      {mark && (
        <span className={`${DISPLAY} ${styles["bk-poster-mark"]}`}>
          {mark}
        </span>
      )}
      <span className={styles["bk-poster-rule"]} />
      {showTitle && (
        <span className={`${DISPLAY} ${styles["bk-poster-title"]} line-clamp-5 wrap-anywhere`}>
          {title}
        </span>
      )}
      <span className={`${styles["bk-poster-rule"]} ${styles["bk-poster-rule-bottom"]}`} />
    </div>
  );
}

export function EmptyPosterWall() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-44 w-56 sm:h-48 sm:w-60">
      <div className={`${styles["bk-empty-floor"]} absolute bottom-2 h-px bg-library-border dark:bg-white/15`} />
      <div className={`${styles["bk-empty-left"]} absolute bottom-2 z-0 aspect-poster overflow-hidden rounded-sm ring-1 ring-black/10 shadow-lg shadow-black/10`}>
        <PosterArtwork title="A quiet page" mark="" className="h-full w-full" />
      </div>
      <div className={`${styles["bk-empty-right"]} absolute bottom-2 z-0 aspect-poster overflow-hidden rounded-sm ring-1 ring-black/10 shadow-lg shadow-black/10`}>
        <PosterArtwork title="The open book" mark="" className="h-full w-full" />
      </div>
      <div className={`${styles["bk-empty-front"]} absolute bottom-2 left-1/2 z-10 aspect-poster -translate-x-1/2 overflow-hidden rounded-sm ring-1 ring-black/10 shadow-xl shadow-black/20`}>
        <PosterArtwork title="Better Reader" className="h-full w-full" />
      </div>
    </div>
  );
}
