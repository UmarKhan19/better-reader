# Architecture and change guide

Start with the owner for the behavior being changed. `src/app/` adapts Next.js requests and renders entry points; it does not own reader state or filesystem transactions.

## Ownership

| Module | Owns | Entry or contract |
| --- | --- | --- |
| `src/components/library/` | Listing, filtering, uploads, covers, delete/undo and feedback | `library.tsx`, `use-library.ts`, `library-client.ts` |
| `src/components/reader/` | Document lifetime and composition | `pdf-reader-loader.tsx`, `pdf-reader.tsx` |
| `reader/navigation/` | Book-session persistence, navigation history and outline | `use-reading-session.ts`, `reader-navigation.ts`, `reader-outline.ts`, `use-reader-outline.ts` |
| `reader/viewport/` | Geometry, placement, gestures, visible window, canvas allocation and rendering | `reader-viewport.tsx`; allocation limits in `reader-limits.json` |
| `reader/search/` | Bounded literal text search, cancellation, caching and safe highlights | `ReaderSearchController` in `reader-search-state.ts` |
| `reader/chrome/` | Panel transitions, focus, fullscreen, feedback, keyboard input and controls | `use-reader-chrome.ts`, `reader-ui-state.ts`, `reader-header.tsx` |
| `src/lib/reading-progress.ts` | Saved progress format, legacy decoding, page/offset normalization and delayed writes | `parseSavedProgress`, `parseReadingLocation`, `createProgressWriter` |
| `src/lib/browser-storage.ts` | Per-book settings/bookmark keys and browser reads/writes | `readStorage`, `writeStorage` |
| `src/lib/storage-health.ts` | Per-key save failures and retry notification | External-store subscription |
| `src/lib/server/pdf-store/` | Original files, metadata, covers, trash and safe index publication | Explicit exports in `index.ts` |
| `src/lib/server/book-index/` | Background indexing, worker lifecycle and evidence retrieval | `queueBookIndex`, `startBookIndexing`, `searchBook` |
| `src/lib/server/http/` | Host validation, file streaming, ranges and HTTP validators | `forbiddenHost`, `serveFile` |
| `scripts/lib/reader-{launch,cdp,expressions}.mjs` | Browser launch/cleanup, readiness, selectors and check configuration | Shared by checks and benchmark |

`src/types/pdf.ts` defines browser-visible library fields; `src/types/api.ts` is the HTTP wire contract (`PdfWireItem`, `PdfListResponse`, `PdfMutationResponse`, `ApiError`, `OkResponse`). `coverFileName` is legacy wire metadata; browser code reads `coverUrl`. The store's private `record.ts` extends them with disk metadata; existing JSON and response fields remain compatible. `src/lib/pdf-title.ts` owns display-title normalization and its colocated tests. Theme behavior lives in `src/lib/theme.ts`; its pre-paint script must match `applyTheme()`.

Use the existing entry files rather than adding directory-wide barrels. The home page imports `library/library.tsx`; the reading page imports `reader/pdf-reader-loader.tsx`; library intent prewarming imports only `reader/reader-preload.ts`. Within the reader, chrome previews share `viewport/reader-render-queue.tsx` with visible pages. That shared queue is intentional; chrome does not own geometry or raster allocation.

Styles follow the same owners. `app/globals.css` holds shared tokens and base treatments; `library/library.module.css` holds library artwork and motion. `reader/reader.module.css` holds the shell and viewer; `reader/chrome/reader-chrome.module.css` holds toolbar, sidebar and dialog styles. Cross-module focus-mode selectors use the root's existing data attributes rather than another module's generated class name.

## Upload and restore

```text
Library → mutation hook → library-client → PDF route
                                         ├─ pdf-store saves/restores original bytes
                                         └─ queueBookIndex returns immediately
                                              → serial worker queue → worker.mjs
```

The indexer uses only the store's public Interface. `bookIndexPaths()` supplies canonical file coordinates. Only `publishBookIndex()` takes the library mutation lock, checks that the original still exists in the live library, and renames the completed temporary index. Parsing and inference never hold that lock.

The worker runs directly with Node outside Next's bundle. Keep its `.mjs` files and installed dependencies in production deployments. `protocol.mjs` defines and validates IPC messages; `worker-client.ts` owns FIFO ordering, idle process references, progress deadlines and crash recovery. The full job, including publication and temporary-file cleanup, finishes before the next job begins.

## Reading and saved state

```text
/read/[id] → metadata lookup → client-only reader loader
                              → PDF.js → original PDF byte-range endpoint

Book session → progress/preferences/bookmarks → browser localStorage
                  └─ library projects saved progress into its reading shelf
```

`useReadingSession()` owns one keyed book lifetime. It flushes delayed progress on page hide, hidden visibility and unmount. Navigation distinguishes observed scrolling from an explicit jump revision; changing the observed location must not issue another scroll placement.

