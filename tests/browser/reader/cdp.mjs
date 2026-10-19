import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchBrowser, readConfig, readyExpression, resetStorageExpression, sleep, waitFor } from "../../../scripts/lib/reader-browser.mjs";
import limits from "../../../src/components/reader/viewport/reader-limits.json" with { type: "json" };

export async function createInteractionReader() {
  const config = readConfig();
  const items = (await (await fetch(`${config.origin}/api/pdfs`)).json()).items;
  const id = process.env.READER_PDF_ID ?? items?.[0]?.id;
  assert.match(id ?? "", /^[a-f\d-]{36}$/i, "An existing PDF is required");
  const url = `${config.origin}/read/${id}`, api = `${config.origin}/api/pdfs/${id}`;
  const { cdp, cleanup } = await launchBrowser(config);
  const evaluate = (expression) => cdp.evaluate(expression);
  const wait = (expression) => waitFor(cdp, expression, 15000);
  const ready = (page) => wait(readyExpression(page));
  const settingKey = `better-reader:settings:${id}`;
  async function viewport(width, height, dpr = 1) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: width < 600 });
  }
  async function open(preferences) {
    // Reset after the old pagehide flush, before the new reader loads its saved state.
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: resetStorageExpression(id, preferences) });
    try {
      await cdp.send("Page.navigate", { url });
      await ready(1);
    } finally { await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }); }
  }
  async function start() {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await viewport(1440, 900);
    await open();
  }
  async function jump(page) {
    await evaluate(`(() => { const input=[...document.querySelectorAll('input[aria-label="Page number"]')].find(e=>e.getBoundingClientRect().width>0); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${page}'); input.form.requestSubmit(); })()`);
    await ready(page);
  }
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const preferences = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)}))`);
  const totalPages = () => evaluate(`Number(document.querySelector('input[aria-label="Page number"]').nextElementSibling.textContent.replace(/[^0-9]/g,''))`);
  const point = () => evaluate(`(() => { const main=document.querySelector('main').getBoundingClientRect(); const holder=document.querySelector('[data-cached-page="'+document.querySelector('[data-reader-stage]').dataset.pageNumber+'"]'); const r=holder.getBoundingClientRect(); const x=Math.max(r.left+20,Math.min(r.right-20,main.left+main.width/2)),y=Math.max(main.top+100,r.top+40); return {x,y,page:Number(holder.dataset.cachedPage),fraction:{x:(x-r.left)/r.width,y:(y-r.top)/r.height}}; })()`);
  async function assertAnchor(anchor) {
    const actual = await evaluate(`(() => { const r=document.querySelector('[data-cached-page="${anchor.page}"]').getBoundingClientRect(); return {x:r.left+${anchor.fraction.x}*r.width,y:r.top+${anchor.fraction.y}*r.height}; })()`);
    const bounds = await evaluate(`(() => {const m=document.querySelector('main'),s=document.querySelector('[data-reader-stage]'),r=s.getBoundingClientRect();return {clientLeft:m.clientLeft,clientWidth:m.clientWidth,scrollWidth:m.scrollWidth,scrollLeft:m.scrollLeft,stageLeft:r.left,stageWidth:r.width};})()`);
    assert.ok(Math.abs(actual.x-anchor.x)<4 && Math.abs(actual.y-anchor.y)<4, JSON.stringify({anchor,actual,bounds}));
  }
  async function budget() {
    const result = await evaluate(`(() => {const stage=document.querySelector('[data-reader-stage]'),c=[...stage.querySelectorAll('canvas')],tiles=c.filter(e=>e.hasAttribute('data-reader-tile'));return {base:c.filter(e=>!e.hasAttribute('data-reader-tile')).reduce((s,e)=>s+e.width*e.height,0),tiles:tiles.reduce((s,e)=>s+e.width*e.height,0),tileCount:tiles.length,max:Math.max(0,...c.map(e=>e.width*e.height)),holders:stage.querySelectorAll('[data-cached-page]').length,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth};})()`);
    assert.ok(result.base<=limits.basePixelBudget && result.tiles<=limits.tilePixelBudget && result.tileCount<=limits.maxTiles && result.max<=limits.pagePixelLimit, JSON.stringify(result));
    assert.equal(result.documentWidth,result.viewport);
    return result;
  }
  async function capture(name) {
    if (!process.env.READER_SCREENSHOTS) return;
    const directory = path.resolve(process.env.READER_SCREENSHOTS);
    await mkdir(directory, { recursive: true });
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(directory, `${name}.png`), Buffer.from(data, "base64"));
  }
  let mockedBody;
  cdp.on("Fetch.requestPaused", (event) => {
    void cdp.send(mockedBody === undefined ? "Fetch.continueRequest" : "Fetch.fulfillRequest", mockedBody === undefined ? { requestId: event.requestId } : {
      requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/pdf" }, { name: "Cache-Control", value: "no-store" }, { name: "Content-Length", value: String(Buffer.byteLength(mockedBody)) }],
      body: Buffer.from(mockedBody).toString("base64"),
    }).catch((error) => console.error("Fixture interception:", error.message));
  });
  async function mock(body) {
    mockedBody = body;
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: api, requestStage: "Request" }] });
  }
  async function diagnose() {
    console.error("Interaction state", JSON.stringify(await evaluate(`({page:document.querySelector('[data-reader-stage]')?.dataset.pageNumber,busy:document.querySelector('[data-reader-stage]')?.getAttribute('aria-busy'),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),holders:[...document.querySelectorAll('[data-cached-page]')].map(e=>({page:e.dataset.cachedPage,hidden:e.getAttribute('aria-hidden'),top:e.getBoundingClientRect().top,canvases:[...e.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,visible:getComputedStyle(c).visibility}))})),links:[...document.querySelectorAll('.annotationLayer a')].map(a=>({href:a.getAttribute('href'),onclick:!!a.onclick})),request:performance.getEntriesByName('reader:page-request').map(e=>e.detail)})`)));
  }
  return { cdp, url, settingKey, evaluate, wait, ready, viewport, open, start, jump, click, preferences, totalPages, point, assertAnchor, budget, capture, mock, diagnose, pause: sleep, cleanup };
}
