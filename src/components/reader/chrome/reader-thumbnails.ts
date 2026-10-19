export const THUMBNAIL_ROW_HEIGHT = 184;

export function thumbnailWindow(pageCount: number, scrollTop: number, height: number) {
  const rows = Math.ceil(Math.max(0, pageCount) / 2);
  const top = Math.max(0, scrollTop);
  const start = Math.max(0, Math.min(rows, Math.floor(top / THUMBNAIL_ROW_HEIGHT) - 2));
  const end = Math.min(rows, Math.ceil((top + Math.max(1, height)) / THUMBNAIL_ROW_HEIGHT) + 2);
  return { start, end, rows };
}