The shared progress decoder does not decide whether a book is unread. Library projection rejects invalid pages and preserves its historical non-JSON numeric fallback, including `+17`. The reader defaults invalid/missing progress to page 1. Library percentages remain page-based; reader percentages include fractional position and navigation endpoints. These differences have compatibility tests. Preserve them unless a product change explicitly requests a migration.

`useReaderChrome()` owns transient UI and browser lifetimes. Its reducer opens Search, dismisses one layer and closes chrome during focus transitions. Keyboard input invokes those commands instead of changing sidebar or panel setters. Document readiness crosses into keyboard/settings as a boolean, not a PDF proxy. Native dialog focus restoration must finish before chrome moves focus to the viewer.

## Rendering and search

Geometry uses estimates until page sizes are discovered; calculating it must not fetch PDF bytes. The viewport plans every visible intersection, reserves backing pixels, and schedules visible work before prefetch or previews. The previous readable raster stays mounted until a replacement is ready. Dark-paper colors must reach every base canvas and tile.

Search owns its cancellation generation, extraction queue and bounded caches. Closing its panel pauses work without discarding the current query's highlights. Changing the query or PDF invalidates old results. PDF strings and queries are escaped before the module inserts its own highlight tags.

See [reader-performance.md](reader-performance.md) for allocation limits, browser check coverage and measurement caveats. The limit values themselves live in `reader/viewport/reader-limits.json` and `reader/search/reader-search-state.ts`.

## Dependency rules

ESLint checks static imports, re-exports and literal dynamic imports:

- Browser/shared code uses HTTP routes rather than Node built-ins or `src/lib/server/` modules. Both bare and `node:` imports are checked.
- Library code can import `reader-preload`, not reader internals.
- Reader code stays independent of library internals.
- Progress, preferences, navigation/UI state, geometry and scheduling stay independent of React UI/hooks. The pure-module list lives in `scripts/lib/import-policy.mjs`, shared by ESLint and `scripts/import-rules.test.mjs`; add new pure modules there.
- Callers outside `pdf-store/` use its root or `index.ts` exports; callers outside `lib/server/http/` use `@/lib/server/http` and callers outside `lib/server/book-index/` use `@/lib/server/book-index`. Every subpath is private except from its own directory and tests, including newly added files.

The checker resolves static imports, re-exports and literal dynamic imports. Computed module names and `require()` still need review.

The raw index is independent of covers. `catalog.ts` composes index reading and cover enrichment, so cover mutations can use the raw index without a circular dependency. Add explicit exports only for real callers; keep internal collaboration inside the owning module.

## Change map

`bun run check` runs the fast local checks without a running app, model download or browser. Next's `typegen` makes it work on a fresh checkout before the first build. The worker is explicitly included in `tsconfig.json` and checked with JSDoc types. Owner files below are relative to `src/`.

| Change area | Owner files | Focused checks |
| --- | --- | --- |
| Upload, delete, cover | `components/library/use-upload.ts`, `use-delete.ts`, `use-covers.ts`, `library-client.ts`; `lib/server/pdf-store/index-store.ts`, `covers.ts`, `trash.ts`; `app/api/pdfs/**` | `bun test src/components/library src/lib/server/pdf-store src/app/api/pdfs/routes.test.ts`, then `bun run test:browser -- library` |
| Progress, bookmarks | `lib/reading-progress.ts`, `lib/browser-storage.ts`, `reader/navigation/use-reading-session.ts` | `bun test src/lib/reading-progress.test.ts src/lib/browser-storage.test.ts`, then `bun run test:browser -- navigation` |
| Preferences, navigation | `reader/reader-preferences.ts`, `reader/navigation/use-reading-session.ts`, `reader-navigation.ts`, `reader-outline.ts`, `use-reader-outline.ts` | `bun test src/components/reader/reader-preferences.test.ts src/components/reader/navigation`, then `bun run test:browser -- navigation` |
| Chrome, keyboard, focus | `reader/chrome/use-reader-chrome.ts`, `use-reader-keyboard.ts`, `reader-ui-state.ts`, `reader-page-controls.tsx`, `reader-shortcuts.tsx`, `reader-dialog.tsx` | `bun test src/components/reader/chrome`, then `bun run test:browser -- navigation` |
| Rendering, zoom, crop | `reader/viewport/reader-viewport.tsx`, `reader-page-surface.tsx`, `reader-budgeted-raster.tsx`, `reader-tile.tsx`, `reader-crop-canvas.ts`, `reader-raster-budget.ts`, `reader-render-queue.tsx`, `reader-geometry.ts`, `reader-crop.ts` | `bun test src/components/reader/viewport`, then `bun run test:browser -- rendering gestures` |
| Search | `reader/search/reader-search-state.ts`, `reader-search-panel.tsx`, `use-reader-search.ts` | `bun test src/components/reader/search`, then `bun run test:browser -- search` |
| PDF HTTP, streaming | `lib/server/http/host-guard.ts`, `pdf-http.ts`, `serve-file.ts`; `app/api/pdfs/**`; `reader/reader-load-options.ts` | `bun test src/lib/server/http src/app/api/pdfs/routes.test.ts src/components/reader/reader-load-options.test.ts`, then `bun run test:browser -- navigation`; external `bun run test:reader` |
| Background index | `lib/server/book-index/index.ts`, `worker-client.ts`, `worker.mjs`, `protocol.mjs`; `lib/server/pdf-store/book-index-files.ts`; `instrumentation.ts` | `bun test src/lib/server/book-index src/lib/server/pdf-store`; no browser group (the worker runs outside the app) |

