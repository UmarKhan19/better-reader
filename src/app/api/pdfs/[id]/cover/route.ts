import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { forbiddenHost } from "@/lib/host-guard";
import { isValidPdfId, resolveCoverFilePath, saveCover, deleteCover } from "@/lib/pdf-store";
import { isNotModified } from "@/lib/pdf-http";

type Context = { params: Promise<{ id: string }> };

// Every stored cover passed the byte-level image check in pdf-store, so the file
// extension is trustworthy. Anything else is served as a download, never as a
// type a browser would execute.
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

function mimeForPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function baseFileName(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}

async function serveCover(request: Request, id: string) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  if (!isValidPdfId(id)) return new Response("Not found", { status: 404 });
  const filePath = await resolveCoverFilePath(id);
  if (!filePath) return new Response("Not found", { status: 404 });
  let file;
  try {
    file = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
    throw error;
  }
  const etag = `"${baseFileName(filePath)}-${file.size.toString(16)}-${file.mtimeMs.toString(16)}"`;
  const headers: Record<string, string> = {
    "Content-Type": mimeForPath(filePath),
    "Cache-Control": "private, max-age=3600, must-revalidate",
    "ETag": etag,
    "Last-Modified": file.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  if (isNotModified(request.headers, etag, file.mtimeMs)) {
    return new Response(null, { status: 304, headers });
  }
  headers["Content-Length"] = String(file.size);
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const stream = createReadStream(filePath);
  request.signal.addEventListener("abort", () => stream.destroy());
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}

export async function GET(request: Request, context: Context) {
  return serveCover(request, (await context.params).id);
}

export async function HEAD(request: Request, context: Context) {
  return serveCover(request, (await context.params).id);
}

export async function POST(request: Request, context: Context) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  const id = (await context.params).id;
  try {
    const contentType = request.headers.get("content-type") || "";
    let file: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const candidates = [
        formData.get("cover"),
        formData.get("file"),
        formData.get("image"),
        formData.get("thumbnail"),
        formData.get("coverImage"),
        formData.get("data"),
      ].filter((value): value is File => value instanceof File);
      if (candidates.length === 0) {
        const all = formData.getAll("files").filter((value): value is File => value instanceof File);
        if (all.length) candidates.push(...all);
      }
      file = candidates[0] ?? null;
    } else {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > 0) {
        file = new File([buffer], "cover", { type: contentType.split(";")[0].trim() || "application/octet-stream" });
      }
    }
    if (!file) {
      return NextResponse.json({ error: "No cover image provided" }, { status: 400 });
    }
    const result = await saveCover(id, file);
    if (!result.ok) {
      return result.reason === "unsupported"
        ? NextResponse.json({ error: "Unsupported cover image. Use PNG, JPEG, WebP, GIF, AVIF or BMP." }, { status: 400 })
        : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ item: result.item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Cover upload failed" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Context) {
  return POST(request, context);
}

export async function DELETE(request: Request, context: Context) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  const id = (await context.params).id;
  if (!isValidPdfId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = await deleteCover(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
