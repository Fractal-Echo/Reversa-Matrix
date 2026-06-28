# CLI

Reversa-Matrix is controlled through the `reversa` CLI. In a cloned checkout, use:

```bash
node ./bin/reversa.js <command>
```

When installed as a package, use:

```bash
npx reversa <command>
```

Reversa is an AI evidence, contradiction, and guarded patch-intelligence engine.
It scans first, writes artifacts second, and keeps patch or command execution
behind review gates.

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
| `--profiles [ids]` | List available profiles, or scan comma-separated profile ids |
| `--include-ignored` | Include files ignored by git exclude rules |

If no output flags are passed, scan writes all primary formats.

By default, scans honor git ignore rules so private scratch folders, generated
outputs, and local experiments do not pollute live-source evidence. Use
`--include-ignored` for forensic sweeps where ignored files are part of the
question.

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

### `studio`

```bash
node ./bin/reversa.js studio export-fixtures \
  --dataset /path/to/gpu-advisory-dataset \
  --out ./reversa-studio/fixtures

node ./bin/reversa.js studio gpu-proof \
  --python /path/to/venv/bin/python \
  --out /path/to/gpu-proof

node ./bin/reversa.js studio amd-proof \
  --out /path/to/amd-proof

node ./bin/reversa.js studio power-proof \
  --out /path/to/power-proof

node ./bin/reversa.js studio amd-join \
  --proof /path/to/amd-proof/amd-uma-proof.json \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --out /path/to/amd-local-fit

node ./bin/reversa.js studio backend-matrix \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --cuda-proof /path/to/gpu-proof/gpu-proof.json \
  --amd-proof /path/to/amd-proof/amd-uma-proof.json \
  --onnx-directml-proof /path/to/onnx-directml-proof/amd-uma-proof.json \
  --out /path/to/backend-matrix

node scripts/build-power-tdp-policy-matrix.js \
  --proof /path/to/power-proof/power-tdp-proof.json \
  --dataset /path/to/power-tdp-runtime-advisory.jsonl \
  --out /path/to/power-policy-matrix
```

Exports small local JSON fixtures for the Reversa Studio prototype. Reversa
Studio is an early local dashboard prototype for evidence, model metadata, and
guarded workflow planning.

The fixture command reads local JSONL/TSV files and writes display fixtures.
The GPU proof command records passive Nvidia/CUDA/Python/backend evidence. The
AMD proof command records Windows/WSL/DirectX/DirectML candidate evidence for
Radeon 890M / UMA systems. The optional `--python` flag selects an existing
interpreter, such as a controlled local PyTorch CUDA or DirectML proof venv. If
`onnxruntime-directml` and `onnx` are present, AMD proof also runs a tiny local
ONNX Add graph with memory pattern disabled and sequential execution. The
Power proof command records read-only CPU/GPU, battery/AC, power profile, and
backend discovery evidence. The Power/TDP policy matrix joins that proof with
advisory rows and emits proposal-only action gates. The backend matrix joins GPU
proof files with advisory rows and classifies
CUDA, DirectML, ONNX DirectML, Vulkan NCNN, and TensorRT gates. The commands
themselves do not install packages. None of the Studio commands acquire models,
launch runtimes, patch binaries, connect to phones, or mutate projects.

The static Studio prototype also includes a Power/TDP panel backed by local
fixture JSON. It displays host proof, detected power backends, policy matrix
counts, game profile candidates, battery/AC policy candidates, approval gates,
and deferred-control labels. It has no TDP write, service install, power-plan
mutation, or handheld-daemon install path.

---

### `patterns`

```bash
node ./bin/reversa.js patterns --list
node ./bin/reversa.js patterns --pattern claude-codex
node ./bin/reversa.js patterns --pattern claude-codex --out CLAUDE_CODEX_REVERSA_PATTERNS.md
```

Prints or writes reusable Reversa pattern templates. Use this when another
project needs the same instruction, hook, skill, memory, provider, subagent,
worktree, and attribution checklist without copying it by hand.

