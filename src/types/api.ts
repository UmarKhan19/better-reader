import type { PdfItem } from "./pdf";

/**
 * Wire shape for PDF responses. `coverFileName` is legacy disk metadata that the
 * store still emits; browser code must read `coverUrl` instead.
 */
export type PdfWireItem = PdfItem & { coverFileName?: string };

export type ApiError = { error: string };
export type OkResponse = { ok: true };
export type PdfListResponse = { items: PdfWireItem[] };
export type PdfMutationResponse = { item: PdfWireItem };
