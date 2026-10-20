# Retrieval evaluation slice

This is the checked-in evaluation for server-side passage retrieval, not the reader's literal Search panel or generated-answer accuracy. The [pre-change study](reports/retrieval-evaluation-2026-10-20.md) compares embedding models. The [implementation report](reports/retrieval-implementation-2026-10-20.md) records the shipped behavior and final checks.

## What is checked in

`tests/fixtures/retrieval/questions.json` contains the frozen slice:

| Item | Count |
| --- | ---: |
| Books / editions | 6 |
| Questions | 72 |
| Answerable English (exact, semantic, two-part) | 48 |
| Paired Hinglish | 12 |
| Unanswerable | 12 |
| Gold evidence groups | 66 |
| Per-chunk proofs | 163 |

Each book has a stable key, the original display file name and the SHA-256 of the exact PDF edition used for labeling. Personal library UUIDs are not stored. Each answerable group carries short exact proofs from the adjudicated judgments:

```json
{
  "key": "myth-of-sisyphus",
  "fileName": "myth-of-sisyphus.pdf",
  "sha256": "…"
}
```

```json
{
  "id": "a-btc-01",
  "book": "building-bitcoin-in-rust",
  "question": "What does Option::unwrap_or provide when an Option is None?",
  "kind": "exact",
  "answerable": true,
  "pairedWith": null,
  "evidenceGroups": [
    {
      "chunks": [
        { "id": "194-2", "page": 194, "quote": "none_value.unwrap_or(\"Default value\")" }
      ]
    }
  ]
}
```

Chunk ids are the production index's book-local ids (`page-sequence`). Multiple ids in one group are alternative evidence for the same need, not independent facts. No PDF text corpus, saved vectors, model weights or personal UUIDs are checked in.

Labels are **AI-adjudicated**, from questions frozen before scoring plus pooled judgments. They are not human ground truth and they are not production query logs.

`tests/fixtures/retrieval/heldout.json` contains 24 additional cases: six semantic English questions, six two-part English questions, six paired Hinglish questions and six negatives. They were authored and source-reviewed without retrieval results. This set has not been scored with the live worker. Its offline test checks structure, distinct questions and paired gold; it does not establish retrieval quality or human label accuracy.

## Run it

The CLI has no personal-data default. Both paths are required:

```sh
node scripts/evaluate-retrieval.mjs \
  --data-dir /path/to/library \
  --output-dir /tmp/opencode/retrieval-eval

# Reuse an owned model cache, score fresh held-out cases:
node scripts/evaluate-retrieval.mjs \
  --data-dir /path/to/library \
  --output-dir /tmp/opencode/retrieval-eval \
  --questions /tmp/opencode/heldout/questions.json \
  --model-cache /tmp/opencode/retrieval-models
```

- `--data-dir` is an existing Better Reader library (`pdfs.json` plus `uploads/`). It is read only. The tool never calls store startup, publishing or queue helpers.
- `--output-dir` is agent-owned. It receives `report.json`, `scratch/` indexes and, by default, `models/`.
- `--questions` replaces the frozen fixture with another file in the same schema.
- `--model-cache` reuses an explicit owned directory. It must not sit inside, equal, or contain `--data-dir`; the default is `<output-dir>/models`.

The package command is `eval:retrieval`. It must forward user arguments unchanged and must not supply default data or output paths. A leading `--` from Bun's passthrough is accepted:

```sh
bun run eval:retrieval -- --data-dir /path/to/library --output-dir /tmp/opencode/retrieval-eval
```

The command exits non-zero if a PDF is missing, its SHA-256 differs from the frozen edition, metadata or PDF bytes change during the run, the fixture is invalid, a metadata id is not a safe file-name token, a resolved PDF leaves the library, or a worker job fails. A changed edition never silently reuses page/chunk labels.

## Safety and caching

- `--output-dir` and `--model-cache` are canonicalized through their closest existing ancestor before comparison. Symlinks cannot smuggle the output into the library, and a model-cache root that contains the library is also rejected.
- PDFs and `pdfs.json` are hashed before and after. Original files are opened by the worker only for reading.
- Library metadata ids must be safe file-name tokens. Every matching PDF must resolve inside the canonical `--data-dir` before it is hashed; `../` ids and `uploads` symlinks pointing outside fail first.
- After indexing, every gold chunk id, page and quote is checked against the actual scratch index. A tokenizer, chunking or edition change fails instead of silently scoring stale labels.
- Derived indexes live under `<output-dir>/scratch/<book-key>/<pdf-sha256>/`. A later run reuses one only when production `isBookIndex()` accepts it. Original `data/ai/<uuid>/index.json` files are never read as output targets or overwritten.
- The worker is the current production `src/lib/server/book-index/worker.mjs`, forked directly. Replies are validated with production `isWorkerReply()` at the IPC seam. Index and search jobs use the original PDF path, the scratch index/temp paths and an owned model cache.

## Scoring

The report keeps two views because center ranking and expanded context answer different questions.

**Primary ranking** means the center hit id only. `selectedIds`, reply-level `primaryIds` and `directIds` are not primary evidence.

- `hit@1`, `hit@5`, `hit@10`: a gold chunk is the center id of a hit by that rank.
- `MRR@10`: reciprocal rank of the first such center hit, zero beyond ten.
- When a hit returns `sources` and `text`, the center hit succeeds only if that gold proof appears inside the primary source span in the actual returned text. A clipped center chunk cannot claim delivery of a hidden fact.
- Group coverage (`groups@5`, `allGroups@5`): for multi-part questions, each labeled need must be covered. This is reported separately and is not equivalent to answer correctness.

**Expanded context** is separate. A group succeeds only when its exact gold quote appears inside a valid source span whose source id and page match the proof. Invalid, negative or oversized offsets are ignored, never clamped. A quote merely present somewhere in the hit text does not count. Neighbor context and merged direct chunks can satisfy this metric, never the primary metric. Replies without `sources` report `expanded.available: false`.

**Negatives** report the number of returned candidates and their top score. No abstention threshold is claimed or tuned. A guard that always abstains is not answerability, and this slice does not score it. Ten candidates for an unanswerable question is ordinary candidate retrieval, not a verified answer.

The summary reports English (non-Hinglish), Hinglish and each kind separately. Hinglish questions are paired translations, so they are not independent English observations. `overall` includes both and is less informative than the split.

## Report

`report.json` records:

- protocol and label provenance;
- input/output paths, fixture hash, embedding model/revision, index schema and runtime environment;
- per-book edition hash, index cache hit and indexing time;
- per-question primary metrics, expanded availability, candidate count, top score and search time;
- English/Hinglish/kind summaries, multi-need coverage and negatives;
- per-PDF and metadata integrity hashes before/after;
- total, mean and p95 search timings.

Reports contain ids, pages and scores, not full passage text.

## Unit checks

```sh
bun test scripts/evaluate-retrieval.test.mjs tests/fixtures/retrieval/heldout.test.mjs
```

The colocated tests cover CLI validation, output/cache overlap, fixture counts, stable keys and edition hashes, paired links, proof shape, primary scoring, source-span checks, group coverage, negative candidate counts and English/Hinglish aggregation. They do not download models, start an app server or read a real library. Real six-book reindexing and model-quality verification are separate, explicitly owned runs.

## Limits

This slice is six English PDFs and AI-authored/judged questions. It does not measure generated answers, abstention accuracy, human relevance, OCR, cross-encoder ranking, alternative chunking or queue latency under load. Page/chunk labels are valid only for the exact PDF editions listed in the fixture. Use `--questions` for fresh held-out cases rather than editing the frozen set after seeing results.
