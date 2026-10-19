import { useEffect, useRef, useState } from "react";
import { Search, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeSelect } from "@/components/theme";
import { DISPLAY, FOCUS_OFFSET, FOCUS_RED } from "./library-styles";

export function LibraryHeader({ filter, onFilterChange, uploading, onUpload, onThemeStorageFailure }: {
  filter: string;
  onFilterChange: (filter: string) => void;
  uploading: boolean;
  onUpload: () => void;
  onThemeStorageFailure: (theme: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    onFilterChange("");
    searchToggleRef.current?.focus();
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled
          ? "border-neutral-200/80 bg-neutral-50/90 backdrop-blur-md dark:border-white/5 dark:bg-[#141414]/90"
          : "border-transparent bg-gradient-to-b from-neutral-50/80 to-transparent dark:from-black/70 dark:to-transparent",
      )}
    >
      <div className="flex min-h-[4.5rem] items-center justify-between gap-2 px-4 py-3 md:px-12 lg:px-16">
        <span className={`${DISPLAY} whitespace-nowrap text-lg tracking-wider text-brand min-[360px]:text-xl sm:text-2xl md:text-3xl dark:text-[#ff3440] sm:dark:text-brand`}>Better Reader</span>
        <div className="flex items-center gap-1 sm:gap-3">
          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
            <input
              ref={desktopSearchRef}
              type="search"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder="Search titles…"
              aria-label="Filter PDFs by file name"
              className={cn("h-10 w-64 rounded-full border border-neutral-300 bg-white/80 pr-10 pl-10 text-sm text-neutral-900 caret-brand transition-colors placeholder:text-neutral-500 focus:bg-white xl:w-72 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-neutral-400 dark:focus:bg-white/10", FOCUS_RED)}
            />
            {filter && (
              <button
                type="button"
                onClick={() => {
                  onFilterChange("");
                  desktopSearchRef.current?.focus();
                }}
                aria-label="Clear search"
                className={cn("absolute top-1/2 right-1 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white", FOCUS_RED)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            ref={searchToggleRef}
            type="button"
            onClick={() => setSearchOpen(true)}
            className={cn("grid h-8 w-8 place-items-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-200/70 hover:text-neutral-900 min-[360px]:h-9 min-[360px]:w-9 lg:hidden dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white", FOCUS_RED)}
            aria-label="Search your library"
          >
            <Search className="h-5 w-5" />
          </button>
          <ThemeSelect
            className="max-[400px]:[&_button]:h-8 max-[400px]:[&_button]:w-8"
            onStorageFailure={onThemeStorageFailure}
          />
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            aria-busy={uploading}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-md bg-brand text-white transition-colors hover:bg-brand-hover active:translate-y-px disabled:cursor-progress disabled:opacity-60 min-[360px]:h-9 min-[360px]:w-9 sm:inline-flex sm:h-10 sm:w-auto sm:items-center sm:gap-2 sm:px-4 sm:text-sm sm:font-semibold",
              FOCUS_RED, FOCUS_OFFSET,
            )}
            aria-label="Upload PDFs"
          >
            <Upload className="h-4 w-4 sm:hidden" aria-hidden="true" />
            <span className="hidden sm:inline">{uploading ? "Uploading…" : "Upload"}</span>
          </button>
        </div>
      </div>
      {/* Mobile search takes the whole bar so nothing squeezes. */}
      {searchOpen && (
        <div className="absolute inset-0 z-20 flex items-center gap-2 bg-neutral-50 px-4 md:px-12 lg:hidden dark:bg-[#141414]">
          <Search className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
          <input
            type="search"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
            placeholder="Search titles…"
            aria-label="Filter PDFs by file name"
            className="h-10 min-w-0 flex-1 bg-transparent text-base text-neutral-900 caret-brand placeholder:text-neutral-500 focus:outline-none dark:text-white dark:placeholder:text-neutral-400"
            autoFocus
          />
          <button
            type="button"
            onClick={closeSearch}
            className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white", FOCUS_RED)}
            aria-label="Close search"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </header>
  );
}
