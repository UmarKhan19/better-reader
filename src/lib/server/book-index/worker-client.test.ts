import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { WorkerJob } from "./protocol.mjs";
import { BookIndexWorker } from "./worker-client";

class FakeWorker extends EventEmitter {
  jobs: WorkerJob[] = [];
  killed = false;
  channel = { ref() {}, unref() {} };
  ref() {}
  unref() {}
  kill() { this.killed = true; return true; }
  send(job: WorkerJob, callback: (error: Error | null) => void) { this.jobs.push(job); callback(null); }
}
const job: WorkerJob = { kind: "index", bookId: "book", pdfFile: "book.pdf", indexFile: "index.json", tempFile: "index.tmp", cacheDir: "models" };
const done = { type: "done", kind: "index", indexed: true };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const child = (worker: FakeWorker) => worker as unknown as ChildProcess;

test("complete jobs are FIFO, including publication, and a healthy worker is reused", async () => {
  const worker = new FakeWorker();
  let spawned = 0;
  const queue = new BookIndexWorker(() => { spawned++; return child(worker); });
  let publish!: () => void;
  const publishing = new Promise<void>((resolve) => { publish = resolve; });
  const first = queue.schedule(async (run) => { await run(job); await publishing; });
  const second = queue.schedule((run) => run(job));
  await tick();
  assert.equal(worker.jobs.length, 1);
  worker.emit("message", { type: "progress" });
  worker.emit("message", done);
  await tick();
  assert.equal(worker.jobs.length, 1, "publication must finish before the next job starts");
  publish();
  await first;
  await tick();
  assert.equal(worker.jobs.length, 2);
  worker.emit("message", done);
  await second;
  assert.equal(spawned, 1);
  assert.equal(worker.listenerCount("message"), 0);
});

test("a worker exit rejects its job, then a later job starts a fresh worker", async () => {
  const workers = [new FakeWorker(), new FakeWorker()];
  let spawned = 0;
  const queue = new BookIndexWorker(() => child(workers[spawned++]));
  const first = queue.schedule((run) => run(job));
  const rejected = assert.rejects(first, /exited/);
  const next = queue.schedule((run) => run(job));
  await tick(); workers[0].emit("exit", 1);
  await rejected;
  await tick(); workers[1].emit("message", done);
  await next;
  assert.equal(spawned, 2);
});

test("timeouts and invalid replies kill the worker without poisoning the queue", async () => {
  for (const invalid of [false, true]) {
    const workers = [new FakeWorker(), new FakeWorker()];
    let spawned = 0;
    const queue = new BookIndexWorker(() => child(workers[spawned++]), 100);
    const first = queue.schedule((run) => run(job));
    const rejected = assert.rejects(first, invalid ? /Invalid/ : /timed out/);
    await tick();
    if (invalid) workers[0].emit("message", { type: "done" });
    else await new Promise((resolve) => setTimeout(resolve, 150));
    await rejected;
    assert.equal(workers[0].killed, true);
    const next = queue.schedule((run) => run(job));
    await tick(); workers[1].emit("message", done);
    await next;
    assert.equal(spawned, 2);
  }
});

test("a failed book does not require replacing a healthy process", async () => {
  const worker = new FakeWorker();
  const queue = new BookIndexWorker(() => child(worker));
  const first = queue.schedule((run) => run(job));
  const rejected = assert.rejects(first, /bad PDF/);
  await tick(); worker.emit("message", { type: "error", error: "bad PDF" });
  await rejected;
  const next = queue.schedule((run) => run({ ...job, kind: "search", question: "Evidence?" }));
  await tick(); worker.emit("message", { type: "done", kind: "search", hits: [{ id: "1-1", page: 1, text: "Evidence", score: 1 }] });
  assert.equal((await next).kind, "search");
  assert.equal(worker.killed, false);
});

test("publication failure releases the queue after a successful worker job", async () => {
  const worker = new FakeWorker();
  const queue = new BookIndexWorker(() => child(worker));
  const first = queue.schedule(async (run) => { await run(job); throw new Error("Cannot publish index"); });
  const rejected = assert.rejects(first, /Cannot publish/);
  const next = queue.schedule((run) => run(job));
  await tick(); worker.emit("message", done);
  await rejected;
  await tick();
  assert.equal(worker.jobs.length, 2);
  worker.emit("message", done);
  await next;
  assert.equal(worker.killed, false);
});
