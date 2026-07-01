# Wrapper Corpus Refresh - 2026-06-30

This refresh reran the local wrapper corpus after the `dos_runtime` profile was
split out from graphics-wrapper evidence.

## Command

```bash
node scripts/refresh-wrapper-corpus.js \
  --manifest docs/upstreams/wrapper-corpus/source-sync.json \
  --out local/training-vault/training-runs/wrapper-corpus-refresh-2026-06-30
```

The generated artifacts are local-only and ignored:

```text
local/training-vault/training-runs/wrapper-corpus-refresh-2026-06-30/
```

## Results

| Source | Lane | Profiles | Findings | Contradictions | Patch candidates |
| --- | --- | --- | ---: | ---: | ---: |
| `SpecialKO/SpecialK` | `overlay_frame_pacing_injection_lab` | wrapper/render profiles | 487299 | 25 | 655 |
| `doitsujin/dxvk` | `d3d9_10_11_to_vulkan` | wrapper/render profiles | 99412 | 0 | 150 |
| `WinterSnowfall/d7vk` | `d3d7_to_vulkan_experiment` | wrapper/render profiles | 125617 | 0 | 215 |
| `elishacloud/dxwrapper` | `win32_dx_compatibility_wrapper` | wrapper/render profiles | 47498 | 5 | 20 |
| `narzoul/DDrawCompat` | `directdraw_compatibility` | wrapper/render profiles | 14848 | 0 | 5 |
| `FunkyFr3sh/cnc-ddraw` | `directdraw_replacement` | wrapper/render profiles | 15194 | 5 | 25 |
| `dege-diosg/dgVoodoo2` | `glide_directdraw_d3d_to_modern_api` | wrapper/render profiles | 1670 | 5 | 5 |
| `crosire/d3d8to9` | `d3d8_to_d3d9_bridge` | wrapper/render profiles | 1565 | 0 | 0 |
| `Ph42oN/dxvk-gplasync` | `dxvk_shader_compilation_experiment` | wrapper/render profiles | 25210 | 0 | 0 |
| `dosbox-staging/dosbox-staging` | `dos_runtime_control_lane` | `dos_runtime` only | 49507 | 340 | 538 |

## Readout

- DOSBox is now isolated to `dos_runtime`; it no longer trains graphics-wrapper
  profiles as if it were a DLL proxy chain.
- Special K remains the densest overlay/frame-pacing/HDR/telemetry study source,
  but its breadth makes it a taxonomy source rather than a direct blueprint.
- DXVK remains the cleanest D3D9/10/11 to Vulkan lane for Windows/Linux/RM11Pro
  game experiments.
- D7VK is high-signal for D3D7-era Vulkan experiments, but it should be selected
  only after the target game proves a D3D7 path.
- For D: The Game, the relevant first-pass wrapper is DOSBox Staging, not DXVK,
  Special K, dgVoodoo2, or DDrawCompat.

## Reversa Direction

The first Reversa-owned wrapper/package functionality is now the
`windows_package_runtime` profile, with `game_package_runtime` as an alias. It
produces:

- executable bitness and host process type;
- native API/runtime classification;
- active wrapper DLL inventory and load-order candidates;
- frame pacing/frame generation/upscaler candidate notes;
- least-translation-layer recommendation;
- reversible test plan and rollback manifest.

The package profile is intentionally separate from the `dos_runtime` profile,
but it imports DOS runtime clues when a Windows package contains DOSBox,
DOSBox-X, DOSBox Staging, or old SVN-Daum evidence. That keeps packaging issues
inspectable without training Reversa to treat emulator internals as a normal
DXVK/Special K/dgVoodoo DLL proxy chain.
