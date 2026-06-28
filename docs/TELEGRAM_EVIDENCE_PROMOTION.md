# Telegram Evidence Promotion Gate

Reversa treats Telegram notes as useful project memory, not automatic source
authority. Stage 05 adds an offline promotion gate so RM11Pro, DroidSpaces, and
Nebula notes can become tracked evidence only when the proof chain is explicit.

## Authority Model

| Evidence | What It Proves | Source Authority |
| --- | --- | --- |
| Telegram text only | A note was captured from chat. | No |
| Telegram note plus hashed file/video | The note has a stable artifact handle. | No, unless decoded content is supplied |
| Hashed file/video plus transcript, OCR, frame extract, or summary | The artifact contains reviewable technical content. | Artifact-backed evidence |
| Repo source, tracked docs, raw logs, counts, or test output | Independent corroboration of a technical claim. | Yes, when non-generated |
| Reversa report, dashboard, or summary | Generated index of evidence. | No |

Files and videos matter. The gate records them as first-class artifacts when
they have hashes, sizes, paths, or media IDs. The guardrail is narrower: a video
hash proves which video was reviewed, but the technical claim inside that video
needs extracted content or another source/log corroborator before it becomes
source-authoritative.

## Command

```bash
node ./bin/reversa.js dataset telegram-promotion \
  --claims /path/to/normalized/claims.jsonl \
  --corroborator /path/to/repo/or/raw-proof \
  --artifact-manifest /path/to/hashed-file-video-manifest.jsonl \
  --out /path/to/output
```

The command is offline and read-only. It does not call Telegram, send messages,
open ADB, stage APKs/modules, launch runtimes, mutate DRM, or touch power/TDP.

## Outputs

- `telegram-promotion-records.jsonl`: every inspected claim and its decision.
- `promoted-evidence.jsonl`: claims corroborated by non-generated source or raw
  proof.
- `artifact-backed-evidence.jsonl`: claims backed by hashed media/file artifacts
  with extracted or summarized content.
- `corroboration-needed.jsonl`: useful notes that still need source, log, hash,
  or decoded-media proof.
- `rejected-evidence.jsonl`: claims rejected by a frontier or safety conflict.
- `promotion-summary.tsv`: counts by promotion state.
- `result.md`: human-readable summary and safety statement.

## Artifact Manifest

Use JSONL. A row can be as small as:

```json
{"media_id":"video-1","path":"D:/Downloads/proof.mp4","sha256":"..."}
```

That row proves artifact identity only. To make it artifact-backed, add decoded
content:

```json
{"media_id":"video-1","path":"D:/Downloads/proof.mp4","sha256":"...","content_summary":"Video shows Nebula DRM lease external display and SCM_RIGHTS wlroots handoff."}
```

The stronger form still does not make Telegram itself source authority. It tells
Reversa that the hashed artifact contains reviewable evidence.

## Promotion Rules

1. Telegram text never promotes by itself.
2. Generated Reversa outputs never promote claims by themselves.
3. Hashed files/videos can make a claim artifact-backed.
4. Hash-only files/videos stay `artifact_backed_needs_content_extraction`.
5. Non-generated repo source, tracked docs, raw logs, or test output can promote
   a claim to source-backed evidence.
6. Known-good frontier proof wins over newer lower Telegram claims.

This keeps the project memory useful without letting chat recency or generated
reports overwrite raw proof.
