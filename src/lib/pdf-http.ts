export type ByteRange = { start: number; end: number };

export function parseByteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header || !header.toLowerCase().startsWith("bytes=") || header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return "unsatisfiable";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
    start < 0 || start >= size || end < start) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

function timestampMatches(header: string, modified: number) {
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) && timestamp >= Math.floor(modified / 1000) * 1000;
}

export function isNotModified(headers: Headers, etag: string, modified: number) {
  const match = headers.get("if-none-match");
  if (match !== null) {
    return match.split(",").some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag);
  }
  const since = headers.get("if-modified-since");
  return since !== null && timestampMatches(since, modified);
}

export function mayServeRange(headers: Headers, etag: string, modified: number) {
  const condition = headers.get("if-range");
  if (condition === null) return true;
  return condition === etag || (!condition.startsWith('"') && !condition.startsWith("W/") && timestampMatches(condition, modified));
}
