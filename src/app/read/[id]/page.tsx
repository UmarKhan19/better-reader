import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPdf } from "@/lib/pdf-store";
import { PdfReaderLoader } from "@/components/reader/pdf-reader-loader";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const item = await findPdf(id);
  if (!item) return { title: "Not found, Better Kindle" };
  return { title: `${item.name}, Better Kindle` };
}

export default async function ReadPage({ params }: PageProps) {
  const { id } = await params;
  const item = await findPdf(id);
  if (!item) notFound();
  return <PdfReaderLoader id={item.id} title={item.name} fileSize={item.size} />;
}
