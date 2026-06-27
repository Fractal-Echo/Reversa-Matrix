# Reversa Studio UI Blueprint

Reversa Studio is an evidence-console dashboard for GPU upscale, framegen,
texture workflow, and patch dossier planning.

The first prototype is local and static. It reads fixture JSON only.

## Navigation Model

Primary navigation:

- Home
- Evidence
- GPU Proof
- Models
- Textures
- Framegen
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
5. Review model metadata and license risk.
6. Select a texture/upscale/framegen planning lane.
7. Build a patch or reinjection checklist.
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

- "Missing model license"
- "CUDA proof missing"
- "Linux/Proton not proven"
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
- Model License Risk
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

Model Library:

- Hugging Face metadata
- local models
- license status
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
