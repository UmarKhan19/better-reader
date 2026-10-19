# Reader loading and measurement

## Loading policy

Library links call `prewarmReader()` on pointer entry, focus and touch start. It imports the client reader and warms `/pdf.worker.min.mjs` once. It does not download a book or start a PDF document. Save-data, 2g/3g and reported downlink below 1 Mbps skip this work. Missing connection hints permit it. A failed prewarm never blocks navigation.

The server passes the existing library file size to the client reader. `optionsForPdfSize()` returns stable, frozen options:

- PDFs up to 1 MiB use normal streaming and automatic fetching. Small files avoid multiple object/font range round trips.
- Larger PDFs, or files with unknown size, use on-demand ranges with `disableStream: true`, `disableAutoFetch: true`, and 65,536-byte chunks. Installed PDF.js 6.3 requires both flags to stop background downloading.

The private range endpoint, validators and original PDFs are unchanged. PDF.js can begin and cancel an initial non-range request while detecting range support. Non-linearized PDFs can require distant objects, shared fonts and cross-reference tables. Range support does not guarantee a particular byte saving or an instant jump to an uncached page.

## Rendering and interaction limits

Continuous scrolling is the default. Single-page and desktop spread modes remain per-book options. Narrow windows display saved spreads as continuous pages without changing that preference. Fractional progress, crop, focus, sizing and paper settings survive reload. Existing numeric and `{page,numPages}` progress formats still load.

`ReaderViewport` mounts a viewport-sized window, including every visible short page. A shared queue prioritizes visible rasters, then directional prefetch, then thumbnail/scrubber previews. Save-data and low-memory hints reduce background work. Outline resolution starts after the first readable page.

Visible base rasters share 6 MP; old and incoming base rasters together stay within 12 MP. Each canvas stays below 3 MP. At most six high-resolution tiles add 6 MP. Crop sampling uses one canvas no larger than 256×256. The viewport budget is below 18.07 MP, about 73 MB of RGBA backing pixels. This excludes thumbnails, the scrubber preview, GPU copies, worker heaps and PDF.js internal caches. A holder-count cap must never omit visible pages.

Historical measurements live in [the loading comparison report](reports/reader-loading-comparison.md). Allocation limits are current contracts; past observations are not release budgets or leak tests.

## Viewport data flow

```text
scroll / gesture (rAF)
  -> useReaderScrollPlacement -> view {top, left, width, height, direction}
       observed ReadingLocation -> session progress; never a new navigation
  -> readerGeometry -> PageBox[] (estimates until sizes/crops arrive; never PDF bytes)
  -> useReaderWindow -> pageWindow numbers (continuous: visible pages + one neighbour)
       planReaderWindow -> intersection area, priority 0 visible / 1 prefetch, tile limits
       allocateRasterWindow -> visible-area-weighted pixels and raster ratio per page
  -> ReaderPageSurface -> BudgetedRaster -> ReaderRasterBudget.reserve
       grant -> ScheduledPdfPage -> ReaderRenderQueue (tab singleton, two permits)
       ready -> promote (shown pixels stay inside SHOWN_PIXEL_BUDGET) -> finishRaster
  -> shown frame -> tiles keyed by the shown frame + canvasCrop sampling -> crops
  -> statuses {identity, busy, readable, ready} -> busy / readable / settled
  -> reader:first-page mark on the first readable page; reader:page-turn measure
       once settled after a matching reader:page-request
```

An observed scroll updates only the session location; it never bumps `navigation.revision`. Placement repositions the scroller only when the revision changes or geometry does (zoom, layout), and a scroll event that lands on the placed offset is treated as its own echo, so scrolling cannot feed back into navigation. Prefetch and retained pages are presentation-only: they are inert, `aria-hidden` and never become the observed location.

| State | Owner | Lifetime |
| --- | --- | --- |
| `sizes` | `viewport/reader-viewport.tsx` (`onSize`) | Per mounted viewport; grows until page sizes are discovered, reset only when the PDF or viewport remounts |
| `crops` | `viewport/reader-viewport.tsx` (`onCrop`) | Per mounted viewport; capped at 128 entries, window pages and active kept first |
| `statuses` | `viewport/reader-viewport.tsx` (`onStatus`) | Per mounted viewport; pruned to rendered pages plus active; an unmounted surface reports identity `unmounted`, busy |
| `ReaderRasterBudget` | `viewport/reader-raster-budget.ts` | One per mounted viewport; granted pixels and shown frames live until the canvas effect cleanup |
| `retained` | `viewport/use-reader-window.ts` (`lastReadablePages`) | Per mounted viewport; non-continuous layouts only, kept while the window is not yet readable |
| `renderPlan` | `viewport/reader-render-window.ts` (`planReaderWindow`) | Recomputed per render from window, view and statuses; prefetch entries only while settled |

## Run the checks

Use Node 22+, Chromium and the `agent-browser` CLI. Routine regression checks own their production server, library and browser profiles:

```sh
bun run check
bun run build
bun run test:browser
```

For representative-book measurements, start a separate server against a benchmark library you own. Agents must use a disposable data directory rather than the personal library:

```sh
BETTER_READER_DATA_DIR=/path/to/benchmark-library node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
```

