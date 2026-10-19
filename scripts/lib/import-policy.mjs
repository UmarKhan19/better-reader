// Shared by eslint.config.mjs and scripts/import-rules.test.mjs. A pure module
// may not import React, UI components, hooks or other non-pure modules.
export const pureModules = [
  "lib/reading-progress",
  "components/reader/reader-preferences",
  "components/reader/navigation/reader-navigation",
  "components/reader/navigation/reader-outline",
  "components/reader/search/reader-search-state",
  "components/reader/chrome/reader-ui-state",
  "components/reader/chrome/reader-thumbnails",
  "components/reader/chrome/reader-scrubber-state",
  ...["geometry", "crop", "tiles", "raster-budget", "render-state", "render-window", "render-scheduler", "text-renderer", "performance"]
    .map((name) => `components/reader/viewport/reader-${name}`),
  "components/reader/viewport/reader-limits.json",
];
