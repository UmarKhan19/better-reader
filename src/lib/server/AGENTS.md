# Server changes

- Routes and the indexer use `pdf-store/index.ts`. The store owns file coordinates, live/trash membership, atomic JSON replacement and the process-wide mutation lock.
- Keep parsing and inference outside that lock. Index publication must recheck live metadata and original bytes under the same lock used by delete/restore.
- Preserve original PDFs byte for byte, cover signature validation, Host validation and HTTP range/validator behavior.
- `book-index/worker.mjs` runs directly under Node. Moving it requires updating `worker-client.ts`, its tests and deployment instructions. Keep the IPC protocol checked on both sides.
- Model inference and private extracted text stay on the server. The retrieval Interface returns bounded evidence without vectors; deletion during inference must not return trash evidence.
- Filesystem tests import `tests/helpers/library.ts` before store/route modules and call its reset/cleanup hooks. Use its owned temporary directory rather than the real `data/` folder.
