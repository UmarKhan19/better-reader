import { NextResponse } from "next/server";
import { deletePdf, listPdfs, saveCover, savePdf } from "@/lib/pdf-store";

export type SkippedFile = { name: string; reason: string };

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Turns a storage error into a reason a user can act on instead of "couldn't be saved". */
function saveFailureReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC") return "couldn't be saved (no space left on the server)";
  if (code === "EACCES" || code === "EPERM") return "couldn't be saved (server permission denied)";
  if (code === "EMFILE" || code === "ENFILE") return "couldn't be saved (server is busy, try again)";
  return "couldn't be saved (unexpected server error)";
}

export async function GET() {
  const items = await listPdfs();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files: File[] = [];

    const single = formData.get("file");
    if (single instanceof File) files.push(single);

    for (const entry of formData.getAll("files")) {
      if (entry instanceof File) files.push(entry);
    }

    const covers: File[] = [];
    for (const key of ["cover", "image", "thumbnail", "coverImage"]) {
      const value = formData.get(key);
      if (value instanceof File) covers.push(value);
    }
    for (const key of ["covers", "images", "thumbnails"]) {
      for (const entry of formData.getAll(key)) {
        if (entry instanceof File) covers.push(entry);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No PDF file provided", items: [], skipped: [] },
        { status: 400 },
      );
    }

    // Every file gets its own result: one rejected file must not hide the ones already saved.
    const items = [];
    const skipped: SkippedFile[] = [];
    let coverCursor = 0;
    for (const file of files) {
      const name = file.name || "Unnamed file";
      if (!isPdf(file)) {
        skipped.push({ name, reason: "not a PDF" });
        continue;
      }
      try {
        const saved = await savePdf(file);
        let finalItem = saved;
        if (covers.length > 0) {
          const cover = covers.length === 1 ? covers[0] : covers[coverCursor];
          coverCursor += 1;
          if (cover) {
            const withCover = await saveCover(saved.id, cover).catch(() => null);
            if (withCover) finalItem = withCover;
          }
        }
        items.push(finalItem);
      } catch (error) {
        skipped.push({ name, reason: saveFailureReason(error) });
      }
    }

    if (items.length === 0) {
      return NextResponse.json(
        { error: "No files were uploaded", items, skipped },
        { status: 400 },
      );
    }

    return NextResponse.json({ items, skipped }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Upload failed", items: [], skipped: [] },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const ok = await deletePdf(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
