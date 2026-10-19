import { clampPage } from "@/lib/reading-progress";

type Chapter = { title: string; page: number | null };
export type ScrubSession = { draft: number; active: boolean };

export function beginScrub(page: number, total: number): ScrubSession {
  return { draft: clampPage(page, total), active: true };
}

export function previewScrub(session: ScrubSession, page: number, total: number): ScrubSession {
  return session.active ? { ...session, draft: clampPage(page, total) } : session;
}

// Consuming the session before invoking navigation makes pointerup/keyup duplicates harmless.
export function finishScrub(session: ScrubSession, accepted: boolean) {
  return { session: { ...session, active: false }, page: session.active && accepted ? session.draft : null };
}

export function chapterMarkers(outline: readonly Chapter[] | null, total: number) {
  const pages = [...new Set(outline?.map((entry) => entry.page)
    .filter((page): page is number => page !== null && page >= 1 && page <= total) ?? [])].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(pages.length / 64));
  return pages.filter((_, index) => index % step === 0).map((page) => ({ page, fraction: (page - 1) / Math.max(1, total - 1) }));
}
