# Workspace Troubleshooting Facts

These facts keep Reversa from rediscovering the same workspace layout and
tooling issues during RM11Pro/Nebula work.

## Source Roots

- WSL project root: `/home/richtofen/.android/repositories`
- Windows E drive mount: `/mnt/e`
- Windows-side RM11 artifact store: `/mnt/e/Android/RM-11-Pro`
- WSL backing disk: `/mnt/e/WSL/Ubuntu/ext4.vhdx`
- Windows-side E drive is part of the project search space. Audit both WSL and
  `E:\` before declaring a file, repo, SDK, or artifact missing.
- Treat `/mnt/e/WSL/Ubuntu/ext4.vhdx` as WSL backing storage, not a source tree.

Primary active repos:

- Reversa-Matrix:
  `/home/richtofen/.android/repositories/tool-repos/Reversa-Matrix`
- Droidspaces-Nebula:
  `/home/richtofen/.android/repositories/Droidspaces-Nebula`
- DroidSpaces OSS:
  `/home/richtofen/.android/repositories/nebula-assets/Repos/Droidspaces-OSS`
- Anland:
  `/home/richtofen/.android/repositories/nebula-assets/Repos/anland`
- Droidspaces rootfs KDE builder:
  `/home/richtofen/.android/repositories/nebula-assets/Repos/Droidspaces-rootfs-KDE-builder`
- WayLandIE active baseline:
  `/home/richtofen/.android/repositories/nebula-assets/Repos/waylandie-vower-578b431`
- RM11Pro Canoe Dock:
  `/home/richtofen/.android/repositories/rm11pro-canoe-dock`
- OrangeFox/TWRP local build tree:
  `/home/richtofen/.android/repositories/rm11mainassets/fox_14.1`
- Nebula assets and nested WIP repos:
  `/home/richtofen/.android/repositories/nebula-assets`

Path case matters. The valid Canoe path is lowercase
`rm11pro-canoe-dock`; `/home/richtofen/.android/repositories/Rm11Pro-canoe-dock`
was observed missing.

## Duplicates And Mirrors

- `/home/richtofen/.android/repositories/rm11pro-canoe-dock-public-status-20260616`
  is a worktree of `rm11pro-canoe-dock`, not independent source.
- `/home/richtofen/.android/repositories/rm11mainassets/projects/droidspace-repos/compatibility-candidates/vower-waylandie-origin-main-20260626`
  is a worktree of the active WayLandIE repo.
- `nebula-assets/analysis/.../online/WayLandIE-main` and
  `nebula-assets/analysis/.../online/Droidspaces-OSS-wayland` are snapshot
  clones, not canonical source.
- For the Nubia kernel, treat
  `/home/richtofen/.android/repositories/rm11mainassets/projects/tree-repos/android_kernel_nubia_sm8850_jujube`
  as working source and
  `/home/richtofen/.android/repositories/nebula-assets/online-forks/android_kernel_nubia_sm8850_jujube`
  as reference/cache.

## Android Tooling

- Android SDK root: `/home/richtofen/.android/sdk`
- Confirmed NDK for Anland daemon builds:
  `/home/richtofen/.android/sdk/ndk/29.0.13113456`
- Other installed WSL NDKs:
  `24.0.8215888`, `25.1.8937393`, `26.1.10909125`, `27.2.12479018`,
  `28.2.13676358`, `29.0.14206865`
- `android-ndk-r27c` symlink:
  `/home/richtofen/.android/ndk/android-ndk-r27c -> /home/richtofen/.android/sdk/ndk/27.2.12479018`
- Android platform/build-tools observed: `android-36`, `36.0.0`
- WSL platform-tools: `/home/richtofen/.android/sdk/platform-tools`, revision
  `37.0.0`
- `sdkmanager` wrapper: `/home/richtofen/.local/bin/sdkmanager`
- Preferred ADB for RM11Pro fast testing:
  `/mnt/c/platform-tools/adb.exe`
- Windows-side platform-tools bundles:
  `/mnt/e/Android/AsusPhone6-AI2201/platform-tools-latest-windows/platform-tools`
  and
  `/mnt/e/Android/AsusPhone6-AI2201/platform-tools_r30.0.5-windows/platform-tools`
- No full Windows SDK was found at common C: or E: SDK locations during the
  2026-06-26 audit.

WSL PATH gaps fixed:

- `shellcheck` installed at `/usr/bin/shellcheck`, version `0.11.0`
- `sdkmanager` wrapper added at `/home/richtofen/.local/bin/sdkmanager`
- `pwsh` wrapper added at `/home/richtofen/.local/bin/pwsh`, targeting Windows
  PowerShell `7.6.3`

Remaining intentional gap:

- No global `gradle`. Apt offers Gradle `4.4.1`, which is too old for these
  Android projects; use repo Gradle wrappers instead.

Available tooling observed:

- Java 17
- Node/npm
- MkDocs/Material via `/home/richtofen/.local/bin/mkdocs`
- `zip`
- `make`
- `ninja`

## Artifact Locations

- Nebula APK:
  `/home/richtofen/.android/repositories/Droidspaces-Nebula/app/build/outputs/apk/debug/app-debug.apk`
- Nebula module zip:
  `/home/richtofen/.android/repositories/Droidspaces-Nebula/build/module/Droidspaces-Nebula-Core-0.2.2.zip`
- WayLandIE APK:
  `/home/richtofen/.android/repositories/nebula-assets/Repos/waylandie-vower-578b431/app/build/outputs/apk/debug/app-debug.apk`
- DroidSpaces binary:
  `/home/richtofen/.android/repositories/nebula-assets/Repos/Droidspaces-OSS/output/droidspaces`
- Historical APK cache:
  `/home/richtofen/.android/repositories/nebula-assets/apks`
- OrangeFox outputs:
  `/home/richtofen/.android/repositories/rm11mainassets/fox_14.1/out/target/product/NX809J/`
  and
  `/home/richtofen/.android/repositories/rm11mainassets/fox_14.1/out/target/product/sm88XX/`
- E-drive RM11 artifacts:
  `/mnt/e/Android/RM-11-Pro/BOOT`,
  `/mnt/e/Android/RM-11-Pro/RECOVERY/ORANGEFOX`,
  `/mnt/e/Android/RM-11-Pro/KERNELS/BUILDS`, and
  `/mnt/e/Android/RM-11-Pro/Tools`

## Clean Tree Policy

Do not use broad `git clean -xdf` in project or evidence trees. Generated
rootfs tarballs, APKs, module zips, build directories, and local evidence should
be ignored, moved to assets, or committed deliberately as release artifacts.

Before updating release docs, verify file size and SHA-256 from the actual
rebuilt artifact.

Known hash watch:

```text
Droidspaces-Nebula-Core-0.2.2.zip
stale README hash observed:
ff3997868a9f24cf29a4eefbbf390184c6d6dd14aebf82478b462a557220a9b3
rebuilt hash observed:
8260a521b2072a835875bd942e99866246a11a9fae0490b268aa4d5a64c28aa0
```
