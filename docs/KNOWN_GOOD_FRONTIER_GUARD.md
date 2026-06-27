# Known-Good Frontier Guard

The known-good frontier guard prevents Reversa from treating the newest failed
run as the strongest runtime truth.

## Normalized Frontier Model

### Known-good frontier

The known-good frontier is the deepest proven working state for a lane. For
Nebula graphics work, a frontier must be backed by raw proof when possible:
logs, counters, harness scripts, command output, hashes, and extracted runtime
facts.

### Evidence rank

Evidence rank is ordered by how far the runtime actually proved the lane:

1. `HARNESS_INVALID`
2. `BRIDGE_READY`
3. `GAMESCOPE_READY`
4. `XWAYLAND_READY`
5. `SOFTWARE_GLX_REPRODUCED`
6. `EXPORT_ANALYSIS_ONLY`
7. `WAYLAND_REAL_BUFFER_PASS`
8. `HARDWARE_GLX_PASS`
9. `PROTON_READY`
10. `STEAM_READY`

### Regression below frontier

`REGRESSION_BELOW_KNOWN_GOOD_FRONTIER` means a newer run failed at a lower proof
level than an older known-good run. Recency does not promote the lower run.

### Raw proof beats status-only

Status JSON is useful for UI and summary checks, but raw logs, counters, and
harness files are stronger. Status-only success should produce:

```text
STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY
```

### Newer is not stronger

A newer failed lane does not supersede older raw proof. When older evidence
reaches `WAYLAND_REAL_BUFFER_PASS` and a newer run only reaches SIGBUS, skipped
GLX, no Vulkan device, or no export call, the newer run is a regression artifact.

### Patch gate

When a run is below the known-good frontier, Reversa must recommend:

```text
RECOVER_EXACT_WORKING_HARNESS
```

For Nebula R6 Wayland this resolves to:

```text
R6_WAYLAND_WORKING_03_SIDEcar14_SIDEcar06_REPLAY
```

It must not recommend source patches, new graphics lanes, broad archaeology,
runtime integration, Proton/Wine/Steam jumps, or graphics-source changes before
the exact working harness is recovered or replayed.

## Nebula R6 Markers

Known-good proof markers:

- `NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS`
- `real_buffer_commits=2`
- `vkGetMemoryFdKHR=0`
- `NONE_WAYLAND_DISPLAY`
- `sidecar-14`
- `sidecar-06`
- `force-composition`
- `full-size AR24 parent xdg dmabuf`
- pinned local ICD/driver evidence

Lower-frontier markers:

- `NEBULA_R6_A1E_BASELINE_SIGBUS_CONFIRMED`
- `Xwayland SIGBUS stayed fatal`
- `Xserver ready=no`
- `glxinfo not run`
- `keepalive child with GLX skipped`
- `sidecar-13`
- `shm preload`
- `GAMESCOPE_EXIT=135`
- `SELECTED_VULKAN_DEVICE=NOT_FOUND`
- `VKGETMEMORYFD_FIRST_LINE=NOT_FOUND`

Invalid A1 export proof resolves to:

```text
A1B_KGSL_ENV_ONLY_R6_LIBPATH_RESTORED
```
