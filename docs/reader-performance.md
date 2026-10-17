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

The interaction check observed 14 panoramic pages visible together and a rapid-zoom backing-pixel peak below 12 MP. Those observations do not replace the allocation limits or prove the absence of all memory leaks.

## Run the checks

Use an existing Chromium installation and Node 22+. No browser download or additional npm package is required. Start a production server you own on a free loopback port:

```sh
bun run test
bun run lint
bun run build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
```

In another terminal:

```sh
READER_URL=http://localhost:3100 bun run test:reader
READER_URL=http://localhost:3100 bun run test:reader:interactions
READER_URL=http://localhost:3100 BENCH_OUTPUT=/tmp/reader-desktop.json bun run benchmark:reader

READER_URL=http://localhost:3100 \
BENCH_REPEATS=1 BENCH_STEPS=4 \
BENCH_CPU=4 BENCH_LATENCY_MS=100 \
BENCH_DOWNLOAD_BPS=750000 BENCH_UPLOAD_BPS=250000 \
BENCH_WIDTH=390 BENCH_HEIGHT=844 \
BENCH_OUTPUT=/tmp/reader-throttled.json bun run benchmark:reader
```

Stop only your own server afterward. Do not restart someone else's development server.

`test:reader` uses agent-browser with a unique explicit temporary profile. It checks HTTP caching/ranges, keyboard navigation, all layouts, crop controls, fractional restoration, bookmarks, paper/themes, focus/dialogs, Search focus and retained highlights, Back, thumbnail virtualization, pixel limits, text selection, 320px/landscape overflow and axe accessibility. Set `READER_PDF_ID` to an existing document. `READER_SCREENSHOTS` saves a desktop/mobile batch; paths are resolved before passing them to the browser daemon.

`test:reader:interactions` creates its own disposable CDP browser. It checks trusted pinch/double-tap/Ctrl-wheel input and anchoring, actual crop enlargement, tiled high zoom, rapid zoom limits, pointer seeking with exactly one accepted commit, and internal PDF link/Back navigation. Small generated PDFs are intercepted inside that browser to test more than six short pages and failed-document retry. They are never uploaded or written into the library. A headless touch event is not physical-device verification.

All checks preserve original files. Reading progress and preferences written during tests live only in disposable browser profiles. Fullscreen permission and physical touch/browser differences still need real-device checking. The delegated independent review did not run after the provider usage limit; the parent performed the browser, visual and regression checks directly.

## Benchmark configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `READER_URL` | `http://127.0.0.1:3417` | Started production app |
| `CHROME_BIN` | `/usr/bin/chromium` | Existing executable |
| `READER_PDF_IDS` | The two recorded library UUIDs | Comma-separated existing PDF IDs; override for another library |
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

The recorded UUIDs are `fe94a0f3-3127-41e6-a2c1-f45ee481c36d` for the 419-page book and `5fe96d77-eb1d-4825-ab29-01fde4435215` for the 24-page document. The benchmark requires a multi-page PDF.

## What the numbers mean

The readiness proxy requires a non-busy stage and a visible, nonzero active-page canvas. It is conservative for continuous layouts because adjacent visible pages may still be rendering after the active page is readable. The app's separate `reader:first-page` mark is retained in raw JSON. Neither value is a physical display presentation timestamp. Polling adds up to roughly 40 ms plus scheduling overhead.

Cached navigation means the requested page already had a rendered canvas. Uncached means it did not have a mounted canvas, not that all its PDF bytes were uncached. A continuous layout may also need another visible page to finish before the stage settles. No adjacent cache gives zero cached samples and null percentiles, not an invented cache hit.

p50/p95 use nearest rank. With three repeats, p95 is the maximum; these samples are too small for a stable tail estimate. Direct reader navigation excludes intent prewarming. Browser storage is cold, but server/filesystem caches are not. Compare the same browser, build mode, viewport and throttle.

Request records include status, Range/Content-Range, body/encoded bytes, cancellation and cache flags. Page-target CDP can omit worker-script completion events. `incompleteRequests` and separate Resource Timing expose that gap. Do not add all Resource Timing bytes to CDP totals or call an incomplete page-target count whole-browser wire traffic. Repeated disk-cache range bodies are not fresh network transfers.

Samples include canvas count/pixels, main-target heap and DOM counters. `canvasPixels * 4` estimates RGBA backing bytes only. Finite samples without forced GC are not a leak test.

## Recorded production comparison

The final comparison uses a fresh copy of the original source and the integrated app, both built with default Next 16.4.2 Turbopack. The original source's library was copied locally for the baseline; originals were untouched. This avoids comparing the earlier delegated Webpack baseline against Turbopack. Raw reports and logs are retained outside the source tree under `~/.cache/bk-reader-work.mnkP7x/final-evidence/`.

Desktop settings are 1440×900, DPR 1, CPU 1, no network throttle, three fresh profiles per book, eight extra jumps and a 1000 ms settle. The table reports median milliseconds from the conservative readiness proxy:

| Document | Before / after open | Before / after cached turn | Before / after uncached jump |
| --- | ---: | ---: | ---: |
| 419 pages | 546 / 607 | 53 / 26 | 104 / 113 |
| 24 pages | 604 / 699 | 74 / 34 | 49 / 107 |

The mobile smoke uses 390×844, CPU 4, 100 ms latency and 750,000/250,000 B/s, with one repeat and four extra jumps. Large-document opening changed from about 11.6 s to 4.1 s. Its uncached end-of-book jump changed from 135 ms to about 2.1 s because bytes now arrive on demand. The small document remained around 3.3 s before and 3.9 s after; additional reader work still costs CPU even with streaming enabled.

These results support faster cached desktop turns and lower initial large-document loading delay under this throttle. They do not support an across-the-board speedup: unthrottled cold opens and some uncached jumps regressed. A 390px throttled Chromium window is an emulation, not a measured phone. Increase repeats and test representative hardware before setting release performance budgets.
