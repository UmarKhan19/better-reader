# Retrieval implementation and verification

2026-10-20. Server-side retrieval now uses BGE-small-en-v1.5, bounded clause-aware evidence, index caching and interactive queue priority. Citation validation is implemented without answer generation or semantic verification, as requested. The reader's literal Search panel is unchanged.

## Shipped behavior

- The embedding recipe pins `Xenova/bge-small-en-v1.5` at revision `ea104dacec62c0de699686887e3f920caeb4f3e3`, with CPU q8 inference, CLS pooling and 384 dimensions. Only queries receive the BGE retrieval instruction. Passages keep their 256-token limit and per-page batches of four. Prefixed queries have a 512-token limit.
- Schema version 2 rejects MiniLM indexes. Index publication still uses the store's atomic temporary-file flow, outside inference. Source PDFs and saved browser-state formats do not change.
- Retrieval keeps the whole question and splits at most two explicit English/Hinglish clauses. Candidate ranks are interleaved rather than comparing scores across query strings. Immediate-neighbor context, overlap removal and exact source spans stay within ten hits, 2,400 characters per hit and 16,000 characters total.
- The LRU cache holds at most eight books and 32 MiB of serialized index bytes. This is not a 32 MiB process-memory limit. File fingerprints invalidate replaced or deleted indexes; parsed snapshots cache lexical sets and vector norms. Regression tests cover concurrent cache insertion accounting.
- Questions precede pending indexing jobs, with FIFO within each priority and a four-question fairness limit when indexing waits. An active job retains the worker through publication and cleanup. Questions can still wait for the current book's indexing job.
- `retrieveBookEvidence()` returns the book/question envelope and bounded passages. `searchBook()` keeps its array return shape. A live-library check after inference discards passages if the book was deleted during the search.

## Citation guard contract

Pass a trusted `retrieveBookEvidence()` result and a proposed draft to `guardBookAnswer()`. The draft names the same book and question, then supplies parts with numeric query indexes, claims and citations. Each citation names a returned passage, source chunk, original page, text offsets and exact quote. Offsets are UTF-16 indexes into the returned `hit.text`, not PDF byte offsets.

The guard checks scope, source membership, offsets, exact quote text, duplicates and size limits. Missing citations remain `uncited`; valid citations remain `unverified`. It never returns draft claim text. Every result has `answer: null` and `status: "abstained"` because there is no semantic verifier. A valid quote does not establish that it supports the proposed claim or answers the question.

No chat UI, generative provider, credentials, local QA model or similarity-based answerability threshold was added.

## Retrieval results

A fresh production-worker run rebuilt all six books, totaling 3,039 passages, in an owned scratch directory. It finished at `2026-10-20T14:00:49.804Z` under Node 25.8.2 on Linux x64 with 12 logical CPUs. All 72 regression questions ran against the pinned BGE recipe and original PDF editions.

A cached rerun reused all six scratch indexes and reproduced every non-timing result for all 72 questions. Its JSON report also records the embedding model, pinned revision and index schema; the offline Node CLI test checks those fields.

| Metric | Historical MiniLM baseline | Final worker |
| --- | ---: | ---: |
| English primary hit@5 | 43/48 | 46/48 |
| English MRR@10 | 0.784 | 0.809 |
| Hinglish primary hit@5 | 9/12 | 10/12 |
| Hinglish including expanded context @5 | Not reported | 11/12 |
| Two-part questions, both needs @5 | 1/6 | 5/6 |

Primary success requires the center `hit.id` and its proof in the actual returned primary-source text. Neighbor context and merged sources count only toward the separate expanded metric. Coverage of both labeled needs is not generated-answer accuracy. All twelve negatives still returned ten candidates; the guard's unconditional abstention is not a calibrated answerability classifier.

## Worker latency

The timing check uses the same 24 English question IDs and four sequential rounds as the baseline, totaling 96 searches after the initial model-load/search. It includes worker IPC, index access, BGE inference, prepared ranking and bounded context. It excludes application queue wait, live-library checks, HTTP and browser work. Model files were already downloaded.

