// Run against a started app: READER_URL=http://localhost:3100 bun run test:reader
// Requires agent-browser. Uses an isolated session and an existing PDF; never uploads or deletes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig, readyExpression } from "./lib/reader-browser.mjs";
import limits from "../src/components/reader/viewport/reader-limits.json" with { type: "json" };

const { origin } = readConfig();
const screenshots = process.env.READER_SCREENSHOTS ? path.resolve(process.env.READER_SCREENSHOTS) : undefined;
const session = `reader-verify-${process.pid}`;
const items = (await (await fetch(`${origin}/api/pdfs`)).json()).items;
const id = process.env.READER_PDF_ID ?? items?.[0]?.id;
assert.match(id ?? "", /^[a-f\d-]{36}$/i, "An existing PDF is required. Set READER_PDF_ID or upload one in the app.");
const url = `${origin}/read/${id}`;
const api = `${origin}/api/pdfs/${id}`;
if (screenshots) await mkdir(screenshots, { recursive: true });
// A global persistent profile can defeat named-session isolation and lock Chrome.
const profile = await mkdtemp(path.join(os.tmpdir(), "better-reader-browser-"));
const browserFlags = ["--session", session, "--profile", profile, "--headed", "false"];
let browserStarted = false;
let cleanupPromise;

const cleanup = () => cleanupPromise ??= (async () => {
  try { if (browserStarted) browser("close"); } catch (error) { console.warn("Browser cleanup:", error.message); }
  await rm(profile, { recursive: true, force: true });
})();
process.once("SIGINT", () => { void cleanup().finally(() => process.exit(130)); });
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });

