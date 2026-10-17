import { test } from "node:test";
import assert from "node:assert/strict";
import { ReaderRenderQueue } from "./reader-render-scheduler";
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("visible pages outrank queued thumbnails and directional prefetch", async () => {
  const queue = new ReaderRenderQueue(), calls: string[] = [];
  const thumbnail = queue.schedule(2, () => { calls.push("thumbnail"); });
  const prefetch = queue.schedule(1, () => { calls.push("prefetch"); });
  const visible = queue.schedule(0, () => { calls.push("visible"); });
  await tick(); assert.deepEqual(calls, ["visible", "prefetch"]);
  prefetch.release(); await tick(); assert.deepEqual(calls, ["visible", "prefetch", "thumbnail"]);
  visible.release(); thumbnail.release(); await tick(); assert.deepEqual(queue.counts, { active: 0, queued: 0 });
});
test("background work reserves one permit for a newly visible page", async () => {
  const queue = new ReaderRenderQueue(), calls: string[] = [];
  const first = queue.schedule(2, () => { calls.push("first"); });
  const second = queue.schedule(2, () => { calls.push("second"); });
  await tick(); assert.deepEqual(calls, ["first"]);
  const visible = queue.schedule(0, () => { calls.push("visible"); });
  await tick(); assert.deepEqual(calls, ["first", "visible"]);
  first.cancel(); second.cancel(); visible.cancel(); await tick(); assert.equal(queue.counts.active, 0);
});
test("queued cancellation never starts and repeated completion releases exactly once", async () => {
  const queue = new ReaderRenderQueue(), calls: string[] = [];
  const first = queue.schedule(0, () => { calls.push("first"); });
  const second = queue.schedule(0, () => { calls.push("second"); });
  const obsolete = queue.schedule(0, () => { calls.push("obsolete"); });
  const next = queue.schedule(0, () => { calls.push("next"); });
  obsolete.cancel(); await tick();
  first.release(); first.release(); first.cancel(); await tick();
  assert.deepEqual(calls, ["first", "second", "next"]);
  assert.deepEqual(queue.counts, { active: 2, queued: 0 });
  second.cancel(); next.cancel(); await tick(); assert.deepEqual(queue.counts, { active: 0, queued: 0 });
});
test("queued promotion and FIFO ties survive cancellation", async () => {
  const queue = new ReaderRenderQueue(1), calls: string[] = [];
  const blocker = queue.schedule(0, () => { calls.push("blocker"); });
  await tick();
  const prefetch = queue.schedule(1, () => { calls.push("prefetch"); });
  const promoted = queue.schedule(2, () => { calls.push("promoted"); });
  promoted.setPriority(0); blocker.cancel(); await tick();
  assert.deepEqual(calls, ["blocker", "promoted"]);
  promoted.release(); await tick(); assert.deepEqual(calls, ["blocker", "promoted", "prefetch"]);
  prefetch.release(); await tick();
});
test("a throwing start does not leak a permit or strand the queue", async () => {
  const queue = new ReaderRenderQueue(1); let ran = false;
  queue.schedule(0, () => { throw new Error("obsolete consumer"); });
  const next = queue.schedule(0, () => { ran = true; });
  await tick(); await tick(); assert.equal(ran, true);
  next.release(); await tick(); assert.deepEqual(queue.counts, { active: 0, queued: 0 });
});
