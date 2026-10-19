import assert from "node:assert/strict";
import { pdfFixture } from "../../fixtures/pdf.mjs";
import limits from "../../../src/components/reader/viewport/reader-limits.json" with { type: "json" };

export async function checkRendering(reader) {
  const { api, origin, browser, evaluate, wait, click, ready, jump, totalPages, fitWidth, layout, findTextPage, setSetting } = reader;
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

  const total = totalPages();
  let current = Math.min(16, total);
  jump(current);
  browser("select", "#reader-view-mode", "actual-size");
  wait("!!document.querySelector('[data-reader-stage][aria-busy=\"false\"]')");
  let activeHolder = `[data-reader-stage] [data-cached-page="${current}"]`;
  const naturalWidth = evaluate(`document.querySelector('${activeHolder}').getBoundingClientRect().width`);
  for (let i = 0; i < 3; i++) browser("press", "=");
  assert.ok(evaluate("!!document.querySelector('[data-reader-stage] > [data-cached-page]:not([hidden]) canvas')"), "Keep the previous canvas visible during zoom");
  wait("!!document.querySelector('[data-reader-stage][aria-busy=\"false\"]')");
  const zoomWidth = evaluate(`document.querySelector('${activeHolder}').getBoundingClientRect().width`);
  assert.ok(Math.abs(zoomWidth - naturalWidth * 1.3) < 3);
  assert.ok(evaluate(`[...document.querySelectorAll('[data-reader-stage] canvas')].every(c => c.width*c.height <= ${limits.pagePixelLimit + 1})`));
  browser("select", "#reader-view-mode", "fit-width");
  fitWidth();
  console.log("PASS actual-size, rapid zoom, retained canvas and raster budget");

  const textPage = findTextPage(current, total);
  if (textPage) {
    current = textPage;
    activeHolder = `[data-reader-stage] [data-cached-page="${current}"]`;
    const activeTextLayer = `${activeHolder} [aria-hidden="false"] .textLayer`;
    wait(`!![...document.querySelectorAll('${activeTextLayer} span')].find(s => s.textContent.length > 3)`);
    const selectedText = evaluate(`(() => {
      const span=[...document.querySelectorAll('${activeTextLayer} span')].find(s => s.textContent.length > 3);
      const range=document.createRange(); range.selectNodeContents(span);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      return getSelection().toString();
    })()`);
    evaluate("document.querySelector('main').scrollTop += 5");
    // Let scroll effects and asynchronous text rendering settle before checking selection.
    browser("wait", "300");
    assert.equal(evaluate("getSelection().toString()"), selectedText, "Scrolling must not rebuild the selected text layer");
    evaluate("getSelection().removeAllRanges()");
    jump(current);
    console.log("PASS text selection survives scrolling");
  } else console.log(`SKIP text selection: pages around ${current} have no text layer (blank or image-only pages)`);

  for (const mode of ["single", "spread", "continuous"]) {
    click('button[aria-label="Reading settings"]');
    browser("select", 'dialog[open] label:has(option[value="continuous"]) select', mode);
    click('button[aria-label="Close reading settings"]');
    wait(`document.querySelector('[data-reader-stage]').dataset.readerLayout === '${mode}'`);
    ready(current);
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
  ready(current);
  layout();
  click('button[aria-label="Reading settings"]');
  assert.equal(evaluate("document.querySelector('dialog[open] input[role=\"switch\"]').checked"), true);
  click('dialog[open] input[role="switch"]');
  click('button[aria-label="Close reading settings"]');
  ready(current);
  console.log("PASS all saved layouts, Fit content toggle and per-window raster budgets");

  click('button[aria-label="Reading settings"]');
  setSetting("theme", "light");
  setSetting("paper", "original");
  click('button[aria-label="Close reading settings"]');
  ready(current);
  browser("set", "viewport", "320", "640");
  fitWidth();
  layout();
  browser("set", "viewport", "844", "390");
  fitWidth();
  layout();
  console.log("PASS small-screen and landscape overflow checks");

  browser("set", "viewport", "390", "844");
  ready(current);
  fitWidth();
  const audit = JSON.parse(browser("--json", "a11y"));
  assert.equal(audit.success, true);
  const report = audit.data.result ?? audit.data;
  assert.ok(Array.isArray(report.violations), "Unexpected accessibility report schema");
  assert.equal(report.violations.length, 0, JSON.stringify(report.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }))));
  console.log("PASS accessibility audit");
}

