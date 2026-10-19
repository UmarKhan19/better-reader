// Production interaction checks. Fixtures and settings stay in disposable browsers.
import { requireBrowserRuntime, selectBrowserGroups } from "./lib/browser-groups.mjs";
import { createInteractionReader } from "../tests/browser/reader/cdp.mjs";
import { checkNavigationInteractions } from "../tests/browser/reader/navigation.mjs";
import { checkRenderingInteractions } from "../tests/browser/reader/rendering.mjs";
import { checkGestures } from "../tests/browser/reader/gestures.mjs";

const checks = { navigation: checkNavigationInteractions, rendering: checkRenderingInteractions, gestures: checkGestures };
requireBrowserRuntime();
for (const group of selectBrowserGroups(process.argv.slice(2), Object.keys(checks))) {
  const reader = await createInteractionReader();
  try {
    await reader.start();
    await checks[group](reader);
  } catch (error) {
    try { await reader.diagnose(); } catch {}
    throw error;
  } finally { await reader.cleanup(); }
}
