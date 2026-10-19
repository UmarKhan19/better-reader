import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName } from "./pdf-title";

test("display titles clean filenames without rewriting intentional capitalization", () => {
  assert.equal(displayName("the_art-of_reading.PDF"), "The Art of Reading");
  assert.equal(displayName("NASA_handbook.pdf"), "NASA handbook");
  assert.equal(displayName("  a___quiet--page.pdf"), "A Quiet Page");
  assert.equal(displayName(".pdf"), ".pdf");
  assert.equal(displayName(""), "");
});
