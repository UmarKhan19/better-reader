import { NextResponse } from "next/server";
import { forbiddenHost } from "@/lib/host-guard";
import { listPdfs, savePdf } from "@/lib/pdf-store";

/** The uploader sends the file bytes as the raw body; the name travels in a header. */
function uploadName(header: string | null): string {
  if (!header) return "";
  try {
    return decodeURIComponent(header);
  } catch {
    return "";
  }
}

function isPdf(name: string, contentType: string | null) {
  return contentType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

/** Turns a storage error into a reason a user can act on instead of "couldn't be saved". */
function saveFailureReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC") return "couldn't be saved (no space left on the server)";
  if (code === "EACCES" || code === "EPERM") return "couldn't be saved (server permission denied)";
  if (code === "EMFILE" || code === "ENFILE") return "couldn't be saved (server is busy, try again)";
  return "couldn't be saved (unexpected server error)";
}

export async function GET(request: Request) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  const items = await listPdfs();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const forbidden = forbiddenHost(request);
  if (forbidden) return forbidden;
  const name = uploadName(request.headers.get("x-file-name"));
  if (!request.body || !isPdf(name, request.headers.get("content-type"))) {
    return NextResponse.json({ error: "not a PDF" }, { status: 400 });
  }
  try {
    const item = await savePdf(request.body, name);
    return NextResponse.json({ items: [item] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: saveFailureReason(error) }, { status: 500 });
  }
}
