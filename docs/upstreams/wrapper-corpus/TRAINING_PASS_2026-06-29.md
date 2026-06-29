# Wrapper Corpus Training Pass - 2026-06-29

This pass trains Reversa on compatibility wrapper families for BO3,
Pandemonium, D: The Game, and future Windows/Linux/RM11Pro game experiments.

The source cache is local and ignored:

```text
/home/richtofen/.android/repositories/tool-repos/wrapper-upstreams/2026-06-29
```

Committed files contain metadata and Reversa-authored conclusions only. Do not
commit copied third-party source text, docs, configs, or profiles.

## Sources

| Source | Observed version | Commit | Lane | Local archive |
| --- | --- | --- | --- | --- |
| `SpecialKO/SpecialK` | `SK_26_6_13_7` | `ed99fc9951e3` | overlay/frame pacing/injection lab | `SpecialK.7z` |
| `doitsujin/dxvk` | `v3.0` | `64542839fedb` | D3D9/10/11 to Vulkan | `dxvk-3.0.tar.gz` |
| `WinterSnowfall/d7vk` | `v1.11` | `92a22de8b189` | D3D7 to Vulkan experiment | `d7vk-v1.11.zip` |
| `elishacloud/dxwrapper` | `v1.7.8400.25` | `a53c30ba3381` | Win32/DX compatibility wrapper | `dxwrapper.zip` |
| `narzoul/DDrawCompat` | `v0.7.1` prerelease | `2c9a07fdf930` | DirectDraw compatibility | `DDrawCompat-v0.7.1.zip` |
| `FunkyFr3sh/cnc-ddraw` | `v7.1.0.0` | `a0b81b11553e` | DirectDraw replacement | `cnc-ddraw.zip` |
| `dege-diosg/dgVoodoo2` | `v2.87.3` | `fe9178ea44c0` | Glide/DirectDraw/D3D to modern APIs | `dgVoodoo2_87_3.zip` |
| `crosire/d3d8to9` | `v1.15.1` | `6cdb8a821848` | D3D8 to D3D9 bridge | `d3d8.dll` |
| `Ph42oN/dxvk-gplasync` | `v3.0-1` | `40b31c3cee68` | DXVK shader compilation experiment | `dxvk-gplasync-v3.0-1.tar.gz` |
| `dosbox-staging/dosbox-staging` | `v0.82.2` | `21b6c73e2444` | DOS runtime control lane | `dosbox-staging-windows-x64-v0.82.2.zip` |

Special K official wiki was reachable at `https://wiki.special-k.info/`.
PCGamingWiki direct page fetch returned HTTP 403 from this environment, so PCGW
is recorded as a reference target but not treated as scraped source proof in
this pass.

## Commands

Each source was shallow-cloned into the local cache, then scanned with:

```bash
node ./bin/reversa.js scan \
  --project-root <local-wrapper-source> \
  --profiles graphics_wrapper,vulkan_loader,pcgamingwiki_runtime,widescreen_framegen_runtime,render_enhancement_plugin \
  --out /home/richtofen/.android/repositories/tool-repos/wrapper-upstreams/2026-06-29/reversa/<source>
```

The Windows host shell expanded Bash `$variables` during early attempts. The
working rule is to avoid inline Bash variables from PowerShell or escape them
before calling WSL.

## Aggregate Scan Results

