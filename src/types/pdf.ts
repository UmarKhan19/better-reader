export type PdfItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  // Optional cover image metadata. `coverUrl` is the stable URL served by
  // /api/pdfs/[id]/cover; the boolean aliases make presence checks easy.
  hasCover?: boolean;
  cover?: string;
  coverImage?: string;
  coverUrl?: string;
  coverPath?: string;
  coverFileName?: string;
  coverMimeType?: string;
  coverExt?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
};
