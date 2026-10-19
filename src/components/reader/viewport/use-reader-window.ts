"use client";

import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Size } from "./reader-geometry";
import type { ViewMode } from "../reader-preferences";
import { adjacentWindowPage, pageWindow, readerGeometry, type CropBox, type PageBox, type ReaderGeometry } from "./reader-geometry";
import { planReaderWindow } from "./reader-render-window";
import { rasterFrame, retainedPageWindow } from "./reader-render-state";

const NO_CROPS = new Map<number, CropBox>();

export function useReaderWindow({
  pdf, available, geometry, view, active, statuses, crops, sizes, viewMode, zoom, cropMargins, lowResource,
}: {
  pdf: PDFDocumentProxy;
  available: Size;
  geometry: ReaderGeometry;
  view: { top: number; left: number; width: number; height: number; direction: number };
  active: number;
  statuses: Map<number, { identity: string; busy: boolean; readable: boolean; ready: boolean }>;
  crops: Map<number, CropBox>;
  sizes: Map<number, Size>;
  viewMode: ViewMode;
  zoom: number;
  cropMargins: boolean;
  lowResource: boolean;
}) {
  const [turn, setTurn] = useState({ page: active, direction: 1 });
  if (turn.page !== active) setTurn({ page: active, direction: active > turn.page ? 1 : -1 });

  const [lastReadablePages, setLastReadablePages] = useState<PageBox[]>([]);

  const numbers = available.width > 0 && available.height > 0 ? pageWindow(geometry, view.top, view.height, view.direction, lowResource) : [];

  const targetBoxes = geometry.pages.filter((box) => numbers.includes(box.page));
  const deviceRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const targetPlan = planReaderWindow(targetBoxes, { top: view.top, left: view.left, width: view.width, height: view.height }, active, deviceRatio, lowResource);
  const visibleTargets = targetPlan.filter((entry) => entry.priority === 0);
  const currentStatus = statuses.get(active);
  const cropPending = cropMargins && visibleTargets.some(({ box }) => !crops.has(box.page));
  const busy = cropPending || !targetPlan.some((entry) => entry.box.page === active) || visibleTargets.some(({ box, allocation }) => {
    const status = statuses.get(box.page);
    return status?.identity !== rasterFrame(box, allocation.ratio).key || status.busy;
  });
  const readable = Boolean(currentStatus?.readable);
  const settled = !busy && Boolean(currentStatus?.ready) && visibleTargets.every(({ box }) => statuses.get(box.page)?.ready);

  if (geometry.layout === "continuous" && lastReadablePages.length) setLastReadablePages([]);
  else if (geometry.layout !== "continuous" && readable && lastReadablePages !== geometry.pages) setLastReadablePages(geometry.pages);
  const retained = geometry.layout !== "continuous" && !readable ? retainedPageWindow(lastReadablePages, geometry.pages) : [];

  const nextPage = adjacentWindowPage(geometry.pages, turn.direction, pdf.numPages);
  const prefetch = geometry.layout !== "continuous" && settled && !lowResource && nextPage !== null
    ? readerGeometry({ total: pdf.numPages, active: nextPage, layout: geometry.layout, available, mode: viewMode, zoom, sizes,
        crops: cropMargins ? crops : NO_CROPS }).pages.filter((box) => !numbers.includes(box.page)).slice(turn.direction < 0 ? -1 : 0, turn.direction < 0 ? undefined : 1)
    : [];
  const renderPlan = planReaderWindow([...targetBoxes, ...prefetch], { top: view.top, left: view.left, width: view.width, height: view.height }, active, deviceRatio, lowResource, prefetch.map((box) => box.page))
    .filter((entry) => entry.priority === 0 || settled);
  const renderBoxes = [...renderPlan.map((entry) => entry.box), ...retained];

  return { numbers, busy, readable, settled, retained, renderPlan, renderBoxes };
}
