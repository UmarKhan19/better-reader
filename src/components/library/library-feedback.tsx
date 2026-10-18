import { AlertCircle, X } from "lucide-react";
import type { PdfItem } from "@/types/pdf";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LibraryNotice } from "./library-model";
import { FOCUS_RED } from "./library-styles";

const NOTICE_TONES: Record<LibraryNotice["tone"], string> = {
  success: "border-emerald-600/25 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-950/40 dark:text-emerald-100",
  warning: "border-amber-600/25 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-950/40 dark:text-amber-100",
  error: "border-red-600/25 bg-red-50 text-red-900 dark:border-red-500/25 dark:bg-red-950/40 dark:text-red-100",
};
const PANEL = "flex items-start gap-3 rounded-lg border p-4 text-sm";

export function LibraryFeedback({ loadError, notice, onReload, onDismiss, onRetryUpload, onUndoDelete, undoing }: {
  loadError: boolean;
  notice: LibraryNotice | null;
  onReload: () => void;
  onDismiss: () => void;
  onRetryUpload?: () => void;
  onUndoDelete: (item: PdfItem) => void;
  undoing: boolean;
}) {
  const undoItem = notice?.undo;
  return (
    <>
      {loadError && (
        <div role="alert" className={cn(NOTICE_TONES.error, "mx-4 mt-3 md:mx-12", PANEL)}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-medium">Couldn&apos;t load your library.</p>
            <p className="mt-0.5 text-sm opacity-80">Your PDFs are still on disk. Check your connection, then try again.</p>
            <Button variant="outline" size="touch" className="mt-3" onClick={onReload}>Try again</Button>
          </div>
        </div>
      )}
      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"} className={cn(NOTICE_TONES[notice.tone], "mx-4 mt-3 md:mx-12", PANEL)}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{notice.text}</p>
            {notice.details && notice.details.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs opacity-90">
                {notice.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            )}
            {notice.tone === "error" && onRetryUpload && (
              <Button variant="outline" size="touch" className="mt-3" onClick={onRetryUpload}>Try again</Button>
            )}
            {undoItem && (
              <Button variant="outline" size="touch" className="mt-3" disabled={undoing} onClick={() => onUndoDelete(undoItem)}>
                {undoing ? "Restoring…" : "Undo delete"}
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss message"
            className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md opacity-70 transition-opacity hover:opacity-100", FOCUS_RED)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