function browser(...args) {
  const output = execFileSync("agent-browser", [...browserFlags, ...args], {
    encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  browserStarted = args[0] !== "close";
  return output;
}
function evaluate(source) {
  const output = execFileSync("agent-browser", [...browserFlags, "--json", "eval", "--stdin"], {
    input: source, encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
  });
  const result = JSON.parse(output);
  assert.equal(result.success, true, JSON.stringify(result.error));
  return result.data.result;
}
function wait(source) {
  const settled = evaluate(`new Promise(resolve => {
    const deadline=Date.now()+18000;
    let readySince=0;
    function poll() {
      let ready=false;
      try { ready=Boolean(${source}); } catch {}
      if (ready) {
        readySince ||= Date.now();
        if (Date.now()-readySince >= 80) { resolve(true); return; }
      } else readySince=0;
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(poll,20);
    }
    poll();
  })`);
  assert.equal(settled, true, `Readiness was not established: ${source}`);
}
function click(selector) { browser("click", selector); }
function screenshot(name) {
  if (screenshots) browser("screenshot", path.join(screenshots, `${name}.png`));
}
function waitForPage(page) { wait(readyExpression(page)); }
function waitForFitWidth() {
  wait(`(() => { const s=document.querySelector("[data-reader-stage]"), m=document.querySelector("main"); if(!s || !m || s.getAttribute("aria-busy")!=="false") return false; const c=getComputedStyle(m); return Math.abs(s.getBoundingClientRect().width - Math.min(1120, Math.floor(m.clientWidth-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)))) < 2; })()`);
}
function layout() {
  const result = evaluate(`(() => {
    const main = document.querySelector('main'), stage = document.querySelector('[data-reader-stage]');
    const r = main.getBoundingClientRect(), p = stage.getBoundingClientRect();
    return { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
      viewportHeight: innerHeight, viewportWidth: innerWidth,
      centerOffset: Math.abs((p.x + p.width / 2) - (r.x + r.width / 2)),
      headerHeight: document.querySelector('header').getBoundingClientRect().height,
      canvases: stage.querySelectorAll('canvas').length,
      basePixels: [...stage.querySelectorAll('canvas:not([data-reader-tile])')].reduce((sum,c) => sum+c.width*c.height,0),
      tilePixels: [...stage.querySelectorAll('[data-reader-tile]')].reduce((sum,c) => sum+c.width*c.height,0),
      tiles: stage.querySelectorAll('[data-reader-tile]').length,
      maxCanvasPixels: Math.max(0,...[...stage.querySelectorAll('canvas')].map(c => c.width*c.height)),
      mounted: stage.querySelectorAll('[data-cached-page]').length,
      intersecting: [...stage.querySelectorAll('[data-cached-page]')].filter(holder => {
        const h=holder.getBoundingClientRect(); return h.width>0 && h.height>0 && h.bottom>r.top && h.top<r.bottom && h.right>r.left && h.left<r.right;
      }).length };
  })()`);
  assert.ok(result.height <= result.viewportHeight + 1, JSON.stringify(result));
  assert.ok(result.width <= result.viewportWidth, JSON.stringify(result));
  assert.ok(result.centerOffset < 3, JSON.stringify(result));
  // Virtualized continuous pages replace the incumbent three-holder/four-canvas cache.
  assert.ok(result.basePixels <= limits.basePixelBudget, JSON.stringify(result));
  assert.ok(result.tilePixels <= limits.tilePixelBudget && result.tiles <= limits.maxTiles, JSON.stringify(result));
  assert.ok(result.maxCanvasPixels <= limits.pagePixelLimit, JSON.stringify(result));
  assert.ok(result.mounted <= result.intersecting + 2, JSON.stringify(result));
  return result;
}
/** Nearest mounted page that has a real text layer; null when every mounted page is blank or image-only. */
function pageWithText() {
  return evaluate(`(() => {
    const stage=document.querySelector('[data-reader-stage]'), active=Number(stage.dataset.pageNumber);
    const pages=[...stage.querySelectorAll('[data-cached-page]')]
      .filter(h => /[A-Za-z]{4,}/.test(h.querySelector('.textLayer')?.textContent ?? ''))
      .map(h => Number(h.dataset.cachedPage));
    return pages.length ? pages.reduce((a,b) => Math.abs(b-active) < Math.abs(a-active) ? b : a) : null;
  })()`);
}
function setSetting(kind, value) {
  const presentation = kind === "theme" ? "segmented" : "paper";
  click(`dialog[open] [data-presentation="${presentation}"] label:has(input[value="${value}"])`);
  assert.equal(evaluate(`document.querySelector('[data-reader-root]').getAttribute('data-${kind}')`), value);
}

try {
  const head = await fetch(api, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("cache-control"), /^private, max-age=3600/);
  const size = Number(head.headers.get("content-length")), etag = head.headers.get("etag");
  assert.ok(etag);
  assert.equal((await fetch(api, { headers: { "If-None-Match": etag } })).status, 304);
  assert.equal((await fetch(api, { headers: { "If-None-Match": `W/${etag}` } })).status, 304);
  assert.equal((await fetch(api, { headers: { "If-Modified-Since": head.headers.get("last-modified") } })).status, 304);
  const partial = await fetch(api, { headers: { Range: "bytes=0-31" } });
  assert.equal(partial.status, 206);
  assert.equal((await partial.arrayBuffer()).byteLength, 32);
  assert.equal(partial.headers.get("content-range"), `bytes 0-31/${size}`);
  for (const range of ["bytes=-", "bytes=-0", `bytes=${size}-`]) {
    assert.equal((await fetch(api, { headers: { Range: range } })).status, 416);
  }
  const suffix = await fetch(api, { headers: { Range: "bytes=-32", "If-Range": etag } });
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 32);
  const changed = await fetch(api, { headers: { Range: "bytes=0-31", "If-Range": '"old"' } });
  assert.equal(changed.status, 200);
  await changed.body.cancel();
  assert.equal((await fetch(`${origin}/api/pdfs/not-a-uuid`)).status, 404);
  console.log("PASS HTTP caching, validators, byte ranges, HEAD and recovery");

  browser("set", "viewport", "1440", "900");
  browser("open", url);
  wait(readyExpression());
  assert.equal(evaluate("document.querySelector('[data-reader-stage]').dataset.readerLayout"), "continuous");
  browser("press", "/");
  wait("document.activeElement === document.querySelector('[data-reader-search] input')");
  assert.equal(evaluate("document.activeElement.type"), "search");
  click('button[aria-label="Close document navigation"]');
  browser("press", "Control+f");
  wait("document.activeElement === document.querySelector('[data-reader-search] input')");
  click('button[aria-label="Close document navigation"]');
  console.log("PASS keyboard Search opens and focuses the real input");
  const total = evaluate("Number(document.querySelector('header input[aria-label=\"Page number\"]').nextElementSibling.textContent.replace(/[^0-9]/g, ''))");
  const initialPage = evaluate("Number(document.querySelector('[data-reader-stage]').dataset.pageNumber)");
  const samplePage = Math.min(15, total);
  browser("fill", 'header input[aria-label="Page number"]', String(samplePage));
  assert.equal(evaluate("Number(document.querySelector('[data-reader-stage]').dataset.pageNumber)"), initialPage, "Typing must not navigate before Enter");
  browser("press", "Enter");
  waitForPage(samplePage);
  const desktop = layout();
  screenshot("desktop");
  const firstPageMs = evaluate("performance.getEntriesByName('reader:first-page').at(-1)?.startTime");
  if (samplePage < total) {
    wait(`!![...document.querySelectorAll('[data-reader-stage] [data-cached-page="${samplePage + 1}"] canvas')].find(c => c.width > 0 && c.height > 0 && getComputedStyle(c).visibility !== 'hidden')`);
    browser("press", "ArrowRight");
    waitForPage(samplePage + 1);
  }
  let current = Math.min(samplePage + 1, total);
  const pageTurnMs = evaluate("performance.getEntriesByName('reader:page-turn').at(-1)?.duration ?? null");
  console.log("PASS desktop layout and Enter-only page jumps", JSON.stringify({ ...desktop, firstPageMs, cachedPageTurnMs: pageTurnMs }));

  click('header button[aria-label="Toggle document navigation"]');
  browser("find", "role", "tab", "click", "--name", "Pages", "--exact");
  wait("!!document.querySelector('[data-thumbnail-list] canvas')");
  const initialThumbs = evaluate("document.querySelectorAll('[data-thumb-page]').length");
  assert.ok(initialThumbs <= 20, `Mounted ${initialThumbs} thumbnails`);
  evaluate("document.querySelector('[data-thumbnail-list]').scrollTop = document.querySelector('[data-thumbnail-list]').scrollHeight");
  wait(`!!document.querySelector('[data-thumb-page="${total}"]')`);
  const endThumbs = evaluate("document.querySelectorAll('[data-thumb-page]').length");
  assert.ok(endThumbs <= 20);
  console.log("PASS virtualized thumbnails", JSON.stringify({ totalPages: total, initialThumbs, endThumbs }));
  browser("find", "role", "tab", "click", "--name", "Contents", "--exact");
  wait("!!document.querySelector('[data-reader-sidebar] [aria-current=\"location\"]') || document.querySelector('[data-reader-sidebar]').textContent.includes('no table of contents')");
  waitForFitWidth();
  screenshot("desktop-navigation");
  const chapters = evaluate("document.querySelectorAll('[data-reader-sidebar] ol button').length");
  if (chapters) {
    const destination = evaluate("Number(document.querySelector('[data-reader-sidebar] ol button span:last-child').textContent)");
    click('[data-reader-sidebar] ol button:first-child');
    waitForPage(destination);
    browser("fill", 'header input[aria-label="Page number"]', String(current));
    browser("press", "Enter");
    waitForPage(current);
    console.log("PASS resolved outline destinations and active chapter highlighting");
  } else console.log("PASS missing-outline empty state");
  click('button[aria-label="Close document navigation"]');
  waitForFitWidth();

  browser("select", "#reader-view-mode", "actual-size");
  wait("!!document.querySelector('[data-reader-stage][aria-busy=\"false\"]')");
  let activeHolder = `[data-reader-stage] [data-cached-page="${current}"]`;
  let activeTextLayer = `${activeHolder} [aria-hidden="false"] .textLayer`;
  const naturalWidth = evaluate(`document.querySelector('${activeHolder}').getBoundingClientRect().width`);
  for (let i = 0; i < 3; i++) browser("press", "=");
  assert.ok(evaluate("!!document.querySelector('[data-reader-stage] > [data-cached-page]:not([hidden]) canvas')"), "Keep the previous canvas visible during zoom");
  wait("!!document.querySelector('[data-reader-stage][aria-busy=\"false\"]')");
  const zoomWidth = evaluate(`document.querySelector('${activeHolder}').getBoundingClientRect().width`);
  assert.ok(Math.abs(zoomWidth - naturalWidth * 1.3) < 3);
  assert.ok(evaluate(`[...document.querySelectorAll('[data-reader-stage] canvas')].every(c => c.width*c.height <= ${limits.pagePixelLimit + 1})`));
  browser("select", "#reader-view-mode", "fit-width");
  waitForFitWidth();
  console.log("PASS actual-size, rapid zoom, retained canvas and raster budget");

  // Blank and image-only pages are normal in a real book. The reading checks need a
  // page with a text layer, so look at the mounted pages first, then walk outward a
  // little; if the whole neighbourhood has no text, skip those checks loudly.
  let textPage = pageWithText();
  for (let step = 1; !textPage && step <= 5; step++) {
    for (const candidate of [current + step, current - step]) {
      if (candidate < 1 || candidate > total) continue;
      browser("fill", 'header input[aria-label="Page number"]', String(candidate));
      browser("press", "Enter");
      waitForPage(candidate);
      textPage = pageWithText();
      if (textPage) break;
    }
  }
  if (textPage) {
    if (textPage !== current) {
      browser("fill", 'header input[aria-label="Page number"]', String(textPage));
      browser("press", "Enter");
      waitForPage(textPage);
      current = textPage;
      activeHolder = `[data-reader-stage] [data-cached-page="${current}"]`;
      activeTextLayer = `${activeHolder} [aria-hidden="false"] .textLayer`;
    }
    wait(`!![...document.querySelectorAll('${activeTextLayer} span')].find(s => s.textContent.length > 3)`);
    const selectedText = evaluate(`(() => {
      const span=[...document.querySelectorAll('${activeTextLayer} span')].find(s => s.textContent.length > 3);
      const range=document.createRange(); range.selectNodeContents(span);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      return getSelection().toString();
    })()`);
    evaluate("document.querySelector('main').scrollTop += 5");
    // Negative invariant: let scroll effects and asynchronous text rendering settle.
    browser("wait", "300");
    assert.equal(evaluate("getSelection().toString()"), selectedText, "Scrolling must not rebuild the selected text layer");
    evaluate("getSelection().removeAllRanges()");
    browser("fill", 'header input[aria-label="Page number"]', String(current));
    browser("press", "Enter");
    waitForPage(current);
    console.log("PASS text selection survives scrolling");
  } else {
    console.log(`SKIP text selection: pages around ${current} have no text layer (blank or image-only pages)`);
  }

  for (const mode of ["single", "spread", "continuous"]) {
    click('button[aria-label="Reading settings"]');
    browser("select", 'dialog[open] label:has(option[value="continuous"]) select', mode);
    click('button[aria-label="Close reading settings"]');
    wait(`document.querySelector('[data-reader-stage]').dataset.readerLayout === '${mode}'`);
    waitForPage(current);
    layout();
    if (mode === "single") assert.equal(evaluate("document.querySelectorAll('[data-cached-page]:not([aria-hidden])').length"), 1);
    if (mode === "spread") {
      const expected = current % 2 === 1 && current === total ? 1 : 2;
      assert.equal(evaluate("document.querySelectorAll('[data-cached-page]:not([aria-hidden])').length"), expected);
    }
  }
  click('button[aria-label="Reading settings"]');
  click('dialog[open] input[role="switch"]');
  click('button[aria-label="Close reading settings"]');
  waitForPage(current);
  layout();
  click('button[aria-label="Reading settings"]');
  assert.equal(evaluate("document.querySelector('dialog[open] input[role=\"switch\"]').checked"), true);
  click('dialog[open] input[role="switch"]');
  click('button[aria-label="Close reading settings"]');
  waitForPage(current);
  console.log("PASS all saved layouts, Fit content toggle and per-window raster budgets");

  // A fractional scroll must survive reload without turning into a page-top jump.
  evaluate(`(() => {
    const holder=document.querySelector('${activeHolder}'), main=document.querySelector('main');
    main.scrollTop += holder.getBoundingClientRect().height * 0.25;
  })()`);
  wait(`(() => { const stage=document.querySelector('[data-reader-stage]'), holder=stage.querySelector('[data-cached-page="'+stage.dataset.pageNumber+'"]'); return holder.getBoundingClientRect().top < document.querySelector('main').getBoundingClientRect().top - 20; })()`);
  wait(`(() => { const saved=JSON.parse(localStorage.getItem('better-reader:progress:${id}') ?? 'null'); return saved?.page === ${current} && saved.offset > 0 && saved.offset < 1; })()`);
  const savedLocation = evaluate(`JSON.parse(localStorage.getItem('better-reader:progress:${id}'))`);
  assert.equal(savedLocation.page, current);
  assert.ok(savedLocation.offset > 0 && savedLocation.offset < 1);
  browser("reload");
  waitForPage(current);
  const restoredOffset = evaluate(`(() => { const h=document.querySelector('${activeHolder}').getBoundingClientRect(), m=document.querySelector('main').getBoundingClientRect(); return (m.top-h.top)/h.height; })()`);
  assert.ok(Math.abs(restoredOffset - savedLocation.offset) < 0.02, JSON.stringify({ restoredOffset, savedLocation }));
  // Return to a page top before testing page controls and persisted bookmarks.
  browser("fill", 'header input[aria-label="Page number"]', String(current));
  browser("press", "Enter");
  waitForPage(current);
  console.log("PASS fractional continuous progress and reload anchoring");

  if (current < total) {
    browser("focus", 'input[aria-label="Seek to page"]');
    browser("press", "ArrowRight");
    waitForPage(current + 1);
    click('button[aria-label="Back to previous location"]');
    waitForPage(current);
    console.log("PASS keyboard scrubber commit and Back navigation");
  }

  click('header button[aria-label="Bookmark this page"]');
  assert.equal(evaluate("document.querySelector('header button[aria-label=\"Remove bookmark\"]').getAttribute('aria-pressed')"), "true");
  click('button[aria-label="Reading settings"]');
  setSetting("theme", "dark");
  setSetting("paper", "sepia");
  browser("select", 'dialog[open] label:has(option[value="fit-page"]) select', "fit-page");
  screenshot("desktop-settings");
  click('button[aria-label="Close reading settings"]');
  waitForPage(current);
  assert.ok(evaluate(`document.querySelector('${activeHolder}').getBoundingClientRect().height <= document.querySelector('main').clientHeight - 50`));
  screenshot("desktop-dark");
  browser("reload");
  waitForPage(current);
  assert.equal(evaluate("document.querySelector('[data-reader-root]').dataset.theme"), "dark");
  assert.equal(evaluate("document.querySelector('[data-reader-root]').dataset.paper"), "sepia");
  assert.ok(evaluate("!!document.querySelector('header button[aria-label=\"Remove bookmark\"]')"));
  console.log("PASS bookmarks and per-book theme, paper, sizing and progress persistence");

  browser("press", "z");
  wait("document.querySelector('[data-reader-root]').dataset.focusMode === 'true'");
  assert.ok(evaluate("document.querySelector('header').inert"));
  browser("press", "?");
  wait("!!document.querySelector('dialog[open]')");
  browser("press", "Escape");
  wait("!document.querySelector('dialog[open]')");
  browser("press", "Escape");
  assert.equal(evaluate("document.querySelector('[data-reader-root]').dataset.focusMode"), "false");
  console.log("PASS focus mode, shortcut help and Escape recovery");

  browser("set", "viewport", "390", "844");
  click('button[aria-label="Reading settings"]');
  setSetting("theme", "light");
  setSetting("paper", "original");
  browser("select", 'dialog[open] label:has(option[value="fit-page"]) select', "fit-width");
  screenshot("mobile-settings");
  click('button[aria-label="Close reading settings"]');
  waitForPage(current);
  waitForFitWidth();
  const mobile = layout();
  assert.ok(mobile.headerHeight <= 70);
  assert.ok(evaluate(`[...document.querySelectorAll('header button, nav button, nav input')].filter(e => e.getBoundingClientRect().width > 0).every(e => { const r=e.getBoundingClientRect(); return r.width >= 43 && r.height >= 43; })`));
  screenshot("mobile");
  click('nav button[aria-label="Toggle document navigation"]');
  wait("!!document.querySelector('dialog[open]')");
  browser("find", "role", "tab", "click", "--name", "Bookmarks", "--exact");
  assert.ok(evaluate(`!!document.querySelector('dialog[open] button[aria-current="page"]')`));
  browser("press", "Tab");
  assert.ok(evaluate("!!document.activeElement.closest('dialog[open]')"));
  screenshot("mobile-navigation");
  browser("press", "Escape");
  wait("!document.querySelector('dialog[open]')");
  console.log("PASS mobile controls, bookmark navigation and modal keyboard focus", JSON.stringify(mobile));

  if (textPage) {
    wait(`!![...document.querySelectorAll('${activeTextLayer} span')].find(s => /[a-zA-Z]{4,}/.test(s.textContent))`);
    const query = evaluate(`[...document.querySelectorAll('${activeTextLayer} span')].map(s => s.textContent.match(/[a-zA-Z]{4,}/)?.[0]).find(Boolean)`);
    const departure = current === 1 ? Math.min(2, total) : 1;
    browser("fill", 'nav input[aria-label="Page number"]', String(departure));
    browser("press", "Enter");
    waitForPage(departure);
    click('button[aria-label="Search document"]');
    wait("!!document.querySelector('dialog[open] [data-reader-search] input') && document.activeElement === document.querySelector('dialog[open] [data-reader-search] input')");
    browser("fill", 'dialog[open] [data-reader-search] input', query);
    wait(`!!document.querySelector('[data-search-result-page="${current}"]')`);
    screenshot("mobile-search");
    click(`[data-search-result-page="${current}"]`);
    wait("!document.querySelector('dialog[open]')");
    waitForPage(current);
    // A match may be split across several original PDF text items and mark nodes.
    wait(`[...document.querySelectorAll('${activeTextLayer} mark')].map(m => m.textContent).join('').toLowerCase().includes(${JSON.stringify(query.toLowerCase())})`);
    const visibleMarks = evaluate(`[...document.querySelectorAll('${activeTextLayer} mark')].map(m => m.textContent)`);
    assert.ok(visibleMarks.join("").toLowerCase().includes(query.toLowerCase()),
      `Visible page marks must survive closing the mobile drawer: ${JSON.stringify({ query, visibleMarks })}`);
    screenshot("mobile-search-result");
    click('button[aria-label="Search document"]');
    wait("document.activeElement === document.querySelector('dialog[open] [data-reader-search] input')");
    assert.equal(evaluate("document.querySelector('[data-reader-search] input').value"), query);
    assert.ok(evaluate(`!!document.querySelector('[data-search-result-page="${current}"]')`), "Same-query results stay available when reopening Search");
    browser("focus", 'dialog[open] [data-reader-search] input');
    browser("press", "Control+a");
    browser("press", "Backspace");
    wait(`!document.querySelector('${activeTextLayer} mark') && !document.querySelector('[data-search-result-page]')`);
    browser("press", "Escape");
    wait("!document.querySelector('dialog[open]')");
    click('button[aria-label="Back to previous location"]');
    waitForPage(departure);
    console.log("PASS mobile Search focus, result-click drawer close, retained page marks/results, explicit clear and Back");
  } else {
    console.log(`SKIP mobile search checks: no text layer near page ${current}`);
  }

  browser("set", "viewport", "320", "640");
  waitForFitWidth();
  layout();
  browser("set", "viewport", "844", "390");
  waitForFitWidth();
  layout();
  console.log("PASS small-screen and landscape overflow checks");

  browser("set", "viewport", "390", "844");
  const audit = JSON.parse(browser("--json", "a11y"));
  assert.equal(audit.success, true);
  const report = audit.data.result ?? audit.data;
  assert.ok(Array.isArray(report.violations), "Unexpected accessibility report schema");
  const violations = report.violations;
  assert.equal(violations.length, 0, JSON.stringify(violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }))));
  console.log("PASS accessibility audit");
  const errors = browser("errors");
  assert.ok(!errors.includes("Error:"), errors);
  console.log("PASS browser errors");
} catch (error) {
  try { screenshot("failure"); console.error(browser("snapshot", "-i")); console.error(browser("errors")); } catch {}
  throw error;
} finally {
  await cleanup();
}
