import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfItem } from "@/types/pdf";
import * as client from "./library-client";
import {
  displayName, mergeUploadedItems, parseLibraryProgress, uploadNotice, withoutCover,
  type LibraryNotice, type ReadingProgress,
} from "./library-model";

export function useLibrary() {
  const [items, setItems] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PdfItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [coverFailed, setCoverFailed] = useState<ReadonlySet<string>>(new Set());
  const [coverBusy, setCoverBusy] = useState<ReadonlySet<string>>(new Set());
  const requestRef = useRef(0);

  const progress = useMemo(() => {
    const map: Record<string, ReadingProgress> = {};
    if (typeof window === "undefined") return map;
    for (const item of items) {
      try {
        const value = parseLibraryProgress(window.localStorage.getItem(`better-kindle:progress:${item.id}`));
        if (value) map[item.id] = value;
      } catch {
        // Storage may be blocked; the library still works without saved progress.
      }
    }
    return map;
  }, [items]);

  const fetchLibrary = useCallback(async (request: number) => {
    try {
      const next = await client.listPdfs();
      if (request !== requestRef.current) return;
      setItems(next);
      setLoadError(false);
    } catch {
      if (request !== requestRef.current) return;
      setLoadError(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(false);
    void fetchLibrary(request);
  }, [fetchLibrary]);

  /** Re-reads the folder after a change and invalidates any list request already in flight. */
  const syncAfterMutation = useCallback(() => {
    void fetchLibrary(++requestRef.current);
  }, [fetchLibrary]);

  useEffect(() => {
    void fetchLibrary(++requestRef.current);
    return () => { requestRef.current += 1; };
  }, [fetchLibrary]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(Boolean);
    if (list.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setNotice(null);
    setFailedFiles(null);
    try {
      const result = await client.uploadPdfs(list, setUploadProgress);
      if (result.items.length) {
        setItems((prev) => mergeUploadedItems(prev, result.items));
        syncAfterMutation();
      }
      setNotice(uploadNotice(result.items.length, result.skipped));
    } catch {
      setFailedFiles(list);
      setNotice({ tone: "error", text: "Couldn't upload. Check your connection and try again." });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }, [syncAfterMutation]);

  const requestDelete = useCallback((item: PdfItem) => {
    setPendingDelete(item);
  }, []);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
    setDeleteError(null);
  }, []);

  const confirmDelete = useCallback(async (): Promise<boolean> => {
    if (!pendingDelete || deleting) return false;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.deletePdf(target.id);
      setItems((prev) => prev.filter((item) => item.id !== target.id));
      syncAfterMutation();
      setNotice({ tone: "success", text: `Deleted "${displayName(target.name)}".`, undo: target });
      setPendingDelete(null);
      return true;
    } catch {
      setDeleteError(`Couldn't delete "${displayName(target.name)}". Check your connection and try again.`);
      return false;
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, deleting, syncAfterMutation]);

  const undoDelete = useCallback(async (item: PdfItem) => {
    if (undoing) return;
    setUndoing(true);
    try {
      await client.restorePdf(item.id);
      setNotice({ tone: "success", text: `Restored "${displayName(item.name)}".` });
      reload();
    } catch {
      setNotice({
        tone: "error", text: `Couldn't restore "${displayName(item.name)}". Check your connection and try again.`, undo: item,
      });
    } finally {
      setUndoing(false);
    }
  }, [undoing, reload]);

  const markCoverFailed = useCallback((id: string) => {
    setCoverFailed((prev) => new Set(prev).add(id));
  }, []);

  const addCover = useCallback(async (item: PdfItem, file: File) => {
    setCoverBusy((prev) => new Set(prev).add(item.id));
    try {
      const updated = await client.addCover(item.id, file);
      if (updated) {
        setItems((prev) => prev.map((entry) => entry.id === item.id ? updated : entry));
        syncAfterMutation();
        setCoverFailed((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      } else {
        reload();
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
  }, [reload, syncAfterMutation]);

  const removeCover = useCallback(async (item: PdfItem) => {
    setCoverBusy((prev) => new Set(prev).add(item.id));
    try {
      await client.removeCover(item.id);
      setItems((prev) => prev.map((entry) => entry.id === item.id ? withoutCover(entry) : entry));
      syncAfterMutation();
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
  }, [syncAfterMutation]);

  const dismissNotice = useCallback(() => {
    setNotice(null);
    setFailedFiles(null);
  }, []);

  const warnThemeStorage = useCallback((theme: string) => {
    setNotice({ tone: "warning", text: `Theme set to ${theme} for this page. This browser isn't saving the choice.` });
  }, []);

  return {
    items, progress, loading, loadError, reload, notice, dismissNotice, warnThemeStorage,
    upload: {
      busy: uploading, progress: uploadProgress, start: uploadFiles,
      retry: failedFiles ? () => void uploadFiles(failedFiles) : undefined,
    },
    deletion: {
      item: pendingDelete, busy: deleting, error: deleteError, restoring: undoing,
      request: requestDelete, cancel: cancelDelete, confirm: confirmDelete, restore: undoDelete,
    },
    covers: { busy: coverBusy, failed: coverFailed, markFailed: markCoverFailed, add: addCover, remove: removeCover },
  };
}
