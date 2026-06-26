# Workspace Troubleshooting Facts

These facts keep Reversa from rediscovering the same workspace layout and
tooling issues during RM11Pro/Nebula work.

## Source Roots

- WSL project root: `/home/richtofen/.android/repositories`
- Windows E drive mount: `/mnt/e`
- Windows-side E drive is part of the project search space. Audit both WSL and
  `E:\` before declaring a file, repo, SDK, or artifact missing.

Primary active repos:

- Reversa-Matrix:
  `/home/richtofen/.android/repositories/tool-repos/reversa-fractal-echo`
- Droidspaces-Nebula:
  `/home/richtofen/.android/repositories/Droidspaces-Nebula`
- RM11Pro Canoe Dock:
  `/home/richtofen/.android/repositories/rm11pro-canoe-dock`
- Nebula assets and nested WIP repos:
  `/home/richtofen/.android/repositories/nebula-assets`

Path case matters. The valid Canoe path is lowercase
`rm11pro-canoe-dock`; `/home/richtofen/.android/repositories/Rm11Pro-canoe-dock`
was observed missing.

## Android Tooling

- Android SDK root: `/home/richtofen/.android/sdk`
- Confirmed NDK for Anland daemon builds:
  `/home/richtofen/.android/sdk/ndk/29.0.13113456`
- Android platform/build-tools observed: `android-36`, `36.0.0`
- Preferred ADB for RM11Pro fast testing:
  `/mnt/c/platform-tools/adb.exe`

WSL PATH gaps observed:

- `gradle`
- `sdkmanager`
- `shellcheck`
- `pwsh`

Available tooling observed:

- Java 17
- Node/npm
- MkDocs/Material via `/home/richtofen/.local/bin/mkdocs`
- `zip`
- `make`
- `ninja`

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
