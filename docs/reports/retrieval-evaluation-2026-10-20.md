# Local-library retrieval evaluation

2026-10-20. This evaluates server-side, per-book passage retrieval, not the reader's separate literal Search panel or generated-answer accuracy.

This is the pre-implementation baseline. Current behavior and the permanent evaluation command are documented in [architecture.md](../architecture.md) and [retrieval-evaluation.md](../retrieval-evaluation.md).

See the [implementation report](retrieval-implementation-2026-10-20.md) for the final checks and results after these recommendations were implemented. Temporary artifacts referenced below were not retained across the session reset.

## Outcome

The current MiniLM embeddings are a usable baseline, not broken vectors. Current retrieval found answer-bearing evidence in the first five results for 43/48 English questions and 9/12 paired Hinglish questions. BGE-small-en-v1.5 with the existing hybrid ranker reached 46/48 and 11/12. BGE is worth a controlled upgrade trial, but its three English hit@5 gains all came from the Camus PDF.

The larger reliability gaps are abstention and multi-part evidence. All twelve unanswerable questions still received ten candidates. For six two-part questions, current retrieval covered both labeled evidence needs in the first five results only once. A model change alone does not make this a reliable question-answering system.

All empirical files named below are under `/tmp/opencode/better-reader-retrieval-eval-2026-10-20/`. Application source, original PDFs and saved indexes were not changed. This report is the only repository addition.

## Corpus and method

| PDF | Pages | Indexed passages |
| --- | ---: | ---: |
| Building bitcoin in Rust | 419 | 839 |
| The Myth of Sisyphus | 24 | 176 |
| Backend Development | 32 | 34 |
| Data Analysis from Scratch with Python | 104 | 238 |
| Gray Hat Python | 220 | 726 |
| Web Development with Node and Express | 329 | 1,026 |
| Total | 1,128 | 3,039 |

Each query searched its own book, not all 3,039 passages together. All models received the same passage texts and boundaries. Sources: `inventory.json`, `extraction-audit.json`.

- The comparative question set was frozen before scoring: 48 answerable English questions, 12 paired Hinglish versions and 12 unanswerable questions. Each book contributed three factual, four semantic, one two-part, two Hinglish and two negative cases.
- Questions and initial labels were AI-curated without seeing retrieval results. Independent AI reviewers then judged 1,478 question/passage pairs pooled from every arm's top ten, including the translated queries. Reviewers saw passage text without ranks or model identities.
- Every accepted passage has a short exact-source proof, checked against its own chunk. Parent review corrected false exclusions of equivalent answers. Pooling added 44 group memberships and removed one unsupported seed. These are still AI judgments, not human ground truth.
- Primary metrics are English evidence hit@5 and MRR@10. Hit@5 means at least one answer-bearing passage appears, not that every requested fact or a complete correct answer is present. Two-part coverage separately requires both labeled evidence groups.
- The production baseline calls the actual `rankChunks` from `src/lib/server/book-index/core.mjs`. All 96 real-worker IPC searches in the latency run reproduced its ranking and scores exactly.

Sources: `evaluation-plan.md`, `questions-frozen.json`, `questions-adjudicated.json`, `pool-judgments-stage*.json`, `label-changes.json`, `final-validation.json`.

## Model comparison

These rows keep the current ranker's `0.8 × cosine + 0.2 × query-term coverage`. All models use local CPU q8 inference, normalized 384-dimensional vectors and explicit one-thread ONNX sessions.

| Embedding recipe | English hit@1 | English hit@5 | English hit@10 | MRR@10 | Hinglish hit@5 | Both needs @5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current MiniLM | 34/48 | 43/48, 89.6% | 45/48 | 0.784 | 9/12 | 1/6 |
| BGE-small-en-v1.5 | 36/48 | 46/48, 95.8% | 46/48 | 0.839 | 11/12 | 4/6 |
| multilingual-e5-small | 34/48 | 44/48, 91.7% | 47/48 | 0.796 | 11/12 | 2/6 |

BGE fixed three English top-five misses with no English top-five regressions. They concern philosophical suicide, routine awakening awareness of absurdity, and "most living" versus "best living". The book-cluster bootstrap interval for its +6.25 percentage-point difference was 0.0 to 18.75 points, using 10,000 resamples over six books. This small result is promising, not a general model-quality claim. E5 had three wins and two losses against the current English baseline.

