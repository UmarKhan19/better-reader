"use client";

// Keep the literal import in sync with pdf-reader-loader's client-only dynamic import.
let warmed = false;

type ConnectionHints = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};

export function prewarmReader(): void {
  if (typeof window === "undefined" || warmed) return;
  const connection = (navigator as Navigator & { connection?: ConnectionHints }).connection;
  if (connection?.saveData ||
    ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "") ||
    (connection?.downlink !== undefined && connection.downlink < 1)) return;

  warmed = true;
  // Intent is a hint, never a prerequisite for opening a book. Failures stay silent;
  // the real reader/worker load still runs normally when the user follows the link.
  void import("./pdf-reader").catch(() => {});
  void fetch("/pdf.worker.min.mjs", { cache: "force-cache", credentials: "same-origin" })
    .then((response) => { if (response.ok) return response.arrayBuffer(); })
    .catch(() => {});
}
