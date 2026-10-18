import { useCallback, useState } from "react";
import type { PdfItem } from "@/types/pdf";
import * as client from "./library-client";
import { displayName } from "@/lib/pdf-title";
import type { LibraryNotice } from "./library-model";

type SetItems = (value: PdfItem[] | ((prev: PdfItem[]) => PdfItem[])) => void;
type SetNotice = (value: LibraryNotice | null) => void;

export function useDelete(options: {
  setItems: SetItems;
  syncAfterMutation: () => void;
  setNotice: SetNotice;
  reload: () => void;
}) {
  const { setItems, syncAfterMutation, setNotice, reload } = options;
  const [pendingDelete, setPendingDelete] = useState<PdfItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

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
  }, [pendingDelete, deleting, setItems, syncAfterMutation, setNotice]);

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
  }, [undoing, setNotice, reload]);

  return {
    item: pendingDelete,
    busy: deleting,
    error: deleteError,
    restoring: undoing,
    request: requestDelete,
    cancel: cancelDelete,
    confirm: confirmDelete,
    restore: undoDelete,
  };
}