When `claude-code` or `codex` engines are installed, Reversa also manages this
pattern under `.reversa/patterns/CLAUDE_CODEX_REVERSA_PATTERNS.md`.

---

## Nebula Companion Commands

### `nebula`

```bash
node ./bin/reversa.js nebula status \
  --adb 912607710184 \
  --out local/nebula-status
```

Runs a read-only Nebula companion probe over ADB. Reversa captures active-module
status, display frontier, integrations baseline, cooling policy, package paths,
and pending-module presence without installing, staging, rebooting, or launching
graphics runtimes.

Common subcommands:

| Subcommand | Purpose |
|---|---|
| `status` | Capture active status, active frontier, packages, and pending presence |
| `active-module` | Capture active module JSON command surface |
| `pending-module` | Explicitly read pending module status/display lanes |
| `compare-modules` | Compare active vs pending and classify stage safety |
| `frontier` | Capture active known-good frontier evidence |
| `propose --from <dir>` | Classify an offline scan/result directory |

Safety rules:

- active module is authoritative by default
- pending module is read only after explicit request
- arbitrary shell commands are not accepted
- package deployment, module staging, device restart, bootloader tooling,
  destructive delete, raw block writes, and lease actions are rejected

See `docs/NEBULA_COMPANION_LINK.md` for the full protocol.

---

## Profiles

List the profiles supported by the current build:

```bash
node ./bin/reversa.js scan --profiles
```

Current practical profiles include:

- `generic_source_tree`
- `agentic_toolchain`
- `claude_code_modern`
- `claude_code`
- `codex_agent`
- `agent_workflow`
- `agentic_gateway`
- `semantic_policy`
- `windows_system`
- `windows_compat`
- `android_recovery`
- `orangefox`
- `twrp`
- `android_kernel`
- `kernel`
- `gki_kernel`
- `userspace_graphics`
- `linux_container`
- `gamescope`
- `game_modding`
- `pcgamingwiki_runtime`
- `widescreen_framegen_runtime`
- `game_exe_patch_runtime`
- `graphics_wrapper`
- `vulkan_loader`
- `bo3_zombies_diagnostics`
- `render_enhancement_plugin`
- `rm11pro_gaming_runtime`
- `power_tdp_runtime`
- `autotdp`
- `hhd_autotdp`
- `tdp_control`
- `handheld_daemon`
- `game_power_profile`
- `battery_perf_profile`

Game and graphics-runtime profiles classify evidence for PCGamingWiki-style fixes, wrappers, frame timing, render hook surfaces, texture injection, HDR, API translation, Vulkan loader state, widescreen/framegen layers, offline/private patch manifests, and mobile Linux runtime assumptions.

The `power_tdp_runtime` profile classifies AutoTDP, HHD, handheld-daemon, and
game-aware power evidence. It detects `ryzenadj`, HHD plugin providers, ACPI
call, SMU/ALIB, Steam AppID, executable, Wine/Proton, power mode, battery cap,
stable-sample/hysteresis, device profile, DMI autodetect, plugin conflicts,
mutation-requires-approval surfaces, runtime-proof gaps, and controlled-test
readiness. Aliases: `autotdp`, `hhd_autotdp`, `tdp_control`,
`handheld_daemon`, `game_power_profile`, and `battery_perf_profile`.

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/power-project \
  --profile power_tdp_runtime \
  --out reversa_power_out
