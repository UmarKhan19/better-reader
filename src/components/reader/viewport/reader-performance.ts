export const READER_MARKS = {
  firstPage: "reader:first-page",
  pageRequest: "reader:page-request",
  pageTurn: "reader:page-turn",
  zoomRequest: "reader:zoom-request",
  zoomSettled: "reader:zoom-settled",
} as const;

export function markReader(name: string, detail?: unknown) {
  performance.clearMarks(name);
  if (detail === undefined) performance.mark(name);
  else performance.mark(name, { detail });
}

export function boundedMeasure(name: string, start: number) {
  performance.clearMeasures(name);
  performance.measure(name, { start, end: performance.now() });
}
