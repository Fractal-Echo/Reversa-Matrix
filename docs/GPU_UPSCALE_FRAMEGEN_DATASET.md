# GPU Upscale And Framegen Advisory Dataset

The GPU upscale/framegen advisory dataset is a local JSONL corpus for Reversa's
classification and eval lanes. It is built from short, attribution-safe evidence
snippets, scan metadata, Hugging Face model metadata, manual rules, and synthetic
negative examples.

It is not a model-weight cache, runtime launcher, phone test, or patch applicator.

Reversa Studio can capture local GPU proof and use it to rank advisory
candidates. The local fit join never edits the original dataset; it writes
generated evidence with `source_authority=false`.

## Record Schema

Each JSONL row uses schema version 1:

```json
{
  "schema_version": 1,
  "record_id": "gpuadvisory_...",
  "source_kind": "source|model_card_metadata|scan_finding|manual_rule|negative_example|generated_evidence",
  "source_project": "cupscale|flowframes|huggingface|reversa|synthetic",
  "source_path": "...",
  "source_commit": "...",
  "source_license": "...",
  "evidence_text": "...",
  "evidence_hash": "...",
  "labels": [],
  "backend": [],
  "runtime": [],
  "risk": [],
  "required_proof": [],
  "recommended_action": "...",
  "confidence": "high|medium|low",
  "source_authority": true,
  "generated_artifact": false,
  "notes": "..."
}
```

## Authority Rules

- Hugging Face rows are `source_kind=model_card_metadata`.
- Reversa reports are `source_kind=generated_evidence` or `scan_finding`.
- Training packs, eval packs, dashboards, and summaries are generated evidence.
- Generated evidence must use `source_authority=false`.
- Source-project evidence may use `source_authority=true` only when the
  `source_path` points back to a real source file and the evidence text is a
  short snippet.
- Synthetic fixtures use `source_authority=false`.
- Model-card metadata is authority only for metadata fields such as model ID,
  license string, tags, and file names. It does not prove CUDA, Linux, Proton, or
  runtime support by itself.
- Evidence snippets must be short. Do not copy full model cards, large source
  blocks, or model files.

## Required Labels

- `UPSCALE_RUNTIME_CANDIDATE`
- `FRAMEGEN_RUNTIME_CANDIDATE`
- `VIDEO_INTERPOLATION_CANDIDATE`
- `MODEL_METADATA_ONLY`
- `MODEL_LICENSE_OK`
- `MODEL_LICENSE_UNKNOWN`
- `MODEL_HASH_MISSING`
- `MODEL_PROVENANCE_MISSING`
- `MODEL_WEIGHT_DOWNLOAD_DEFERRED`
- `CUDA_BACKEND_PRESENT`
- `CUDA_CLAIM_UNVERIFIED`
- `CANDIDATE_CUDA_5090`
- `VULKAN_NCNN_BACKEND_PRESENT`
- `CANDIDATE_VULKAN_NCNN`
- `ONNX_BACKEND_PRESENT`
- `CANDIDATE_ONNX`
- `TENSORRT_BACKEND_PRESENT`
- `CANDIDATE_TENSORRT`
- `DIRECTML_BACKEND_PRESENT`
- `CANDIDATE_DIRECTML`
- `WINDOWS_ONLY_RUNTIME`
- `LINUX_RUNTIME_UNKNOWN`
- `PROTON_COMPATIBLE_CANDIDATE`
- `GAME_PATCH_UNSAFE`
- `GAME_PATCH_REVIEW_SAFE`
- `EXE_PATCH_HASH_REQUIRED`
- `REVERSIBLE_PATCH_REQUIRED`
- `GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY`

## Builder

```bash
node ./bin/reversa.js dataset gpu-upscale-framegen \
  --cupscale-scan /path/to/cupscale/report-or-scan-dir \
  --flowframes-scan /path/to/flowframes/report-or-scan-dir \
  --hf-index /path/to/HF_MODEL_METADATA_INDEX.tsv \
  --out /path/to/output/dataset
```

The same builder is available directly:

```bash
node scripts/build-gpu-upscale-framegen-dataset.js \
  --cupscale-scan /path/to/cupscale/report-or-scan-dir \
  --flowframes-scan /path/to/flowframes/report-or-scan-dir \
  --hf-index /path/to/HF_MODEL_METADATA_INDEX.tsv \
  --out /path/to/output/dataset
```

Outputs:

- `gpu-upscale-framegen-advisory.jsonl`
- `gpu-upscale-framegen-train.jsonl`
- `gpu-upscale-framegen-val.jsonl`
- `gpu-upscale-framegen-test.jsonl`
- `label-summary.tsv`
- `source-summary.tsv`
- `rejected-records.tsv`

The split is deterministic and based on the record hash.

## Local Fit Join

Use a captured proof file to rank advisory rows:

```bash
node scripts/join-gpu-proof-with-advisory.js \
  --proof /path/to/gpu-proof.json \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --out /path/to/local-fit
```

The join classifies rows as local candidates, possible CUDA candidates, license
blocked, backend unknown, Linux/Proton unproven, or not GPU relevant. It does not
acquire model artifacts or run any model pipeline.

## Backend Readiness Matrix

When local CUDA, AMD, and ONNX Runtime DirectML proof files exist, build a
cross-backend gate matrix:

```bash
node ./bin/reversa.js studio backend-matrix \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --cuda-proof /path/to/gpu-proof.json \
  --amd-proof /path/to/amd-uma-proof.json \
  --onnx-directml-proof /path/to/amd-uma-proof.json \
  --out /path/to/backend-matrix
```

The matrix preserves dataset authority rules. Generated rows are useful for
planning, but source files, licenses, hashes, provenance, and runtime proof still
control promotion.
