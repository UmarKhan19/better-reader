export type PdfItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  // Canonical cover URL served by /api/pdfs/[id]/cover.
  hasCover?: boolean;
  coverUrl?: string;
};
