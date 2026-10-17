// Production-only, read-only library benchmark. Node >=22 (native fetch/WebSocket).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function summarize(values) {
  return { n: values.length, p50: percentile(values, .5), p95: percentile(values, .95) };
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const activeCleanups = new Set();

class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }
  on(event, listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() { this.socket.close(); }
}

export async function launchBrowser(config) {
  const profile = await mkdtemp(path.join(tmpdir(), 'reader-benchmark-'));
  const browser = spawn(config.chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let exitError;
  browser.on('error', error => { exitError = error; });
  let cdp, cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    activeCleanups.delete(cleanup);
    cdp?.close();
    if (browser.exitCode === null && browser.pid) {
      browser.kill('SIGTERM');
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(3000)]);
      if (browser.exitCode === null) { browser.kill('SIGKILL'); await new Promise(resolve => browser.once('exit', resolve)); }
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  activeCleanups.add(cleanup);
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      if (exitError) throw exitError;
      try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await sleep(100); }
    }
    if (!port) throw new Error('Chromium did not expose a debugging port');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    cdp = new CDP(socket);
    return { cdp, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

// Both the incumbent single stage and the virtualized viewport use these contract attributes.
export const readyExpression = (page) => `(() => {
  const stage = document.querySelector('[data-reader-stage][aria-busy="false"]');
  if (!stage ${page ? `|| Number(stage.dataset.pageNumber) !== ${page}` : ''}) return false;
  const main = document.querySelector('main'), mr = main?.getBoundingClientRect();
  const holder = stage.querySelector('[data-cached-page="' + stage.dataset.pageNumber + '"]') ?? stage;
  return [...holder.querySelectorAll('canvas')].some(canvas => {
    const r = canvas.getBoundingClientRect(), s = getComputedStyle(canvas);
    return canvas.width > 0 && canvas.height > 0 && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && mr && r.bottom > mr.top && r.top < mr.bottom && r.right > mr.left && r.left < mr.right;
  });
})()`;
export async function waitFor(cdp, expression, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await cdp.evaluate(expression)) return; await sleep(40); }
  throw new Error(`Readiness timeout: ${expression}`);
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

export function readConfig(env = process.env) {
  const numeric = (key, fallback, min = 0) => { const value = Number(env[key] ?? fallback); if (!Number.isFinite(value) || value < min) throw new Error(`Invalid ${key}`); return value; };
  const integer = (key, fallback, min) => { const value = numeric(key,fallback,min); if (!Number.isInteger(value)) throw new Error(`Invalid ${key}`); return value; };
  return { origin: (env.READER_URL ?? 'http://127.0.0.1:3417').replace(/\/$/,''), chrome: env.CHROME_BIN ?? '/usr/bin/chromium',
    ids: (env.READER_PDF_IDS ?? 'fe94a0f3-3127-41e6-a2c1-f45ee481c36d,5fe96d77-eb1d-4825-ab29-01fde4435215').split(','),
    repeats: integer('BENCH_REPEATS', 5, 1), steps: integer('BENCH_STEPS', 12, 0), cpu: numeric('BENCH_CPU', 1, 1),
    latency: numeric('BENCH_LATENCY_MS', 0), download: numeric('BENCH_DOWNLOAD_BPS', 0) || -1, upload: numeric('BENCH_UPLOAD_BPS', 0) || -1,
    width: integer('BENCH_WIDTH', 1440, 1), height: integer('BENCH_HEIGHT', 900, 1), timeout: numeric('BENCH_TIMEOUT_MS', 60000, 1), cacheWait: numeric('BENCH_CACHE_WAIT_MS', 5000, 1), settle: numeric('BENCH_SETTLE_MS', 1000),
    output: env.BENCH_OUTPUT ?? path.join(tmpdir(), `reader-benchmark-${Date.now()}.json`) };
}

async function main() {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, async () => {
      await Promise.allSettled([...activeCleanups].map(cleanup => cleanup()));
      process.exit(code);
    });
  }
  const config = readConfig();
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
