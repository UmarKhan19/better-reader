# Browser checks and benchmarks

- These entry scripts run under Node 22+, outside Next's bundle. Keep browser launch/cleanup in `lib/reader-launch.mjs`, CDP/readiness in `lib/reader-cdp.mjs`, and config/expressions in `lib/reader-expressions.mjs`; fixtures live in `tests/fixtures/` and browser scenarios in `tests/browser/`.
- Use `bun run test:browser` for an agent-owned production server, synthetic library and disposable profiles. Each named group establishes its own starting state and also runs on its own.
- Library mutation scenarios require the runner's explicit disposable-library flag and data directory. External-server reader checks and benchmarks preserve library files.
- Keep scenario selectors aligned with the application's `data-reader-*`, accessibility labels, readiness and performance marks. Preserve allocation checks when reorganizing rendering scenarios.
- The prebuilt fixture index and textless upload fixtures keep smoke tests offline. Real-model quality and physical-device performance are separate checks.
- Changes to group selection, configuration or fixture setup need a colocated `node:test` case under Bun. Run the affected browser group after building when runtime wiring changes.
