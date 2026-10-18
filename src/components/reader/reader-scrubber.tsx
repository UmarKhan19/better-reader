"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BookOpen } from "lucide-react";
import { ScheduledPdfPage } from "./reader-render-queue";
import { readingProgress } from "./reader-state";
import { beginScrub, chapterMarkers, finishScrub, previewScrub, type ScrubSession } from "./reader-scrubber-state";
import { activeChapter } from "./reader-state";
import type { OutlineEntry } from "./reader-sidebar";
import styles from "./reader-scrubber.module.css";

const rangeKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function ReaderScrubber({ pdf, page, progress, outline, onCommit, hidden, pageColors }: {
  pdf: PDFDocumentProxy;
  page: number;
  progress: number;
  outline: OutlineEntry[] | null;
  onCommit: (page: number) => void;
  hidden: boolean;
  pageColors?: { background: string; foreground: string } | null;
}) {
  const session = useRef<ScrubSession>({ active: false, draft: page });
  const [draft, setDraft] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const total = pdf.numPages;
  const shown = draft ?? page;
  const seekProgress = readingProgress({ page: shown, offset: 0 }, total);
  const shownProgress = draft === null ? progress : seekProgress;
  const chapter = activeChapter(outline, shown)?.title ?? null;
  const markers = useMemo(() => chapterMarkers(outline, total), [outline, total]);

  useEffect(() => {
    if (draft === null || hidden) return;
    const timer = setTimeout(() => setPreview(draft), 180);
    return () => clearTimeout(timer);
  }, [draft, hidden]);

  function start() {
    if (!session.current.active) {
      session.current = beginScrub(page, total);
      setDraft(session.current.draft);
    }
  }

  function finish(accepted: boolean) {
    const result = finishScrub(session.current, accepted);
    session.current = result.session;
    setDraft(null);
    setPreview(null);
    if (result.page !== null) onCommit(result.page);
  }

  return <section className={styles.scrubber} aria-label="Chapter seek" data-reader-chrome inert={hidden} hidden={hidden}>
    <div className={styles.label}><BookOpen size={14} aria-hidden="true" /><span>{chapter ?? "Seek in document"}</span></div>
    <div className={styles.track}>
      <div className={styles.rail} aria-hidden="true"><span style={{ transform: `scaleX(${seekProgress / 100})` }} /></div>
      <div className={styles.markers} aria-hidden="true">{markers.map((marker) =>
        <i key={marker.page} style={{ insetInlineStart: `${marker.fraction * 100}%` }} />)}</div>
      <input type="range" min={1} max={total} step={1} value={shown} aria-label="Seek to page"
        aria-valuetext={`Page ${shown} of ${total}${chapter ? `, ${chapter}` : ""}`}
        onPointerDown={(event) => { start(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (session.current.active) {
            session.current = previewScrub(session.current, next, total);
            setDraft(session.current.draft);
          } else onCommit(next);
        }}
        onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)}
        onLostPointerCapture={() => { if (session.current.active) finish(false); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); finish(false); }
          else if (rangeKeys.has(event.key)) start();
        }}
        onKeyUp={(event) => { if (rangeKeys.has(event.key)) finish(true); }}
        onBlur={() => { if (session.current.active) finish(false); }} />
    </div>
    <output className={styles.position} aria-label="Reading position">
      <span className={styles.pageCount}>Page {shown}<span> / {total}</span></span>
      <span className={styles.percent}>{shownProgress}%</span>
    </output>
    {draft !== null && <div className={styles.preview} aria-hidden="true">
      {preview === draft ? <ScheduledPdfPage key={draft} pdf={pdf} priority={2} pageNumber={draft} width={120}
        devicePixelRatio={1} renderTextLayer={false} renderAnnotationLayer={false} suspense={false}
        pageColors={pageColors ?? undefined}
        loading={<span>Loading preview…</span>} error={<span>No preview</span>} /> : <span>Page {draft}</span>}
      <span>Page {draft}</span>
    </div>}
  </section>;
}
