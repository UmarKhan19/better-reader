<!-- prettier-ignore -->
<div align="center">

<img src="./public/logo.png" alt="Better Reader logo" height="64" />

# Better Reader

_A personal PDF library and reader for the browser — scroll-first, remembers your place._

[![Bun](https://img.shields.io/badge/Bun-1.3+-000?style=flat-square&logo=bun)](https://bun.sh)
[![Node.js](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-171%20passing-2ea44f?style=flat-square)](#checks)

[Features](#features) • [Getting started](#getting-started) • [Where your files live](#where-your-files-live) • [Reader checks](#reader-checks) • [Configuration](#configuration)

</div>

Better Reader is a single-server app for reading your own PDFs. Uploads stay on the machine that runs it, the original files are never rewritten, and the reader remembers your page, bookmarks, and preferences per book — including legacy progress formats. It is built for desktop and mobile, with continuous scrolling by default and optional single-page or two-page spread layouts.

> [!NOTE]
> There is no login. Anyone who can open the URL can read, upload, and delete your books. Run it on a machine and network you trust.

## Features

**Library**
- Netflix-style poster grid with a full-bleed hero for the book you are reading.
- Upload multiple PDFs at once (drag-and-drop or file picker) with per-file progress and skip reasons.
- Optional cover images: add, replace, or remove per book; PDFs without covers get generated poster artwork.
- Search by filename or displayed title; sort by recent or name.
- Soft-delete with 30-day undo from the library.

**Reader**
- Continuous scroll by default; single-page and desktop two-page spread remain per-book options.
- Fractional progress, crop, focus, sizing, and paper settings survive reload; bookmarks per book.
- Optional blank-margin cropping, gesture zoom (pinch, double-tap, Ctrl-wheel), and in-document search with highlighted results.
- Location history ("Back to previous location") and chapter-aware page seeking via the scrubber.
- Paper modes: original, dimmed, sepia, dark (full recolor).
- Focus mode and fullscreen; keyboard shortcuts for navigation, zoom, bookmarks, and search.

**Performance and safety**
- Rendering and thumbnail memory are bounded (base rasters share 6 MP; physical ceiling ~12 MP; tiles add ≤6 MP).
- Background work does not delay the visible page; a shared queue prioritizes visible rasters.
- Host guard blocks DNS-rebinding: the API answers only to localhost, LAN, and `.local` names unless allow-listed.
- Original PDFs are served with range requests, ETags, and `304 Not Modified`.

## Getting started

Requires [Bun](https://bun.sh) (or Node 22+).

```sh
bun install
bun run dev        # http://127.0.0.1:3000
```

For a production build:

```sh
bun run build
bun run start      # http://127.0.0.1:3000
```

Both bind to `127.0.0.1`, so only this machine can reach the app. To read from your phone on the same network, expose it deliberately:

```sh
bun run start -- --hostname 0.0.0.0
```

> [!WARNING]
> Anyone on that network can reach the same library. Only do this on a network you trust.

## Where your files live

Everything is under `data/` in the project folder:

| Path | Contents |
| --- | --- |
| `data/uploads/` | Original PDFs, byte for byte |
| `data/covers/` | Cover images |
| `data/pdfs.json` | Library index |
| `data/trash/` | Deleted PDFs and covers, plus `data/trash.json` |

Back up the library by copying `data/`. The app never rewrites an uploaded PDF. Deleted books can be undone from the library for 30 days, then are purged on the next delete or restore.

## Configuration

| Variable | Purpose |
| --- | --- |
| `BETTER_READER_ALLOWED_HOSTS` | Comma-separated hostnames a reverse proxy may use (e.g. `books.home.lan`). |
| `READER_PDF_ID` | Existing document id for the reader checks. |
| `READER_URL` | Base URL of the server under test (default `http://127.0.0.1:3417`). |

Run one server process at a time against the same `data/` folder: the index is a JSON file and writes are serialized inside the process only.

## Checks

```sh
bun test           # 171 unit tests (storage, parsers, budgets, geometry)
bun run lint       # ESLint
bun run build      # Next.js production build
```

The reader checks drive a real browser against a running production server. They need Node 22+, an existing Chromium, and an existing PDF in the library. See [docs/reader-performance.md](docs/reader-performance.md) for the full matrix, benchmark variables, and recorded numbers.

```sh
bun run start -- --port 3100
READER_URL=http://localhost:3100 bun run test:reader
READER_URL=http://localhost:3100 bun run test:reader:interactions
READER_URL=http://localhost:3100 BENCH_OUTPUT=/tmp/reader.json bun run benchmark:reader
```

`test:reader` checks HTTP caching/ranges, keyboard navigation, all layouts, crop controls, fractional restoration, bookmarks, paper/themes, focus/dialogs, search focus and retained highlights, Back, thumbnail virtualization, pixel limits, text selection, 320 px/landscape overflow, and accessibility (axe). `test:reader:interactions` checks trusted pinch/double-tap/Ctrl-wheel input and anchoring, actual crop enlargement, tiled high zoom, rapid zoom limits, pointer seeking with exactly one accepted commit, and internal PDF link/Back navigation.

## Performance notes

- Continuous scrolling is the default; single-page and spread modes stay per-book.
- Small PDFs (≤ 1 MiB) stream normally; larger or unknown-size PDFs use on-demand ranges with `disableStream`/`disableAutoFetch` and 64 KiB chunks.
- Visible base rasters share 6 MP; old and incoming together stay within 12 MP; each canvas stays below 3 MP; at most six high-resolution tiles add 6 MP.
- A 390 px throttled Chromium window is an emulation, not a measured phone. See [docs/reader-performance.md](docs/reader-performance.md) for recorded before/after numbers.

## Architecture

- **Storage** (`src/lib/pdf-store.ts`): JSON index + files on disk, serialized mutations, atomic writes, 30-day trash with purge.
- **API** (`src/app/api/pdfs/`): list/upload (raw body), serve with ranges/ETag, delete, restore, cover CRUD.
- **Library** (`src/components/library/`): `useLibrary` hook plus focused modules for model, client, grid, shelf, hero, header, card, artwork, feedback.
- **Reader** (`src/components/reader/`): `PdfReader` orchestrates react-pdf `Document`; `ReaderViewport` computes geometry and windowed rendering; `ReaderPageSurface` manages raster/tile/crop lifecycle; scheduler and raster budget enforce memory limits; search controller extracts and caches text.
- **State** (`reader-state.ts`): preferences, progress, bookmarks, navigation reducer, parsers that preserve legacy formats.

## Deploying

This is a single-server app. It needs Node, a persistent writable disk for `data/`, and one long-lived process. Serverless platforms that freeze or discard the working directory will lose uploads, so run it on a small VM, a home server, or any host that keeps a disk. Put it behind a reverse proxy with authentication if more than one person can reach it. The API answers only to localhost, LAN addresses, and `.local` names unless `BETTER_READER_ALLOWED_HOSTS` is set.
