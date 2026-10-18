# Better Kindle

A personal PDF library and reader for the browser. Upload your own PDFs, they are
stored on this machine, and you read them with a scroll-first reader that remembers
your page, bookmarks and preferences per book.

## Run it

Requires [Bun](https://bun.sh) (or Node 22+ with npm).

```sh
bun install
bun run dev        # http://127.0.0.1:3000
```

For the production build:

```sh
bun run build
bun run start      # http://127.0.0.1:3000
```

Both commands bind to `127.0.0.1`, so only this machine can reach the app. There is
no login: anyone who can open the URL can read, upload and delete your books.

To read from your phone on the same network, expose it deliberately:

```sh
bun run start -- --hostname 0.0.0.0
```

Then open `http://<this-machine-ip>:3000`. Anyone on that network can reach the same
library, so only do this on a network you trust.

The API answers only to localhost, LAN addresses and `.local` names. Something that
reaches it under another hostname — a reverse proxy, say — must be allowed first:

```sh
BETTER_KINDLE_ALLOWED_HOSTS=books.home.lan bun run start
```

This is what stops a hostile web page from pointing its own domain at
`127.0.0.1` and reading your library through the browser.

Run one server process at a time against the same `data/` folder. The library index
is a JSON file, and the server serializes writes inside itself only.

## Where your files live

Everything is under `data/` in the project folder:

- `data/uploads/` the original PDFs, byte for byte
- `data/covers/` cover images
- `data/pdfs.json` the library index
- `data/trash/` deleted PDFs and covers, plus `data/trash.json`. Deleted books can be
  undone from the library for 30 days, then they are purged on the next delete or
  restore.

Back up the library by copying `data/`. The app never rewrites an uploaded PDF.

## Checks

```sh
bun test                                   # unit tests (file store, parsers, budgets)
bun run lint
bun run build
```

The reader checks drive a real browser against a running production server. They need
Node 22+, an existing Chromium and an existing PDF in the library. See
[docs/reader-performance.md](docs/reader-performance.md) for the full matrix,
benchmark variables and recorded numbers.

```sh
bun run start -- --port 3100
READER_URL=http://localhost:3100 bun run test:reader
READER_URL=http://localhost:3100 bun run test:reader:interactions
READER_URL=http://localhost:3100 BENCH_OUTPUT=/tmp/reader.json bun run benchmark:reader
```

## Deploying

This is a single-server app. It needs Node, a persistent writable disk for `data/`
and one long-lived process. Serverless platforms that freeze or discard the working
directory will lose uploads, so run it on a small VM, a home server or any host that
keeps a disk. Put it behind a reverse proxy with authentication if more than one
person can reach it.
