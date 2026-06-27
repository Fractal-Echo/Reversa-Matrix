# Platform Scope

Reversa-Matrix is being shaped for Windows, Android, Linux, and mixed source trees.

It should stay profile-driven: each platform gets specialized extractors, but all evidence lands in the same report contract.

---

## Android

Current strongest profile:

- `android_recovery`

Useful targets:

- recovery device trees
- OrangeFox/TWRP trees
- kernel config fragments
- vendor blob lists
- fstab files
- init rc files
- BoardConfig and product makefiles
- known-good device facts

Typical contradictions:

- wrong board or product name
- old SoC/platform leftovers
- partition size mismatches
- missing service binaries
- vendor blob paths that do not exist
- decrypt stack assumptions that do not match the target

---

## Linux

Current related profiles:

- `linux_container`
- `userspace_graphics`
- `gamescope`
- `generic_source_tree`

Useful targets:

- container roots
- compositor and graphics stacks
- systemd units
- kernel/userland boundary files
- build outputs and package manifests
- ELF-heavy userspace projects

Linux support should focus on claims that can be checked from files: paths, packages, symbols, services, configs, runtime assumptions, and known-good logs.

---

## Windows

Current profile:

- `windows_system`

Useful targets:

- services
- drivers
- Visual Studio and MSBuild projects
- PowerShell scripts
- registry assumptions
- PE metadata
- installer layouts
- cross-compiled Windows targets

Windows profile work preserves the same safety model: inspect files, classify evidence, produce handoff artifacts, and avoid destructive host changes.

---

## Game Runtime

Current related profiles:

- `game_modding`
- `pcgamingwiki_runtime`
- `widescreen_framegen_runtime`
- `game_exe_patch_runtime`
- `gpu_upscale_framegen`
- `graphics_wrapper`
- `vulkan_loader`
- `bo3_zombies_diagnostics`
- `render_enhancement_plugin`
- `rm11pro_gaming_runtime`

Useful targets:

- old-game modding and private co-op launch profiles
- PCGamingWiki-style game data, store/version, video, input, audio, network, API, middleware, Wine, Proton, and Linux fix notes
- graphics wrapper chains such as DXVK, VKD3D, ReShade, SpecialK, 3DMigoto, SUWSF, and upscalers
- Flawless Widescreen, ultrawide/FOV/HUD, frame generation, Windows DLL proxy, and Linux Vulkan layer evidence
- Cupscale/Flowframes, RIFE/DAIN/FLAVR, Real-ESRGAN/SwinIR/waifu2x/Real-CUGAN, NCNN/Vulkan, PyTorch/CUDA, TensorRT, ONNX Runtime, DirectML, FFmpeg/VapourSynth/ImageMagick, and model provenance/hash/license evidence
- offline/private executable patch manifests with exact version/hash guards, RVA/signature mapping, backup/rollback, and Linux/Proton validation
- Vulkan loader variables, ICD JSON references, and driver negotiation logs
- render hook, frame timing, texture injection, and HDR pipeline manifests
- mobile Linux gaming profiles for phone, container, translation, and Vulkan driver layers
- performance notes tied to frame pacing, shader cache, texture streaming, and VRAM pressure
- security notes about crash exploits, network passwords, friends-only sessions, and patch validation

Game runtime support is diagnostic. It classifies runtime identity, wrapper inventory, loader state, performance symptoms, and safety-boundary terms. It does not implement anti-cheat bypasses, DRM removal, public-match automation, competitive advantage features, or ownership-evasion behavior.

---

## Cross-Platform

Many real trees are mixed. Reversa-Matrix should handle:

- C and C++
- Rust
- Java and Kotlin
- Python
- JavaScript and TypeScript
- shell scripts
- build systems
- generated files
- copied constants
- reference-tree drift

The platform-specific profile should enrich the report, not fragment the output format.
