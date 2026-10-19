# Server changes

- Routes and the indexer use `pdf-store/index.ts`. The store owns file coordinates, live/trash membership, atomic JSON replacement and the process-wide mutation lock.
- `src/types/pdf.ts` is the shared browser contract. `pdf-store/record.ts` adds disk-only cover metadata for the store; preserve both shapes and the existing on-disk JSON fields.
- Keep parsing and inference outside that lock. Index publication must recheck live metadata and original bytes under the same lock used by delete/restore.
- Preserve original PDFs byte for byte, cover signature validation, Host validation and HTTP range/validator behavior.
- `book-index/worker.mjs` runs directly under Node. Moving it requires updating `worker-client.ts`, its tests and deployment instructions. Keep the IPC protocol checked on both sides.
- Model inference and private extracted text stay on the server. The retrieval Interface returns bounded evidence without vectors; deletion during inference must not return trash evidence.
- `tests/preload.ts` configures a disposable data directory before store modules load. Filesystem tests import `tests/helpers/library.ts` for reset/cleanup and must never use the real `data/` folder.

## Trash transitions

`deletePdf` and `restorePdf` run under the store's mutation lock:

- Delete: read index -> find the record -> rename `uploads/<id>.pdf` to `trash/pdfs/<id>.pdf` (ENOENT tolerated). If it moved: best-effort cover rename to `trash/covers` -> purge expired trash excluding this id -> write `trash.json` -> write `pdfs.json`. A failed `trash.json` or `pdfs.json` write must unstash the PDF, restore the previous trash metadata and rethrow. `invalidateCoverMap()` runs after both writes.
- Delete with missing bytes: no trash record; purge; write `trash.json`; write `pdfs.json`; then remove cover copies (covers, trash/covers, legacy trash root), stashed copies and the AI index directory.
- Restore: read `trash.json` -> if the live upload is missing, find the stashed copy (`trash/pdfs` then the legacy trash root), otherwise drop the record and its AI index directory -> best-effort cover rename -> add the record to the index if missing -> write `trash.json` without the record, purging expired entries -> remove leftover stashed copies -> invalidate the cover map.
- Purge never removes the shared model cache.
