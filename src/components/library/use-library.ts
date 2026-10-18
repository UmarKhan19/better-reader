import { useCallback } from "react";
import { useLibraryItems } from "./use-library-items";
import { useNotice } from "./use-notice";
import { useUpload } from "./use-upload";
import { useDelete } from "./use-delete";
import { useCovers } from "./use-covers";

export function useLibrary() {
  const { items, setItems, loading, loadError, progress, reload, syncAfterMutation } = useLibraryItems();
  const { notice, setNotice, dismissNotice: dismissNoticeBase, warnThemeStorage } = useNotice();
  const upload = useUpload({ setItems, syncAfterMutation, setNotice });
  const deletion = useDelete({ setItems, syncAfterMutation, setNotice, reload });
  const covers = useCovers({ setItems, syncAfterMutation, setNotice, reload });
  const { clearFailed } = upload;

  const dismissNotice = useCallback(() => {
    dismissNoticeBase();
    clearFailed();
  }, [dismissNoticeBase, clearFailed]);

  return {
    items, progress, loading, loadError, reload, notice, dismissNotice, warnThemeStorage,
    upload: {
      busy: upload.busy, progress: upload.progress, start: upload.start,
      retry: upload.retry,
    },
    deletion: {
      item: deletion.item, busy: deletion.busy, error: deletion.error, restoring: deletion.restoring,
      request: deletion.request, cancel: deletion.cancel, confirm: deletion.confirm, restore: deletion.restore,
    },
    covers: { busy: covers.busy, failed: covers.failed, markFailed: covers.markFailed, add: covers.add, remove: covers.remove },
  };
}
