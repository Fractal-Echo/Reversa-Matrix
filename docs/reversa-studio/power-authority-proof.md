# Reversa Studio Power Authority Proof

Stage 02 Power Authority Proof is a read-only resolver. It answers which layer is
currently observing Power/TDP evidence and which layer could own mutation later,
without performing a TDP write, service change, game launch, phone action, power
plan change, or runtime mutation.

It builds on the Stage 01 Power/TDP proof:

```bash
node ./bin/reversa.js studio power-authority-proof \
  --out /path/to/power-authority-proof \
  --power-proof /path/to/power-proof/power-tdp-proof.json
```

If `--power-proof` is omitted, the command captures a fresh read-only Stage 01
source proof into `source-power-proof/` under the output directory.

## Authority Layers

The resolver separates host and backend ownership:

| Layer | Meaning |
|---|---|
| `WSL_OBSERVER` | WSL can see host evidence, but it is not the write authority. |
| `WINDOWS_HOST_AUTHORITY` | Windows host layer can be the authority for Windows-only power surfaces. |
| `LINUX_BARE_METAL_AUTHORITY` | Linux bare metal can be the authority when it owns the hardware stack directly. |
| `HANDHELD_DAEMON_HHD_AUTHORITY` | HHD is visible as the handheld power-management owner candidate. |
| `RYZENADJ_DIRECT_AUTHORITY` | ryzenadj is visible as a direct backend owner candidate. |
| `UNKNOWN_UNSAFE_AUTHORITY` | The resolver cannot prove a safe authority layer. |

## Collected Evidence

The command records:

- OS layer.
- privilege state.
- backend availability.
- whether each backend is observable only.
- whether each backend is mutation-capable in principle.
- whether mutation is allowed by policy.
- denial reasons.
- next required proof.

## Write Gate

Stage 02 never allows writes by itself.

Backend presence does not imply permission. A backend can be present, observable,
and mutation-capable in principle while still reporting:

```text
mutation_allowed_by_policy=false
```

Writes remain denied when any of these are true:

- WSL is the observer layer.
- authority is unknown or unsafe.
- multiple mutation backends conflict.
- no supported mutation backend is visible.
- privilege is missing.
- runtime proof is missing.
- explicit approval and rollback proof are missing.

## Outputs

The command writes generated Reversa-owned artifacts:

- `power-authority-proof.json`
- `power-authority-proof.md`
- `authority-backends.tsv`

These files are evidence artifacts, not authoritative records and not permission to
mutate hardware state.
