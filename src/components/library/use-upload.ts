import { useCallback, useState } from "react";
import type { PdfItem } from "@/types/pdf";
import * as client from "./library-client";
import { mergeUploadedItems, uploadNotice, type LibraryNotice } from "./library-model";

type SetItems = (value: PdfItem[] | ((prev: PdfItem[]) => PdfItem[])) => void;
type SetNotice = (value: LibraryNotice | null) => void;

export function useUpload(options: {
  setItems: SetItems;
  syncAfterMutation: () => void;
  setNotice: SetNotice;
}) {
  const { setItems, syncAfterMutation, setNotice } = options;
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[] | null>(null);

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
      setFailedFiles(result.failed.length ? result.failed : null);
      const notice = uploadNotice(result.items.length, result.skipped, result.failed.length);
      if (result.failed.length) {
        notice.details = [...(notice.details ?? []), ...result.failed.map((file) => `${file.name || "Unnamed file"}, not uploaded`)];
      }
      setNotice(notice);
    } catch {
      setFailedFiles(list);
      setNotice(uploadNotice(0, [], list.length));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }, [setItems, syncAfterMutation, setNotice]);

  const clearFailed = useCallback(() => {
    setFailedFiles(null);
  }, []);

  return {
    busy: uploading,
    progress: uploadProgress,
    failedFiles,
    clearFailed,
    start: uploadFiles,
    retry: failedFiles ? () => void uploadFiles(failedFiles) : undefined,
  };
}