```

The `claude_code_modern` profile is the best first pass for modern Claude/Codex
agent workflow repos. It classifies `CLAUDE.md` memory, `AGENTS.md`, managed,
project, and local settings scopes, hooks, skills, slash commands, subagents,
MCP/plugin surfaces, Agent SDK/CI automation, generated artifacts, stale-agent
references, approval/sandbox policy, active-first module authority, and
`modules_update` regression risk. Aliases: `claude_code`, `codex_agent`,
`agent_workflow`, `ai_coding_surface`, and `claude_matrix`.

The `agentic_toolchain` profile remains the broad compatibility sweep for
Claude/Codex-style instruction
files, skills, hooks, permissions, provider routing, memory/context injection,
subagent orchestration, worktree isolation, MCP/plugin surfaces, attribution
requirements, and proprietary-source import risk.

The `agentic_gateway` profile extends that lane for provider-gateway repos. It
classifies provider catalogs, model routing, Anthropic Messages/OpenAI
Responses adapters, Claude/Codex launcher env hygiene, admin config surfaces,
smoke coverage, messaging bridges, and secret redaction.

The `semantic_policy` profile extends the agentic lane with meaning-level
policy checks. It normalizes claims such as `read_only`, `write_forbidden`,
`approval_required`, `approval_bypass`, `device_action_forbidden`,
`network_allowed`, `commit_forbidden`, `push_allowed`, `proprietary_reference_only`,
`attribution_missing`, `stale_agent`, and `active_agent`, then reports HIGH or
MEDIUM contradictions when the claims collide. Markdown fenced examples,
generated scan outputs, and local code string assignments are guarded so they
do not become durable policy by accident.

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/semantic-policy \
  --profile semantic_policy \
  --out reversa_policy_out
```

Scan a real project for semantic policy drift:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/project \
  --profile semantic_policy \
  --out reversa_policy_out
```

Equivalent short form:

```bash
node ./bin/reversa.js scan --profiles semantic_policy /path/to/project
```

Scan a modern Claude/Codex workflow repo:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/project \
  --profile claude_code_modern \
  --out reversa_claude_modern_out
```

Scan a real provider gateway or agent launcher tree:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/project \
  --profile agentic_gateway \
  --out reversa_gateway_out
```

Scan both profiles in one pass:

```bash
node ./bin/reversa.js scan \
  --profiles semantic_policy,agentic_gateway \
  --out reversa_agentic_sweep \
  /path/to/project
```

Use `windows_compat` when a sweep brief says "Windows compatibility"; it aliases
`windows_system`. Use `kernel` when a sweep brief says "kernel"; it aliases
`android_kernel`.

To distill scanned upstreams into a license-clean training/review pack:

```bash
node scripts/build-agentic-training-pack.js \
  --manifest docs/upstreams/claude-code-matrix/source-sync.json \
  --out /path/to/training-pack
```

The pack is metadata/evidence only. It records source URL, commit, import
stance, license evidence, scan counts, evidence-category weights, and GPU proof
when `nvidia-smi` is available. It does not copy third-party source text.

For a reusable Claude/Codex/Reversa checklist, see
`templates/engines/CLAUDE_CODEX_REVERSA_PATTERNS.md`.

Print or write that reusable checklist from the CLI:

```bash
node ./bin/reversa.js patterns --pattern claude-codex
node ./bin/reversa.js patterns --pattern claude-codex --out CLAUDE_CODEX_REVERSA_PATTERNS.md
```

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

### `agent eval`

```bash
node ./bin/reversa.js agent eval \
  --base-url http://127.0.0.1:8000/v1 \
  --model Qwen/Qwen3-Coder-30B-A3B-Instruct \
  --evidence-file /path/to/nebula-result.md \
  --out local/evals/nebula-wayland
```

Scores a local OpenAI-compatible model on held-out Reversa JSON cases. Eval
output is advisory only: it writes `eval_report.json`, `eval_report.md`,
per-case request/response artifacts, and evidence hashes, but it does not mutate
scanner findings or contradictions.

Built-in eval cases include a Nebula Wayland regression guard, an agent policy
destructive-operation guard, and a DroidSpaces container command-wizard guard.
The command-wizard case scores whether the local model returns exact proposed
commands with a risk/approval policy instead of executing anything.

Eval cases may scope optional evidence by domain. This prevents a DroidSpaces
command-plan eval from copying unrelated host repo scan commands, and lets
policy cases score normalized meaning such as `ask_before_destructive` instead
of brittle prose-only string matches.

Useful eval flags:

| Flag | Meaning |
| --- | --- |
| `--case <id>` | Run one built-in eval case; repeatable |
| `--evidence-file <path>` | Add optional evidence context; repeatable |
| `--evidence-dir <path>` | Add optional evidence directory context; repeatable |
| `--max-prompt-evidence-chars <n>` | Cap evidence included in the model prompt |
| `--no-fail-on-mismatch` | Write metrics while exiting 0 on failed assertions |

### `agent command-plan`

```bash
node ./bin/reversa.js agent command-plan \
  --domain droidspaces-container \
  --profile gaming \
  --evidence-file /path/to/nebula-display-lanes.json \
  --out local/command-plans/rm11pro-gaming
