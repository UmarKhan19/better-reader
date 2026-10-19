"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./reader-chrome.module.css";

export type PageControlsProps = {
  page: number; pageCount: number | null; onNavigate: (page: number) => void; onSeek?: (page: number) => void;
  disabled?: boolean; onMessage?: (message: string) => void;
};

export function PageControls({ page, pageCount, onNavigate, onSeek = onNavigate, disabled = false, onMessage }: PageControlsProps) {
  const [invalid, setInvalid] = useState(false);
  const last = pageCount ?? null;
  const hint = last ? `Enter a page number between 1 and ${last}, then press Enter.` : "Enter a page number and press Enter.";
  const report = (raw: string, input: HTMLInputElement) => {
    const digits = raw.trim();
    if (digits && /^\d+$/.test(digits)) return Number(digits);
    setInvalid(true);
    onMessage?.(`"${digits || "Nothing"}" isn't a page number. ${hint}`);
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
        <span className={styles.pageLabel} aria-hidden="true">Page</span>
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
        <span className={styles.pageTotal}>/ {pageCount ?? "…"}</span>
      </form>
      <Button variant="ghost" size="icon-touch" aria-label="Next page" title="Next page (→)"
        disabled={disabled || !last || page >= last} onClick={() => onNavigate(page + 1)}><ChevronRight /></Button>
    </div>
  );
}
