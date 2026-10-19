import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launchAgentBrowser, readConfig, readyExpression, resetStorageExpression } from "../../../scripts/lib/reader-browser.mjs";
import limits from "../../../src/components/reader/viewport/reader-limits.json" with { type: "json" };

export async function createAgentReader(group) {
  const { origin } = readConfig();
  const items = (await (await fetch(`${origin}/api/pdfs`)).json()).items;
  const id = process.env.READER_PDF_ID ?? items?.[0]?.id;
  assert.match(id ?? "", /^[a-f\d-]{36}$/i, "An existing PDF is required. Set READER_PDF_ID or upload one in the app.");
  const url = `${origin}/read/${id}`, api = `${origin}/api/pdfs/${id}`;
  const screenshots = process.env.READER_SCREENSHOTS ? path.resolve(process.env.READER_SCREENSHOTS) : undefined;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  // Without CHROME_BIN, preserve agent-browser's existing executable discovery/configuration.
  const { browser, evaluate, wait, cleanup } = await launchAgentBrowser({ chrome: process.env.CHROME_BIN }, `reader-${group}-${process.pid}`);
  const click = (selector) => browser("click", selector);
  const screenshot = (name) => { if (screenshots) browser("screenshot", path.join(screenshots, `${name}.png`)); };
  const ready = (page) => wait(readyExpression(page));
  function open() {
    browser("set", "viewport", "1440", "900");
    browser("open", `${origin}/api/pdfs`);
    evaluate(resetStorageExpression(id));
    browser("open", url);
    ready(1);
    assert.equal(evaluate("document.querySelector('[data-reader-stage]').dataset.readerLayout"), "continuous");
  }
  function jump(page) {
    // agent-browser 0.35.0 silently ignores :visible in fill; use plain CSS for the displayed control.
    const scope = evaluate(`document.querySelector('header input[aria-label="Page number"]').getBoundingClientRect().width > 0`) ? "header" : "nav";
    browser("fill", `${scope} input[aria-label="Page number"]`, String(page));
    browser("press", "Enter");
    ready(page);
  }
  function totalPages() {
    return evaluate("Number(document.querySelector('input[aria-label=\"Page number\"]').nextElementSibling.textContent.replace(/[^0-9]/g, ''))");
  }
  function fitWidth() {
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
    assert.ok(result.basePixels <= limits.basePixelBudget, JSON.stringify(result));
    assert.ok(result.tilePixels <= limits.tilePixelBudget && result.tiles <= limits.maxTiles, JSON.stringify(result));
    assert.ok(result.maxCanvasPixels <= limits.pagePixelLimit, JSON.stringify(result));
    assert.ok(result.mounted <= result.intersecting + 2, JSON.stringify(result));
    return result;
  }
  function pageWithText() {
    return evaluate(`(() => {
      const stage=document.querySelector('[data-reader-stage]'), active=Number(stage.dataset.pageNumber);
      const pages=[...stage.querySelectorAll('[data-cached-page]')]
        .filter(h => /[A-Za-z]{4,}/.test(h.querySelector('.textLayer')?.textContent ?? ''))
        .map(h => Number(h.dataset.cachedPage));
      return pages.length ? pages.reduce((a,b) => Math.abs(b-active) < Math.abs(a-active) ? b : a) : null;
    })()`);
  }
  function findTextPage(current, total) {
    let textPage = pageWithText();
    for (let step = 1; !textPage && step <= 5; step++) {
      for (const candidate of [current + step, current - step]) {
        if (candidate < 1 || candidate > total) continue;
        jump(candidate);
        textPage = pageWithText();
        if (textPage) break;
      }
    }
    jump(textPage ?? current);
    if (process.env.READER_REQUIRE_TEXT === "1") assert.ok(textPage, "The owned searchable fixture must have a text layer; do not skip search/selection coverage.");
    return textPage;
  }
  function setSetting(kind, value) {
    const presentation = kind === "theme" ? "segmented" : "paper";
    click(`dialog[open] [data-presentation="${presentation}"] label:has(input[value="${value}"])`);
    assert.equal(evaluate(`document.querySelector('[data-reader-root]').getAttribute('data-${kind}')`), value);
  }
  return { id, origin, api, browser, evaluate, wait, click, screenshot, ready, open, jump, totalPages, fitWidth, layout, findTextPage, setSetting, cleanup };
}
