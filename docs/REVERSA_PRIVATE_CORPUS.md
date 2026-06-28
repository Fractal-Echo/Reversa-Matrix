# Reversa Private Corpus

The private corpus lane builds a deterministic retrieval/training dataset from
operator-selected repos, proof logs, extracted media notes, and promoted
evidence.

It is designed for Reversa Studio and local model work:

- chunk useful source/proof text into hashed JSONL records;
- preserve source authority, generated-artifact, raw-proof, and operator-note
  boundaries;
- redact common token/key/password patterns before writing chunks;
- split records into deterministic train/validation/test files;
- write summaries, skipped-file rows, privacy rows, and hash manifests.

The generated corpus may contain source text or proof text. Keep outputs in
ignored operator storage such as `local/`, `logs/`, `private/`, `.reversa/`, or
a path outside the repository.

## Command

```bash
node ./bin/reversa.js dataset private-corpus \
  --manifest local/private-corpus-manifest.json \
  --out local/private-corpus/run-01
```

Optional limits:

```bash
--max-file-bytes 262144
--max-files-per-source 1000
--max-chunk-chars 1800
--chunk-overlap 180
```

## Manifest Shape

```json
{
  "schema": "reversa.private_corpus_manifest.v1",
  "corpus_id": "rm11pro-reversa-corpus",
  "max_file_bytes": 262144,
  "max_chunk_chars": 1800,
  "chunk_overlap": 180,
  "sources": [
    {
      "id": "reversa",
      "root": "/path/to/Reversa-Matrix",
      "role": "repo_source",
      "tags": ["reversa", "training"]
    },
    {
      "id": "nebula-proof",
      "root": "/path/to/nebula-assets/logs",
      "role": "raw_proof",
      "authority_class": "raw_proof",
      "tags": ["nebula", "graphics"]
    },
    {
      "id": "telegram-promoted",
      "root": "/path/to/promoted-telegram-extracts",
      "role": "telegram_notes",
      "tags": ["telegram", "rm11pro"]
    }
  ]
}
```

Operator notes are retrieval material only unless corroborated by source or raw
artifact proof. Generated Reversa reports are index material, not source
authority.

## Outputs

```text
private-corpus-records.jsonl
private-corpus-train.jsonl
private-corpus-val.jsonl
private-corpus-test.jsonl
private-corpus-index.json
private-corpus-summary.md
source-summary.tsv
label-summary.tsv
rejected-records.tsv
privacy-summary.tsv
result.md
sha256sums.txt
```

## Authority Rules

- `repo_source`: source-authoritative when not generated.
- `raw_proof`: source-authoritative proof logs or counters.
- `artifact_extract`: source-authoritative only for extracted file/video proof.
- `operator_note`: retrieval-only until corroborated.
- `generated_artifact`: not source-authoritative and not trainable by default.

The private corpus is a memory substrate. It does not replace scanner truth,
known-good frontier guards, or explicit runtime proof.

## Search

```bash
node ./bin/reversa.js dataset private-corpus-search \
  --corpus local/private-corpus/run-01 \
  --query "NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS real_buffer_commits" \
  --top 8 \
  --out local/private-corpus/run-01/query-wayland-frontier
```

The search command is offline. It ranks existing chunks by query terms,
retrieval tags, source authority, raw-proof status, and generated-artifact
penalties. It writes:

```text
private-corpus-query-results.json
private-corpus-query-results.md
```
