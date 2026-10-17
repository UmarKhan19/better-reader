"use client";

import { useEffect, useId, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel",
  pending = false, error = null, onConfirm, onCancel, onClosed,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Fired after the dialog closes and native focus restoration has run. */
  onClosed?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(pending);
  const cancelRef = useRef(onCancel);
  const id = useId();
  const descriptionId = `${id}-description`;
  useEffect(() => {
    pendingRef.current = pending;
    cancelRef.current = onCancel;
  }, [pending, onCancel]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Escape must not quietly "cancel" an in-flight deletion. Chromium dispatches the dialog
    // `cancel` event as non-cancelable, so preventDefault() there cannot stop the close; the
    // reliable guard is to cancel the Escape keydown that would signal the close request.
    // Listening on document (capture) covers the case where focus has fallen back to <body>
    // because the focused Cancel button just became disabled.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && node.open && pendingRef.current) event.preventDefault();
    };
    // Non-pending Escape still fires `cancel`; route it through onCancel so React state stays
    // in sync with the dialog the browser just closed.
    const handleCancel = () => {
      if (!pendingRef.current) cancelRef.current();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    node.addEventListener("cancel", handleCancel);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      node.removeEventListener("cancel", handleCancel);
    };
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) {
      node.close();
      onClosed?.();
    }
  }, [open, onClosed]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      aria-describedby={descriptionId}
      className="m-auto w-[min(420px,calc(100%-32px))] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div className="p-5">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        <div id={descriptionId} className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{description}</div>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-400">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <Button variant="outline" size="touch" disabled={pending} onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="destructive" size="touch" aria-busy={pending} disabled={pending} onClick={onConfirm}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Deleting…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