| English evidence hit@5 | Current | BGE hybrid | E5 hybrid |
| --- | ---: | ---: | ---: |
| Bitcoin/Rust | 6/8 | 6/8 | 5/8 |
| Camus | 5/8 | 8/8 | 8/8 |
| Backend slides | 8/8 | 8/8 | 7/8 |
| Data Analysis | 8/8 | 8/8 | 8/8 |
| Gray Hat Python | 8/8 | 8/8 | 8/8 |
| Node/Express | 8/8 | 8/8 | 8/8 |

E5 did better than BGE on Hinglish MRR and top-ten coverage, so BGE does not dominate every metric. Both remain imperfect on this small code-mixed sample. Sources: `results.json`, `analysis.json`.

### Ranking changes are not automatic upgrades

Parameters were fixed before comparative scoring: BM25 k1=1.2/b=0.75, RRF k=60 with depth 50, and exploratory MMR lambda=0.8 with depth 50. Lexical arms use the current English tokenization/stopword policy.

| Recipe | English hit@5 | Hinglish hit@5 | Both needs @5 |
| --- | ---: | ---: | ---: |
| Current MiniLM hybrid | 43/48 | 9/12 | 1/6 |
| MiniLM cosine only | 41/48 | 7/12 | 0/6 |
| BGE cosine only | 44/48 | 10/12 | 3/6 |
| BM25 only | 42/48 | 9/12 | 1/6 |
| MiniLM + BM25 RRF | 42/48 | 8/12 | 2/6 |
| Current ranking + MMR | 46/48 | 6/12 | 0/6 |
| BGE + BM25 RRF | 44/48 | 11/12 | 5/6 |

The existing keyword blend is useful. Default BM25/RRF did not beat it overall. MMR recovered the same three English misses as BGE, but hurt Hinglish and two-part coverage. BGE/RRF covered more two-part needs, at the cost of worse first-result ranking and lower English hit@5 than BGE hybrid. There is no demonstrated single ranking switch that improves every use case. Source: `results.json`.

## Unanswerable questions

The current retriever returned ten candidates for all 12 negatives. That is ordinary candidate-retrieval behavior, but those candidates must not be treated as verified answers.

Current top scores overlapped:

| Question class | Top-score range |
| --- | ---: |
| Answerable English | 0.357 to 0.738 |
| Answerable Hinglish | 0.206 to 0.427 |
| Unanswerable English | 0.204 to 0.600 |

For example, the unsupported question about Camus's personal writing schedule scored 0.600. A universal cutoff of 0.5 would still admit that negative while rejecting every Hinglish question in this set. Cosine/hybrid scores are not confidence probabilities. No threshold was trained and evaluated on these same twelve negatives. Sources: `results.json`, `analysis.json`.

## Speed and cost

Serial query-encoder measurements used 24 English questions, four rounds, rotating model order, three warmups per model load and explicit one-thread sessions. Each row has 96 measured queries.

| Model | q8 weights | Encoder median | Encoder p95 |
| --- | ---: | ---: | ---: |
| MiniLM | 23.0 MB | 5.6 ms | 7.3 ms |
| BGE | 34.0 MB | 13.3 ms | 17.9 ms |
| E5 | 118.3 MB | 12.5 ms | 18.0 ms |

The actual current production worker, over IPC, took 56.9 ms median and 111.8 ms p95 across 96 warm searches. A fresh worker's first model-load/search took 373.0 ms with model files already cached. These exclude application FIFO wait, HTTP and browser overhead.

Separate component measurements found median JSON read/parse of 30.4 ms and ranking of 18.8 ms. For the largest book, those medians were 45.5 and 41.3 ms. They are separate measurements, not components to sum into an exact request percentile. Parsed-index and lexical-term caching are more direct speed experiments than introducing a vector database at this scale. Retrieval also shares the background-indexing FIFO queue, as documented in `worker-client.ts:18`; queue delay was not benchmarked.

