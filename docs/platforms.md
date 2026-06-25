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

Windows support is a product direction, not a completed profile.

Useful targets:

- services
- drivers
- Visual Studio and MSBuild projects
- PowerShell scripts
- registry assumptions
- PE metadata
- installer layouts
- cross-compiled Windows targets

Windows profile work should preserve the same safety model: inspect files, classify evidence, produce handoff artifacts, and avoid destructive host changes.

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
