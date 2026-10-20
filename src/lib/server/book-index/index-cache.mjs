// @ts-check

import { readFile, stat } from "node:fs/promises";
import { isBookIndex } from "./core.mjs";

/** @typedef {import('./core.mjs').BookIndex} BookIndex */
/** @param {import('node:fs').BigIntStats} file */
function fingerprint(file) {
  return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`;
}

/** Immutable parsed snapshots; serialized-byte and book limits bound retained library data. */
export class BookIndexCache {
  /** @type {Map<string, { stamp: string, bytes: number, index: BookIndex }>} */
  entries = new Map();
  bytes = 0;

  /** @param {number} [maxBooks] @param {number} [maxBytes] */
  constructor(maxBooks = 8, maxBytes = 32 * 1024 * 1024) {
    if (!Number.isInteger(maxBooks) || maxBooks < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError("Cache limits must be positive integers");
    }
    this.maxBooks = maxBooks;
    this.maxBytes = maxBytes;
  }

  get size() { return this.entries.size; }

  /** @param {string} file */
  invalidate(file) {
    const entry = this.entries.get(file);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(file);
  }

  /** @param {string} file @param {string} bookId @returns {Promise<BookIndex | null>} */
  async read(file, bookId) {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await stat(file, { bigint: true });
        const stamp = fingerprint(before);
        const cached = this.entries.get(file);
        if (cached?.stamp === stamp && cached.index.bookId === bookId) {
          this.entries.delete(file);
          this.entries.set(file, cached);
          return cached.index;
        }
        this.invalidate(file);
        const text = await readFile(file, "utf8");
        if (fingerprint(await stat(file, { bigint: true })) !== stamp) continue;
        const value = JSON.parse(text);
        if (!isBookIndex(value, bookId)) return null;
        const bytes = Number(before.size);
        if (bytes <= this.maxBytes) {
          // Another read may have populated this key while filesystem promises settled.
          this.invalidate(file);
          while (this.entries.size >= this.maxBooks || this.bytes + bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.invalidate(oldest);
          }
          this.entries.set(file, { stamp, bytes, index: value });
          this.bytes += bytes;
        }
        return value;
      }
      throw new Error("Book index changed repeatedly while reading");
    } catch (error) {
      this.invalidate(file);
      if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return null;
      throw error;
    }
  }
}
