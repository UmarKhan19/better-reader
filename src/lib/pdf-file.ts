/** The uploader's pre-check and the server's rule; the server re-checks anyway. */
export function isPdf(name: string, contentType?: string | null): boolean {
  return contentType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}
