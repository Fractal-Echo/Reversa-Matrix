# CLI

Reversa-Matrix is controlled through the `reversa` CLI. In a cloned checkout, use:

```bash
node ./bin/reversa.js <command>
```

When installed as a package, use:

```bash
npx reversa <command>
```

---

## Scanner Commands

### `scan`

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

Scans a source tree as evidence. The target tree is read-only. Output goes to `--out`.

Default outputs:

- `report.json`
- `evidence.jsonl`
- `summary.md`
- `report.html`
- `agent_handoff/`

Useful flags:

| Flag | Meaning |
|---|---|
| `--project-root <path>` | Tree to inspect |
| `--profile <name>` | Scanner profile |
| `--known-good <json>` | Trusted facts for comparison |
| `--out <path>` | Output directory |
| `--html` | Write `report.html` |
| `--json` | Write `report.json` |
| `--jsonl` | Write `evidence.jsonl` |
| `--markdown` | Write `summary.md` |
| `--agent-handoff` | Write handoff files for agents |
| `--profiles` | List available profiles |

If no output flags are passed, scan writes all primary formats.

---

### `compare`

```bash
node ./bin/reversa.js compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_compare_out
```

Compares two trees and writes:

- `compare_report.json`
- `compare_summary.md`
- `compare.html`
- `agent_handoff/compare_findings.json`
- `agent_handoff/safe_import_candidates.json`
- `agent_handoff/risky_import_candidates.json`

Compare mode classifies differences and import candidates. It does not copy files.

---

### `gui`

```bash
node ./bin/reversa.js gui --out reversa_out
```

Builds an offline local dashboard from existing scan or compare outputs. The command verifies that `--out` exists and contains `report.json` or `compare_report.json`, then writes:

```text
dashboard.html
```

The GUI reads existing structured files. It does not modify scan data and does not require internet access.

Dashboard sections include:

- overview
- setup checklist
- scan metadata
- findings
- contradictions
- patch candidates
- known-good comparison
- risky assumptions
- commands
- tree inventory
- agent handoff
- compare results

---

## Profiles

List the profiles supported by the current build:

```bash
node ./bin/reversa.js scan --profiles
```

Current practical profiles include:

- `generic_source_tree`
- `android_recovery`
- `orangefox`
- `twrp`
- `android_kernel`
- `gki_kernel`
- `userspace_graphics`
- `linux_container`
- `gamescope`
- `game_modding`
- `graphics_wrapper`
- `vulkan_loader`
- `bo3_zombies_diagnostics`
- `render_enhancement_plugin`
- `rm11pro_gaming_runtime`

Game and graphics-runtime profiles classify evidence for wrappers, frame timing, render hook surfaces, texture injection, HDR, API translation, Vulkan loader state, and mobile Linux runtime assumptions.

---

## Evidence Fields

Every evidence item is designed to be traceable. Important fields include:

- `id`
- `category`
- `severity`
- `confidence`
- `source_file`
- `source_line_start`
- `source_line_end`
- `extracted_text`
- `normalized_claim`
- `related_paths`
- `related_symbols`
- `related_build_vars`
- `related_device_props`
- `evidence_type`
- `suggested_action`
- `rationale`
- `contradiction_group_id`
- `patch_candidate_id`
- `timestamp`

Agents should treat `report.json`, `evidence.jsonl`, and `agent_handoff/` as the source of truth.

---

## Local Agent Commands

### `agent doctor`

```bash
node ./bin/reversa.js agent doctor --no-network
```

Checks Node, Git, ADB path, memory folder, and optionally an
OpenAI-compatible model endpoint.

### `agent init-memory`

```bash
node ./bin/reversa.js agent init-memory
```

Creates `.reversa/memory/` templates:

- `known_good_frontier.yaml`
- `active_blockers.yaml`
- `contradictions.yaml`
- `phone_targets.yaml`
- `project_constraints.yaml`

### `agent models`

```bash
node ./bin/reversa.js agent models --base-url http://127.0.0.1:8000/v1
```

Lists models from a local OpenAI-compatible endpoint such as vLLM, Ollama, or
llama.cpp.

### `agent run`

```bash
node ./bin/reversa.js agent run \
  --mode phone-safe \
  --goal "Inspect supplied evidence for Vulkan loader contradictions. Do not patch." \
  --evidence-file /path/to/report.md \
  --evidence-dir /path/to/raw-snapshot
```

Writes an auditable run folder under `.reversa/runs/`. The scaffold supports
`scan-only`, `phone-safe`, and `patch-propose`. It refuses `patch-apply` and
`recovery-danger`.

Useful run flags:

| Flag | Meaning |
| --- | --- |
| `--evidence-file <path>` | Add one specific evidence file; repeatable |
| `--evidence-dir <path>` | Add a bounded text evidence directory; repeatable |
| `--max-evidence-files <n>` | Cap collected files from directories; default `200` |
| `--max-evidence-bytes <n|nK|nM>` | Per-file read cap; default `1M` |

Every run writes `artifacts/evidence_files.sha256` and
`artifacts/evidence_manifest.json`.

### `agent snapshot`

```bash
node ./bin/reversa.js agent snapshot \
  --serial <adb-serial> \
  --package io.droidspaces.nebula.waylandie \
  --out .reversa/snapshots/rm11-latest
```

Captures a read-only, typed ADB evidence snapshot. It writes host, device,
process, and optional app-context files plus `manifest.json`, `manifest.txt`,
and `evidence_files.sha256`.

Use `--no-package` to skip app-context `run-as` probes. Use the snapshot as an
agent input with `--evidence-dir`.

---

## Compatibility Commands

These commands remain from the original Reversa agent installer:

- `install`
- `status`
- `update`
- `uninstall`
- `add-agent`
- `add-engine`
- `diagram`

They are kept for compatibility with `.reversa/`, agent teams, and `_reversa_sdd/` workflows. They are not required for the Reversa-Matrix scanner/dashboard loop.
