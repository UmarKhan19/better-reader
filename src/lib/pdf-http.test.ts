import { test } from "node:test";
import assert from "node:assert/strict";
import { isNotModified, mayServeRange, parseByteRange } from "./pdf-http";

test("closed, open and suffix byte ranges have exact bounds", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=100-", 1000), { start: 100, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-50", 1000), { start: 950, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-2000", 1000), { start: 0, end: 999 });
  assert.deepEqual(parseByteRange("bytes=990-2000", 1000), { start: 990, end: 999 });
});

test("invalid or unsatisfiable single byte ranges do not silently serve the full PDF", () => {
  for (const value of ["bytes=-0", "bytes=-", "bytes=1000-", "bytes=9-2", "bytes=bogus", "bytes=999999999999999999999-"]) {
    assert.equal(parseByteRange(value, 1000), "unsatisfiable", value);
  }
  assert.equal(parseByteRange("bytes=0-", 0), "unsatisfiable");
});

test("unsupported range units or multipart ranges can be ignored", () => {
  assert.equal(parseByteRange(null, 1000), null);
  assert.equal(parseByteRange("items=0-3", 1000), null);
  assert.equal(parseByteRange("bytes=0-9,20-29", 1000), null);
});

const etag = '"pdf-123"';
const modified = Date.parse("2026-10-16T12:34:56.789Z");

test("GET validators accept strong, weak, list and wildcard ETag matches", () => {
  for (const value of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
    assert.equal(isNotModified(new Headers({ "If-None-Match": value }), etag, modified), true);
  }
  assert.equal(isNotModified(new Headers({ "If-None-Match": '"other"' }), etag, modified), false);
});

test("ETags take precedence over If-Modified-Since", () => {
  const headers = new Headers({ "If-None-Match": '"old"', "If-Modified-Since": new Date(modified).toUTCString() });
  assert.equal(isNotModified(headers, etag, modified), false);
  assert.equal(isNotModified(new Headers({ "If-Modified-Since": new Date(modified).toUTCString() }), etag, modified), true);
  assert.equal(isNotModified(new Headers({ "If-Modified-Since": "not a date" }), etag, modified), false);
});

test("If-Range requires an exact strong validator or an up-to-date date", () => {
  assert.equal(mayServeRange(new Headers(), etag, modified), true);
  assert.equal(mayServeRange(new Headers({ "If-Range": etag }), etag, modified), true);
  assert.equal(mayServeRange(new Headers({ "If-Range": `W/${etag}` }), etag, modified), false);
  assert.equal(mayServeRange(new Headers({ "If-Range": '"old"' }), etag, modified), false);
  assert.equal(mayServeRange(new Headers({ "If-Range": new Date(modified).toUTCString() }), etag, modified), true);
  assert.equal(mayServeRange(new Headers({ "If-Range": "Thu, 15 Oct 2026 00:00:00 GMT" }), etag, modified), false);
});