Then, in another terminal:

```sh
READER_URL=http://localhost:3100 bun run test:reader
READER_URL=http://localhost:3100 bun run test:reader:interactions
READER_URL=http://localhost:3100 READER_PDF_IDS=your-pdf-id BENCH_OUTPUT=/tmp/reader-desktop.json bun run benchmark:reader

READER_URL=http://localhost:3100 \
READER_PDF_IDS=your-pdf-id \
BENCH_REPEATS=1 BENCH_STEPS=4 \
BENCH_CPU=4 BENCH_LATENCY_MS=100 \
BENCH_DOWNLOAD_BPS=750000 BENCH_UPLOAD_BPS=250000 \
BENCH_WIDTH=390 BENCH_HEIGHT=844 \
BENCH_OUTPUT=/tmp/reader-throttled.json bun run benchmark:reader
```

Stop only your own server afterward. Do not restart someone else's development server.

For routine regression checks, `bun run test:browser` uses the existing production build and starts its own isolated server/library instead. It generates synthetic PDFs and uses a prebuilt empty test index to avoid inference/model downloads. Shared browser helpers live in `scripts/lib/reader-launch.mjs`, `reader-cdp.mjs` and `reader-expressions.mjs`; PDF fixtures live in `tests/fixtures/`. This smoke suite is not a representative-book benchmark.

`test:reader` uses agent-browser with a unique explicit temporary profile. It checks HTTP caching/ranges, keyboard navigation, all layouts, crop controls, fractional restoration, bookmarks, paper/themes, focus/dialogs, Search focus and retained highlights, Back, thumbnail virtualization, pixel limits, text selection, 320px/landscape overflow and axe accessibility. Set `READER_PDF_ID` to an existing document. `READER_SCREENSHOTS` saves a desktop/mobile batch; paths are resolved before passing them to the browser daemon.

`test:reader:interactions` creates its own disposable CDP browser. It checks trusted pinch/double-tap/Ctrl-wheel input and anchoring, actual crop enlargement, tiled high zoom, rapid zoom limits, pointer seeking with exactly one accepted commit, and internal PDF link/Back navigation. Small generated PDFs are intercepted inside that browser to test more than six short pages and failed-document retry. They are never uploaded or written into the library. A headless touch event is not physical-device verification.

All checks preserve original files. Reading progress and preferences written during tests live only in disposable browser profiles. Fullscreen permission and physical touch/browser differences still need real-device checking.

## Benchmark configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `READER_URL` | `http://127.0.0.1:3100` | Started production app |
| `CHROME_BIN` | `/usr/bin/chromium` | Existing executable |
| `READER_PDF_IDS` | Required for benchmark | Comma-separated existing PDF IDs; no personal-library defaults |
| `BENCH_REPEATS` | 5 | Fresh browser profiles per book |
| `BENCH_STEPS` | 12 | Additional deterministic page jumps |
| `BENCH_CPU` | 1 | CDP CPU slowdown factor |
| `BENCH_LATENCY_MS` | 0 | Added network latency |
| `BENCH_DOWNLOAD_BPS`, `BENCH_UPLOAD_BPS` | 0 | Bytes/second; zero means unthrottled |
| `BENCH_WIDTH`, `BENCH_HEIGHT` | 1440, 900 | CSS viewport at DPR 1 |
| `BENCH_TIMEOUT_MS` | 60000 | Readiness timeout per operation |
| `BENCH_CACHE_WAIT_MS` | 5000 | Wait for an actually rendered adjacent page |
| `BENCH_SETTLE_MS` | 1000 | Final observation window |
| `BENCH_OUTPUT` | Timestamped OS-temp path | Raw JSON and summaries |

To repeat the benchmark, supply IDs from the benchmark library. It requires a multi-page PDF.

## What the numbers mean

The readiness proxy requires a non-busy stage and a visible, nonzero active-page canvas. It is conservative for continuous layouts because adjacent visible pages may still be rendering after the active page is readable. The app's separate `reader:first-page` mark is retained in raw JSON. Neither value is a physical display presentation timestamp. Polling adds up to roughly 40 ms plus scheduling overhead.

Cached navigation means the requested page already had a rendered canvas. Uncached means it did not have a mounted canvas, not that all its PDF bytes were uncached. A continuous layout may also need another visible page to finish before the stage settles. No adjacent cache gives zero cached samples and null percentiles, not an invented cache hit.

p50/p95 use nearest rank. With three repeats, p95 is the maximum; these samples are too small for a stable tail estimate. Direct reader navigation excludes intent prewarming. Browser storage is cold, but server/filesystem caches are not. Compare the same browser, build mode, viewport and throttle.

Request records include status, Range/Content-Range, body/encoded bytes, cancellation and cache flags. Page-target CDP can omit worker-script completion events. `incompleteRequests` and separate Resource Timing expose that gap. Do not add all Resource Timing bytes to CDP totals or call an incomplete page-target count whole-browser wire traffic. Repeated disk-cache range bodies are not fresh network transfers.

Samples include canvas count/pixels, main-target heap and DOM counters. `canvasPixels * 4` estimates RGBA backing bytes only. Finite samples without forced GC are not a leak test.
