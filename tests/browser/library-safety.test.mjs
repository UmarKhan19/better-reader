import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDisposableLibrary } from "./library-safety.mjs";

test("library mutation safety requires an explicit owned loopback fixture", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "library-safety-"));
  const repository = path.join(root, "repo");
  const directory = path.join(root, "fixture");
  const repoData = path.join(repository, "data");
  const env = {
    READER_DISPOSABLE_LIBRARY: "1", BETTER_READER_DATA_DIR: directory,
    READER_URL: "http://127.0.0.1:3100", READER_PDF_ID: "11111111-1111-4111-8111-111111111111",
  };
  try {
    await mkdir(path.join(repoData, "nested"), { recursive: true });
    await mkdir(directory);
    assert.deepEqual(await assertDisposableLibrary(env, repository), {
      directory, origin: env.READER_URL, id: env.READER_PDF_ID,
    });
    for (const origin of ["http://localhost:3100/", "http://[::1]:3100/"]) {
      assert.equal((await assertDisposableLibrary({ ...env, READER_URL: origin }, repository)).origin, origin.slice(0, -1));
    }
    for (const override of [
      { READER_DISPOSABLE_LIBRARY: undefined }, { READER_DISPOSABLE_LIBRARY: "true" },
      { BETTER_READER_DATA_DIR: undefined }, { BETTER_READER_DATA_DIR: " " },
      { READER_URL: undefined }, { READER_PDF_ID: undefined }, { READER_PDF_ID: "../personal" },
      ...["https://example.com", "http://127.0.0.1.example.com", "http://user@localhost:3100",
        "http://127.0.0.1:3100/read/id", "http://127.0.0.1:3100/?owned=1", "http://127.0.0.1:3100/#owned",
        "ftp://127.0.0.1"].map((READER_URL) => ({ READER_URL })),
    ]) {
      await assert.rejects(assertDisposableLibrary({ ...env, ...override }, repository), undefined, JSON.stringify(override));
    }
    await symlink(repoData, path.join(root, "personal-alias"));
    for (const forbidden of [repoData, path.join(repoData, "nested"), repository, root, path.join(root, "personal-alias")]) {
      await assert.rejects(assertDisposableLibrary({ ...env, BETTER_READER_DATA_DIR: forbidden }, repository), /Refusing repository data/);
    }
    await mkdir(path.join(directory, "trash"));
    for (const entry of ["uploads", "covers", "trash/pdfs"]) {
      const alias = path.join(directory, entry);
      await symlink(repoData, alias);
      await assert.rejects(assertDisposableLibrary(env, repository), /escapes BETTER_READER_DATA_DIR/);
      await rm(alias);
    }
    await symlink(directory, path.join(root, "fixture-alias"));
    assert.equal((await assertDisposableLibrary({ ...env, BETTER_READER_DATA_DIR: path.join(root, "fixture-alias") }, repository)).directory, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
