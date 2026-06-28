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
| `BACKEND_UNAVAILABLE` | No relevant backend was detected or proven. |
| `BACKEND_VISIBLE` | Host visibility exists, but no import or tiny-op proof exists. |
| `BACKEND_IMPORT_PROVEN` | A backend import/provider is visible. |
| `BACKEND_TINY_OP_PROVEN` | A tiny local operation proved backend mechanics. |
| `BACKEND_CANDIDATE` | The row is relevant, but runtime proof is incomplete. |
| `BACKEND_BLOCKED_LICENSE` | License review blocks further promotion. |
| `BACKEND_BLOCKED_ARTIFACT` | Artifact acquisition or metadata-only status blocks promotion. |
| `BACKEND_BLOCKED_HASH` | Hash or provenance proof is missing. |
| `BACKEND_BLOCKED_RUNTIME` | Backend-specific runtime proof is missing. |
| `BACKEND_READY_FOR_CONTROLLED_TEST` | Eligible for a controlled test plan only. |
| `BACKEND_READY_FOR_RECOMMENDATION` | Reserved for future fully proven rows. |

## Backend Rules

- CUDA tiny-op proof can unlock `BACKEND_READY_FOR_CONTROLLED_TEST` for eligible
  CUDA rows.
- DirectML or ONNX Runtime DirectML tiny-op proof can unlock controlled-test
  planning for eligible DirectML/ONNX rows.
- Vulkan visibility does not prove Vulkan NCNN runtime readiness.
- CUDA proof does not prove TensorRT readiness.
- Metadata-only model rows remain blocked until license, artifact, hash, and
  provenance gates are cleared.
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