```

Writes a compact, approval-aware command plan. This is the offline wizard lane:
Reversa proposes validation commands and candidate actions, but every command is
tagged with risk and `execute=false`; mutating actions remain human-approved.
Nebula plans prefer the active module path by default. Pending
`/data/adb/modules_update` artifacts are treated as explicit dry-check targets,
not normal UI or command-plan sources.

Initial domains:

| Domain | Purpose |
| --- | --- |
| `droidspaces-container` | Map containers, Anland env, rootfs candidates, and method selection |
| `nebula-wayland` | Preserve the proven Wayland real-buffer path while preparing client runtime checks |
| `gaming-performance` | Read RedMagic, thermal, GPU, and PowerDeck evidence before gaming tuning |
| `battery-optimization` | Read battery, power, and process state before low-power tuning |
| `stability` | Capture module, crash, and safe-mode evidence before repair work |

### `agent patch-plan` / `agent patch-wizard`

```bash
node ./bin/reversa.js agent patch-wizard \
  --scan-out /path/to/reversa-scan \
  --candidate PATCH_CONFIG_MODE \
  --project-root /path/to/source-tree \
  --out local/patch-wizards/config-mode
```

The same command can be aimed at a policy or gateway scan:

```bash
node ./bin/reversa.js agent patch-wizard \
  --project-root /path/to/project \
  --scan-out reversa_policy_out \
  --candidate <patch-candidate-id> \
  --out .reversa/patch-plans/policy-fix-01
```

Turns a Reversa `agent_handoff/patch_candidates.json` entry into a guarded patch
review dossier. It writes `patch_plan.json`, `patch_plan.md`, an evidence
manifest, and evidence hashes. It does not edit source files, run formatters,
commit, push, reboot, flash, or install modules.

Manual mode is available when a scan candidate does not exist yet:

```bash
node ./bin/reversa.js agent patch-plan \
  --project-root /path/to/source-tree \
  --target-file src/config.js \
  --proposed-change "Normalize stale config mode to the proven value." \
  --find-text 'mode = "stale"' \
  --replace-text 'mode = "proven"' \
  --out local/patch-wizards/manual-config
```

Patch wizard output includes target-file root validation, target SHA-256 before
review, edit groups, verification commands, rollback notes, stop conditions, and
approval guardrails. Targets resolving outside `--project-root` are rejected.

When both `--find-text` and `--replace-text` are supplied, Reversa writes a
review-only `patch.diff` using one exact literal replacement. It still does not
edit the target file or apply the patch; missing text, oversized files, binary
files, or incomplete replacement input block diff generation.

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

### `agent replay`

```bash
node ./bin/reversa.js agent replay \
  --run .reversa/runs/<run-id> \
  --out .reversa/runs/<run-id>-replay
```

Rebuilds a run from its saved `prompt.md` and
`artifacts/evidence_manifest.json`. Replay verifies saved SHA-256 hashes before
reuse, keeps the original goal, mode, project root, and evidence paths, then
writes a fresh run folder plus `artifacts/replay_source.json`.

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
- `export-diagrams`

They are kept for compatibility with `.reversa/`, agent teams, and `_reversa_sdd/` workflows. They are not required for the Reversa-Matrix scanner/dashboard loop.