Encoding the existing passages took about 402 seconds for BGE, 433 for E5 and 204 for the MiniLM batching control. Those single runs exclude PDF extraction/publication and are not controlled full-index-build benchmarks. Sources: `latency.json`, `worker-latency.json`, `bge-notes.md`, `e5-notes.md`, `minilm-flat-notes.md`.

## Extraction and reproducibility checks

- All 1,093 pages with extractable text were indexed; 35 pages had no extractable text. Every saved passage was found in its normalized raw PDF page text.
- No geometry-only missing-space pairs were detected by the audit heuristic. There were 474 letter/hyphen/newline/letter occurrences. This does not prove perfect reading order, table extraction or OCR coverage.
- All twelve saved-vector probes reproduced exactly when their original per-page batch was replayed. Single-item encoding differed, with a minimum cosine of 0.991 in those probes.
- Production restarts batches on each page; the alternative encoders used flat per-book batches of four. A matched MiniLM control quantified that difference. Its English hit@5 stayed 43/48; Hinglish changed from 9/12 to 8/12. Thus batch grouping did not explain the English BGE gain.
- Across all passages, flat-batch versus saved MiniLM vectors had mean cosine 0.9949 and minimum 0.88995. The worst outlier's numerical cause was not isolated with an fp32 comparison. Batch sensitivity is an observed limitation of the tested q8 recipe, not evidence that saved indexes are corrupt.
- SHA-256 checks confirmed all six original PDFs, all eight pre-existing index files and the original four model-cache files were unchanged.

Sources: `extraction-audit.json`, `embedding-reproduction.json`, `minilm-flat-embeddings.json`, `integrity-verification.json`.

## Recommended next work

1. Before generated Q&A, add source-support/abstention handling and evaluate it on new held-out negative questions. Do not use one raw similarity cutoff as proof of answerability.
2. Test retrieving the separate needs of multi-part questions, then combine bounded evidence. Neighbor context and deduplication are candidates to measure, not fixes established by this experiment.
3. Trial BGE-small-en-v1.5 as the next lightweight model. Keep 384 dimensions; use CLS pooling, its query-only instruction and fresh indexes. Recheck held-out questions and actual production batch boundaries before replacing the default. E5's larger download was not justified by the primary English metric here.
4. If latency needs work, test bounded parsed-index/lexical caches and question scheduling ahead of further background jobs. Current measurements do not justify a vector database migration.

These findings revise the earlier code-only advice: missing-space extraction was not a demonstrated problem in this corpus, and adding default BM25/RRF was not a demonstrated overall improvement.

## Limits, artifacts and reproduction

This is six English PDFs and AI-authored/judged questions, not production query logs or a human-reviewed benchmark. Paired Hinglish questions are not independent English observations. Bootstrap intervals reflect sampled books under these labels, not label uncertainty. No generated answers, cross-encoder reranker, alternative chunking, fp32 quality comparison, OCR, GPU or queue-under-load behavior was evaluated.

Runtime: Node 25.8.2, Bun 1.3.14, Transformers.js 4.3.1, Linux x86_64, 12 logical CPUs. Model weight hashes and frozen/final question hashes are retained in `integrity-verification.json` and `final-validation.json`.

The artifact directory contains encoder/audit scripts, frozen and adjudicated questions, exact-source proofs, every arm's top ten, bootstrap comparisons, timing trials and integrity manifests. These are temporary local artifacts, not a checked-in benchmark package. Preserve that directory if reproducibility after temporary-file cleanup matters.

To rescore the retained artifacts:

```sh
ROOT=/tmp/opencode/better-reader-retrieval-eval-2026-10-20
node "$ROOT/apply-judgments.mjs" 3
node "$ROOT/evaluate.mjs"
node "$ROOT/summarize.mjs"
node "$ROOT/validate-final.mjs"
```

`bun test src/lib/server/book-index` passed 17/17. Full application checks/build/browser tests were not run because application source was unchanged; unit tests do not establish semantic retrieval quality.

Model protocol references: [MiniLM](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), [BGE](https://huggingface.co/BAAI/bge-small-en-v1.5), [multilingual E5](https://huggingface.co/intfloat/multilingual-e5-small). BGE uses CLS rather than the mean-pooling example on its conversion card; E5 requires `query: ` and `passage: ` prefixes. Conversion metadata and protocol checks are retained in `model-protocol.md` and the model-specific notes.
