# Pandemonium PC Runtime And Remaster Training

This profile teaches Reversa to recognize the Pandemonium PC port as a small
but brittle 32-bit Glide-era runtime with a separate long-term remaster lane.

## Current Split

The original executable lane is for stabilizing the owned PC release:

- `PANDY3.EXE` as the preferred 3Dfx/Glide target.
- `PANDY.EXE` as the software/DirectDraw fallback.
- `glide.dll`, `3DfxSpl.dll`, `SST1INIT.DLL`, `win32.dll`, and `XanLib.dll`
  as runtime boundary files.
- nGlide, dgVoodoo, DXVK, and Vulkan as wrapper-chain evidence.
- registry, ESC/settings, controller, audio, and movie playback as separate
  risk lanes.

The remaster lane is not a binary patch. It is a new runtime/source-port path:

- decode PKG archive tables;
- extract textures, models, animation data, music, and FMVs;
- compare PC assets against PlayStation/PS1 quality;
- upscale or recreate assets;
- import into a 64-bit runtime such as Unreal Engine 5 only after extraction
  proof exists.

Unreal setup is optional for the first pass. The original runtime work should
produce a clean asset map and wrapper baseline before creating a UE project, so
the remaster does not become an empty engine shell with unknown data formats.

## 32-Bit Boundary

The Steam executable is PE32/i386. A 32-bit process can only load 32-bit wrapper
DLLs. That means Vulkan-first stabilization can use 32-bit wrappers, but a real
64-bit Pandemonium requires a new executable/runtime.

## First Vulkan Experiment

Preferred first chain:

```text
PANDY3.EXE -> dgVoodoo x86 Glide.dll -> Direct3D11 -> DXVK x32 -> Vulkan
```

Control chain:

```text
PANDY3.EXE -> bundled nGlide -> Direct3D
```

Direct3D12 through dgVoodoo should remain a later test because dgVoodoo's D3D12
backend has stricter swapchain behavior that can be fragile with old mixed
window, movie, and menu surfaces.

## Profile

Use:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/Pandemonium \
  --profile pandemonium_pc_runtime \
  --out reversa_pandemonium
```

The profile records both text evidence and file-inventory evidence. Binary
archives and media are not extracted during scanning; Reversa records their
paths and sizes as guard evidence, then requires separate PKG/FMV decode proof
before texture, model, music, or movie replacement is treated as ready.

CNF manifests are parsed as archive-routing evidence. A row such as
`level21.pkg 0 21 21 42 8 0` proves the install points at a PKG archive with
six numeric routing fields, but it does not prove the internal PKG table has
been decoded.
