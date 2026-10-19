export const browserGroups = {
  navigation: [["scripts/check-reader.mjs", "navigation"], ["scripts/check-reader-interactions.mjs", "navigation"]],
  search: [["scripts/check-reader.mjs", "search"]],
  rendering: [["scripts/check-reader.mjs", "rendering"], ["scripts/check-reader-interactions.mjs", "rendering"]],
  gestures: [["scripts/check-reader-interactions.mjs", "gestures"]],
  library: [["tests/browser/library.mjs"]],
};

export function selectBrowserGroups(args, available = Object.keys(browserGroups)) {
  const names = args[0] === "--" ? args.slice(1) : args;
  for (const name of names) {
    if (!available.includes(name)) throw new Error(`Unknown browser group: ${name}. Choose ${available.join(", ")}.`);
  }
  return [...new Set(names.length ? names : available)];
}

export function requireBrowserRuntime(version = process.versions.node) {
  if (Number(version.split(".")[0]) < 22) throw new Error("Browser checks require Node 22+.");
}

export function isolatedBrowserEnv(env, library, origin, group) {
  return {
    ...env,
    BETTER_READER_DATA_DIR: library.directory,
    READER_URL: origin,
    READER_PDF_ID: library.id,
    READER_REQUIRE_TEXT: "1",
    READER_DISPOSABLE_LIBRARY: group === "library" ? "1" : "0",
  };
}
