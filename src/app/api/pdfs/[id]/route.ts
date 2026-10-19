import { NextResponse } from "next/server";
import { forbiddenHost } from "@/lib/server/http/host-guard";
import { isValidPdfId, pdfFilePath, deletePdf, restorePdf } from "@/lib/server/pdf-store";
import { serveFile } from "@/lib/server/http/serve-file";
import { queueBookIndex } from "@/lib/server/book-index";

async function servePdf(request: Request, id: string) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  if (!isValidPdfId(id)) return new Response("Not found", { status: 404 });
  const filePath = pdfFilePath(id);
  return serveFile(request, {
    filePath,
    contentType: "application/pdf",
    range: true,
    headers: {
      "Content-Disposition": `inline; filename="${id}.pdf"`,
      "Cache-Control": "private, max-age=3600, must-revalidate",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    },
    etag: ({ size, mtimeMs }) => `"${id}-${size.toString(16)}-${mtimeMs.toString(16)}"`,
  });
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return servePdf(request, (await context.params).id);
}

export async function HEAD(request: Request, context: Context) {
  return servePdf(request, (await context.params).id);
}

export async function DELETE(request: Request, context: Context) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  const ok = await deletePdf((await context.params).id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Brings a deleted PDF back into the library (undo delete). */
export async function POST(request: Request, context: Context) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "restore") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const item = await restorePdf((await context.params).id);
    if (!item) return NextResponse.json({ error: "Nothing to restore" }, { status: 404 });
    queueBookIndex(item.id);
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }
}
