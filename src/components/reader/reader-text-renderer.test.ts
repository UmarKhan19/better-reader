import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageProps } from "react-pdf";
import type { ReaderViewportProps } from "./reader-viewport";
import { pageTextRenderer, type ReaderTextContext } from "./reader-text-renderer";

test("actual react-pdf item indexes and holder page reach the contextual highlighter", () => {
  const calls: { text: string; context?: ReaderTextContext }[] = [];
  const highlight: NonNullable<ReaderViewportProps["highlightText"]> = (text, context) => {
    calls.push({ text, context }); return `<mark>${text}</mark>`;
  };
  const renderer: PageProps["customTextRenderer"] = pageTextRenderer(highlight, 37);
  const item = { str: "same", dir: "ltr", width: 10, height: 12, transform: [1, 0, 0, 1, 0, 0], fontName: "font", hasEOL: false,
    pageNumber: 37, pageIndex: 36, itemIndex: 19 };
  assert.equal(renderer?.(item), "<mark>same</mark>");
  renderer?.({ ...item, itemIndex: 42 });
  assert.deepEqual(calls, [{ text: "same", context: { pageNumber: 37, itemIndex: 19 } },
    { text: "same", context: { pageNumber: 37, itemIndex: 42 } }]);
});

test("split phrase items retain their own page/item contexts and output is not reinterpreted", () => {
  const highlight: NonNullable<ReaderViewportProps["highlightText"]> = (text, context) =>
    context?.pageNumber === 8 && [3, 4].includes(context.itemIndex) ? `<mark>${text}</mark>` : text;
  const page8 = pageTextRenderer(highlight, 8)!;
  assert.equal(page8({ str: "micro", itemIndex: 3 }), "<mark>micro</mark>");
  assert.equal(page8({ str: "scope", itemIndex: 4 }), "<mark>scope</mark>");
  assert.equal(page8({ str: "micro", itemIndex: 5 }), "micro");
  assert.equal(pageTextRenderer(highlight, 9)!({ str: "micro", itemIndex: 3 }), "micro");
});

test("optional context remains compatible with existing text-only highlighters", () => {
  const textOnly: NonNullable<ReaderViewportProps["highlightText"]> = (text) => text.toUpperCase();
  assert.equal(pageTextRenderer(textOnly, 1)!({ str: "text", itemIndex: 0 }), "TEXT");
  assert.equal(pageTextRenderer(undefined, 1), undefined);
});
