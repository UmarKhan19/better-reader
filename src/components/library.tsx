"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, Play, Plus,
  Search, Trash2, Upload, X,
} from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { prewarmReader } from "@/components/reader/reader-preload";
import { ThemeSelect } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type SkippedFile = { name: string; reason: string };
type Notice = { tone: "success" | "warning" | "error"; text: string; details?: string[]; undo?: PdfItem; retry?: () => void; retryLabel?: string };
type SortMode = "recent" | "name";
type ReadingProgress = { page: number; numPages: number };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    const datePart = new Intl.DateTimeFormat(undefined, sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }).format(date);
    if (!sameYear) return datePart;
    const timePart = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    return `${datePart}, ${timePart}`;
  } catch {
    return iso;
  }
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/** The filename is the only title we have; strip the extension and dress it up for display. */
function displayName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return name;
  if (base !== base.toLowerCase()) return base;
  return base
    .split(" ")
    .map((word, index) => {
      const bare = word.replace(/[^a-z0-9]/gi, "");
      if (index > 0 && SMALL_WORDS.has(bare)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function progressPercent(value?: ReadingProgress): number {
  if (!value || !value.numPages) return 0;
  return Math.min(100, Math.round((value.page / value.numPages) * 100));
}

function isFinished(value?: ReadingProgress): boolean {
  return Boolean(value && value.numPages > 0 && value.page >= value.numPages);
}

function uploadNotice(saved: number, skipped: SkippedFile[]): Notice {
  const details = skipped.map((file) => `${file.name}, ${file.reason}`);
  if (saved === 0) return { tone: "warning", text: "No files were uploaded.", details };
  const uploaded = `${saved} ${saved === 1 ? "PDF" : "PDFs"} uploaded`;
  if (skipped.length) return { tone: "warning", text: `${uploaded}, ${skipped.length} skipped.`, details };
  return { tone: "success", text: `${uploaded}.` };
}

function coverSrc(item: PdfItem): string | undefined {
  if (item.coverUrl || item.cover || item.coverImage || item.thumbnailUrl || item.thumbnail) {
    return item.coverUrl || item.cover || item.coverImage || item.thumbnailUrl || item.thumbnail;
  }
  if (item.hasCover) return `/api/pdfs/${item.id}/cover`;
  return undefined;
}

const DISPLAY = "font-[family-name:var(--font-bebas-neue)]";
const FOCUS_RED = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e50914]";
const SKIP_LINK = "focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-[#141414]";
const POSTER_PALETTES = [
  { base: "#2b4940", ink: "#e5e8ca" },
  { base: "#493b50", ink: "#efdfd2" },
  { base: "#854735", ink: "#f4dfbc" },
  { base: "#2c455d", ink: "#e0e7e5" },
  { base: "#6b5732", ink: "#f3e7c6" },
] as const;
const NOTICE_TONES: Record<Notice["tone"], string> = {
  success: "border-emerald-600/25 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-950/40 dark:text-emerald-100",
  warning: "border-amber-600/25 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-950/40 dark:text-amber-100",
  error: "border-red-600/25 bg-red-50 text-red-900 dark:border-red-500/25 dark:bg-red-950/40 dark:text-red-100",
};
const PANEL = "flex items-start gap-3 rounded-lg border p-4 text-sm";

function posterHash(title: string): number {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function posterPalette(title: string) {
  return POSTER_PALETTES[posterHash(title) % POSTER_PALETTES.length];
}

function posterMonogram(title: string): string {
  const words = title.split(/\s+/).filter((word) => {
    const bare = word.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return bare && !SMALL_WORDS.has(bare);
  });
  return words.slice(0, 2).map((word) => word.charAt(0)).join("").toLocaleUpperCase() || "BK";
}

function PosterArtwork({
  title,
  className,
  mark = posterMonogram(title),
  showTitle = true,
}: {
  title: string;
  className?: string;
  mark?: string;
  showTitle?: boolean;
}) {
  const palette = posterPalette(title);
  const motif = posterHash(title) % 3;

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

function EmptyPosterWall() {
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

export function Library() {
  const [items, setItems] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [pendingDelete, setPendingDelete] = useState<PdfItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState<Set<string>>(new Set());
  const [coverBusy, setCoverBusy] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [rowFade, setRowFade] = useState<"none" | "left" | "right" | "both">("none");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const parkFocusRef = useRef(false);
  const requestRef = useRef(0);
  const query = filter.trim().toLowerCase();
  const progress = useMemo(() => {
    const map: Record<string, ReadingProgress> = {};
    if (typeof window === "undefined") return map;
    for (const item of items) {
      try {
        const raw = window.localStorage.getItem(`better-kindle:progress:${item.id}`);
        if (!raw) continue;
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          const n = Number(raw);
          if (Number.isFinite(n)) parsed = { page: n };
        }
        if (parsed && typeof parsed === "object") {
          const pp = parsed as { page?: unknown; numPages?: unknown };
          const page = Number(pp.page);
          if (Number.isFinite(page) && page >= 1) {
            map[item.id] = {
              page: Math.round(page),
              numPages: Number.isFinite(Number(pp.numPages)) ? Number(pp.numPages) : 0,
            };
          }
        }
      } catch {
        // ignore
      }
    }
    return map;
  }, [items]);
  const visible = useMemo(() => {
    const base = query
      ? items.filter((item) => item.name.toLowerCase().includes(query) || displayName(item.name).toLowerCase().includes(query))
      : items;
    if (sort === "name") {
      return [...base].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    }
    return base;
  }, [items, query, sort]);
  const inProgress = useMemo(() => items.filter((item) => progress[item.id]), [items, progress]);
  const heroItem = inProgress[0] ?? items[0];
  const heroProgress = heroItem ? progress[heroItem.id] : undefined;
  const heroCover = heroItem ? coverSrc(heroItem) : undefined;
  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + (item.size || 0), 0), [items]);

  const fetchLibrary = useCallback(async (request: number) => {
    try {
      const res = await fetch("/api/pdfs", { cache: "no-store" });
      if (!res.ok) throw new Error("Library request failed");
      const data = (await res.json()) as { items?: PdfItem[] };
      if (request !== requestRef.current) return;
      setItems(data.items ?? []);
      setLoadError(false);
    } catch {
      if (request !== requestRef.current) return;
      setLoadError(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const loadLibrary = useCallback(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(false);
    void fetchLibrary(request);
  }, [fetchLibrary]);

  useEffect(() => {
    void fetchLibrary(++requestRef.current);
    return () => {
      requestRef.current += 1;
    };
  }, [fetchLibrary]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(Boolean);
      if (list.length === 0) return;
      setUploading(true);
      setUploadProgress(0);
      setNotice(null);
      setFailedFiles(null);
      const formData = new FormData();
      for (const file of list) formData.append("files", file);
      try {
        const data = await new Promise<{ items?: PdfItem[]; skipped?: SkippedFile[]; error?: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/pdfs");
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
          xhr.onload = () => {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(xhr.responseText);
            } catch {
              // ignore malformed responses
            }
            const body =
              parsed && typeof parsed === "object"
                ? (parsed as { error?: string; items?: PdfItem[]; skipped?: SkippedFile[] })
                : {};
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(body);
            } else if (body.items?.length || body.skipped?.length) {
              resolve(body);
            } else {
              reject(new Error("Couldn't upload. Check your connection and try again."));
            }
          };
          xhr.onerror = () => reject(new Error("Couldn't upload. Check your connection and try again."));
          xhr.send(formData);
        });
        const saved = data.items ?? [];
        if (saved.length) {
          setItems((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            return [...saved.filter((p) => !ids.has(p.id)), ...prev];
          });
        }
        setNotice(uploadNotice(saved.length, data.skipped ?? []));
      } catch {
        setFailedFiles(list);
        setNotice({ tone: "error", text: "Couldn't upload. Check your connection and try again." });
      } finally {
        setUploading(false);
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleting) return;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/pdfs/${target.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((p) => p.id !== target.id));
      setNotice({ tone: "success", text: `Deleted "${displayName(target.name)}".`, undo: target });
      parkFocusRef.current = true;
      setPendingDelete(null);
    } catch {
      setDeleteError(`Couldn't delete "${displayName(target.name)}". Check your connection and try again.`);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, deleting]);

  const undoDelete = useCallback(
    async (item: PdfItem) => {
      if (undoing) return;
      setUndoing(true);
      try {
        const res = await fetch(`/api/pdfs/${item.id}?action=restore`, { method: "POST" });
        if (!res.ok) throw new Error("Restore failed");
        setNotice({ tone: "success", text: `Restored "${displayName(item.name)}".` });
        loadLibrary();
      } catch {
        setNotice({
          tone: "error",
          text: `Couldn't restore "${displayName(item.name)}". Check your connection and try again.`,
          undo: item,
        });
      } finally {
        setUndoing(false);
      }
    },
    [undoing, loadLibrary],
  );

  const addCover = useCallback(async (item: PdfItem, file: File) => {
    setCoverBusy((prev) => new Set(prev).add(item.id));
    try {
      const formData = new FormData();
      formData.append("cover", file);
      const res = await fetch(`/api/pdfs/${item.id}/cover`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Cover upload failed");
      const data = (await res.json()) as { item?: PdfItem };
      if (data.item) {
        setItems((prev) => prev.map((p) => (p.id === item.id ? data.item! : p)));
        setCoverFailed((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      } else {
        loadLibrary();
      }
      setNotice({ tone: "success", text: `Cover added to "${displayName(item.name)}".` });
    } catch {
      setNotice({ tone: "error", text: `Couldn't add cover to "${displayName(item.name)}".` });
    } finally {
      setCoverBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [loadLibrary]);

  const removeCover = useCallback(async (item: PdfItem) => {
    setCoverBusy((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/pdfs/${item.id}/cover`, { method: "DELETE" });
      if (!res.ok) throw new Error("Cover remove failed");
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, hasCover: false, cover: undefined, coverImage: undefined, coverUrl: undefined, thumbnail: undefined, thumbnailUrl: undefined } : p)));
      setNotice({ tone: "success", text: `Cover removed from "${displayName(item.name)}".` });
    } catch {
      setNotice({ tone: "error", text: `Couldn't remove cover from "${displayName(item.name)}".` });
    } finally {
      setCoverBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    setDragOver(false);
    if (!uploading) uploadFiles(e.dataTransfer.files);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setFilter("");
    searchToggleRef.current?.focus();
  };

  const scrollRow = (ref: React.RefObject<HTMLDivElement | null>, dir: "left" | "right") => {
    if (!ref.current) return;
    const amount = ref.current.clientWidth * 0.8;
    ref.current.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const rowRef = useRef<HTMLDivElement | null>(null);

  /** Only fade an edge the row can actually travel past. */
  const updateRowFade = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 8;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    setRowFade(atStart && atEnd ? "none" : atStart ? "right" : atEnd ? "left" : "both");
  }, []);

  useEffect(() => {
    updateRowFade();
    window.addEventListener("resize", updateRowFade);
    return () => window.removeEventListener("resize", updateRowFade);
  }, [updateRowFade, inProgress.length, query]);

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
      onDrop={onDrop}
    >
      <a
        href="#library"
        className={cn("fixed top-3 left-4 z-50 -translate-y-24 rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white focus-visible:translate-y-0 dark:bg-white dark:text-neutral-900", FOCUS_RED)}
      >
        Skip to library
      </a>
      {/* Top nav */}
      <header
        className={cn(
          "sticky top-0 z-40 border-b transition-colors duration-300",
          scrolled
            ? "border-neutral-200/80 bg-neutral-50/90 backdrop-blur-md dark:border-white/5 dark:bg-[#141414]/90"
            : "border-transparent bg-gradient-to-b from-neutral-50/80 to-transparent dark:from-black/70 dark:to-transparent",
        )}
      >
        <div className="flex min-h-[4.5rem] items-center justify-between gap-2 px-4 py-3 md:px-12 lg:px-16">
          <span className={`${DISPLAY} whitespace-nowrap text-lg tracking-wider text-[#e50914] min-[360px]:text-xl sm:text-2xl md:text-3xl dark:text-[#ff3440] sm:dark:text-[#e50914]`}>Better Kindle</span>
          <div className="flex items-center gap-1 sm:gap-3">
            {/* Desktop search */}
            <div className="relative hidden lg:block">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
              <input
                ref={desktopSearchRef}
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search titles…"
                aria-label="Filter PDFs by file name"
                className={cn("h-10 w-64 rounded-full border border-neutral-300 bg-white/80 pr-10 pl-10 text-sm text-neutral-900 caret-[#e50914] transition-colors placeholder:text-neutral-500 focus:bg-white xl:w-72 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-neutral-400 dark:focus:bg-white/10", FOCUS_RED)}
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("");
                    desktopSearchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className={cn("absolute top-1/2 right-1 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white", FOCUS_RED)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            {/* Mobile search toggle */}
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
              onStorageFailure={(theme) => setNotice({
                tone: "warning",
                text: `Theme set to ${theme} for this page. This browser isn't saving the choice.`,
              })}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-busy={uploading}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md bg-[#e50914] text-white transition-colors hover:bg-[#f40612] active:translate-y-px disabled:cursor-progress disabled:opacity-60 min-[360px]:h-9 min-[360px]:w-9 sm:inline-flex sm:h-10 sm:w-auto sm:items-center sm:gap-2 sm:px-4 sm:text-sm sm:font-semibold",
                FOCUS_RED, SKIP_LINK,
              )}
              aria-label="Upload PDFs"
            >
              <Upload className="h-4 w-4 sm:hidden" aria-hidden="true" />
              <span className="hidden sm:inline">{uploading ? "Uploading…" : "Upload"}</span>
            </button>
          </div>
        </div>
        {/* Mobile search takes the whole bar so nothing squeezes */}
        {searchOpen && (
          <div className="absolute inset-0 z-20 flex items-center gap-2 bg-neutral-50 px-4 md:px-12 lg:hidden dark:bg-[#141414]">
            <Search className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearch();
              }}
              placeholder="Search titles…"
              aria-label="Filter PDFs by file name"
              className="h-10 min-w-0 flex-1 bg-transparent text-base text-neutral-900 caret-[#e50914] placeholder:text-neutral-500 focus:outline-none dark:text-white dark:placeholder:text-neutral-400"
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

      <main>
        {loadError && (
          <div role="alert" className={cn(NOTICE_TONES.error, "mx-4 mt-3 md:mx-12", PANEL)}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-medium">Couldn&apos;t load your library.</p>
              <p className="mt-0.5 text-sm opacity-80">Your PDFs are still on disk. Check your connection, then try again.</p>
              <Button variant="outline" size="touch" className="mt-3" onClick={() => void loadLibrary()}>Try again</Button>
            </div>
          </div>
        )}

        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(NOTICE_TONES[notice.tone], "mx-4 mt-3 md:mx-12", PANEL)}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{notice.text}</p>
              {notice.details && notice.details.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs opacity-90">
                  {notice.details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              )}
              {notice.tone === "error" && failedFiles && (
                <Button variant="outline" size="touch" className="mt-3" onClick={() => void uploadFiles(failedFiles)}>
                  Try again
                </Button>
              )}
              {notice.undo && (
                <Button variant="outline" size="touch" className="mt-3" disabled={undoing}
                  onClick={() => void undoDelete(notice.undo!)}>
                  {undoing ? "Restoring…" : "Undo delete"}
                </Button>
              )}
              {notice.retry && (
                <Button variant="outline" size="touch" className="mt-3" onClick={() => notice.retry!()}>
                  {notice.retryLabel ?? "Retry"}
                </Button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setNotice(null); setFailedFiles(null); }}
              aria-label="Dismiss message"
              className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md opacity-70 transition-opacity hover:opacity-100", FOCUS_RED)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <h1 ref={headingRef} tabIndex={-1} className="sr-only">Library</h1>

        {/* Hero */}
        {heroItem && !query && (
          <section aria-labelledby="featured-title" className="relative isolate w-full overflow-hidden">
            {heroCover && !coverFailed.has(heroItem.id) ? (
              <Image
                src={heroCover}
                alt=""
                fill
                unoptimized
                loading="eager"
                className="absolute inset-0 h-full w-full object-cover"
                decoding="async"
                onError={() => setCoverFailed((prev) => new Set(prev).add(heroItem.id))}
              />
            ) : (
              <PosterArtwork title={displayName(heroItem.name)} className="absolute inset-0 h-full w-full" mark="" showTitle={false} />
            )}
            <div className="bk-hero-scrim absolute inset-0" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-neutral-50 to-transparent dark:from-[#141414]" aria-hidden="true" />
            <div className="relative grid items-center gap-7 px-4 pt-8 pb-9 md:min-h-[33rem] md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-10 md:px-12 md:py-12 lg:min-h-[36rem] lg:px-16">
              <div className="min-w-0 max-w-2xl md:py-4">
                <h2 id="featured-title" className={`${DISPLAY} bk-rise line-clamp-3 text-4xl leading-[0.98] tracking-[0.02em] text-balance wrap-anywhere text-neutral-900 sm:text-5xl lg:text-6xl xl:text-7xl dark:text-white`}>
                  {displayName(heroItem.name)}
                </h2>
                <div className="bk-rise mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-neutral-600 md:text-sm dark:text-neutral-300" style={{ animationDelay: "90ms" }}>
                  <span className="tabular-nums">{formatBytes(heroItem.size)}</span>
                  <span aria-hidden="true" className="text-neutral-400 dark:text-white/30">·</span>
                  <span>Added {formatDate(heroItem.createdAt)}</span>
                  {isFinished(heroProgress) && (
                    <span className={`${DISPLAY} rounded-full border border-neutral-900/15 px-2 py-0.5 text-[11px] tracking-[0.18em] text-neutral-700 dark:border-white/25 dark:text-white/80`}>
                      Finished
                    </span>
                  )}
                </div>
                {heroProgress && (
                  <div className="bk-rise mt-5 max-w-80" style={{ animationDelay: "150ms" }}>
                    <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
                      <span>Page {heroProgress.page}{heroProgress.numPages ? ` of ${heroProgress.numPages}` : ""}</span>
                      {heroProgress.numPages > 0 && <span className="font-medium text-neutral-900 dark:text-white">{progressPercent(heroProgress)}% read</span>}
                    </div>
                    {heroProgress.numPages > 0 && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-900/15 dark:bg-white/15">
                        <div className="h-full rounded-full bg-[#e50914]" style={{ width: `${progressPercent(heroProgress)}%` }} />
                      </div>
                    )}
                  </div>
                )}
                <div className="bk-rise mt-6 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "210ms" }}>
                  <Link
                    href={`/read/${heroItem.id}`}
                    prefetch={false}
                    className={cn(
                      "inline-flex items-center gap-2.5 rounded-md bg-neutral-900 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200",
                      FOCUS_RED, SKIP_LINK,
                    )}
                  >
                    <Play className="h-5 w-5 fill-current" aria-hidden="true" />
                    {heroProgress ? "Resume" : "Start reading"}
                  </Link>
                  <a href="#library" className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-white", FOCUS_RED)}>
                    Your library
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </a>
                </div>
              </div>
              <div aria-hidden="true" className="bk-rise order-first flex justify-center px-5 md:order-last" style={{ animationDelay: "90ms" }}>
                <div className="bk-hero-jacket relative aspect-[2/3] w-28 overflow-hidden rounded-sm bg-neutral-900 sm:w-36 md:w-56 lg:w-64 xl:w-72">
                  {heroCover && !coverFailed.has(heroItem.id) ? (
                    <Image
                      src={heroCover}
                      alt=""
                      fill
                      unoptimized
                      loading="eager"
                      fetchPriority="high"
                      className="h-full w-full object-cover"
                      onError={() => setCoverFailed((prev) => new Set(prev).add(heroItem.id))}
                    />
                  ) : (
                    <PosterArtwork title={displayName(heroItem.name)} className="h-full w-full" />
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Rows */}
        <div className="space-y-10 px-4 pt-7 pb-12 md:space-y-12 md:px-12 md:pt-8 lg:px-16">
          {inProgress.length > 0 && !query && (
            <section aria-labelledby="continue-reading-heading">
              <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 id="continue-reading-heading" className={`${DISPLAY} text-2xl tracking-wider text-neutral-900 md:text-3xl dark:text-white`}>Continue reading</h2>
                  <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{inProgress.length}</span>
                </div>
                {rowFade !== "none" && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => scrollRow(rowRef, "left")}
                      disabled={rowFade === "right"}
                      className={cn("grid h-9 w-9 place-items-center rounded-full border border-neutral-300 text-neutral-600 transition-colors hover:border-neutral-500 hover:text-neutral-900 disabled:cursor-default disabled:opacity-30 dark:border-white/20 dark:text-neutral-300 dark:hover:border-white/40 dark:hover:text-white", FOCUS_RED)}
                      aria-label="Scroll left"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollRow(rowRef, "right")}
                      disabled={rowFade === "left"}
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
                onScroll={updateRowFade}
                className={cn(
                  "flex snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden scroll-px-4 pt-1 pb-5 no-scrollbar md:gap-4",
                  rowFade === "right" && "bk-fade-right",
                  rowFade === "left" && "bk-fade-left",
                  rowFade === "both" && "bk-fade-both",
                )}
              >
                {inProgress.map((item) => (
                  <div key={item.id} className="w-36 shrink-0 snap-start sm:w-40 md:w-44">
                    <NetflixCard
                      item={item}
                      progress={progress[item.id]}
                      coverFailed={coverFailed}
                      coverBusy={coverBusy}
                      setCoverFailed={setCoverFailed}
                      addCover={addCover}
                      removeCover={removeCover}
                      onPendingDelete={setPendingDelete}
                      prewarmReader={prewarmReader}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* All titles */}
          <section id="library" tabIndex={-1} className="scroll-mt-28 focus:outline-none">
            {items.length > 0 && (
              <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className={`${DISPLAY} text-2xl tracking-wider text-neutral-900 md:text-3xl dark:text-white`}>{query ? "Search results" : "Your library"}</h2>
                  <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{query ? `${visible.length} of ${items.length}` : items.length}</span>
                </div>
                <div className="relative">
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortMode)}
                    aria-label="Sort library"
                    className={cn("h-9 appearance-none rounded-full border border-neutral-300 bg-white/80 pr-9 pl-4 text-xs text-neutral-700 transition-colors hover:border-neutral-400 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:border-white/25", FOCUS_RED)}
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name (A–Z)</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
                </div>
              </div>
            )}

            {loading && items.length === 0 ? (
              <div aria-busy="true">
                <p role="status" className="sr-only">Loading your library…</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="aspect-[2/3] animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-900" />
                  ))}
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-24 text-center md:py-32">
                <EmptyPosterWall />
                <h2 className={`${DISPLAY} text-4xl tracking-wider text-neutral-900 md:text-5xl dark:text-white`}>Your library is empty</h2>
                <p className="max-w-md text-neutral-600 dark:text-neutral-400">
                  Drop PDFs anywhere on this page, or pick them from your device. They&rsquo;ll line up here as posters.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className={cn(
                    "mt-2 inline-flex items-center gap-2 rounded-md bg-[#e50914] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#f40612] active:translate-y-px disabled:cursor-progress disabled:opacity-60",
                    FOCUS_RED, SKIP_LINK,
                  )}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  {uploading ? "Uploading…" : "Choose PDFs"}
                </button>
              </div>
            ) : (
              <>
                <p role="status" className="sr-only">{query ? `${visible.length} ${visible.length === 1 ? "title matches" : "titles match"} your search.` : ""}</p>
                {(!query || visible.length > 0) && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 md:gap-x-4 lg:grid-cols-5 xl:grid-cols-6">
                    {/* Upload tile */}
                    {!query && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className={cn(
                          "relative flex aspect-[2/3] flex-col items-center justify-center gap-3 overflow-hidden rounded-md border border-dashed border-neutral-400 bg-neutral-100/50 text-neutral-600 transition-colors duration-200 hover:border-[#e50914] hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-progress",
                          "dark:border-white/15 dark:bg-white/[0.03] dark:text-neutral-400 dark:hover:border-white/30 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200",
                          FOCUS_RED,
                          dragOver && "border-[#e50914] bg-[#e50914]/5 text-[#e50914] dark:border-[#e50914] dark:bg-[#e50914]/10 dark:text-[#e50914]",
                        )}
                        aria-busy={uploading}
                        aria-label="Upload PDFs"
                      >
                        <span className="grid h-11 w-11 place-items-center rounded-full border border-current opacity-80">
                          {uploading ? <Upload className="h-5 w-5 animate-pulse" aria-hidden="true" /> : <Plus className="h-5 w-5" aria-hidden="true" />}
                        </span>
                        <span aria-live="polite" className="px-2 text-center text-sm font-medium">
                          {uploading
                            ? uploadProgress !== null && uploadProgress > 0
                              ? `Uploading ${uploadProgress}%`
                              : "Uploading…"
                            : dragOver
                              ? "Drop to upload"
                              : "Add PDFs"}
                        </span>
                        {!uploading && <span className="-mt-1 px-2 text-center text-xs text-neutral-600 dark:text-neutral-400">or drop them here</span>}
                        {uploading && (
                          <span className="absolute inset-x-0 bottom-0 h-1 bg-neutral-900/10 dark:bg-white/10" aria-hidden="true">
                            <span className="block h-full bg-[#e50914] transition-[width] duration-300" style={{ width: `${uploadProgress ?? 0}%` }} />
                          </span>
                        )}
                      </button>
                    )}

                    {visible.map((item) => (
                      <NetflixCard
                        key={item.id}
                        item={item}
                        progress={progress[item.id]}
                        coverFailed={coverFailed}
                        coverBusy={coverBusy}
                        setCoverFailed={setCoverFailed}
                        addCover={addCover}
                        removeCover={removeCover}
                        onPendingDelete={setPendingDelete}
                        prewarmReader={prewarmReader}
                      />
                    ))}
                  </div>
                )}

                {query && items.length > 0 && visible.length === 0 && (
                  <p className="flex min-h-64 flex-col items-center justify-center gap-3 py-12 text-center text-sm text-neutral-600 dark:text-neutral-400">
                    No titles match &ldquo;{filter.trim()}&rdquo;.{" "}
                    <button
                      type="button"
                      className={cn("rounded px-1 text-neutral-900 underline underline-offset-4 dark:text-white", FOCUS_RED)}
                      onClick={() => setFilter("")}
                    >
                      Clear search
                    </button>
                  </p>
                )}
              </>
            )}
          </section>
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

      {/* Whole-stage drop target */}
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
        onChange={onInputChange}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this PDF?"
        description={<>&ldquo;{pendingDelete ? displayName(pendingDelete.name) : ""}&rdquo; will be removed from your library. You can undo this from the message shown after deletion.</>}
        confirmLabel="Delete"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
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

const CARD_CONTROL = cn(
  "grid h-8 w-8 place-items-center rounded-md bg-black/75 text-white ring-1 ring-white/15 transition-colors [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9",
  "hover:bg-[#e50914] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e50914] disabled:opacity-50",
);
/** Visible on touch and keyboard, revealed on hover where hover exists. */
const CARD_CONTROL_REVEAL =
  "opacity-100 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";

function NetflixCard({
  item,
  progress: itemProgress,
  coverFailed,
  coverBusy,
  setCoverFailed,
  addCover,
  removeCover,
  onPendingDelete,
  prewarmReader,
}: {
  item: PdfItem;
  progress?: ReadingProgress;
  coverFailed: Set<string>;
  coverBusy: Set<string>;
  setCoverFailed: React.Dispatch<React.SetStateAction<Set<string>>>;
  addCover: (item: PdfItem, file: File) => void;
  removeCover: (item: PdfItem) => void;
  onPendingDelete: (item: PdfItem) => void;
  prewarmReader: (e?: unknown) => void;
}) {
  const name = displayName(item.name);
  const src = coverSrc(item);
  const hasCover = Boolean(src) && !coverFailed.has(item.id);
  const done = isFinished(itemProgress);
  const busy = coverBusy.has(item.id);
  const pageSummary = itemProgress
    ? itemProgress.numPages > 0
      ? `Page ${itemProgress.page} of ${itemProgress.numPages}`
      : `Page ${itemProgress.page}`
    : undefined;

  return (
    <div className="group relative aspect-[2/3] overflow-hidden rounded-md bg-neutral-200 ring-1 ring-neutral-900/10 transition duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/25 hover:ring-neutral-900/20 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-[#e50914] motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:bg-neutral-900 dark:ring-white/10 dark:hover:ring-white/25">
      <Link
        href={`/read/${item.id}`}
        prefetch={false}
        onPointerEnter={prewarmReader as (e: React.PointerEvent) => void}
        onFocus={prewarmReader as (e: React.FocusEvent) => void}
        onTouchStart={prewarmReader as (e: React.TouchEvent) => void}
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
            onError={() => setCoverFailed((prev) => new Set(prev).add(item.id))}
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
          {itemProgress && (
            <>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs leading-none text-white/80">
                <span className="tabular-nums">{pageSummary}</span>
                {itemProgress.numPages > 0 && (
                  <span className="shrink-0 tabular-nums">{progressPercent(itemProgress)}%</span>
                )}
              </div>
              {itemProgress.numPages > 0 && (
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-[#e50914]" style={{ width: `${progressPercent(itemProgress)}%` }} />
                </div>
              )}
            </>
          )}
        </div>
      </Link>
      <div className={cn("absolute top-1.5 left-1.5 flex gap-1.5", CARD_CONTROL_REVEAL)}>
        <label className={cn(CARD_CONTROL, "cursor-pointer hover:bg-white hover:text-black", "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-[#e50914]")} title="Add cover image">
          {busy ? "…" : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void addCover(item, file);
              e.target.value = "";
            }}
            aria-label={`Add cover image for ${name}`}
          />
        </label>
        {(item.hasCover || src) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void removeCover(item)}
            className={CARD_CONTROL}
            aria-label={`Remove cover image for ${name}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onPendingDelete(item)}
        className={cn(CARD_CONTROL, "absolute top-1.5 right-1.5", CARD_CONTROL_REVEAL)}
        aria-label={`Delete ${name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
