# Anland/Xwayland Responsiveness

The `anland_xwayland_responsiveness` profile is a read-only classifier for Nebula and DroidSpaces display evidence.

It exists to prevent one specific regression loop: treating a live Anland/KDE/KWin producer as missing just because X11, GLX, or Vulkan clients hang.

## What It Classifies

The profile separates these states:

| Classification | Meaning |
| --- | --- |
| `producer_absent` | The Anland producer entrypoint or process is missing. |
| `socket_missing` | The producer may exist, but expected Wayland/X11 sockets are absent. |
| `socket_present_auth_bad` | Sockets exist, but DISPLAY or Xauthority blocks clients. |
| `env_leakage` | DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR, or graphics loader variables point at the wrong layer. |
| `x11_client_hang` | `xdpyinfo` or another X11 metadata probe timed out. |
| `glx_hang` | `glxinfo -B` timed out. |
| `vulkan_loader_bad` | `vulkaninfo --summary` timed out or hit loader/driver incompatibility. |
| `producer_alive_client_dead` | Producer and sockets are alive, but one or more clients hang or fail. |
| `known_good_match` | Producer, sockets, GLX, Vulkan, and known-good frontier markers agree. |
| `unknown_needs_manual_probe` | Evidence mentions the lane but lacks enough bounded probe output. |

## Read-Only Probe Contract

Every external runtime probe for this lane must be bounded by a hard timeout.

Safe probe examples:

```bash
timeout 3s ps -A | grep -Ei "anland|xwayland|kwin|wayland"
timeout 3s ls -la /tmp/.X11-unix /run/user/* 2>/dev/null
timeout 5s xdpyinfo -display "$DISPLAY"
timeout 5s xset q
timeout 7s glxinfo -B
timeout 10s vulkaninfo --summary
timeout 3s env | grep -Ei "DISPLAY|WAYLAND|VK_|LD_|MESA|XDG_RUNTIME_DIR"
```

The profile must not stage modules, install APKs, reboot, mutate power/TDP state, change display settings, launch games, or patch runtime source.

## Known Nebula Frontier

Known-good Nebula display evidence remains:

- `NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS`
- `real_buffer_commits=2`
- `vkGetMemoryFdKHR_failures=0`
- `NONE_WAYLAND_DISPLAY`

Stage 18/19 evidence showed a different boundary: the producer and sockets were alive, but client probes timed out. That should be classified as `producer_alive_client_dead`, then investigated with bounded client-side probes.

## Command

```bash
node ./bin/reversa.js scan \
  --profiles anland_xwayland_responsiveness \
  --project-root /path/to/evidence \
  --out /path/to/output
```

