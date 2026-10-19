"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ScheduledPdfPage } from "../viewport/reader-render-queue";
import { THUMBNAIL_ROW_HEIGHT, thumbnailWindow } from "./reader-thumbnails";
import type { PdfPageColors } from "../reader-preferences";
import styles from "./reader-chrome.module.css";

const Thumbnail = memo(function Thumbnail({
  pdf, page, current, onNavigate, onKeyDown, pageColors,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  current: boolean;
  onNavigate: (page: number) => void;
  onKeyDown: (event: React.KeyboardEvent, page: number) => void;
  pageColors?: PdfPageColors;
}) {
  return (
    <button type="button" className={styles.thumbnail} data-thumb-page={page}
      aria-label={`Go to page ${page}`} aria-current={current ? "page" : undefined}
      onClick={() => onNavigate(page)} onKeyDown={(event) => onKeyDown(event, page)}>
      <span className={styles.thumbnailImage}>
        <ScheduledPdfPage pdf={pdf} priority={2} pageNumber={page} width={104} devicePixelRatio={1}
          pageColors={pageColors ?? undefined}
          renderTextLayer={false} renderAnnotationLayer={false} suspense={false}
          loading={<span className={styles.thumbnailSkeleton} aria-hidden="true"><i /><i /><i /></span>}
          error={<span className={styles.thumbnailLoading}>No preview</span>} />
      </span>
      <span className={styles.thumbnailNumber}>{page}</span>
    </button>
  );
});

export function ThumbnailList({ pdf, total, current, onNavigate, pageColors }: {
  pdf: PDFDocumentProxy; total: number; current: number; onNavigate: (page: number) => void;
  pageColors?: PdfPageColors;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 480 });
  const [focusPage, setFocusPage] = useState<number | null>(null);
  const windowed = thumbnailWindow(total, viewport.top, viewport.height);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setViewport({ top: node.scrollTop, height: node.clientHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const top = Math.floor((current - 1) / 2) * THUMBNAIL_ROW_HEIGHT;
    if (top < node.scrollTop || top + THUMBNAIL_ROW_HEIGHT > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.max(0, top - (node.clientHeight - THUMBNAIL_ROW_HEIGHT) / 2);
    }
  }, [current]);

  useLayoutEffect(() => {
    if (focusPage !== null) {
      ref.current?.querySelector<HTMLButtonElement>(`[data-thumb-page="${focusPage}"]`)?.focus();
    }
  }, [focusPage, windowed.start, windowed.end]);

  function onThumbnailKey(event: React.KeyboardEvent, page: number) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
    let next = page;
    if (event.key in offsets) next += offsets[event.key];
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = total;
    else return;
    event.preventDefault();
    next = Math.max(1, Math.min(total, next));
    const node = ref.current;
    if (!node) return;
    const top = Math.floor((next - 1) / 2) * THUMBNAIL_ROW_HEIGHT;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + THUMBNAIL_ROW_HEIGHT > node.scrollTop + node.clientHeight) {
      node.scrollTop = top + THUMBNAIL_ROW_HEIGHT - node.clientHeight;
    }
    setViewport({ top: node.scrollTop, height: node.clientHeight });
    setFocusPage(next);
  }

  return (
    <div ref={ref} className={styles.thumbnailList} data-thumbnail-list tabIndex={0}
      role="region" aria-label="Page thumbnails"
      onScroll={(event) => {
        const node = event.currentTarget;
        setViewport({ top: node.scrollTop, height: node.clientHeight });
      }}>
      <div className={styles.thumbnailSpacer} style={{ height: windowed.rows * THUMBNAIL_ROW_HEIGHT }}>
        {Array.from({ length: Math.max(0, windowed.end - windowed.start) }, (_, index) => {
          const row = windowed.start + index;
          return (
            <div key={row} className={styles.thumbnailRow} style={{ top: row * THUMBNAIL_ROW_HEIGHT }}>
              {[row * 2 + 1, row * 2 + 2].filter((n) => n <= total).map((n) => (
                <Thumbnail key={n} pdf={pdf} page={n} current={n === current} onNavigate={onNavigate} onKeyDown={onThumbnailKey} pageColors={pageColors} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
