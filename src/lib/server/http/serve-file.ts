import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { isNotModified, mayServeRange, parseByteRange } from "@/lib/server/http/pdf-http";

export type ServeFileOptions = {
  filePath: string;
  contentType: string;
  headers?: Record<string, string>;
  range?: boolean;
  etag?: (file: { size: number; mtimeMs: number }, filePath: string) => string;
};

export async function serveFile(request: Request, options: ServeFileOptions): Promise<Response> {
  const { filePath, contentType, range = false } = options;
  let file;
  try {
    file = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
    throw error;
  }
  const etag = options.etag
    ? options.etag({ size: file.size, mtimeMs: file.mtimeMs }, filePath)
    : `"${file.size.toString(16)}-${file.mtimeMs.toString(16)}"`;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...(options.headers ?? {}),
    "ETag": etag,
    "Last-Modified": file.mtime.toUTCString(),
  };

  if (isNotModified(request.headers, etag, file.mtimeMs)) {
    return new Response(null, { status: 304, headers });
  }

  const size = file.size;
  let rangeResult: ReturnType<typeof parseByteRange> = null;
  if (range && request.method !== "HEAD" && mayServeRange(request.headers, etag, file.mtimeMs)) {
    rangeResult = parseByteRange(request.headers.get("range"), size);
  }
  if (rangeResult === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const status = rangeResult ? 206 : 200;
  const length = rangeResult ? rangeResult.end - rangeResult.start + 1 : size;
  headers["Content-Length"] = String(length);
  if (rangeResult) headers["Content-Range"] = `bytes ${rangeResult.start}-${rangeResult.end}/${size}`;

  if (request.method === "HEAD") return new Response(null, { status, headers });

  const stream = createReadStream(filePath, rangeResult ? { start: rangeResult.start, end: rangeResult.end } : {});
  request.signal.addEventListener("abort", () => stream.destroy());
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}
