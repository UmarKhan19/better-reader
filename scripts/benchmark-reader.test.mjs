import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize } from './benchmark-reader.mjs';

test('benchmark-reader uses nearest-rank percentiles and reports missing samples honestly', () => {
  assert.equal(percentile([7, 1, 3, 2, 9], .5), 3);
  assert.equal(percentile([7, 1, 3, 2, 9], .95), 9);
  assert.deepEqual(summarize([]), { n: 0, p50: null, p95: null });
});
