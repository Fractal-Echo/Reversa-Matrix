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

## Reversa / Nebula Relation

- Reversa Studio is the desktop/host brain.
- Nebula is the phone control deck.
- The Reversa to Nebula phone companion link stays read-only first.
- No phone actions are part of this pass.

Studio may eventually display Nebula status, but the control path must remain
explicit, guarded, and separated from desktop game/runtime planning.
