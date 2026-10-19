import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import path from "node:path";

const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function existingPath(file) {
  try { return await realpath(file); }
  catch (error) { if (error.code === "ENOENT") return file; throw error; }
}

/** Mutations need an explicit fixture directory, never a personal library or remote server. */
export async function assertDisposableLibrary(env, repository) {
  assert.equal(env.READER_DISPOSABLE_LIBRARY, "1", "Library browser checks require READER_DISPOSABLE_LIBRARY=1");
  assert.ok(env.BETTER_READER_DATA_DIR?.trim(), "Library browser checks require BETTER_READER_DATA_DIR");
  assert.ok(env.READER_URL?.trim(), "Library browser checks require an explicit READER_URL");
  const url = new URL(env.READER_URL);
  assert.ok(["http:", "https:"].includes(url.protocol)
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "Library browser checks require a loopback server origin without credentials, path or query");
  assert.match(env.READER_PDF_ID ?? "", /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i,
    "Library browser checks require the baseline fixture READER_PDF_ID");

  const directory = await realpath(env.BETTER_READER_DATA_DIR);
  const root = await realpath(repository);
  const repoData = path.join(root, "data");
  for (const protectedDirectory of [repoData, await existingPath(repoData)]) {
    assert.ok(!contains(protectedDirectory, directory) && !contains(directory, protectedDirectory),
      "Refusing repository data, its descendants or its ancestors");
  }
  for (const entry of ["uploads", `uploads/${env.READER_PDF_ID}.pdf`, "covers", "ai", "trash", "trash/pdfs", "trash/covers", "pdfs.json", "trash.json"]) {
    assert.ok(contains(directory, await existingPath(path.join(directory, entry))),
      `Refusing a fixture path that escapes BETTER_READER_DATA_DIR: ${entry}`);
  }
  return { directory, origin: url.origin, id: env.READER_PDF_ID };
}
