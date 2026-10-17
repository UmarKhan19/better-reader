import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { createReadStream, isValidPdfId, pdfFilePath, deletePdf, restorePdf } from "@/lib/pdf-store";
import { isNotModified, mayServeRange, parseByteRange } from "@/lib/pdf-http";

async function servePdf(request: Request, id: string) {
  if (!isValidPdfId(id)) return new Response("Not found", { status: 404 });
  const path = pdfFilePath(id);
  let file;
  try {
    file = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
    throw error;
  }
  const size = file.size;
  // Uploads have immutable UUIDs. Private caching never shares a user's PDF.
  const etag = `"${id}-${size.toString(16)}-${file.mtimeMs.toString(16)}"`;
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${id}.pdf"`,
    "Cache-Control": "private, max-age=3600, must-revalidate",
    "Accept-Ranges": "bytes",
    "ETag": etag,
    "Last-Modified": file.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };

  if (isNotModified(request.headers, etag, file.mtimeMs)) {
    return new Response(null, { status: 304, headers });
  }
  const range = request.method !== "HEAD" && mayServeRange(request.headers, etag, file.mtimeMs)
    ? parseByteRange(request.headers.get("range"), size) : null;
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const status = range ? 206 : 200;
  const length = range ? range.end - range.start + 1 : size;
  headers["Content-Length"] = String(length);
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const stream = createReadStream(path, { ...(range ?? {}), signal: request.signal });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return servePdf(request, (await context.params).id);
}

export async function HEAD(request: Request, context: Context) {
  return servePdf(request, (await context.params).id);
}

export async function DELETE(_request: Request, context: Context) {
  const ok = await deletePdf((await context.params).id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Brings a deleted PDF back into the library (undo delete). */
export async function POST(request: Request, context: Context) {
  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "restore") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const item = await restorePdf((await context.params).id);
    if (!item) return NextResponse.json({ error: "Nothing to restore" }, { status: 404 });
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }
}
