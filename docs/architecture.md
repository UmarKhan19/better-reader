# Architecture and change guide

Start with the owner for the behavior being changed. `app/` adapts Next.js requests and renders entry points; it does not own reader state or filesystem transactions.

## Ownership

| Module | Owns | Entry or contract |
| --- | --- | --- |
| `src/components/library/` | Listing, filtering, uploads, covers, delete/undo and feedback | `library.tsx`, `use-library.ts`, `library-client.ts` |
| `src/components/reader/` | Document lifetime and composition | `pdf-reader-loader.tsx`, `pdf-reader.tsx` |
| `reader/navigation/` | Book-session persistence, navigation history, outline and keyboard input | `use-reading-session.ts`, `reader-navigation.ts` |
| `reader/viewport/` | Geometry, placement, gestures, visible window, canvas allocation and rendering | `reader-viewport.tsx`; allocation limits in `reader-limits.json` |
| `reader/search/` | Bounded literal text search, cancellation, caching and safe highlights | `ReaderSearchController` in `reader-search-state.ts` |
| `reader/chrome/` | Controls, settings, sidebar, thumbnails and chapter seek | `reader-toolbar.tsx`, `reader-controls.tsx` |
| `src/lib/reading-progress.ts` | Saved progress format, legacy decoding, page/offset normalization and delayed writes | `parseSavedProgress`, `parseReadingLocation`, `createProgressWriter` |
| `src/lib/browser-storage.ts` | Per-book settings/bookmark keys and browser reads/writes | `readStorage`, `writeStorage` |
| `src/lib/storage-health.ts` | Per-key save failures and retry notification | External-store subscription |
| `src/lib/server/pdf-store/` | Original files, metadata, covers, trash and safe index publication | Explicit exports in `index.ts` |
| `src/lib/server/book-index/` | Background indexing, worker lifecycle and evidence retrieval | `queueBookIndex`, `startBookIndexing`, `searchBook` |
| `src/lib/server/http/` | Host validation, file streaming, ranges and HTTP validators | `forbiddenHost`, `serveFile` |
| `scripts/lib/reader-browser.mjs` | Browser launch/cleanup, readiness and check configuration | Shared by checks and benchmark |

`src/types/pdf.ts` is the current library record contract. `src/lib/pdf-title.ts` owns display-title normalization. Theme behavior lives in `src/lib/theme.ts`; its pre-paint script must match `applyTheme()`.

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

The shared progress decoder does not decide whether a book is unread. Library projection rejects invalid pages and preserves its historical non-JSON numeric fallback, including `+17`. The reader defaults invalid/missing progress to page 1. Library percentages remain page-based; reader percentages include fractional position and navigation endpoints. These differences have compatibility tests and are intentional during this refactor.

## Rendering and search

Geometry uses estimates until page sizes are discovered; calculating it must not fetch PDF bytes. The viewport plans every visible intersection, reserves backing pixels, and schedules visible work before prefetch or previews. The previous readable raster stays mounted until a replacement is ready. Dark-paper colors must reach every base canvas and tile.

Search owns its cancellation generation, extraction queue and bounded caches. Closing its panel pauses work without discarding the current query's highlights. Changing the query or PDF invalidates old results. PDF strings and queries are escaped before the module inserts its own highlight tags.

See [reader-performance.md](reader-performance.md) for allocation limits, browser check coverage and measurement caveats. The limit values themselves live in `reader/viewport/reader-limits.json` and `reader/search/reader-search-state.ts`.

## Dependency rules

ESLint checks static imports, re-exports and literal dynamic imports:

- Browser/shared code uses HTTP routes rather than Node or `src/lib/server/` modules.
- Library code can import `reader-preload`, not reader internals.
- Progress, preferences, navigation state, geometry and scheduling stay independent of React UI/hooks.
- Callers outside `pdf-store/` use its public exports, not its paths, raw index writes or lock.

The raw index is independent of covers. `catalog.ts` composes index reading and cover enrichment, so cover mutations can use the raw index without a circular dependency. Add explicit exports only for real callers; keep internal collaboration inside the owning module.

## Verification

`bun run check` runs the fast local checks without a running app, model download or browser. Next's `typegen` makes it work on a fresh checkout before the first build. The worker is explicitly included in `tsconfig.json` and checked with JSDoc types.

| Changed behavior | Focused checks |
| --- | --- |
| Saved progress/storage | `bun test src/lib/reading-progress.test.ts src/lib/browser-storage.test.ts src/lib/storage-health.test.ts` |
| Preferences/navigation | `bun test src/components/reader/reader-preferences.test.ts src/components/reader/navigation` |
| PDF/cover/trash/publication | `bun test src/lib/server/pdf-store` |
| Request/response behavior | `bun test src/app/api/pdfs/routes.test.ts` |
| Worker protocol/lifecycle/retrieval | `bun test src/lib/server/book-index` |
| Geometry/raster/zoom | `bun test src/components/reader/viewport`, then browser suite |
| Search | `bun test src/components/reader/search`, then browser suite |
| Import restrictions | `bun test scripts/import-rules.test.mjs` |

Filesystem-backed cases use `tests/helpers/library.ts`. It configures an owned temporary directory before the first store import, resets metadata/files/cover cache before each case, and restores the environment during cleanup. Those suites are serial because they deliberately exercise one process-wide store and lock. Individual cases must create their own records, so name-filtered runs work.

For runtime wiring, rendering or interactions:

```sh
bun run build
bun run test:browser
```

The browser suite needs Node 22+, Chromium and the `agent-browser` CLI. It starts its own production server on a free loopback port with `BETTER_READER_DATA_DIR` pointing to an owned synthetic library. It verifies the fixture PDF's bytes afterward and cleans up its server, data and browser profiles. A prebuilt empty test index prevents model downloads; this suite does not measure embedding quality.

For representative-book measurements, run the external-server checks/benchmark described in the performance guide. Supply `READER_PDF_IDS` explicitly for a benchmark; there are no personal UUID defaults. Real-model inference and physical-device touch/performance remain separate checks.

## Documentation and generated files

`PRODUCT.md` defines behavior, `DESIGN.md` defines library visuals, and `CONTEXT.md` defines domain terms. This guide records implementation ownership. Historical review artifacts are evidence, not current requirements.

Normal source searches honor `.ignore`. Dependencies, build output, caches, personal data, the generated PDF worker and lockfile are excluded from those searches. Read them explicitly for dependency or deployment work. Apply equivalent exclusions to any external indexer; `.ignore` is a ripgrep convention, not a universal harness setting.
