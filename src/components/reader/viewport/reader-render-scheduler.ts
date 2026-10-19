export type RenderPriority = 0 | 1 | 2;
export type RenderTicket = { release: () => void; cancel: () => void; setPriority: (priority: RenderPriority) => void };
type Job = { priority: RenderPriority; order: number; start: () => void; active: boolean; done: boolean };

/** One background permit leaves capacity for a readable page, even before it queues. */
export class ReaderRenderQueue {
  private jobs = new Set<Job>();
  private order = 0;
  private pending = false;
  constructor(readonly concurrency = 2) {}

  schedule(priority: RenderPriority, start: () => void): RenderTicket {
    const job: Job = { priority, start, order: this.order++, active: false, done: false };
    this.jobs.add(job);
    const finish = () => {
      if (job.done) return;
      job.done = true;
      this.jobs.delete(job);
      this.requestDrain();
    };
    this.requestDrain();
    return { release: finish, cancel: finish, setPriority: (next) => {
      if (job.done) return;
      job.priority = next;
      this.requestDrain();
    } };
  }

  get counts() {
    return { active: [...this.jobs].filter((job) => job.active).length,
      queued: [...this.jobs].filter((job) => !job.active).length };
  }

  private requestDrain() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.drain(); });
  }

  private drain() {
    const waiting = [...this.jobs].filter((job) => !job.active)
      .sort((a, b) => a.priority - b.priority || a.order - b.order);
    for (const job of waiting) {
      if (job.done) continue;
      const active = [...this.jobs].filter((entry) => entry.active);
      if (active.length >= this.concurrency) break;
      if (job.priority > 0 && active.filter((entry) => entry.priority > 0).length >= Math.max(1, this.concurrency - 1)) continue;
      job.active = true;
      try { job.start(); } catch { job.done = true; this.jobs.delete(job); this.requestDrain(); }
    }
  }
}

export const readerRenderQueue = new ReaderRenderQueue();
