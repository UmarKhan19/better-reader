import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LibraryCard, type LibraryCardProps } from "./library-card";
import { DISPLAY, FOCUS_RED } from "./library-styles";
import styles from "./library.module.css";

export function LibraryShelf({ cards }: { cards: LibraryCardProps[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<"none" | "left" | "right" | "both">("none");

  const updateFade = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const atStart = row.scrollLeft <= 8;
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
    setFade(atStart && atEnd ? "none" : atStart ? "right" : atEnd ? "left" : "both");
  }, []);

  useEffect(() => {
    updateFade();
    window.addEventListener("resize", updateFade);
    return () => window.removeEventListener("resize", updateFade);
  }, [updateFade, cards.length]);

  const scrollRow = (direction: "left" | "right") => {
    const row = rowRef.current;
    if (!row) return;
    const amount = row.clientWidth * 0.8;
    row.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <section aria-labelledby="continue-reading-heading">
      <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 id="continue-reading-heading" className={`${DISPLAY} text-2xl tracking-wider text-neutral-900 md:text-3xl dark:text-white`}>Continue reading</h2>
          <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{cards.length}</span>
        </div>
        {fade !== "none" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => scrollRow("left")}
              disabled={fade === "right"}
              className={cn("grid h-9 w-9 place-items-center rounded-full border border-neutral-300 text-neutral-600 transition-colors hover:border-neutral-500 hover:text-neutral-900 disabled:cursor-default disabled:opacity-30 dark:border-white/20 dark:text-neutral-300 dark:hover:border-white/40 dark:hover:text-white", FOCUS_RED)}
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => scrollRow("right")}
              disabled={fade === "left"}
              className={cn("grid h-9 w-9 place-items-center rounded-full border border-neutral-300 text-neutral-600 transition-colors hover:border-neutral-500 hover:text-neutral-900 disabled:cursor-default disabled:opacity-30 dark:border-white/20 dark:text-neutral-300 dark:hover:border-white/40 dark:hover:text-white", FOCUS_RED)}
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div
        ref={rowRef}
        onScroll={updateFade}
        className={cn(
          "flex snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden scroll-px-4 pt-1 pb-5 no-scrollbar md:gap-4",
          fade === "right" && styles["bk-fade-right"],
          fade === "left" && styles["bk-fade-left"],
          fade === "both" && styles["bk-fade-both"],
        )}
      >
        {cards.map((card) => (
          <div key={card.item.id} className="w-36 shrink-0 snap-start sm:w-40 md:w-44">
            <LibraryCard {...card} />
          </div>
        ))}
      </div>
    </section>
  );
}
