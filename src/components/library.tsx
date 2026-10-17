"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, Search, Trash2, Upload, X } from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { prewarmReader } from "@/components/reader/reader-preload";
import { ThemeSelect, writeTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type SkippedFile = { name: string; reason: string };
type Notice = { tone: "success" | "warning" | "error"; text: string; details?: string[]; undo?: PdfItem; retry?: () => void; retryLabel?: string };
type SortMode = "recent" | "name";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    // Keep the card meta short: "Oct 16 · 7:23 PM". For files from another year
    // the year matters more than the clock, so the time is dropped there.
    const sameYear = date.getFullYear() === new Date().getFullYear();
    const datePart = new Intl.DateTimeFormat(undefined, sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }).format(date);
    if (!sameYear) return datePart;
    const timePart = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    return `${datePart} · ${timePart}`;
  } catch {
    return iso;
  }
}

function uploadNotice(saved: number, skipped: SkippedFile[]): Notice {
  const details = skipped.map((file) => `${file.name} — ${file.reason}`);
  if (saved === 0) return { tone: "warning", text: "No files were uploaded.", details };
  const uploaded = `${saved} ${saved === 1 ? "PDF" : "PDFs"} uploaded`;
  if (skipped.length) return { tone: "warning", text: `${uploaded}, ${skipped.length} skipped.`, details };
  return { tone: "success", text: `${uploaded}.` };
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const parkFocusRef = useRef(false);
  const requestRef = useRef(0);
  const query = filter.trim().toLowerCase();
  const progress = useMemo(() => {
    const map: Record<string, { page: number; numPages: number }> = {};
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
    const filtered = query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    if (sort === "name") {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    }
    return filtered;
  }, [items, query, sort]);

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
    // The first load is already in flight; only a retry shows the spinner again.
    void fetchLibrary(++requestRef.current);
    return () => {
      requestRef.current += 1;
    };
  }, [fetchLibrary]);

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
            // Rejected files still come back with per-file results; only a bare failure is an error.
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
        // Keep the selection around so the notice can offer a one-click retry.
        setFailedFiles(list);
        setNotice({ tone: "error", text: "Couldn't upload. Check your connection and try again." });
      } finally {
        setUploading(false);
        setUploadProgress(null);
        // The files live in React state now, so clearing the input never loses the
        // selection; it only lets the same file be picked again.
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
      setNotice({ tone: "success", text: `Deleted “${target.name}”.`, undo: target });
      // The card and its delete button are gone; once the dialog closes, park focus on the page heading.
      parkFocusRef.current = true;
      setPendingDelete(null);
    } catch {
      setDeleteError(`Couldn't delete “${target.name}”. Check your connection and try again.`);
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
        setNotice({ tone: "success", text: `Restored “${item.name}”.` });
        // Refetch instead of re-inserting: the "recent" order comes from the server.
        loadLibrary();
      } catch {
        // Keep the undo action on the notice so the user can retry without reopening the trash.
        setNotice({
          tone: "error",
          text: `Couldn't restore “${item.name}”. Check your connection and try again.`,
          undo: item,
        });
      } finally {
        setUndoing(false);
      }
    },
    [undoing, loadLibrary],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
  };

  const onDrop = (e: React.DragEvent) => {
    // Dropping a file anywhere on the page uploads it; letting the browser's
    // default handling run would navigate away from the library.
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    setDragOver(false);
    if (!uploading) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="min-h-screen bg-zinc-50 dark:bg-black"
      onDragOver={(event) => {
        // Only file drags belong here; text/selection drags keep their default behavior.
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              Better Kindle
            </p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 rounded-sm text-2xl font-semibold tracking-tight text-black dark:text-zinc-50"
            >
              Library
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Your uploaded PDFs.
            </p>
          </div>
          <ThemeSelect
            onStorageFailure={(theme) => {
              const retry = () => {
                const saved = writeTheme(theme);
                if (saved) {
                  setNotice({ tone: "success", text: "Theme saved." });
                } else {
                  setNotice({
                    tone: "warning",
                    text: "Theme won't be saved on this device until browser storage works again.",
                  });
                }
              };
              setNotice({
                tone: "warning",
                text: "Theme won't be saved on this device until browser storage works again.",
                retry,
                retryLabel: "Retry saving",
              });
            }}
          />
        </header>

        {loadError && (
          <div
            role="alert"
            className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-red-800 dark:text-red-200">Couldn&apos;t load your library.</p>
              <p className="text-sm text-red-700 dark:text-red-300">
                Your PDFs are still on disk. Check your connection, then try again.
              </p>
            </div>
            <Button variant="outline" size="touch" onClick={() => void loadLibrary()}>Try again</Button>
          </div>
        )}

        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
              "mb-5 flex items-start gap-3 rounded-xl border p-4 text-sm",
              notice.tone === "error" && "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
              notice.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100",
              notice.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100",
            )}
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
              className="-my-2 -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {items.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3" role="region" aria-label="Filter and sort your library">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by file name"
                aria-label="Filter PDFs by file name"
                className="h-11 w-full rounded-lg border border-zinc-300 bg-white pr-3 pl-9 text-sm text-zinc-800 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="h-11 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="recent">Newest first</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </label>
            {query && (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {visible.length} of {items.length}
              </span>
            )}
          </div>
        )}

        <main className="min-w-0">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {/* Upload placeholder card, always first */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "group relative flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 bg-white text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200",
              dragOver && "border-blue-500 bg-blue-50 text-blue-500 dark:bg-blue-950/30 dark:text-blue-400",
            )}
            aria-busy={uploading}
            aria-live="polite"
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <Upload className="h-8 w-8" />
            )}
            <span className="text-sm font-medium">
              {uploading
                ? `Uploading…${uploadProgress !== null && uploadProgress > 0 ? ` ${uploadProgress}%` : ""}`
                : "Upload PDF"}
            </span>
            {uploading && uploadProgress !== null && uploadProgress > 0 && (
              <div
                role="progressbar"
                aria-valuenow={uploadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Upload progress"
                className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
            <span className="px-3 text-center text-xs text-zinc-600 dark:text-zinc-400">
              Click or drop files here
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={onInputChange}
            />
          </button>

          {loading && items.length === 0 && (
            <div role="status" className="col-span-full flex items-center justify-center gap-3 py-16 text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <span className="text-sm sr-only">Loading your library…</span>
            </div>
          )}

          {visible.map((item) => (
            <div
              key={item.id}
              className="group relative flex aspect-[3/4] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Link
                href={`/read/${item.id}`}
                prefetch={false}
                onPointerEnter={prewarmReader}
                onFocus={prewarmReader}
                onTouchStart={prewarmReader}
                className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center"
              >
                <FileText className="h-10 w-10 text-zinc-400 dark:text-zinc-500" />
                <span className="line-clamp-2 w-full break-words text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {item.name}
                </span>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {formatBytes(item.size)}
                </span>
                {progress[item.id] && (
                  <span className="text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400">
                    <span className="sr-only">Resume at </span>
                    {progress[item.id].numPages
                      ? `Page ${progress[item.id].page} of ${progress[item.id].numPages}`
                      : `Page ${progress[item.id].page}`}
                  </span>
                )}
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="sr-only">Uploaded </span>
                  <time dateTime={item.createdAt} className="whitespace-nowrap">{formatDate(item.createdAt)}</time>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setPendingDelete(item)}
                className="absolute top-1 right-1 grid h-11 w-11 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600 dark:text-zinc-400 dark:hover:bg-red-900/30 dark:hover:text-red-400 dark:focus-visible:bg-red-900/30"
                aria-label={`Delete ${item.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {!loading && !loadError && items.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center gap-3 py-16 text-zinc-500 dark:text-zinc-400">
            <p className="text-center text-sm">No PDFs yet. Upload one to get started.</p>
            <Button variant="outline" size="touch" onClick={() => fileInputRef.current?.click()}>
              Upload PDF
            </Button>
          </div>
        )}

        {query && items.length > 0 && visible.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No PDFs match “{filter.trim()}”.{" "}
            <button
              type="button"
              className="-my-2 inline-flex min-h-11 items-center rounded-md px-1 underline underline-offset-2"
              onClick={() => setFilter("")}
            >
              Clear filter
            </button>
          </p>
        )}
        </main>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this PDF?"
        description={<>“{pendingDelete?.name}” will be removed from your library. You can undo this from the message shown after deletion.</>}
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
