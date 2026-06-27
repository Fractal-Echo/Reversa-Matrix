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
