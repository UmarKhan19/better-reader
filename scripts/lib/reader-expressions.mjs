import { tmpdir } from "node:os";
import path from "node:path";

export const resetStorageExpression = (id, preferences) => `localStorage.clear(); ${preferences
  ? `localStorage.setItem(${JSON.stringify(`better-reader:settings:${id}`)}, JSON.stringify(${JSON.stringify(preferences)}))`
  : ""}`;

export const readyExpression = (page) => `(() => {
  const stage = document.querySelector('[data-reader-stage][aria-busy="false"]');
  if (!stage ${page ? `|| Number(stage.dataset.pageNumber) !== ${page}` : ""}) return false;
  const main = document.querySelector('main'), mr = main?.getBoundingClientRect();
  const holder = stage.querySelector('[data-cached-page="' + stage.dataset.pageNumber + '"]') ?? stage;
  return [...holder.querySelectorAll('canvas')].some(canvas => {
    const r = canvas.getBoundingClientRect(), s = getComputedStyle(canvas);
    return canvas.width > 0 && canvas.height > 0 && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && mr && r.bottom > mr.top && r.top < mr.bottom && r.right > mr.left && r.left < mr.right;
  });
})()`;

export function readConfig(env = process.env) {
  const numeric = (key, fallback, min = 0) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${key}`);
    return value;
  };
  const integer = (key, fallback, min) => {
    const value = numeric(key, fallback, min);
    if (!Number.isInteger(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    origin: (env.READER_URL ?? "http://127.0.0.1:3100").replace(/\/$/, ""),
    chrome: env.CHROME_BIN ?? "/usr/bin/chromium",
    ids: (env.READER_PDF_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
    repeats: integer("BENCH_REPEATS", 5, 1), steps: integer("BENCH_STEPS", 12, 0), cpu: numeric("BENCH_CPU", 1, 1),
    latency: numeric("BENCH_LATENCY_MS", 0), download: numeric("BENCH_DOWNLOAD_BPS", 0) || -1, upload: numeric("BENCH_UPLOAD_BPS", 0) || -1,
    width: integer("BENCH_WIDTH", 1440, 1), height: integer("BENCH_HEIGHT", 900, 1),
    timeout: numeric("BENCH_TIMEOUT_MS", 60000, 1), cacheWait: numeric("BENCH_CACHE_WAIT_MS", 5000, 1), settle: numeric("BENCH_SETTLE_MS", 1000),
    output: env.BENCH_OUTPUT ?? path.join(tmpdir(), `reader-benchmark-${Date.now()}.json`),
  };
}
