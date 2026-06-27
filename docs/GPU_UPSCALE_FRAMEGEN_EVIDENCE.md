# GPU Upscale And Framegen Evidence

The `gpu_upscale_framegen` profile classifies upscaling, frame interpolation,
frame generation, media-pipeline, model-asset, and executable-patch evidence.

It is read-only. It scans files and logs. It does not download weights, launch
runtime jobs, patch games, stage phone artifacts, or mutate source trees.

## What It Looks For

- Cupscale, Flowframes, RIFE, DAIN, FLAVR, XVFI, IFRNet, GMFSS, FILM, and other
  interpolation or frame-generation lanes.
- Real-ESRGAN, ESRGAN, SwinIR, EDSR, waifu2x, Real-CUGAN, and related upscalers.
- NCNN/Vulkan, PyTorch/CUDA, TensorRT, ONNX Runtime, and DirectML backend clues.
- FFmpeg, VapourSynth, Magick.NET, and ImageMagick media pipeline surfaces.
- fp16, UHD, scene-change, dedupe, tile-size, VRAM, GPU ID, and processing-thread
  tuning hints.
- Windows-only DLL/proxy/WinForms surfaces versus Linux/Proton candidates.
- Offline/private executable patch dossiers with hashes, version facts,
  offsets/signatures, backup, rollback, patch origin, and legal/offline notes.

## Evidence Rules

Reversa treats model files as runtime inputs, not vague assets. A model reference
must eventually carry:

- model path;
- upstream provenance;
- license or model-card status;
- hash or checksum;
- backend/runtime target;
- local-use and redistribution notes when relevant.

If those fields are missing, the profile emits guardrail findings such as:

- `MODEL_HASH_MISSING`
- `MODEL_LICENSE_UNKNOWN`
- `MODEL_PROVENANCE_MISSING`

CUDA and 5090 acceleration claims also require direct host/runtime proof. A line
that only says "CUDA supported" is not enough. Reversa expects evidence such as
`nvidia-smi`, `torch.cuda.is_available()`, CUDA runtime version, driver version,
and backend identity before it promotes the lane to a candidate.

## Generated Artifact Boundary

The profile also enforces the Reversa self-reference guard:

- generated scans;
- dashboards;
- local training packs;
- eval reports;
- classifier outputs;
- derived summaries.

These can be useful archaeology, but they are not primary authority. Reversa
records them as `GENERATED_EVIDENCE`, `DERIVED_SUMMARY`,
`TRAINING_EVAL_ARTIFACT`, and `NOT_SOURCE_AUTHORITY` instead of recursively
promoting their text into active contradictions or patch candidates.

## Usage

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/cupscale-or-flowframes-tree \
  --profile gpu_upscale_framegen \
  --out reversa_gpu_out
```

Aliases:

- `upscale_runtime`
- `framegen_runtime`
- `game_upscale`
- `flowframes`
- `cupscale`

## Safety Boundary

This profile may identify review-safe executable patch dossiers, but it does not
perform modifications. A patch dossier must include original and patched hashes,
reversibility, backup, game version, offset/signature mapping, patch origin, and
legal/offline/private-use notes before Reversa marks it review-safe.
