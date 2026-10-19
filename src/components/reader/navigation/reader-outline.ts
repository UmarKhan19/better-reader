"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type OutlineEntry = { id: string; title: string; depth: number; page: number | null; url?: string };

/** The last destination at or before this page, shared by navigation and chapter seek. */
export function activeChapter<T extends { page: number | null }>(outline: readonly T[] | null, pageNumber: number): T | null {
  return outline?.reduce<T | null>((active, entry) =>
    entry.page !== null && entry.page <= pageNumber &&
      (active?.page == null || entry.page >= active.page) ? entry : active,
  null) ?? null;
}

type OutlineNode = {
  title: string;
  dest?: string | unknown[] | null;
  url?: string | null;
  items?: OutlineNode[];
};

type YieldTask = () => void | Promise<void>;

function yieldTaskOrDefault(yieldTask?: YieldTask): () => Promise<void> {
  return async () => {
    if (yieldTask) await yieldTask();
    else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
}

export async function resolveOutline(
  pdf: PDFDocumentProxy,
  isCancelled: () => boolean,
  yieldTask?: YieldTask,
): Promise<OutlineEntry[]> {
  const yieldNow = yieldTaskOrDefault(yieldTask);
  const nodes: { node: OutlineNode; depth: number }[] = [];
  const roots = ((await pdf.getOutline()) ?? []) as OutlineNode[];
  if (isCancelled()) return [];
  const stack = roots.map((node) => ({ node, depth: 0 })).reverse();
  while (stack.length && !isCancelled()) {
    const entry = stack.pop()!;
    nodes.push(entry);
    for (let i = (entry.node.items?.length ?? 0) - 1; i >= 0; i--) {
      stack.push({ node: entry.node.items![i], depth: entry.depth + 1 });
    }
    if (nodes.length % 128 === 0) await yieldNow();
  }
  const entries: OutlineEntry[] = [];
  for (let start = 0; start < nodes.length && !isCancelled(); start += 8) {
    const batch = nodes.slice(start, start + 8);
    const resolved = await Promise.all(batch.map(async ({ node, depth }, i) => {
      let page: number | null = null;
      try {
        if (isCancelled()) return { id: String(start + i), title: node.title, depth, page };
        const destination = typeof node.dest === "string"
          ? await pdf.getDestination(node.dest) : node.dest;
        if (isCancelled()) return { id: String(start + i), title: node.title, depth, page };
        const ref = (destination as unknown[] | null | undefined)?.[0];
        if (typeof ref === "number") page = ref + 1;
        else if (ref && typeof ref === "object" && "num" in (ref as object) && "gen" in (ref as object)) {
          const r = ref as { num: number; gen: number };
          if (typeof r.num === "number" && typeof r.gen === "number") {
            page = await pdf.getPageIndex({ num: r.num, gen: r.gen }) + 1;
          }
        }
      } catch {
        // Broken destinations should not prevent the remaining contents from loading.
      }
      return {
        id: String(start + i), title: node.title, depth, page,
        url: node.url && /^https?:\/\//i.test(node.url) ? node.url : undefined,
      };
    }));
    entries.push(...resolved);
    if (start + 8 < nodes.length) await yieldNow();
  }
  return entries;
}

export function useReaderOutline(pdf: PDFDocumentProxy | null, enabled = true) {
  const [resolved, setResolved] = useState<{ pdf: PDFDocumentProxy; outline: OutlineEntry[] } | null>(null);
  useEffect(() => {
    if (!pdf || !enabled) return;
    let cancelledFlag = false;
    const isCancelled = () => cancelledFlag;
    const timer = window.setTimeout(async () => {
      try {
        const entries = await resolveOutline(pdf, isCancelled, () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
        if (!cancelledFlag) setResolved({ pdf, outline: entries });
      } catch {
        if (!cancelledFlag) setResolved({ pdf, outline: [] });
      }
    }, 350);
    return () => { cancelledFlag = true; window.clearTimeout(timer); };
  }, [pdf, enabled]);
  return resolved?.pdf === pdf && enabled ? resolved.outline : null;
}
