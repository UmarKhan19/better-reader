import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Configure the disposable store before any test module (and therefore before
// pdf-store resolves its import-time paths). Tests may still reset this directory.
// Always ignore an inherited data directory: tests must never mutate a real library.
const ownedRoot = mkdtempSync(path.join(tmpdir(), "better-reader-tests-"));
const dataDir = path.join(ownedRoot, "data");
process.env.BETTER_READER_DATA_DIR = dataDir;
const cleanup = () => rmSync(ownedRoot, { recursive: true, force: true });
process.on("exit", cleanup);
process.once("SIGINT", () => { cleanup(); process.exit(130); });
process.once("SIGTERM", () => { cleanup(); process.exit(143); });