| Measurement | Historical MiniLM baseline | Fresh final worker |
| --- | ---: | ---: |
| Repeated-search median | 56.92 ms | 16.52 ms |
| Repeated-search p95 | 111.79 ms | 47.43 ms |
| First model-load/search | 372.97 ms | 956.63 ms |

Repeated searches improved in these runs, but the first model-load/search became slower. These measurements were collected at different times, not as a simultaneous controlled speed comparison. They do not predict queue delay while a background book is indexing.

## Application checks

Final source checks passed:

| Check | Result |
| --- | --- |
| `bun run check` | Type generation, application/worker typecheck, lint and 295 tests passed |
| Node syntax checks | Evaluation entry, helper and both evaluation test files passed |
| `node --test scripts/evaluate-retrieval.test.mjs tests/fixtures/retrieval/heldout.test.mjs` | 14 tests passed, including offline CLI-to-production-worker IPC |
| `bun run build` | Production build passed |
| `bun run test:browser` | Navigation, search, rendering, gestures and library groups passed; disposable fixture bytes unchanged |

The browser suite owns its server, profiles and synthetic library. The user's running server was not restarted.

## Library integrity and artifacts

SHA-256 snapshots before and after this final verification round matched for all 28 personal-library files, with none added, removed or changed. That includes all six PDFs, eight existing indexes and four original model-cache files. Each PDF also matched its checked-in edition hash. This confirms the final round left the library unchanged; the missing pre-reset manifest prevents a fresh comparison against the very start of the task.

New model files and indexes stayed under `/tmp/opencode/better-reader-final-2026-10-20/`. Nothing was published to the personal library. The six scratch indexes occupy 26,840,814 serialized bytes, within the cache's 32 MiB limit.

Current raw artifacts:

- `evaluation/report-full-build.json` preserves the fresh index-build run and its timings.
- `evaluation/report.json` contains the final cached-run scores, model/schema provenance, edition hashes and input integrity checks.
- `latency-worker.mjs` and `worker-latency.json` contain the timing probe and its 96 trials.
- `library-before.json`, `library-after.json` and `library-integrity.json` contain the full final-round hash comparison.
- `cache-verification.json` records the cached-run equality and subsequent library hash check.

The regression fixture SHA-256 is `db160a982eddfc2c7f7b535c600db05a3ce92cdcd5397f898b16e68f1e1c75f0`. The final cached evaluation report SHA-256 is `b59b613089bcd3b6df9e9a1d4a9ec5f3307dfec26e999908b696fe4533e83d14`. Raw artifacts are temporary; this checked-in report retains the summary if they are cleared again.

## Reproduction and migration

The permanent command uses only explicit input and owned output paths:

```sh
node scripts/evaluate-retrieval.mjs \
  --data-dir /path/to/library \
  --output-dir /tmp/opencode/retrieval-eval
```

It checks PDF edition hashes, builds scratch indexes with the production worker, validates gold proofs against those indexes and records primary and expanded-context scores separately. It does not publish scratch indexes into the library. See [retrieval-evaluation.md](../retrieval-evaluation.md) for the fixture schema, path checks and report fields.

Restart the app to load the new worker. Startup queues outdated indexes for rebuilding; existing MiniLM indexes are not usable by the BGE worker while those rebuilds are pending. The first rebuild may download the pinned model. The old model cache is not removed.

## Limits

The 72-case regression set uses six English PDFs and AI-adjudicated labels, not human ground truth. The additional 24-case held-out fixture was independently authored and source-reviewed without retrieval results. Only its offline structural test has run. An ad-hoc live proof check was blocked by the safety filter and was not retried or bypassed; no held-out retrieval score is claimed.

These checks do not establish generated-answer correctness, calibrated abstention, OCR quality, physical-device performance or queue latency under load. Query splitting recognizes a narrow set of explicit clauses, not arbitrary question decomposition.

Pre-reset scratch artifacts, including the original pre-implementation integrity manifest, are unavailable. The historical comparison is retained in the [baseline report](retrieval-evaluation-2026-10-20.md); its raw measurements cannot be rechecked from those deleted artifacts.
