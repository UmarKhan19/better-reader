export type PdfItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  // Canonical cover metadata. `coverUrl` is the stable URL served by
  // /api/pdfs/[id]/cover; `coverFileName` and `coverVersion` are server details.
  hasCover?: boolean;
  coverUrl?: string;
  coverFileName?: string;
  coverVersion?: string;
};
