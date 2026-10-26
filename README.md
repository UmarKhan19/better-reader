<!-- prettier-ignore -->
<div align="center">

<img src="./public/logo.png" alt="Better Reader logo" width="320" />

# Better Reader

_A self-hosted PDF library that remembers your place._

[![Bun](https://img.shields.io/badge/Bun-1.3.14+-000?style=flat-square&logo=bun)](https://bun.sh)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Features](#features) · [Quick start](#quick-start) · [Data and backups](#data-and-backups) · [Development](#development) · [Documentation](#documentation)

</div>

Better Reader is a single-user PDF library for desktop and mobile browsers. Upload PDFs, add cover art, and return to your saved reading position. Files stay on the server's disk and are never rewritten. Reading progress stays in your browser. No database or cloud API key is required.

> [!WARNING]
> There is no login. Anyone who can reach the app can read, upload, or delete PDFs. Keep it on a trusted machine or network, or put it behind an authenticated reverse proxy. The Host guard helps block DNS rebinding; it is not authentication.

![Better Reader's poster-style library with a featured book and upload controls](./docs/screenshots/library.png)

<details>
<summary>See the desktop and mobile reader</summary>

![Desktop reader with page controls, search, and chapter seeking](./docs/screenshots/reader.png)

<img src="./docs/screenshots/reader-mobile.png" alt="Mobile reader with continuous pages and compact navigation" width="280" />

</details>

## Features

### Your library

- Upload multiple PDFs by file picker or drag-and-drop, with progress, per-file results, and retry for failed uploads.
- Add or replace cover art, or use the generated poster artwork. Filter by filename or display title; sort by newest upload or name.
- Resume books from the reading shelf. Delete with undo and a 30-day trash retention policy.

### Your reader

- Read with continuous scrolling, single pages, or a desktop two-page spread. Save layout, sizing, and paper preferences per book.
- Return to your saved spot within a page, save bookmarks, and retrace jumps with location history.
- Search text with highlighted results, browse contents or page thumbnails, and seek by chapter. OCR is not included, so image-only pages are not searchable.
- Pinch, double-tap, or Ctrl-wheel to zoom. Hide blank margins, enter focus mode or fullscreen, and navigate with keyboard shortcuts.
- Choose light, dark, or system interface themes, with original, dimmed, sepia, or dark paper.

Visible pages take priority over prefetch and previews, with bounded canvas allocations. PDFs up to 1 MiB stream normally; larger or unknown-size files load through on-demand byte ranges. See the [reader performance guide](./docs/reader-performance.md) for limits and measurement caveats.

## Quick start

Install [Bun 1.3.14+](https://bun.sh) and [Node.js 22+](https://nodejs.org). Node must be available as `node` for the background indexing worker. From the repository root:

```bash
bun install
bun run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), choose **Upload**, and select a PDF. Click its cover to start reading.

To run a production build:

```bash
bun run build
bun run start
```

Both development and production servers bind to `127.0.0.1` by default. See [deployment](#deployment) for LAN access and hosting requirements.

## Configuration

Defaults work for local use. Set these in `.env.local` or the server's environment, then restart the server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BETTER_READER_DATA_DIR` | `./data` | Persistent library directory. Prefer an absolute path for deployment. |
| `BETTER_READER_ALLOWED_HOSTS` | Localhost, private-network addresses, and `.local` names | Additional comma-separated hostnames, such as `books.example.com` behind a reverse proxy. This does not add authentication. |

## Data and backups

The server stores the following under `BETTER_READER_DATA_DIR`:

| Path | Contents |
| --- | --- |
| `uploads/` | Original PDF bytes |
| `covers/` | Uploaded cover images |
| `pdfs.json` | Library metadata |
| `trash/pdfs/`, `trash/covers/`, `trash.json` | Deleted files and restore metadata |
| `ai/<book-id>/index.json` | Extracted passages and embeddings for one book |
| `ai/models/` | Downloaded embedding model cache |

Stop the server before copying this directory for a consistent backup. Expired trash is purged on a later delete or restore. Deleted books retain their AI index until purge, but cannot return search evidence. Derived indexes can be regenerated; protect them like the PDFs because they contain extracted book text.

> [!NOTE]
> Progress, bookmarks, theme, and reader settings live in browser `localStorage`, not in the server backup. They are specific to that browser and site address, do not sync between devices, and are lost if you clear site storage. The PDF library remains on disk.

## How it works

The Next.js and React app serves the library UI and HTTP API. PDF.js renders original documents in the browser through endpoints with byte ranges, ETags, and conditional requests. Filesystem mutations share a process-wide queue, and JSON metadata is published through temporary-file renames.

The main implementation boundaries are:

- `src/components/library/` and `src/components/reader/` own the library and reader interfaces; `src/lib/browser-storage.ts` and `src/lib/reading-progress.ts` keep progress and preferences in browser storage.
- `src/app/api/pdfs/` adapts upload, library, and file requests; `src/lib/server/pdf-store/` owns PDF bytes, metadata, covers, and trash on disk.
- `src/lib/server/book-index/` extracts text in a separate Node worker, builds local embeddings, and returns bounded passages with page references. `src/lib/server/http/` owns host checks and PDF byte-range responses.

There is no database service to provision. This is a single-user app without built-in authentication; do not expose it to an untrusted network without adding an authenticated boundary and upload limits.

### Background text indexing

Uploads and restores queue text extraction and local embeddings in a separate, low-priority Node process. Startup checks existing books for missing, corrupt, or outdated indexes. Reading and uploads do not wait for indexing to finish.

The first text-bearing book downloads the pinned `Xenova/bge-small-en-v1.5` model revision in quantized q8 form from Hugging Face into `ai/models/`. Inference then runs locally using the cache. Book text and questions are not sent to an external model service.

This is separate from the reader's literal text search. There is no chat UI or LLM integration. The server-only [`searchBook(id, question)`](./src/lib/server/book-index/index.ts) helper returns up to ten passages with page numbers and scores. Questions are limited to 2,000 characters and 256 model tokens.

Completed indexes are published atomically. Indexing failures are logged and retried on server startup or book restore; interrupted builds restart from the beginning. A worker crash does not stop reading or uploads.

## Deployment

- Run one long-running application server per data directory, with persistent, writable storage. The mutation queue does not coordinate multiple server instances. Serverless or ephemeral filesystems are not supported.
- Keep `src/lib/server/book-index/*.mjs` and installed dependencies alongside the production build. The worker runs directly with Node, outside Next.js bundling. Start from the repository root.
- For a custom proxy hostname, set `BETTER_READER_ALLOWED_HOSTS` and configure authentication at the proxy.

For access from another device on a trusted LAN, start the production server with:

```bash
bun run start -- --hostname 0.0.0.0
```

Then open `http://<server-lan-ip>:3000`. This exposes the same unauthenticated library to your network.

## Development

| Command | Purpose |
| --- | --- |
| `bun run check` | Route type generation, application/worker typechecking, lint, import rules, and unit tests |
| `bun test` | Unit tests with disposable library storage |
| `bun run test:coverage` | Unit tests with a coverage report |
| `bun run build` | Production build |
| `bun run test:browser` | Browser workflows against an isolated production server |

Browser checks require a production build, Chromium, and the `agent-browser` CLI. Set `CHROME_BIN` if Chromium is not at `/usr/bin/chromium`. The suite owns its synthetic library and browser profiles, verifies original bytes afterward, and avoids model downloads.

Run all groups with `bun run test:browser`, or select `navigation`, `search`, `rendering`, `gestures`, or `library`, for example `bun run test:browser -- search`.

For external-server checks and benchmarks, use `READER_URL`, `READER_PDF_ID`, and `READER_PDF_IDS` as described in the [performance guide](./docs/reader-performance.md#run-the-checks). Synthetic browser checks do not establish real-device performance or embedding quality.

## Documentation

- [Architecture and change guide](./docs/architecture.md): module ownership, invariants, and focused checks.
- [Reader performance](./docs/reader-performance.md): loading policy, allocation limits, and benchmarking.
- [Product](./PRODUCT.md): supported behavior and constraints.
- [Design](./DESIGN.md): library visuals, tokens, and shared controls.
- [Domain terms](./CONTEXT.md): book, location, passage, and storage terminology.
