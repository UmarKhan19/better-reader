import assert from "node:assert/strict";
import { pdfFixture } from "../../fixtures/pdf.mjs";

export function checkNavigation(reader) {
  const { id, browser, evaluate, wait, click, screenshot, ready, jump, totalPages, fitWidth, layout, setSetting } = reader;
  const total = totalPages();
  const initialPage = evaluate("Number(document.querySelector('[data-reader-stage]').dataset.pageNumber)");
  const samplePage = Math.min(15, total);
  browser("fill", 'header input[aria-label="Page number"]', String(samplePage));
  assert.equal(evaluate("Number(document.querySelector('[data-reader-stage]').dataset.pageNumber)"), initialPage, "Typing must not navigate before Enter");
  browser("press", "Enter");
  ready(samplePage);
  const desktop = layout();
  screenshot("desktop");
  const firstPageMs = evaluate("performance.getEntriesByName('reader:first-page').at(-1)?.startTime");
  if (samplePage < total) {
    wait(`!![...document.querySelectorAll('[data-reader-stage] [data-cached-page="${samplePage + 1}"] canvas')].find(c => c.width > 0 && c.height > 0 && getComputedStyle(c).visibility !== 'hidden')`);
    browser("press", "ArrowRight");
    ready(samplePage + 1);
  }
  const current = Math.min(samplePage + 1, total);
  const activeHolder = `[data-reader-stage] [data-cached-page="${current}"]`;
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
  fitWidth();
  screenshot("desktop-navigation");
  const chapters = evaluate("document.querySelectorAll('[data-reader-sidebar] ol button').length");
  if (chapters) {
    const destination = evaluate("Number(document.querySelector('[data-reader-sidebar] ol button span:last-child').textContent)");
    click('[data-reader-sidebar] ol button:first-child');
    ready(destination);
    jump(current);
    console.log("PASS resolved outline destinations and active chapter highlighting");
  } else console.log("PASS missing-outline empty state");
  click('button[aria-label="Close document navigation"]');
  fitWidth();

  // Fractional restoration starts from a known continuous, uncropped page top.
  jump(current);
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
  ready(current);
  const restoredOffset = evaluate(`(() => { const h=document.querySelector('${activeHolder}').getBoundingClientRect(), m=document.querySelector('main').getBoundingClientRect(); return (m.top-h.top)/h.height; })()`);
  assert.ok(Math.abs(restoredOffset - savedLocation.offset) < 0.02, JSON.stringify({ restoredOffset, savedLocation }));
  jump(current);
  console.log("PASS fractional continuous progress and reload anchoring");

  if (current < total) {
    browser("focus", 'input[aria-label="Seek to page"]');
    browser("press", "ArrowRight");
    ready(current + 1);
    click('button[aria-label="Back to previous location"]');
    ready(current);
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
  ready(current);
  assert.ok(evaluate(`document.querySelector('${activeHolder}').getBoundingClientRect().height <= document.querySelector('main').clientHeight - 50`));
  screenshot("desktop-dark");
  browser("reload");
  ready(current);
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
  ready(current);
  fitWidth();
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
}

export async function checkNavigationInteractions(reader) {
  const { cdp, evaluate, wait, ready, viewport, open, jump, click, totalPages, mock, pause } = reader;
  const total = await totalPages();
  await viewport(390, 844);
  await open();
  await jump(total);
  assert.equal(await evaluate(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')`), "100");
  console.log("PASS mobile last-page jump stays on its requested page");

  await viewport(1440, 900);
  await open({ layout: "continuous", viewMode: "fit-width", zoom: 1, cropMargins: false });
  await evaluate(`window._seekRequests=0;window._seekObserver=new PerformanceObserver(list=>{window._seekRequests+=list.getEntries().filter(e=>e.name==='reader:page-request').length});window._seekObserver.observe({entryTypes:['mark']})`);
  const track = await evaluate(`(() => {const r=document.querySelector('input[aria-label="Seek to page"]').getBoundingClientRect();return {left:r.left,width:r.width,y:r.top+r.height/2}})()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: track.left+track.width*.15, y: track.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: track.left+track.width*.65, y: track.y, button: "left", buttons: 1 });
  await pause(250);
  assert.equal(await evaluate("window._seekRequests"), 0, "Dragging must not navigate");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: track.left+track.width*.65, y: track.y, button: "left", clickCount: 1 });
  await ready();
  await pause(80);
  assert.equal(await evaluate("window._seekRequests"), 1, "Accepted seek commits exactly once");
  console.log("PASS pointer scrubber previews without navigation and commits once");

  await mock(pdfFixture({ pages: 3, width: 600, height: 800, link: true }));
  await open({ layout: "single", viewMode: "fit-page", zoom: 1, cropMargins: false });
  await jump(1);
  await wait(`!!document.querySelector('[data-cached-page="1"] .annotationLayer a')`);
  await click('[data-cached-page="1"] .annotationLayer a');
  await ready(3);
  await click('button[aria-label="Back to previous location"]');
  await ready(1);
  console.log("PASS actual internal PDF link and previous-location recovery");
}
