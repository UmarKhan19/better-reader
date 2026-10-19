# Working on Better Reader

Better Reader is a single-user, disk-backed PDF library with browser-local reading state. Keep source PDFs and existing saved-state formats intact.

## Find the owner

- Orientation: repo directory `better-kindle`, package `better-reader`, product "Better Reader"; do not rename them.
- For a behavior change, read [docs/architecture.md](docs/architecture.md) for flows, ownership and the matching checks.
- For product behavior, read [PRODUCT.md](PRODUCT.md). For library visuals, read [DESIGN.md](DESIGN.md). For domain terminology, read [CONTEXT.md](CONTEXT.md).
- For rendering, gestures or loading changes, read [docs/reader-performance.md](docs/reader-performance.md) and the scoped reader instructions.
- Use CodeGraph when available, then inspect current source and callers. The graph is a navigation aid, not a substitute for tests.

## Scoped instructions

- Read [src/components/reader/AGENTS.md](src/components/reader/AGENTS.md) before changing reader composition, rendering, gestures or loading.
- Read [src/lib/server/AGENTS.md](src/lib/server/AGENTS.md) before changing routes, the PDF store, book indexing or HTTP streaming.
- Read [scripts/AGENTS.md](scripts/AGENTS.md) before changing browser checks, benchmarks or their shared script helpers.
- Read [tests/browser/AGENTS.md](tests/browser/AGENTS.md) before changing browser scenarios, fixtures or group selection.

`public/pdf.worker.min.mjs` is a vendored copy of `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`; replace it from the installed package, never edit it by hand.

## Verify the change

Run `bun run check` after source changes. It includes route type generation, application/worker typechecking, import rules, lint and unit tests. Tests normally use `node:test` under Bun; the preload mock test uses `bun:test` deliberately.

For reader interaction or runtime wiring changes, also build and run `bun run test:browser`. It owns a disposable library, browser profiles and production server. Prerequisites and targeted test paths are in the architecture guide.

## Protect local work

- Use a disposable `BETTER_READER_DATA_DIR` for an agent-owned server. Leave the user's server and personal library alone.
- Keep tests next to their owner. `tests/preload.ts` configures a disposable data directory before test modules load; filesystem-backed tests still import `tests/helpers/library.ts` for reset and cleanup.
- Normal source searches use `.ignore`. Read generated/vendor files or the lockfile explicitly only when the task requires them. Keep private library data out of search indexes and model context.
- Update callers, colocated tests, worker launch paths and documentation pointers when moving code. Preserve Next's generated instructions below.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
