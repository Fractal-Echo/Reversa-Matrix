# Reversa Studio Backend Readiness Matrix

The backend readiness matrix joins local proof files with the GPU upscale and
framegen advisory dataset. It answers a narrow question:

```text
Which candidates are ready for a controlled local test plan, and which gates
still block them?
```

It is generated evidence with `source_authority=false`. It does not acquire
artifacts, launch runtimes, connect to phones, patch binaries, or turn candidate
rows into recommendations.

## Inputs

- GPU upscale/framegen advisory JSONL
- RTX 5090 CUDA proof JSON
- AMD HX 370 / Radeon 890M proof JSON
- ONNX Runtime DirectML proof JSON

## Command

```bash
node ./bin/reversa.js studio backend-matrix \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --cuda-proof /path/to/gpu-proof.json \
  --amd-proof /path/to/amd-uma-proof.json \
  --onnx-directml-proof /path/to/amd-uma-proof.json \
  --out /path/to/backend-matrix
```

Outputs:

- `backend-readiness-matrix.json`
- `backend-readiness-matrix.tsv`
- `backend-readiness-matrix.md`
- `backend-gate-summary.tsv`
- `candidate-routing.tsv`
- `blocked-candidates.tsv`

## Readiness Levels

| Level | Meaning |
| --- | --- |
| `RESEARCH_METADATA_ONLY` | The row is metadata only and remains research evidence. |
| `RESEARCH_PROVENANCE_UNKNOWN` | Source identity or provenance is missing. |
| `RESEARCH_ARTIFACT_DEFERRED` | Artifact acquisition is intentionally deferred. |
| `RESEARCH_HASH_MISSING` | Hash proof must be captured before execution. |
| `RESEARCH_BACKEND_PROVEN` | Backend import or tiny-op proof exists. |
| `RESEARCH_BACKEND_CANDIDATE` | Backend is plausible, but runtime proof is incomplete. |
| `RESEARCH_READY_FOR_CONTROLLED_TEST` | Eligible for a controlled research test plan only. |
| `RESEARCH_RUNTIME_UNPROVEN` | Backend-specific runtime proof is missing. |
| `RESEARCH_REVIEW_REQUIRED` | Human review is required before promotion. |

## Backend Rules

- CUDA tiny-op proof can unlock `RESEARCH_READY_FOR_CONTROLLED_TEST` for eligible
  CUDA rows.
- DirectML or ONNX Runtime DirectML tiny-op proof can unlock controlled-test
  planning for eligible DirectML/ONNX rows.
- Sparse license metadata does not block research classification.
- Redistribution stays not decided until explicit approval.
- Vulkan visibility does not prove Vulkan NCNN runtime readiness.
- CUDA proof does not prove TensorRT readiness.
- Metadata-only model rows can remain research-only while artifact and hash
  collection are deferred.
- Generated Reversa evidence is never an authority record by itself.

## Studio Fixture

After building the matrix, export a small UI fixture:

```bash
node scripts/export-backend-matrix-ui-fixtures.js \
  --matrix /path/to/backend-matrix/backend-readiness-matrix.json \
  --out ./reversa-studio/fixtures
```

The fixture powers the Reversa Studio `Readiness` panel. It is display evidence,
not a command surface.
