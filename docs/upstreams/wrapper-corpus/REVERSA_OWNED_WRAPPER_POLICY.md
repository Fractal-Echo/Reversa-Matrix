# Reversa-Owned Wrapper Policy

This corpus teaches Reversa how compatibility wrappers are shaped. It does not
authorize vendoring or cloning third-party wrapper implementation.

## Goal

Reversa should learn to classify wrapper families, API boundaries, load order,
bitness, release drift, and validation evidence so it can recommend the lowest
practical translation-layer count for each game.

The first Reversa-owned wrapper target is not "copy Special K" or "copy DXVK".
It is a clean orchestration and telemetry layer that can select, validate, and
chain existing wrapper lanes while future Reversa-native pieces are implemented
from scratch.

## Import Rules

| Material | Allowed Use | Forbidden Use |
| --- | --- | --- |
| Public release metadata | Commit tags, hashes, URLs, dates, and asset names | Claim unverified current state |
| Local source cache | Personal local pattern training and scanner evidence | Commit copied source text |
| Wrapper docs | Summarize behavior and validation lessons | Copy manuals or config blocks wholesale |
| Old local builds | Regression matrix and engine-specific baselines | Treat old build as latest |
| Reversa scan outputs | Local evidence and training signal | Treat noisy scanner counts as proof without review |

All wrapper-derived reusable implementation must be Reversa-owned and written
from the learned mechanism, not transcribed from upstream source.

## Training Boundaries

- `local_experimental_training_allowed=true` means personal local training is
  allowed for the operator cache.
- `redistribution_allowed=false` means raw source text, copied docs, or trained
  material exports stay local.
- `commercial_use_allowed=false` means this lane is for personal research until
  each source license and output boundary is reviewed.
- Committed docs may include metadata, hashes, release URLs, scanner summaries,
  and Reversa-authored conclusions.

## Wrapper Selection Model

Reversa should rank a candidate wrapper chain by:

1. Native API compatibility.
2. Process bitness.
3. Required feature surface: overlay, frame pacing, HDR, texture replacement,
   frame generation, shader cache, or legacy display mode.
4. Translation-layer count.
5. Known engine-specific old-build evidence.
6. Reversibility and rollback cost.
7. Reproducible validation evidence.

For BO3-like D3D11 games, the first Vulkan lane should usually be:

```text
Game -> D3D11/DXGI proxy -> DXVK -> Vulkan
```

For old DirectDraw/Glide/D3D7/D3D8 games, Reversa should first classify the
native API and bitness before choosing a wrapper:

```text
DirectDraw -> DDrawCompat | cnc-ddraw | dxwrapper | dgVoodoo
Glide      -> dgVoodoo | nGlide
D3D7       -> D7VK | dgVoodoo
D3D8       -> d3d8to9 -> D3D9 path
```

DOSBox-style projects are a control lane, not an ultimate-wrapper base. They
teach emulator/runtime containment and old-game launch policy, but their large
contradiction count under graphics-wrapper profiles means Reversa must avoid
classifying emulator internals as normal DLL-proxy wrapper evidence.

## Special K Study Boundary

Special K is a high-signal source for overlay, injection, frame pacing, HDR,
texture replacement, and game-specific profile behavior. Reversa may study:

- feature taxonomy;
- overlay and telemetry surface shape;
- frame pacing vocabulary;
- game profile organization;
- release/version layout;
- failure modes caused by competing overlays and proxy DLL load order.

Reversa must not copy Special K code, UI text, docs, config defaults, or game
profiles into committed Reversa files. Any Reversa-owned overlay must be a clean
implementation with its own API, settings model, UI, and validation tests.

## Old-Build Rule

Old wrapper builds are useful evidence. They must be labeled as historical and
tested against a specific target, not promoted as current defaults.

Use old builds when:

- a target engine regressed on current builds;
- PCGamingWiki or local proof names a known-good older wrapper;
- the game requires legacy behavior removed from current builds;
- a rollback baseline is needed for A/B testing.

Use current builds when:

- no engine-specific proof favors an old build;
- security, driver, or Vulkan loader fixes matter;
- the target is modern Windows, Proton, or RM11Pro/Linux.

## Minimum Test Evidence

Before Reversa recommends a wrapper chain for a game, record:

- game executable, bitness, and native graphics API;
- wrapper version, architecture, file hashes, and active DLL names;
- active display path and monitor refresh rate when relevant;
- Vulkan device/ICD evidence for Vulkan lanes;
- overlays enabled or disabled;
- frame-time sample before and after the change;
- rollback path.

WEIGH IT AGAIN = TESSERACT: repeated claims only count when the runs are
independent, reproducible, and attached to files/logs/configs/screenshots.
