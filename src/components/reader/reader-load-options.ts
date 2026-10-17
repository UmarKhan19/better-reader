import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

// PDF.js 6.3 api.d.ts: disableAutoFetch only works with streaming disabled.
// A stable object also prevents react-pdf Document from restarting on re-render.
export const PDF_DOCUMENT_OPTIONS = Object.freeze({
  disableRange: false,
  disableStream: true,
  disableAutoFetch: true,
  rangeChunkSize: 65_536,
} satisfies DocumentInitParameters);

// Small documents avoid the extra round trips of on-demand object/font ranges.
export const SMALL_PDF_LIMIT = 1_048_576;
export const STREAMED_PDF_OPTIONS = Object.freeze({
  ...PDF_DOCUMENT_OPTIONS,
  disableStream: false,
  disableAutoFetch: false,
} satisfies DocumentInitParameters);

export function optionsForPdfSize(bytes?: number) {
  return typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0 && bytes <= SMALL_PDF_LIMIT
    ? STREAMED_PDF_OPTIONS : PDF_DOCUMENT_OPTIONS;
}
