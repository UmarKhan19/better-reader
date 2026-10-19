"use client";

import { useEffect, useRef, useState } from "react";
import { Page } from "react-pdf";
import type { PageProps } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readerRenderQueue, type RenderPriority, type RenderTicket } from "./reader-render-scheduler";

export type ScheduledPdfPageProps = Omit<PageProps, "pdf"> & { pdf: PDFDocumentProxy; priority: RenderPriority };
const documents = new WeakMap<PDFDocumentProxy, number>();
let nextDocument = 0;
function documentKey(pdf: PDFDocumentProxy) {
  if (!documents.has(pdf)) documents.set(pdf, ++nextDocument);
  return documents.get(pdf);
}

function QueuedPage({ priority, ...props }: ScheduledPdfPageProps) {
  const [permitted, setPermitted] = useState(false);
  const ticket = useRef<RenderTicket | null>(null);
  useEffect(() => {
    const permit = readerRenderQueue.schedule(priority, () => {
      setPermitted(true);
      if (!(props.pageNumber ?? (props.pageIndex == null ? 0 : props.pageIndex + 1))) permit.release();
    });
    ticket.current = permit;
    return () => { permit.cancel(); ticket.current = null; };
    // Priority changes update the queued ticket without restarting a canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { ticket.current?.setPriority(priority); }, [priority]);
  if (!permitted) return typeof props.loading === "function" ? props.loading() : (props.loading ?? null);
  return <Page {...props}
    onRenderSuccess={(page) => { ticket.current?.release(); props.onRenderSuccess?.(page); }}
    onRenderError={(error) => { ticket.current?.release(); props.onRenderError?.(error); }}
    onLoadError={(error) => { ticket.current?.release(); props.onLoadError?.(error); }}
    onLoadSuccess={(page) => {
      if (props.renderMode === "none") ticket.current?.release();
      props.onLoadSuccess?.(page);
    }} />;
}

/** Shared by full pages, previews and thumbnails. A new raster identity gets a new permit. */
export function ScheduledPdfPage(props: ScheduledPdfPageProps) {
  const key = [documentKey(props.pdf), props.pageNumber ?? `i${props.pageIndex ?? 0}`,
    props.width, props.height, props.scale, props.rotate, props.devicePixelRatio, props.renderMode,
    props.canvasBackground, props.renderForms, props.pageColors?.background, props.pageColors?.foreground].join(":");
  return <QueuedPage key={key} {...props} />;
}