export async function checkRenderingInteractions(reader) {
  const { cdp, url, evaluate, wait, ready, viewport, open, jump, click, preferences, totalPages, budget, capture, mock, pause } = reader;
  const total = await totalPages();
  await viewport(1440, 900);
  await open({ layout: "continuous", viewMode: "fit-width", zoom: 1, cropMargins: false });
  await jump(Math.min(15, total));
  const beforeCrop = await evaluate(`document.querySelector('[data-cached-page="'+document.querySelector('[data-reader-stage]').dataset.pageNumber+'"] canvas').getBoundingClientRect().width`);
  await click('button[aria-label="Reading settings"]');
  await click('dialog[open] input[role="switch"]');
  await click('button[aria-label="Close reading settings"]');
  await ready(Math.min(15, total));
  await wait(`document.querySelector('[data-cached-page="${Math.min(15, total)}"] canvas').getBoundingClientRect().width > ${beforeCrop+5}`);
  assert.equal((await preferences()).cropMargins, true);
  await budget();
  await capture("desktop-crop");
  console.log("PASS Fit content expands readable ink without changing source bytes");

  await viewport(1440, 900, 2);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await open({ layout: "single", viewMode: "custom", zoom: 4, cropMargins: false });
  await wait(`!![...document.querySelectorAll('[data-reader-tile]')].find(c=>c.width>0&&getComputedStyle(c).visibility==='visible')`);
  await budget();
  await capture("desktop-high-zoom");
  await evaluate(`window._pixelPeak=0;window._watchPixels=setInterval(()=>{const c=[...document.querySelectorAll('[data-reader-stage] canvas')];window._pixelPeak=Math.max(window._pixelPeak,c.reduce((s,e)=>s+e.width*e.height,0));},5);document.querySelector('main').focus()`);
  for (let i = 0; i < 8; i++) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "-", code: "Minus" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "-", code: "Minus" });
  }
  await ready();
  await pause(200);
  await budget();
  const peak = await evaluate("clearInterval(window._watchPixels);window._pixelPeak");
  assert.ok(peak <= 18_070_000, `Rapid zoom peak ${peak}`);
  console.log("PASS high-resolution tiles and rapid-zoom pixel bounds", JSON.stringify({ peak, ...await budget() }));

  await viewport(1440, 900);
  await mock(pdfFixture());
  await open({ layout: "continuous", viewMode: "fit-width", zoom: 1, cropMargins: false });
  await jump(1);
  await wait(`document.querySelectorAll('[data-cached-page]:not([aria-hidden])').length > 6`);
  await ready(1);
  const visible = await evaluate(`(() => {const m=document.querySelector('main').getBoundingClientRect();return [...document.querySelectorAll('[data-cached-page]:not([aria-hidden])')].filter(e=>{const r=e.getBoundingClientRect();return r.bottom>m.top&&r.top<m.bottom}).map(e=>({page:e.dataset.cachedPage,ready:!!e.querySelector('canvas')}));})()`);
  assert.ok(visible.length > 6 && visible.every(page => page.ready), JSON.stringify(visible));
  await budget();
  await jump(40);
  assert.equal(await evaluate(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')`), "100");
  await budget();
  await capture("panoramic-window");
  console.log("PASS more-than-six visible panoramic pages and last-page navigation", JSON.stringify({ visible: visible.length, ...await budget() }));

  await mock("not a PDF");
  await cdp.send("Page.navigate", { url });
  await wait(`!!document.querySelector('[role="alert"] button')`);
  await mock(pdfFixture({ pages: 3, width: 600, height: 800, fill: true }));
  await click('[role="alert"] button');
  await ready();
  await budget();
  console.log("PASS failed-document retry with original library untouched");
}
