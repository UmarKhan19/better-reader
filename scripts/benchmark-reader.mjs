// Production-only, read-only library benchmark. Node >=22 (native fetch/WebSocket).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanupBrowsers, sleep, waitFor } from './lib/reader-cdp.mjs';
import { launchBrowser } from './lib/reader-launch.mjs';
import { readConfig, readyExpression } from './lib/reader-expressions.mjs';

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function summarize(values) {
  return { n: values.length, p50: percentile(values, .5), p95: percentile(values, .95) };
}
const header = (headers, name) => Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;

async function sample(cdp, label) {
  const dom = await cdp.evaluate(`(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    return { atMs: performance.now(), page: Number(document.querySelector('[data-reader-stage]')?.dataset.pageNumber),
      canvases: canvases.length, canvasPixels: canvases.reduce((sum,c) => sum+c.width*c.height,0),
      maxCanvasPixels: Math.max(0,...canvases.map(c=>c.width*c.height)),
      mountedPages: document.querySelectorAll('[data-reader-stage] [data-cached-page]').length,
      jsHeap: performance.memory?.usedJSHeapSize ?? null,
      measures: performance.getEntries().filter(e => e.name.startsWith('reader:')).map(e => ({name:e.name,startTime:e.startTime,duration:e.duration})) };
  })()`);
  return { label, ...dom, heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') };
}

async function runSession(config, id, iteration) {
  const { cdp, cleanup } = await launchBrowser(config);
  const requests = new Map(), samples = [], navigation = [];
  let phase = 'first-readable';
  let browserVersion;
  cdp.on('Network.requestWillBeSent', event => {
    requests.set(event.requestId, { id: event.requestId, phase, url: event.request.url, method: event.request.method,
      range: header(event.request.headers, 'range'), started: event.timestamp, transferredBytes: 0, dataBytes: 0 });
  });
  cdp.on('Network.requestWillBeSentExtraInfo', event => { const request = requests.get(event.requestId); if (request) request.range = header(event.headers, 'range') ?? request.range; });
  cdp.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId); if (!request) return;
    Object.assign(request, { status: event.response.status, contentRange: header(event.response.headers, 'content-range'),
      contentLength: header(event.response.headers, 'content-length'), fromDiskCache: !!event.response.fromDiskCache,
      fromServiceWorker: !!event.response.fromServiceWorker, protocol: event.response.protocol });
  });
  cdp.on('Network.dataReceived', event => { const request = requests.get(event.requestId); if (request) { request.dataBytes += event.dataLength; request.transferredBytes += event.encodedDataLength; } });
  cdp.on('Network.loadingFinished', event => { const request = requests.get(event.requestId); if (request) Object.assign(request, { transferredBytes: event.encodedDataLength, finished: event.timestamp }); });
  cdp.on('Network.loadingFailed', event => { const request = requests.get(event.requestId); if (request) Object.assign(request, { failure: event.errorText, canceled: event.canceled, finished: event.timestamp }); });
  try {
    browserVersion = await cdp.send('Browser.getVersion');
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: config.width, height: config.height, deviceScaleFactor: 1, mobile: config.width < 600 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: config.cpu });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: config.latency, downloadThroughput: config.download, uploadThroughput: config.upload });
    await cdp.send('Page.navigate', { url: `${config.origin}/read/${id}` });
    await waitFor(cdp, readyExpression(), config.timeout);
    const initial = await cdp.evaluate(`({firstReadableMs: performance.now(), marker: performance.getEntriesByName('reader:first-page').at(-1)?.startTime ?? null, total: Number(document.querySelector('header input[aria-label="Page number"]')?.nextElementSibling?.textContent.replace(/[^0-9]/g,''))})`);
    if (!(initial.total > 1)) throw new Error('Page count unavailable; benchmark requires a multi-page PDF');
    samples.push(await sample(cdp, 'first-readable'));
    const navigate = async (page, kind) => {
      phase = kind;
      const cachedBefore = await cdp.evaluate(`!![...document.querySelectorAll('[data-reader-stage] [data-cached-page="${page}"] canvas')].find(c=>c.width>0&&c.height>0&&getComputedStyle(c).visibility!=='hidden')`);
      const start = await cdp.evaluate(`(() => {
        const input = document.querySelector('header input[aria-label="Page number"]');
        if (!input) throw new Error('Missing page number control');
        input.focus(); const start = performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, '${page}');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.form.requestSubmit();
        return start;
      })()`);
      await waitFor(cdp, readyExpression(page), config.timeout);
      const durationMs = await cdp.evaluate(`performance.now()-${start}`);
      navigation.push({ kind, page, cachedBefore, durationMs });
      samples.push(await sample(cdp, `${kind}:${page}`));
    };
    // Wait for an actual rendered adjacent page, rather than assuming a timer implies a cache hit.
    let adjacentCacheAvailable = true;
    try {
      await waitFor(cdp, `!![...document.querySelectorAll('[data-reader-stage] [data-cached-page="2"] canvas')].find(c=>c.width>0&&c.height>0&&getComputedStyle(c).visibility!=='hidden')`, config.cacheWait);
    } catch (error) {
      if (!error.message.startsWith('Readiness timeout:')) throw error;
      adjacentCacheAvailable = false;
    }
    await navigate(2, 'cached');
    await navigate(initial.total, 'uncached');
    for (let step = 0; step < config.steps; step++) {
      const page = 1 + ((step * 37 + Math.floor(initial.total / 2)) % initial.total);
      await navigate(page, 'session');
    }
    // Capture any tail work during a fixed, disclosed observation window.
    phase = 'settle'; await sleep(config.settle);
    samples.push(await sample(cdp, 'settled'));
    const allRequests = [...requests.values()];
    // Chromium may omit worker-script response/finish events on the page target.
    // Resource Timing records that transfer separately; never silently treat it as free.
    const resourceTiming = await cdp.evaluate(`performance.getEntriesByType('resource').map(e=>e.toJSON())`);
    return { id, iteration, browserVersion, adjacentCacheAvailable, ...initial, navigation, samples, requests: allRequests, resourceTiming,
      transfer: { requests: allRequests.length, observedCdpTransferredBytes: allRequests.reduce((sum,r)=>sum+r.transferredBytes,0),
        incompleteRequests: allRequests.filter(r=>!r.finished).map(r=>r.id),
        pdfRequests: allRequests.filter(r=>r.url.includes(`/api/pdfs/${id}`)),
        workerRequests: allRequests.filter(r=>r.url.includes('pdf.worker')) } };
  } finally { await cleanup(); }
}

