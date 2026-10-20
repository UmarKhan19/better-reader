import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { isWorkerReply, type DoneReply, type WorkerJob } from "./protocol.mjs";

function spawnWorker(): ChildProcess {
  return fork(/* turbopackIgnore: true */ path.join(process.cwd(), "src/lib/server/book-index/worker.mjs"), [], {
    execPath: "node", execArgv: ["--max-old-space-size=512"], stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
}

/** Serializes complete jobs, including publication, and replaces a failed worker on the next job. */
export class BookIndexWorker {
  private child: ChildProcess | null = null;
  private interactive: Array<() => void> = [];
  private background: Array<() => void> = [];
  private active = false;
  private interactiveBurst = 0;

  constructor(private readonly spawn = spawnWorker, private readonly timeoutMs = 15 * 60_000) {}

  schedule<T>(work: (run: (job: WorkerJob) => Promise<DoneReply>) => Promise<T>, priority: "background" | "interactive" = "background"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queue = priority === "interactive" ? this.interactive : this.background;
      queue.push(() => {
        void Promise.resolve().then(() => work(this.runJob)).then(resolve, reject).finally(() => {
          this.active = false;
          this.drain();
        });
      });
      this.drain();
    });
  }

  private drain() {
    if (this.active) return;
    let next: (() => void) | undefined;
    if (this.background.length && (!this.interactive.length || this.interactiveBurst >= 4)) {
      next = this.background.shift();
      // Bound interactive bursts so a steady stream of questions cannot starve indexing.
      this.interactiveBurst = 0;
    } else if (this.interactive.length) {
      next = this.interactive.shift();
      this.interactiveBurst++;
    }
    if (next) {
      this.active = true;
      next();
    }
  }

  private runJob = (job: WorkerJob): Promise<DoneReply> => new Promise((resolve, reject) => {
    let child = this.child;
    if (!child) {
      child = this.spawn();
      this.child = child;
      child.once("exit", () => { if (this.child === child) this.child = null; });
      child.unref();
      child.channel?.unref?.();
    }
    const worker = child;
    worker.ref();
    worker.channel?.ref?.();
    let settled = false;
    const timeout = () => fail(new Error("Book indexing worker timed out"));
    let timer = setTimeout(timeout, this.timeoutMs);
    timer.unref();
    const finish = (error?: Error, reply?: DoneReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", fail);
      worker.off("exit", onExit);
      worker.unref();
      worker.channel?.unref?.();
      if (error) reject(error);
      else resolve(reply!);
    };
    const fail = (error: Error) => {
      if (settled) return;
      if (this.child === worker) this.child = null;
      worker.kill();
      finish(error);
    };
    const onMessage = (value: unknown) => {
      if (!isWorkerReply(value)) { fail(new Error("Invalid book indexing worker reply")); return; }
      if (value.type === "progress") {
        clearTimeout(timer);
        timer = setTimeout(timeout, this.timeoutMs);
        timer.unref();
      } else if (value.type === "error") finish(new Error(value.error));
      else if (value.kind !== job.kind) fail(new Error("Unexpected book indexing worker reply"));
      else finish(undefined, value);
    };
    const onExit = (code: number | null) => finish(new Error(`Book indexing worker exited (${code})`));
    worker.on("message", onMessage);
    worker.once("error", fail);
    worker.once("exit", onExit);
    try {
      worker.send(job, (error: Error | null) => { if (error) fail(error); });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
