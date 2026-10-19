# Working on Better Reader

Better Reader is a single-user, disk-backed PDF library with browser-local reading state. Keep source PDFs and existing saved-state formats intact.

## Find the owner

- For a behavior change, read [docs/architecture.md](docs/architecture.md) for flows, ownership and the matching checks.
- For product behavior, read [PRODUCT.md](PRODUCT.md). For library visuals, read [DESIGN.md](DESIGN.md). For domain terminology, read [CONTEXT.md](CONTEXT.md).
- For rendering, gestures or loading changes, read [docs/reader-performance.md](docs/reader-performance.md) and the scoped reader instructions.
- Use CodeGraph when available, then inspect current source and callers. The graph is a navigation aid, not a substitute for tests.

## Verify the change

Run `bun run check` after source changes. It includes route type generation, application/worker typechecking, import rules, lint and unit tests. Tests normally use `node:test` under Bun; the preload mock test uses `bun:test` deliberately.

For reader interaction or runtime wiring changes, also build and run `bun run test:browser`. It owns a disposable library, browser profiles and production server. Prerequisites and targeted test paths are in the architecture guide.

## Protect local work

- Use a disposable `BETTER_READER_DATA_DIR` for an agent-owned server. Leave the user's server and personal library alone.
- Keep tests next to their owner. Filesystem-backed tests import `tests/helpers/library.ts` before store/route modules and reset their fixture before each case.
- Normal source searches use `.ignore`. Read generated/vendor files or the lockfile explicitly only when the task requires them. Keep private library data out of search indexes and model context.
- Update callers, colocated tests, worker launch paths and documentation pointers when moving code. Preserve Next's generated instructions below.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
