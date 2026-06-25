# Enhanced Reversa

Enhanced Reversa turns source-tree research into a structured evidence dataset for coding agents.

The scanner is read-only against the target tree. It writes artifacts to an output directory and treats JSON/JSONL as the source of truth:

- `report.json`
- `evidence.jsonl`
- `summary.md`
- `report.html`
- `agent_handoff/`

HTML is a dashboard. Agents should consume `report.json`, `evidence.jsonl`, and the handoff bundle.

## Evidence Contract

Every evidence item has stable required fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable evidence identifier |
| `category` | Finding bucket, such as `partition_sizes` or `vendor_blobs` |
| `severity` | `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`, or `INFO` |
| `confidence` | `confirmed`, `likely`, `possible`, or `weak` |
| `source_file` | Relative source file path |
| `source_line_start` | First source line |
| `source_line_end` | Last source line |
| `extracted_text` | Original line or extracted snippet |
| `normalized_claim` | Machine-readable claim |
| `related_paths` | Referenced paths |
| `related_symbols` | Referenced symbols |
| `related_build_vars` | Android/build variables |
| `related_device_props` | Device properties |
| `evidence_type` | Source or derived evidence type |
| `suggested_action` | Safe next investigation step |
| `rationale` | Why this matters |
| `contradiction_group_id` | Linked contradiction, if any |
| `patch_candidate_id` | Linked patch candidate, if any |
| `timestamp` | Scan timestamp |

Unknown values are represented as `null`, `[]`, or `"unknown"` depending on field shape. Required fields are not omitted.

## Known-Good Facts

Known-good facts are JSON files that record real device observations. Reversa compares source-tree declarations against those facts and flags mismatches.

Example:

```bash
npx reversa scan \
  --project-root /path/to/device/nubia/canoe \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

The RM11Pro / NX809J example includes `product`, `model`, `device`, `SoC/platform`, boot header version, recovery partition size, slot suffix, and stock recovery backup requirements.

## Android Recovery Profile

The `android_recovery` profile prioritizes:

- `BoardConfig.mk`
- `AndroidProducts.mk`
- `device.mk`
- `orangefox_*.mk`
- `twrp_*.mk`
- `*.rc`
- `fstab*`
- `recovery/root/**`
- `vendor-files.txt`
- `proprietary-files.txt`

It extracts build variables, device identity, platform identity, partition/image rules, fstab entries, init service binary paths, vendor blob references, decrypt/security stack references, display/touch/theme settings, placeholders, suspicious paths, missing paths, duplicate definitions, and contradictions.

## Compare Mode

Compare mode scans two trees and classifies differences:

```bash
npx reversa compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_compare_out
```

Outputs:

- `compare_report.json`
- `compare_summary.md`
- `compare.html`
- `agent_handoff/compare_findings.json`
- `agent_handoff/safe_import_candidates.json`
- `agent_handoff/risky_import_candidates.json`

Compare mode never imports, copies, patches, flashes, or modifies either tree.

## Agent Handoff

Codex agents should read handoff artifacts in this order:

1. `summary.md`
2. `contradictions.json`
3. `patch_candidates.json`
4. `commands_to_run.md`
5. `known_good_facts.json`
6. `risky_assumptions.json`
7. `tree_inventory.json`

Normal validation commands are read-only. If a future workflow ever proposes a destructive command, it must be separated under `DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED`.
