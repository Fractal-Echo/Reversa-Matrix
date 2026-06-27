# RM11Pro Fast-Test Facts

These are sticky facts for RM11Pro/Nebula testing. They belong in Reversa
memory so the fast path does not depend on chat history.

## Device

- Model: `NX809J`
- Observed USB serial: `912607710184`
- Observed ADB mDNS service: `adb-912607710184-SmmJsU._adb-tls-connect._tcp`
- Observed phone IP: `192.168.7.230`

## ADB Rule

Use the Windows platform-tools ADB for this workflow:

```bash
/mnt/c/platform-tools/adb.exe mdns services
/mnt/c/platform-tools/adb.exe connect <ip:port-from-mdns>
ADB=/mnt/c/platform-tools/adb.exe NEBULA_ADB_MODEL=NX809J \
  ./scripts/resolve-rm11-adb-serial.sh --prefer-wireless --env
```

Linux `/usr/bin/adb` may not see the Windows TLS pairing or mDNS state. Treat it
as unproven unless it independently sees the same live endpoint.

## Port Refresh

Wireless ADB ports change. A saved `PHONE=<ip:port>` is only a snapshot, not a
stable identity.

Critical rule:

```text
Refreshing is refreshing.
```

For this workflow, refresh is not a status label. It means all three happened in
the current run: live mDNS discovery, connect to the live endpoint, and captured
`PHONE` / `ADB_SERIAL` evidence.

- Stale endpoint observed on 2026-06-26: `192.168.7.230:37223`
- Refreshed live endpoint observed on 2026-06-26: `192.168.7.230:33899`

Before every wireless fast test, refresh with:

```bash
/mnt/c/platform-tools/adb.exe mdns services
```

Then connect to the current `_adb-tls-connect._tcp` endpoint and capture the
resolved environment into the evidence folder:

```text
ADB=/mnt/c/platform-tools/adb.exe
MODEL=NX809J
PHONE=<live-ip:live-port>
ADB_SERIAL=<live-ip:live-port>
```

## Safety

Do not run reboot tests unless the human explicitly requests a reboot. For
Droidspaces-Nebula, `scripts/run-fast-reboot-test.sh` sends `adb reboot`.

## Evidence

The 2026-06-26 refresh incident is recorded under:

```text
/home/richtofen/.android/repositories/nebula-assets/logs/2026-06-26-post-clean-test-campaign-01/refreshed-adb-address.env
/home/richtofen/.android/repositories/nebula-assets/logs/2026-06-26-post-clean-test-campaign-01/refreshed-adb-connect.log
/home/richtofen/.android/repositories/nebula-assets/logs/2026-06-26-post-clean-test-campaign-01/refreshed-adb-device-props.log
```

## Wayland Display Refresh

Current refresh proof from 2026-06-27:

```text
/home/richtofen/.android/repositories/nebula-assets/logs/2026-06-27-nebula-r6-wayland-working-refresh-01/result.md
```

Classification:

```text
NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS
```

Critical facts:

- The working phone/app display lane is dmabuf, not wl_shm.
- The known-good Gamescope sidecar is:
  `/data/user/0/io.droidspaces.nebula.waylandie/files/sidecars/xwayland-gamescope-14-exportable-fence-guard-a4-473ba531`
- The matching Xwayland sidecar is:
  `/data/user/0/io.droidspaces.nebula.waylandie/files/sidecars/xwayland-gamescope-06-xwayland-9f1a3d62`
- The refresh proof used `xeglgears.aarch64-linux-gnu`; `glxgears` was not run.
- The refresh proof produced real-buffer commits greater than zero.
- `VKGETMEMORYFD_FAILURE_COUNT=0`.
- Xwayland readiness was `yes`.
- Reversa scan path:
  `/home/richtofen/.android/repositories/nebula-assets/logs/2026-06-27-nebula-r6-wayland-working-refresh-01/reversa-child-libpath`
- Reversa reported `0` contradictions and `0` patch candidates for the refresh artifact.

Do not regress back to the wl_shm path as a display success criterion. The
bridge intentionally rejects non-dmabuf frames when final-copy is forbidden:

```text
reason=not-dmabuf-zero-copy
```

If Wayland appears broken again, first verify the sidecar-14 dmabuf lane before
patching source.

## GPU OC 1230MHz KernelSU Module Audit

Current audit proof from 2026-06-27:

```text
/home/richtofen/.android/repositories/nebula-assets/local/module-audits/ksu_rm11pro_gpu_oc_1230mhz/AUDIT.md
```

Original module zip:

```text
/mnt/d/Downloads/ksu_rm11pro_gpu_oc_1230mhz.zip
SHA256=07558c718250a4f4284d2dc9e4fd9392a746d9838f2b07ba4ca5f4285732758c
```

Classification:

```text
RM11PRO_GPU_OC_1230_AUDITED_HIGH_POWER_HIGH_RISK_NOT_BLIND_INSTALL
```

Critical facts:

- The original module loads `adreno_overclock.ko`, stops/kills ZTE
  thermal/perf services, writes KGSL `max_pwrlevel=0`, and chmods the KGSL node.
- The live RM11Pro kernel was refreshed through Windows ADB and observed as
  `6.12.23-android16-OP-WILD`; the module vermagic is
  `6.12.23-maybe-dirty-4k`.
- Live KGSL stock table tops at `1200 MHz`; the module tries to add/use
  `1230 MHz`.
- Do not install the original as an enabled boot module blindly.

Guarded wrapper staged locally:

```text
/home/richtofen/.android/repositories/nebula-assets/local/module-audits/ksu_rm11pro_gpu_oc_1230mhz/rm11pro_gpu_oc_1230_guarded-audit01.zip
SHA256=ddff3ae4aa187ef373c1e666e7c708e94f463374cced57b663f98fb013269269
```

The guarded wrapper is default no-op until `/data/local/tmp/rm11-gpu-oc.allow`
exists. It separates kernel load, `max_pwrlevel` write, and thermal/perf daemon
shutdown behind separate opt-in files. It was created for staged proof only and
was not installed or executed during the audit.
