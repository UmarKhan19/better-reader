import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream, isValidPdfId } from "@/lib/pdf-store";
import { Readable } from "node:stream";
import { resolveCoverFilePath, saveCover, deleteCover, listPdfs } from "@/lib/pdf-store";

type Context = { params: Promise<{ id: string }> };

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

function mimeForPath(filePath: string, fallback?: string | null): string {
  if (fallback) return fallback;
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

async function serveCover(request: Request, id: string) {
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
  const items = await listPdfs().catch(() => []);
  const item = items.find((entry) => entry.id === id);
  const contentType = mimeForPath(filePath, item?.coverMimeType ?? null);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600, must-revalidate",
    "Content-Length": String(file.size),
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const stream = createReadStream(filePath, { signal: request.signal });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}

export async function GET(request: Request, context: Context) {
  return serveCover(request, (await context.params).id);
}

export async function HEAD(request: Request, context: Context) {
  return serveCover(request, (await context.params).id);
}

export async function POST(request: Request, context: Context) {
  const id = (await context.params).id;
  if (!isValidPdfId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    const item = await saveCover(id, file);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Cover upload failed" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Context) {
  return POST(request, context);
}

export async function DELETE(_request: Request, context: Context) {
  const id = (await context.params).id;
  if (!isValidPdfId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = await deleteCover(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}