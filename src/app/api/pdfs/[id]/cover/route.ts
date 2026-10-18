import { NextResponse } from "next/server";
import { forbiddenHost } from "@/lib/host-guard";
import { COVER_MAX_BYTES, isValidPdfId, resolveCoverFilePath, saveCover, deleteCover } from "@/lib/pdf-store";
import { serveFile } from "@/lib/serve-file";

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
  return serveFile(request, {
    filePath,
    contentType: mimeForPath(filePath),
    headers: {
      "Cache-Control": "private, max-age=3600, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
    etag: ({ size, mtimeMs }) => `"${baseFileName(filePath)}-${size.toString(16)}-${mtimeMs.toString(16)}"`,
  });
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
    const isMultipart = contentType.includes("multipart/form-data");
    if (!isMultipart) {
      const declared = Number(request.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > COVER_MAX_BYTES) {
        return NextResponse.json({ error: "Cover image is too large. Use an image under 10 MB." }, { status: 413 });
      }
    }
    let file: File | null = null;
    if (isMultipart) {
      const formData = await request.formData();
      const candidate = formData.get("cover");
      file = candidate instanceof File ? candidate : null;
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
      if (result.reason === "unsupported") {
        return NextResponse.json({ error: "Unsupported cover image. Use PNG, JPEG, WebP, GIF, AVIF or BMP." }, { status: 400 });
      }
      if (result.reason === "too-large") {
        return NextResponse.json({ error: "Cover image is too large. Use an image under 10 MB." }, { status: 413 });
      }
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ item: result.item }, { status: 201 });
  } catch (error) {
    console.error("Cover upload failed", error);
    return NextResponse.json({ error: "Cover upload failed" }, { status: 500 });
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
