"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./reader-chrome.module.css";

export function ReaderDialog({ open, title, onClose, children, navigation = false }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  navigation?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog ref={ref} className={`${styles.dialog} ${navigation ? styles.navigationDialog : ""}`}
      aria-labelledby={id} data-reader-overlay onCancel={(event) => {
        event.preventDefault();
        onClose();
      }} onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) onClose();
        }
      }}>
      <div className={styles.dialogHeading}>
        <h2 id={id}>{title}</h2>
        <Button variant="ghost" size="icon-touch" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X /></Button>
      </div>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>
  );
}
