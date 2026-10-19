# Reader changes

- `pdf-reader.tsx` owns document composition and transient UI. `navigation/use-reading-session.ts` owns one book's persisted state and navigation commands.
- For rendering, zoom or crop changes, read `docs/reader-performance.md` before editing. Keep every visible page represented and keep reservations until actual canvas cleanup. Limits live in `viewport/reader-limits.json`.
- Preserve the distinction between observed location and explicit navigation revision. Keep page/item context in text highlights and the previous readable raster until its replacement is ready.
- Pass dark-paper colors to every rendered canvas, including retained base rasters and tiles. Tile identity follows the shown frame.
- Keep `data-reader-*`, `data-cached-page`, readiness and performance marks aligned with `scripts/lib/reader-browser.mjs` and the browser checks.
- Preserve the literal client-only dynamic import and matching prewarm import. A prewarm failure must not block opening a book.
- Change the behavior's colocated tests, then run the isolated browser suite for interaction or rendering work. Throttled headless Chromium is not a physical-device measurement.
