import { test } from "node:test";
import assert from "node:assert/strict";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolveOutline } from "./reader-outline";

function fakePdf() {
  const destinations: Record<string, unknown> = {
    intro: [{ num: 5, gen: 0 }],
    chapter: [3], // 0-based page index stored as number? page = ref+1 => 4
    broken: null,
    badpage: [{ num: 99, gen: 0 }],
  };
  const nodes = [
    { title: "Intro", dest: "intro", items: [] },
    { title: "Chapter", dest: "chapter", items: [
      { title: "Nested", dest: [{ num: 9, gen: 0 }], items: [] },
    ] },
    { title: "External", url: "https://example.com", dest: null, items: [] },
    { title: "Broken dest", dest: "missing", items: [] },
    { title: "Broken page", dest: "broken", items: [] },
    { title: "Bad page index", dest: "badpage", items: [] },
  ];
  return {
    numPages: 10,
    getOutline: async () => nodes,
    getDestination: async (name: string) => {
      if (name === "missing") throw new Error("missing destination");
      if (!(name in destinations)) throw new Error("unknown");
      return destinations[name];
    },
    getPageIndex: async (ref: { num: number }) => {
      if (ref.num === 99) throw new Error("bad page");
      return ref.num;
    },
  } as unknown as PDFDocumentProxy;
}

test("resolveOutline resolves string and ref destinations, urls, and broken entries", async () => {
  const pdf = fakePdf();
  const entries = await resolveOutline(pdf, () => false, async () => {});
  assert.deepEqual(entries.map((e) => e.title), ["Intro", "Chapter", "Nested", "External", "Broken dest", "Broken page", "Bad page index"]);
  assert.equal(entries[0].page, 6, "string destination ref resolves via getDestination + getPageIndex");
  assert.equal(entries[1].page, 4, "numeric destination ref becomes page+1");
  assert.equal(entries[2].page, 10, "nested ref destination resolves");
  assert.equal(entries[2].depth, 1);
  assert.equal(entries[3].url, "https://example.com");
  assert.equal(entries[3].page, null);
  assert.equal(entries[4].page, null, "broken destination does not throw");
  assert.equal(entries[5].page, null, "broken destination does not throw");
  assert.equal(entries[6].page, null, "broken page index does not throw");
});

test("resolveOutline supports cancellation", async () => {
  const pdf = fakePdf();
  let cancelled = false;
  let yields = 0;
  const entries = await resolveOutline(pdf, () => cancelled, async () => {
    yields++;
    if (yields >= 1) cancelled = true;
  });
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length <= 7);
});
