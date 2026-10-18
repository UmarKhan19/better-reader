import { useCallback, useState } from "react";
import type { PdfItem } from "@/types/pdf";
import * as client from "./library-client";
import { displayName } from "@/lib/pdf-title";
import { withoutCover, type LibraryNotice } from "./library-model";

type SetItems = (value: PdfItem[] | ((prev: PdfItem[]) => PdfItem[])) => void;
type SetNotice = (value: LibraryNotice | null) => void;

export function useCovers(options: {
  setItems: SetItems;
  syncAfterMutation: () => void;
  setNotice: SetNotice;
  reload: () => void;
}) {
  const { setItems, syncAfterMutation, setNotice, reload } = options;
  const [coverFailed, setCoverFailed] = useState<ReadonlySet<string>>(new Set());
  const [coverBusy, setCoverBusy] = useState<ReadonlySet<string>>(new Set());

  const markFailed = useCallback((id: string) => {
    setCoverFailed((prev) => new Set(prev).add(id));
  }, []);

  const add = useCallback(async (item: PdfItem, file: File) => {
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
  }, [reload, setItems, syncAfterMutation, setNotice]);

  const remove = useCallback(async (item: PdfItem) => {
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
  }, [setItems, syncAfterMutation, setNotice]);

  return {
    busy: coverBusy,
    failed: coverFailed,
    markFailed,
    add,
    remove,
  };
}
