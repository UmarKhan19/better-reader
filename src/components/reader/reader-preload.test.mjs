import { afterAll, expect, mock, test } from "bun:test";

let readerImports = 0;
mock.module("./pdf-reader", () => {
  readerImports++;
  return { PdfReader: () => null };
});

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalFetch = globalThis.fetch;
afterAll(() => {
  for (const [key, descriptor] of [["window", originalWindow], ["navigator", originalNavigator]]) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  globalThis.fetch = originalFetch;
  mock.restore();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test("reader-preload only warms client code and worker once after permitted intent", async () => {
  const { prewarmReader } = await import("./reader-preload");
  const calls = [];
  let bodiesRead = 0;
  globalThis.fetch = mock((async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, arrayBuffer: async () => { bodiesRead++; return new ArrayBuffer(0); } };
  }));

  Reflect.deleteProperty(globalThis, "window");
  prewarmReader();
  expect(calls).toHaveLength(0);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  for (const connection of [
    { saveData: true }, { effectiveType: "slow-2g" }, { effectiveType: "2g" },
    { effectiveType: "3g" }, { downlink: 0.5 },
  ]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { connection } });
    prewarmReader();
  }
  await flush();
  expect(calls).toHaveLength(0);
  expect(readerImports).toBe(0);

  // Missing connection hints are normal on Safari/Firefox. This must not disable intent.
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  prewarmReader(); prewarmReader();
  await flush();
  expect(readerImports).toBe(1);
  expect(calls).toEqual([{ url: "/pdf.worker.min.mjs", options: { cache: "force-cache", credentials: "same-origin" } }]);
  expect(bodiesRead).toBe(1);
  prewarmReader();
  expect(calls).toHaveLength(1);
});

test("reader-preload absorbs optional warm failures", async () => {
  // A fresh module instance models a new library session without resetting production state.
  const modulePath = `./reader-preload.ts?failure=${Date.now()}`;
  const { prewarmReader } = await import(modulePath);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { connection: { effectiveType: "4g", downlink: 10 } } });
  const failedFetch = mock(async () => { throw new Error("offline"); });
  globalThis.fetch = failedFetch;
  expect(prewarmReader()).toBeUndefined();
  prewarmReader();
  await flush();
  expect(failedFetch).toHaveBeenCalledTimes(1);
});
