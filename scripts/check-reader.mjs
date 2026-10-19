// External-server checks never upload or delete. Each group gets its own browser profile.
import assert from "node:assert/strict";
import { requireBrowserRuntime, selectBrowserGroups } from "./lib/browser-groups.mjs";
import { createAgentReader } from "../tests/browser/reader/agent.mjs";
import { checkNavigation } from "../tests/browser/reader/navigation.mjs";
import { checkSearch } from "../tests/browser/reader/search.mjs";
import { checkRendering } from "../tests/browser/reader/rendering.mjs";

const checks = { navigation: checkNavigation, search: checkSearch, rendering: checkRendering };
requireBrowserRuntime();
for (const group of selectBrowserGroups(process.argv.slice(2), Object.keys(checks))) {
  const reader = await createAgentReader(group);
  try {
    reader.open();
    await checks[group](reader);
    const errors = reader.browser("errors");
    assert.ok(!errors.includes("Error:"), errors);
    console.log(`PASS ${group} browser errors`);
  } catch (error) {
    try { reader.screenshot("failure"); console.error(reader.browser("snapshot", "-i")); console.error(reader.browser("errors")); } catch {}
    throw error;
  } finally { await reader.cleanup(); }
}
