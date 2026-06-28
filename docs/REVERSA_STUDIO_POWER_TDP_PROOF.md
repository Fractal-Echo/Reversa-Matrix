# Reversa Studio Power/TDP Proof

Reversa Studio Power/TDP proof is a read-only evidence lane. It answers what the host can see about power state and power-control backends without writing limits, changing services, launching games, changing power plans, or treating WSL as final hardware authority.

## Schema

```json
{
  "schema_version": 1,
  "timestamp": "2026-06-27T00:00:00.000Z",
  "host": "host-name",
  "platform": {
    "os": "windows|linux|wsl|unknown",
    "kernel": "kernel-or-build",
    "machine": "machine",
    "is_wsl": true
  },
  "cpu": {
    "name": "processor name",
    "vendor": "AMD|Intel|unknown",
    "cores": 0,
    "threads": 0
  },
  "gpu": {
    "nvidia_visible": true,
    "amd_visible": true,
    "radeon_890m_visible": true
  },
  "power": {
    "battery_present": true,
    "ac_online": null,
    "battery_percent": null,
    "power_profile": null,
    "windows_power_scheme": null,
    "linux_power_profile": null
  },
  "tdp_backends": {
    "ryzenadj": "present|missing|unknown",
    "hhd": "present|missing|unknown",
    "acpi_call": "present|missing|unknown",
    "smu": "present|missing|unknown",
    "powerprofilesctl": "present|missing|unknown",
    "powercfg": "present|missing|unknown"
  },
  "proof": {
    "read_only": true,
    "write_capable_backend_seen": false,
    "tdp_write_performed": false,
    "runtime_test_performed": false
  },
  "classification": "POWER_PROOF_HOST_VISIBLE",
  "notes": []
}
```

## Proof Levels

- `POWER_PROOF_UNAVAILABLE`
- `POWER_PROOF_HOST_VISIBLE`
- `POWER_PROOF_BATTERY_VISIBLE`
- `POWER_PROOF_AC_STATE_VISIBLE`
- `POWER_PROOF_BACKEND_DISCOVERED`
- `POWER_PROOF_RYZENADJ_PRESENT`
- `POWER_PROOF_HHD_PRESENT`
- `POWER_PROOF_CONTROL_CANDIDATE`
- `POWER_PROOF_WRITE_DEFERRED`
- `POWER_PROOF_POLICY_MATRIX_READY`

## Rules

- Write-capable backend presence does not mean safe to write.
- `ryzenadj` path or help output is evidence; setting limits is prohibited.
- HHD path evidence is evidence; service install/start/stop remains prohibited.
- Windows power plans are read-only in this lane.
- WSL observations are useful but are not final hardware authority.
- All recommendations are proposal-only until snapshot, backend, AC/battery, min/default/max TDP, rollback, game-risk, and user-approval gates are satisfied.

## Safe Commands

Allowed probes are read-only: CPU/GPU inventory, battery state reads, `powercfg /L`, `powercfg /GETACTIVESCHEME`, backend path checks, `ryzenadj --help`, `powerprofilesctl get`, `/sys/class/power_supply` reads, and `/proc/modules` reads.

Blocked Power/TDP operation classes include TDP limit changes, HHD or systemd service changes, ACPI/SMU writes, module insertion, `/sys` writes, power-plan changes, and game/runtime launches.
