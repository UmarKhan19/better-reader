import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBookIndex } from "./core.mjs";

function blankPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  return `${pdf}xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

test("worker extracts and closes PDFs, reuses indexes, and survives a bad book without downloading a model", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "better-reader-ai-worker-"));
  const bookId = "b3c22387-8fda-444d-b7af-c158c55868a7";
  const pdfFile = path.join(dir, "book.pdf");
  const indexFile = path.join(dir, "index.json");
  const tempFile = `${indexFile}.tmp`;
  const child = fork(fileURLToPath(new URL("./worker.mjs", import.meta.url)), [], {
    execPath: "node", execArgv: [], stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  function job(kind) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Worker test timed out")); }, 15_000);
      function cleanup() {
        clearTimeout(timer);
        child.off("message", message);
        child.off("exit", exit);
        child.off("error", error);
      }
      function message(reply) {
        if (reply.type === "progress") return;
        cleanup();
        if (reply.type === "error") reject(new Error(reply.error));
        else resolve(reply);
      }
      function error(error) { cleanup(); reject(error); }
      function exit(code) { error(new Error(`Worker exited: ${code}`)); }
      child.on("message", message);
      child.once("exit", exit);
      child.once("error", error);
      child.send({ kind, bookId, pdfFile, indexFile, tempFile, cacheDir: path.join(dir, "models"), question: "Evidence?" });
    });
  }
  try {
    await writeFile(pdfFile, blankPdf());
    assert.equal((await job("index")).indexed, true);
    const index = JSON.parse(await readFile(tempFile, "utf8"));
    assert.equal(isBookIndex(index, bookId), true);
    assert.deepEqual(index.chunks, []);
    await rename(tempFile, indexFile);
    assert.equal((await job("index")).indexed, false);
    assert.deepEqual((await job("search")).hits, []);
    await writeFile(indexFile, "{corrupt");
    await writeFile(pdfFile, "not a PDF");
    await assert.rejects(job("index"));
    await writeFile(pdfFile, blankPdf());
    assert.equal((await job("index")).indexed, true, "a failed job must not poison the queue");
    await assert.rejects(stat(path.join(dir, "models")), { code: "ENOENT" }, "image-only books need no model download");
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
