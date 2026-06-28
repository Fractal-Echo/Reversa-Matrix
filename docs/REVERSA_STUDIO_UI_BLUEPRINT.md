# Reversa Studio UI Blueprint

Reversa Studio is an evidence-console dashboard for GPU upscale, framegen,
texture workflow, Power/TDP research, and patch dossier planning.

The first prototype is local and static. It reads fixture JSON only.

## Navigation Model

Primary navigation:

- Home
- Evidence
- GPU Proof
- AMD / UMA
- Power / TDP
- Models
- Textures
- Framegen
- Readiness
- Patch
- Safety
- Reports
- Settings

The default screen is Home / Project Intake. It should show enough status for a
new user to understand what is safe, what is blocked, and what to do next.

## Card System

Cards are compact evidence surfaces. They use:

- status chip: `Safe`, `Review`, `Blocked`, `Candidate`, `Unknown`;
- title;
- short plain-language explanation;
- evidence count or proof count;
- optional advanced details.

Avoid nested cards. Repeated items such as models or patch checks may be cards;
page sections should stay full-width bands or unframed grids.

## Project Workflow

1. Create or select a project.
2. Import Reversa scan output or advisory dataset fixture.
3. Review evidence health and known-good frontier.
4. Capture or import local GPU proof.
5. Review model metadata, provenance, and redistribution status.
6. Select a texture/upscale/framegen or Power/TDP planning lane.
7. Build a patch, reinjection, or controlled-test checklist.
8. Stop at the Safety Gate until required proof exists.
9. Export a report.

## Visual Direction

Visual language:

- dark evidence console;
- RedMagic black base;
- cyan evidence lines;
- red block state;
- controlled purple accent for advanced mode;
- green safe state;
- high-contrast chips;
- grid and scanline texture kept subtle.

Tone:

- Blade Runner evidence terminal;
- RedMagic control deck;
- Reversa no-nonsense proof board.

No third-party UI assets are copied.

## Plain-Language Labels

Use plain labels:

- "Provenance unknown"
- "Redistribution not decided"
- "CUDA proof missing"
- "Linux/Proton not proven"
- "Read-only proof"
- "Write deferred"
- "Approval required"
- "Runtime test later"
- "Patch cannot be applied"
- "Review-only package"
- "Next safe action"

Keep raw labels available in advanced details.

## Advanced Mode Toggles

Advanced mode can reveal:

- source path;
- evidence hash;
- labels;
- backend tags;
- required proof;
- authority flag;
- generated artifact state.

Advanced mode must not unlock mutation.

## Patch Safety Banner

Banner language:

```text
Proposal only. Reversa Studio does not patch, inject, launch, or mutate runtime
state. Missing proof keeps the action blocked.
```

## Generated Report Preview Layout

Report preview sections:

- project summary;
- evidence health;
- model risk table;
- backend matrix;
- patch dossier checklist;
- blocked reasons;
- next safe action;
- authority notes.

Generated reports are display artifacts. They are not authority records.

## Required UI Cards

Home:

- Active Project
- Evidence Health
- Known-Good Frontier
- GPU Proof
- Unsafe Actions Blocked
- GPU Readiness
- Research Provenance
- Next Safe Action

Texture Pipeline:

- Dump Source
- Texture Manifest
- Upscale Model
- Preview Compare
- Reinject Package
- Rollback Bundle

Framegen Pipeline:

- Input Video/Game Capture
- Interpolation Engine
- FPS Target
- Scene Change Guard
- Artifact Risk
- Output Plan

GPU Proof:

- Nvidia SMI status
- driver version
- CUDA runtime version
- VRAM
- PyTorch CUDA status
- tiny tensor operation result
- backend readiness
- local advisory fit summary

Backend Readiness:

- total records
- controlled-test candidates
- recommendation-ready candidates
- CUDA / DirectML / ONNX DirectML counts
- Vulkan NCNN and TensorRT candidate counts
- provenance, redistribution, artifact, hash, and runtime block counts
- proof status labels
- representative gated rows

Power / TDP:

- Host Power Proof: CPU, GPU, battery present, AC state, Windows power scheme, WSL authority warning
- Backend Discovery: ryzenadj, HHD, ACPI call, SMU, powerprofilesctl, powercfg
- Policy Matrix: game profile candidate, battery policy candidate, AC policy candidate, approval required, write deferred
- Action Gate: TDP write deferred, runtime proof required, rollback required, user approval required
- Legacy research summary: device profile, game profile source, performance mode, stable sample / hysteresis, mutation guard

Model Library:

- Hugging Face metadata
- local models
- provenance status
- redistribution status
- hash status
- backend
- VRAM estimate
- download deferred / allowed later

Patch Dossier:

- original hash
- patch method
- reversible status
- backup
- legal note
- proof level
- reviewer checklist

Safety Gate:

- hard block reasons
- soft warnings
- missing evidence
- approval required
