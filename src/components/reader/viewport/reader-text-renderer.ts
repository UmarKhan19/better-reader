export type ReaderTextContext = { pageNumber: number; itemIndex: number };
export type ReaderHighlightText = (text: string, context?: ReaderTextContext) => string;

/** Bind the holder's PDF page, but preserve react-pdf's original text item index. */
export function pageTextRenderer(highlightText: ReaderHighlightText | undefined, pageNumber: number) {
  return highlightText ? ({ str, itemIndex }: { str: string; itemIndex: number }) =>
    highlightText(str, { pageNumber, itemIndex }) : undefined;
}