| Source | Reports | Findings | Contradictions | Patch candidates | Profiles |
| --- | ---: | ---: | ---: | ---: | --- |
| `FunkyFr3sh/cnc-ddraw` | 5 | 15194 | 5 | 25 | wrapper/vulkan/pcgw/framegen/render |
| `Ph42oN/dxvk-gplasync` | 5 | 25210 | 0 | 0 | wrapper/vulkan/pcgw/framegen/render |
| `SpecialKO/SpecialK` | 5 | 487299 | 25 | 655 | wrapper/vulkan/pcgw/framegen/render |
| `WinterSnowfall/d7vk` | 5 | 125617 | 0 | 215 | wrapper/vulkan/pcgw/framegen/render |
| `crosire/d3d8to9` | 5 | 1565 | 0 | 0 | wrapper/vulkan/pcgw/framegen/render |
| `dege-diosg/dgVoodoo2` | 5 | 1670 | 5 | 5 | wrapper/vulkan/pcgw/framegen/render |
| `doitsujin/dxvk` | 5 | 99412 | 0 | 150 | wrapper/vulkan/pcgw/framegen/render |
| `dosbox-staging/dosbox-staging` | 5 | 280503 | 1700 | 2690 | wrapper/vulkan/pcgw/framegen/render |
| `elishacloud/dxwrapper` | 5 | 47498 | 5 | 20 | wrapper/vulkan/pcgw/framegen/render |
| `narzoul/DDrawCompat` | 5 | 14848 | 0 | 5 | wrapper/vulkan/pcgw/framegen/render |

## Readout

Special K is the highest-value study source for Reversa-owned overlay design:
it contains dense evidence for hook surfaces, frame pacing vocabulary, HDR,
texture injection, telemetry, and game-specific profile behavior. It is also
too broad to use as a direct blueprint. Reversa should learn taxonomy and
failure modes, then implement its own wrapper/overlay contracts.

DXVK is the cleanest Vulkan lane for BO3-style D3D11 work. For Windows and
Linux/RM11Pro experiments, the minimum practical chain remains:

```text
Game -> D3D11/DXGI proxy -> DXVK -> Vulkan
```

D7VK is high-signal for old D3D7 titles but should stay experimental until a
target game proves it beats dgVoodoo or DDrawCompat.

dxwrapper, DDrawCompat, cnc-ddraw, dgVoodoo2, and d3d8to9 form the old-game
decision matrix. They are not interchangeable. Reversa must identify the native
API and bitness first, then pick the smallest wrapper family that solves the
specific failure.

DOSBox staging is a control lane. It is useful for D: The Game research and old
runtime containment, but current graphics-wrapper profiles generate too many
contradictions on emulator/runtime internals. Reversa should add a dedicated
`dos_runtime` or `emulator_runtime` profile before using it as normal wrapper
training signal.

## First Reversa-Owned Wrapper Direction

Build a wrapper supervisor before building a monolithic replacement:

1. Inventory the target game executable, API, bitness, monitor, overlays, and
   active wrapper DLLs.
2. Select a chain from a wrapper decision matrix.
3. Apply the chain through reversible file staging.
4. Capture logs, frame timing, and Vulkan/driver proof.
5. Render a transparent top-screen overlay with high-contrast telemetry.
6. Export a rollback manifest.

That gives BO3 immediate value and gives Pandemonium/D enough structure to move
toward cleaner ports later.

## Current Candidate Ranking

| Rank | Candidate | Why |
| ---: | --- | --- |
| 1 | Reversa wrapper supervisor + telemetry overlay | Lowest legal/technical risk; works with existing wrappers; gives BO3 test value fast |
| 2 | DXVK-first BO3 render bridge | Best match for D3D11 to Vulkan on Windows/Linux/RM11Pro |
| 3 | Old-game wrapper matrix | Needed for Pandemonium and D: The Game before UE/remaster work |
| 4 | Special K-inspired Reversa overlay | Valuable, but must be Reversa-owned and not code/config copied |
| 5 | DOS runtime profile | Needed for D control tests, but not a direct wrapper base |

## Open Work

- Add a dedicated `wrapper_corpus` or `wrapper_supervisor` dataset builder so
  wrapper scans do not ride the agentic-training pack naming.
- Add a `dos_runtime` profile to separate emulator/runtime evidence from DLL
  proxy evidence.
- Build a private local corpus from wrapper source caches and release metadata.
- Add fixtures for old-build regression selection.
- Add a BO3 test manifest that can compare native D3D11, DXVK, Reversa
  telemetry, and Reversa+DXVK chains without destructive game-folder writes.
