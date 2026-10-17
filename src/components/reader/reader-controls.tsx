"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./reader.module.css";

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

export function PageControls({ page, total, onNavigate, onSeek = onNavigate, disabled = false, onMessage }: {
  page: number; total: number | null; onNavigate: (page: number) => void; onSeek?: (page: number) => void;
  disabled?: boolean; onMessage?: (message: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const last = total ?? null;
  const hint = last ? `Enter a page number between 1 and ${last}, then press Enter.` : "Enter a page number and press Enter.";
  const report = (raw: string, input: HTMLInputElement) => {
    const digits = raw.trim();
    if (digits && /^\d+$/.test(digits)) return Number(digits);
    setInvalid(true);
    onMessage?.(`“${digits || "Nothing"}” isn't a page number. ${hint}`);
    if (digits) input.select();
    return null;
  };
  return (
    <div className={styles.pageControls}>
      <Button variant="ghost" size="icon-touch" aria-label="Previous page" title="Previous page (←)"
        disabled={disabled || !last || page <= 1} onClick={() => onNavigate(page - 1)}><ChevronLeft /></Button>
      <form className={styles.pageJump} onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("page");
        if (!(input instanceof HTMLInputElement)) return;
        const value = report(input.value, input);
        if (value === null) return;
        setInvalid(false);
        const target = last ? Math.min(last, Math.max(1, value)) : value;
        if (last && value > last) onMessage?.(`Page ${value} doesn't exist. Jumping to page ${last}.`);
        onSeek(target);
        input.blur();
      }}>
        <input key={page} name="page" type="text" inputMode="numeric"
          defaultValue={page} disabled={disabled || !last} aria-label="Page number"
          title={hint} aria-invalid={invalid || undefined} autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim();
            if (raw && raw !== String(page)) report(raw, event.currentTarget);
            setInvalid(false);
            event.currentTarget.value = String(page);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setInvalid(false); event.currentTarget.value = String(page); event.currentTarget.blur(); }
          }} />
        <span className={styles.pageTotal}>/ {total ?? "…"}</span>
      </form>
      <Button variant="ghost" size="icon-touch" aria-label="Next page" title="Next page (→)"
        disabled={disabled || !last || page >= last} onClick={() => onNavigate(page + 1)}><ChevronRight /></Button>
    </div>
  );
}

export function RadioChoices<T extends string>({ legend, value, options, onChange }: {
  legend: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className={styles.settingGroup}>
      <legend>{legend}</legend>
      <div className={styles.radioChoices}>
        {options.map((option) => <label key={option.value} className={styles.radioChoice}>
          <input type="radio" name={name} value={option.value} checked={value === option.value}
            onChange={() => onChange(option.value)} />
          <span>{option.label}</span>
        </label>)}
      </div>
    </fieldset>
  );
}

export function KeyboardShortcuts() {
  const shortcuts = [
    ["← / →", "Previous / next page"],
    ["Page Up / Page Down", "Previous / next page"],
    ["+ / −", "Zoom in / out"],
    ["0", "Fit width"],
    ["1", "Actual size"],
    ["T", "Open document navigation"],
    ["/ or Ctrl / ⌘ + F", "Search this document"],
    ["Alt + ←", "Back to previous location"],
    ["B", "Bookmark this page"],
    ["Z", "Toggle focus mode"],
    ["F", "Toggle fullscreen"],
    ["Esc", "Close a panel or exit focus mode"],
    ["?", "Keyboard shortcuts"],
  ];
  return <dl className={styles.shortcutList}>{shortcuts.map(([keys, action]) => (
    <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>
  ))}</dl>;
}
