import { cn } from "@/lib/utils";
import { TITLE_SMALL_WORDS } from "@/lib/pdf-title";
import { DISPLAY } from "./library-styles";

const POSTER_PALETTES = [
  { base: "#2b4940", ink: "#e5e8ca" },
  { base: "#493b50", ink: "#efdfd2" },
  { base: "#854735", ink: "#f4dfbc" },
  { base: "#2c455d", ink: "#e0e7e5" },
  { base: "#6b5732", ink: "#f3e7c6" },
] as const;

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
      className={cn("bk-poster-art relative isolate overflow-hidden", className)}
      style={{ backgroundColor: palette.base, color: palette.ink }}
    >
      <span className="absolute inset-[6%] border border-current opacity-20" />
      {motif === 0 ? (
        <span className="absolute right-[-14%] bottom-[11%] aspect-square w-[86%] rounded-full border border-current opacity-25" />
      ) : motif === 1 ? (
        <span className="absolute right-[12%] bottom-[11%] h-[42%] w-[40%] rounded-t-full bg-current opacity-10" />
      ) : (
        <span className="absolute right-[12%] bottom-[11%] h-[40%] w-[64%] -skew-x-12 border border-current opacity-25" />
      )}
      {mark && (
        <span className={`${DISPLAY} bk-poster-mark absolute bottom-[12%] left-[10%] select-none leading-[0.8] tracking-[-0.03em] opacity-70`}>
          {mark}
        </span>
      )}
      <span className="absolute top-[11%] left-[12%] h-px w-[18%] bg-current opacity-70" />
      {showTitle && (
        <span className={`${DISPLAY} bk-poster-title absolute inset-x-[12%] top-[16%] line-clamp-5 leading-[0.98] tracking-[0.015em] wrap-anywhere`}>
          {title}
        </span>
      )}
      <span className="absolute bottom-[7%] left-[12%] h-px w-[18%] bg-current opacity-50" />
    </div>
  );
}

export function EmptyPosterWall() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-44 w-56 sm:h-48 sm:w-60">
      <div className="absolute inset-x-[8%] bottom-2 h-px bg-neutral-300 dark:bg-white/15" />
      <div className="absolute bottom-2 left-[13%] z-0 aspect-[2/3] w-[28%] -rotate-[11deg] overflow-hidden rounded-sm ring-1 ring-black/10 shadow-lg shadow-black/10">
        <PosterArtwork title="A quiet page" mark="" className="h-full w-full" />
      </div>
      <div className="absolute right-[13%] bottom-2 z-0 aspect-[2/3] w-[28%] rotate-[11deg] overflow-hidden rounded-sm ring-1 ring-black/10 shadow-lg shadow-black/10">
        <PosterArtwork title="The open book" mark="" className="h-full w-full" />
      </div>
      <div className="absolute bottom-2 left-1/2 z-10 aspect-[2/3] w-[31%] -translate-x-1/2 overflow-hidden rounded-sm ring-1 ring-black/10 shadow-xl shadow-black/20">
        <PosterArtwork title="Better Kindle" className="h-full w-full" />
      </div>
    </div>
  );
}