## Invariants

- Original PDFs are never rewritten; reads, byte ranges and indexing use the same bytes.
- Saved browser formats stay backward compatible. Missing state means unread or default, not a migration.
- Only `publishBookIndex()` takes the library mutation lock. Parsing and inference never hold it.
- Keep the previous readable raster mounted until its replacement is ready.
- Every visible page remains represented; allocation limits never omit one.
- The Host guard blocks DNS-rebinding requests; it is not authentication.
- Module singletons stay shared as listed below; do not create per-route or per-render duplicates.
- Browser storage is best-effort; a failed write must not block reading.

## Module lifetimes

| Singleton | Lifetime / scope | Reset or replacement |
| --- | --- | --- |
| `pdf-store` mutation lock (`globalThis.betterReaderMutations`) | Process | Process restart |
| `BookIndexWorker` (`globalThis.betterReaderBookIndex.worker`) | Process | Replaced on crash or the next job after exit |
| `coverMap` in `pdf-store/covers.ts` | Process | `invalidateCoverMap()` after cover/trash writes |
| `storage-health` state | Tab | `clearStorageFailures()` on explicit retry |
| `sessionTheme` in `lib/theme.ts` | Tab | Page reload or new tab |
| `readerRenderQueue` | Tab | Module load; shared by visible and preview renders |
| `ReaderRasterBudget` | One mounted viewport | Viewport unmount |
| PDF key `WeakMap`s in `viewport/reader-viewport-runtime.ts` and `reader-render-queue.tsx` | PDF document | Garbage collection after the document closes |
| `warmed` in `reader-preload.ts` | Tab | Page reload or new tab |

## Test tiers

| Command | Scope |
| --- | --- |
| `bun test` | Unit tests colocated with their owners; `tests/preload.ts` configures a disposable data directory. `bun run test:coverage` adds Bun's coverage report. |
| `bun run test:browser` | Isolated production server, synthetic library and browser profiles. Groups: `navigation`, `search`, `rendering`, `gestures`, `library`. |
| `bun run test:reader` | External read-only server checks: HTTP caching/ranges, layouts, persistence, accessibility. |
| `bun run test:reader:interactions` | External CDP checks for trusted gestures, crop, zoom and PDF links. |
| `bun run benchmark:reader` | Measurements on a representative library; not a pass/fail test. |

CodeGraph cannot see browser scenarios. Its "no tests found" output can under-report tests reached through namespace imports or HTTP routes; use the commands above and the owner files as the source of truth.

`tests/preload.ts` and `bunfig.toml` always create a disposable `BETTER_READER_DATA_DIR` before test modules load, ignoring an inherited value so tests cannot mutate a real library. Filesystem tests no longer depend on import order for safety, but still import `tests/helpers/library.ts` for reset and cleanup. Those suites are serial because they deliberately exercise one process-wide store and lock. Individual cases must create their own records so name-filtered runs work.

For runtime wiring, rendering or interactions:

```sh
bun run build
bun run test:browser
```

The browser suite needs Node 22+, Chromium and the `agent-browser` CLI. It starts its own production server on a free loopback port with `BETTER_READER_DATA_DIR` pointing to an owned synthetic library. It verifies the fixture PDF's bytes afterward and cleans up its server, data and browser profiles. A prebuilt empty test index prevents model downloads; this suite does not measure embedding quality.

For representative-book measurements, run the external-server checks and benchmark described in the performance guide. Supply `READER_PDF_IDS` explicitly for a benchmark; there are no personal UUID defaults. Real-model inference and physical-device touch/performance remain separate checks.

## Documentation and generated files

`PRODUCT.md` defines behavior, `DESIGN.md` defines library visuals, and `CONTEXT.md` defines domain terms. This guide records implementation ownership. Historical review artifacts are evidence, not current requirements.

Normal source searches honor `.ignore`. Dependencies, build output, caches, personal data, the generated PDF worker and lockfile are excluded from those searches. Read them explicitly for dependency or deployment work. Apply equivalent exclusions to any external indexer; `.ignore` is a ripgrep convention, not a universal harness setting.
