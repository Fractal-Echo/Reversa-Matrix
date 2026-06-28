# Reversa Studio

Reversa Studio is a local-first evidence and workflow UI for GPU upscaling,
frame generation, texture workflows, and guarded patch proposals.

It is the desktop/host brain for complex enhancement work. It reads evidence,
advisory datasets, model metadata, and patch dossiers, then turns them into
reviewable plans. Version 01 is a static prototype and planning surface only.

## Mission

Reversa Studio helps the user understand, prepare, and safely execute complex
game/runtime enhancement workflows.

The focus is mechanism over guesswork:

- what evidence exists;
- what proof is missing;
- which backend is implied;
- which model metadata is safe to review;
- which actions are blocked;
- which action is the next reversible step.

## What Version 01 Does

- reads Reversa scan outputs;
- reads advisory datasets;
- shows model metadata;
- classifies backend requirements;
- builds safe patch/reinjection checklists;
- creates review-safe patch dossiers;
- flags missing proof;
- refuses unsafe EXE patch plans;
- refuses unsupported Linux/Proton claims;
- refuses unknown-license model downloads.

Version 01 may show proposed workflow steps, but every future patch,
reinjection, or runtime-adjacent action stays proposal-only.

## Local 5090 Proof Capture

Reversa Studio can capture local GPU proof and use it to rank advisory
candidates. The proof lane records Nvidia metadata, CUDA visibility, existing
PyTorch CUDA state, a tiny CUDA tensor result when PyTorch already supports it,
and passive backend availability.

The proof command does not install packages, acquire model artifacts, launch
games, launch graphics runtimes, connect to phones, or mutate projects. A
separate controlled setup may install official PyTorch CUDA wheels into
`local/venvs/reversa-torch-cuda-proof` only, then pass that interpreter with
`--python` for tensor-op proof.

## AMD 890M / UMA Proof Capture

Reversa Studio can also capture a separate AMD proof lane for HX 370 / Radeon
890M / UMA systems. This lane records Windows GPU visibility, DirectX 12,
DirectML candidate status, UMA memory evidence, Vulkan/OpenCL evidence when
visible, optional `torch-directml` proof, and optional ONNX Runtime DirectML
proof from an existing interpreter.

The AMD lane does not overwrite RTX 5090 proof. DirectML candidate status is
useful host evidence, but it is not a model-ready or runtime-ready claim.
ONNX Runtime DirectML tiny-op proof uses a generated local Add graph with memory
pattern optimizations disabled and sequential execution mode; it still does not
prove broad model readiness.

Use:

```bash
node ./bin/reversa.js studio amd-proof \
  --out /path/to/amd-proof
```

Then join it with the advisory dataset:

```bash
node ./bin/reversa.js studio amd-join \
  --proof /path/to/amd-proof/amd-uma-proof.json \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --out /path/to/amd-local-fit
```

## Backend Readiness Matrix

After CUDA, AMD, and ONNX Runtime DirectML proof files exist, Studio can build a
single generated matrix that ranks advisory rows by backend gate status:

```bash
node ./bin/reversa.js studio backend-matrix \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --cuda-proof /path/to/gpu-proof/gpu-proof.json \
  --amd-proof /path/to/amd-proof/amd-uma-proof.json \
  --onnx-directml-proof /path/to/onnx-directml-proof/amd-uma-proof.json \
  --out /path/to/backend-matrix
```

`RESEARCH_READY_FOR_CONTROLLED_TEST` means planning can continue for a
controlled local research test. It is not a recommendation, production-ready
claim, redistribution approval, model-artifact approval, or runtime launch
permission.

## What Version 01 Does Not Do

- no game launch;
- no EXE patch;
- no DLL injection;
- no anti-cheat bypass;
- no DRM bypass;
- no model weight download;
- no automatic reinjection;
- no runtime mutation.

## UI Inspiration Boundaries

Special K, Cupscale, and Flowframes are workflow inspirations, not code sources.

Reversa Studio may learn from the shape of those workflows: render/runtime
inspection, upscale planning, interpolation planning, model selection,
deduplication, scene-change handling, backend proof, and reviewable output
packages. It must not copy third-party UI assets or source code wholesale.

## Core Screens

- Home / Project Intake
- Evidence Board
- GPU Proof
- Model Library
- Texture Pipeline
- Upscale Pipeline
- Frame Interpolation / Framegen Pipeline
- Runtime Backend Matrix
- Patch Dossier
- Safety Gate
- Queue / Jobs
- Reports
- Settings

## Safety Gates

The following proof is required before any future patch or reinject step:

- original hash;
- patched hash;
- backup path;
- game version;
- offset/signature;
- patch provenance;
- model license;
- model hash;
- rollback plan;
- offline/private scope;
- no anti-cheat/DRM bypass.

Missing proof means the UI must present a block or review warning, not an action
button.

## Local GPU Lane

5090/CUDA proof requires:

- `nvidia-smi`;
- `torch.cuda.is_available()`;
- CUDA runtime;
- driver version;
- backend used;
- model size/VRAM estimate.

Without those facts, acceleration remains a candidate, not a proven backend.

Use:

```bash
node ./bin/reversa.js studio gpu-proof \
  --python local/venvs/reversa-torch-cuda-proof/bin/python \
  --out /path/to/gpu-proof
```

Then join it with the advisory dataset:

```bash
node scripts/join-gpu-proof-with-advisory.js \
  --proof /path/to/gpu-proof/gpu-proof.json \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --out /path/to/local-fit
```

The join output is generated evidence with `source_authority=false`.

## Reversa / Nebula Relation

- Reversa Studio is the desktop/host brain.
- Nebula is the phone control deck.
- The Reversa to Nebula phone companion link stays read-only first.
- No phone actions are part of this pass.

Studio may eventually display Nebula status, but the control path must remain
explicit, guarded, and separated from desktop game/runtime planning.