async function main() {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, async () => {
      await cleanupBrowsers();
      process.exit(code);
    });
  }
  const config = readConfig();
  if (!config.ids.length) throw new Error('Set READER_PDF_IDS to existing PDF UUIDs before benchmarking.');
  for (const id of config.ids) if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error(`Invalid PDF id: ${id}`);
  const report = { timestamp: new Date().toISOString(), config, node: process.version, sessions: [], summary: {} };
  for (const id of config.ids) {
    for (let iteration = 0; iteration < config.repeats; iteration++) {
      console.error(`Benchmark ${id} ${iteration + 1}/${config.repeats}`);
      report.sessions.push(await runSession(config,id,iteration));
      await writeFile(config.output, JSON.stringify(report,null,2)+'\n');
    }
    const sessions = report.sessions.filter(session=>session.id===id);
    report.summary[id] = { firstReadableMs: summarize(sessions.map(s=>s.firstReadableMs)),
      cachedNavigationMs: summarize(sessions.flatMap(s=>s.navigation.filter(n=>n.kind==='cached'&&n.cachedBefore).map(n=>n.durationMs))),
      uncachedNavigationMs: summarize(sessions.flatMap(s=>s.navigation.filter(n=>n.kind==='uncached'&&!n.cachedBefore).map(n=>n.durationMs))) };
  }
  await writeFile(config.output, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ output: config.output, summary: report.summary },null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
