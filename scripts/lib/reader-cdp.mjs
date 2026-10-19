export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const activeCleanups = new Set();
export function trackCleanup(cleanup) {
  activeCleanups.add(cleanup);
  return () => activeCleanups.delete(cleanup);
}
export async function cleanupBrowsers() {
  await Promise.allSettled([...activeCleanups].map((cleanup) => cleanup()));
}

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
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
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}

export async function waitFor(cdp, expression, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await cdp.evaluate(expression)) return; await sleep(40); }
  throw new Error(`Readiness timeout: ${expression}`);
}
