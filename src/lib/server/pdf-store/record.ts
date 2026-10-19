import type { PdfItem } from "@/types/pdf";

export type StoredPdfRecord = PdfItem & {
  coverFileName?: string;
};
