"use client";

import dynamic from "next/dynamic";

const PdfReader = dynamic(() => import("./pdf-reader").then((m) => m.PdfReader), {
  ssr: false,
  loading: () => <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground" role="status">Opening reader…</div>,
});

export function PdfReaderLoader({ id, title, fileSize }: { id: string; title: string; fileSize?: number }) {
  return <PdfReader key={id} id={id} title={title} fileSize={fileSize} />;
}
