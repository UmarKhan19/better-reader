import type { PDFDocumentProxy } from "pdfjs-dist";

const pdfKeys = new WeakMap<PDFDocumentProxy, number>();
let nextPdfKey = 0;

export function getPdfKey(pdf: PDFDocumentProxy): number {
  if (!pdfKeys.has(pdf)) pdfKeys.set(pdf, ++nextPdfKey);
  return pdfKeys.get(pdf)!;
}

export function lowResourceDevice() {
  const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  return Boolean((device.deviceMemory && device.deviceMemory <= 4) || device.connection?.saveData || /(^|-)2g$/.test(device.connection?.effectiveType ?? ""));
}

export function boundedMeasure(name: string, start: number) {
  performance.clearMeasures(name); performance.measure(name, { start, end: performance.now() });
}

export function stagePosition(stage: HTMLElement, scroller: HTMLElement) {
  const box = stage.getBoundingClientRect(), scroll = scroller.getBoundingClientRect();
  return { top: box.top - scroll.top + scroller.scrollTop - scroller.clientTop,
    left: box.left - scroll.left + scroller.scrollLeft - scroller.clientLeft };
}
