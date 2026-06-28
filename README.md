# Reversa-Matrix

Reversa-Matrix is a local evidence scanner, contradiction detector, and guarded patch-planning toolkit for complicated engineering projects.

[![Docs](https://img.shields.io/badge/DOCS-Reversa--Matrix-009c3b?style=for-the-badge&logo=material-for-mkdocs&logoColor=white&labelColor=2d2d2d)](https://fractal-echo.github.io/Reversa-Matrix/)

It scans repositories, extracted project trees, config folders, logs, runtime notes, and agent instructions. It writes structured reports that help a human or coding agent see what is known, what conflicts, what needs proof, and what should not be patched yet.

Core rule:

```text
HTML is a view.
JSON and JSONL are the source of truth.
```

## Current Scope

Implemented today:

- `scan`: read a tree and emit findings, contradictions, patch candidates, known-good comparisons, and agent handoff files.
- `compare`: compare two trees and classify safe/risky import candidates.
- `gui`: build an offline `dashboard.html` from existing scan or compare output.
- `agent`: create local run scaffolds, memory templates, safe command proposals, review-only patch plans, model eval reports, and read-only ADB evidence snapshots.
- `dataset`: build bounded advisory datasets from existing evidence.
- `studio`: export local Reversa Studio fixtures and capture passive GPU/backend proof files.
- `nebula`: read-only host bridge for Nebula active-module evidence.
- compatibility helpers: `install`, `update`, `uninstall`, `add-agent`, `add-engine`, `patterns`, and `export-diagrams`.

Reversa-Matrix is designed for evidence-heavy work across:

- Android recovery and kernel trees.
- Linux containers and userspace graphics stacks.
- Windows services, drivers, registry assumptions, PE metadata, and MSBuild trees.
- PC game compatibility evidence, wrappers, Vulkan loader state, widescreen/frame-generation notes, and private/offline patch dossiers.
- Claude/Codex-style agent workflows, settings, hooks, skills, subagents, MCP, plugins, and approval policies.
- Generic C/C++/Rust/Java/Kotlin/Python/JavaScript projects with copied constants, generated artifacts, and stale assumptions.

## What It Is Not

- Not an autonomous unrestricted patcher.
- Not a flashing, rooting, rebooting, or module-install tool.
- Not a DRM, anti-cheat, ownership, or competitive-bypass tool.
- Not proof just because a model said something.
- Not an endorsement or bundled copy of upstream projects named in profiles or reports.

Profiles may mention projects or ecosystems such as Android, OrangeFox, TWRP, Gamescope, Xwayland, Mesa, Wine, Proton, DXVK, Special K, ReShade, 3DMigoto, WayLandIE, DroidSpaces, Anland, Cupscale, Flowframes, or PCGamingWiki-style data. Those names describe evidence domains only.

## Requirements

- Node.js 18.20.2 or newer.
- npm.
- Git.
- A local tree, log folder, config bundle, or extracted project to inspect.

Optional commands depend on your task. Reversa-Matrix does not bundle ADB, compilers, SDKs, debuggers, platform drivers, game files, model weights, or device flashing tools.

## Quick Start

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
node ./bin/reversa.js scan --help
```

List profiles:

```bash
node ./bin/reversa.js scan --profiles
```

Run the included Android recovery fixture:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/android-recovery-current \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

Open the offline dashboard:

```bash
node ./bin/reversa.js gui --out reversa_out
```

Run a generic scan on any local tree:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/tree \
  --profile generic_source_tree \
  --out reversa_out
```

By default, scans honor git ignore rules. Use `--include-ignored` only when ignored files are part of the evidence you intentionally want to inspect.

## Common Commands

Scan a Claude/Codex-style workflow tree:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/agent-project \
  --profile claude_code_modern \
  --out reversa_agent_out
```

Scan the included provider-gateway fixture:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/agentic-gateway \
  --profile agentic_gateway \
  --out reversa_gateway_out
```

Scan the included game/runtime fixture:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/bo3-runtime-diagnostics \
  --profile rm11pro_gaming_runtime \
  --out reversa_game_out
```

Compare two trees:

```bash
node ./bin/reversa.js compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile generic_source_tree \
  --out reversa_compare_out
```

Create a review-only patch dossier from an existing scan:

```bash
node ./bin/reversa.js agent patch-plan \
  --project-root /path/to/tree \
  --scan-out reversa_out \
  --candidate <patch-candidate-id> \
  --out .reversa/patch-plans/<case-id>
```

Capture passive local GPU proof for Reversa Studio:

```bash
node ./bin/reversa.js studio gpu-proof --out /path/to/gpu-proof
node ./bin/reversa.js studio amd-proof --out /path/to/amd-proof
```

Read Nebula status through the read-only companion bridge:

```bash
node ./bin/reversa.js nebula status \
  --adb <adb-serial> \
  --out local/nebula-status
```

## Outputs

Default scan output:

```text
reversa_out/
+-- report.json
+-- evidence.jsonl
+-- summary.md
+-- report.html
+-- agent_handoff/
    +-- summary.md
    +-- findings.json
    +-- evidence.jsonl
    +-- contradictions.json
    +-- patch_candidates.json
    +-- commands_to_run.md
    +-- questions_for_human.md
    +-- known_good_facts.json
    +-- risky_assumptions.json
    +-- tree_inventory.json
```

Dashboard output:

```text
reversa_out/
+-- dashboard.html
```

Compare output:

```text
reversa_compare_out/
+-- compare_report.json
+-- compare_summary.md
+-- compare.html
+-- dashboard.html
+-- agent_handoff/
    +-- compare_findings.json
    +-- safe_import_candidates.json
    +-- risky_import_candidates.json
```

Use `dashboard.html` for browsing. Use `report.json`, `evidence.jsonl`, and `agent_handoff/` for automation and follow-up agent work.

## Profiles

The authoritative list is generated by:

```bash
node ./bin/reversa.js scan --profiles
```

Current profile families include:

- Generic source: `generic_source_tree`.
- Agent workflows: `agentic_toolchain`, `claude_code_modern`, `claude_code`, `codex_agent`, `agent_workflow`, `ai_coding_surface`, `claude_matrix`, `semantic_policy`.
- Provider gateways: `agentic_gateway`.
- Android/recovery/kernel: `android_recovery`, `orangefox`, `orangefox_sync_tool`, `twrp`, `android_kernel`, `kernel`, `gki_kernel`.
- Linux graphics/container: `userspace_graphics`, `linux_container`, `gamescope`, `child_libpath`, `nebula_child_libpath`, `nebula_gamescope`, `nebula_vulkan_loader`, `known_good_frontier`, `nebula_frontier_guard`, `frontier_guard`.
- Windows: `windows_system`, `windows_compat`.
- Game/runtime: `game_modding`, `pcgamingwiki_runtime`, `widescreen_framegen_runtime`, `game_exe_patch_runtime`, `graphics_wrapper`, `vulkan_loader`, `bo3_zombies_diagnostics`, `render_enhancement_plugin`, `rm11pro_gaming_runtime`.
- GPU/upscale/frame generation: `gpu_upscale_framegen`, `upscale_runtime`, `framegen_runtime`, `game_upscale`, `flowframes`, `cupscale`.

Use `generic_source_tree` when you are not sure where to start.

## Safety Model

`scan`, `compare`, and `gui` are read-only against the inspected project tree.

Some commands intentionally write Reversa-owned artifacts when explicitly invoked:

- `agent init-memory` writes `.reversa/memory` templates.
- `agent run`, `agent replay`, `agent snapshot`, `agent command-plan`, and `agent patch-plan` write output bundles under the requested output path.
- `dataset` and `studio` commands write generated datasets, fixtures, or proof files under the requested output path.
- compatibility commands such as `install`, `update`, and `uninstall` manage Reversa-created compatibility files.

The Nebula bridge is read-only by design. It does not install APKs, stage modules, reboot, launch graphics runtimes, or write `/data/adb`.

Game/runtime profiles are evidence classifiers. They may flag DRM, anti-cheat, cheat, public-match, ownership, or bypass language as review boundaries, but they do not implement bypass behavior.

If imported evidence contains risky commands, the dashboard separates them under:

```text
DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED
```

## Agent Handoff

For follow-up work, start with:

1. `agent_handoff/summary.md`
2. `agent_handoff/findings.json`
3. `agent_handoff/contradictions.json`
4. `agent_handoff/patch_candidates.json`
5. `agent_handoff/commands_to_run.md`
6. `agent_handoff/known_good_facts.json`
7. `agent_handoff/risky_assumptions.json`
8. `agent_handoff/tree_inventory.json`

The dashboard is for human review. The JSON and JSONL files are for reproducible continuation.

## Documentation

- [Docs home](docs/index.md)
- [Installation](docs/instalacao.md)
- [First scan](docs/uso.md)
- [CLI](docs/cli.md)
- [GUI Dashboard](docs/gui.md)
- [Reversa Agent Runtime](docs/REVERSA_AGENT_RUNTIME.md)
- [Reversa Studio](docs/REVERSA_STUDIO.md)
- [Nebula Companion Link](docs/NEBULA_COMPANION_LINK.md)
- [Known-Good Frontier Guard](docs/KNOWN_GOOD_FRONTIER_GUARD.md)
- [Semantic Policy Contradictions](docs/semantic-policy-contradictions.md)
- [Platform scope](docs/platforms.md)
- [Evidence pipeline](docs/pipeline.md)
- [Generated outputs](docs/saidas/index.md)

Build the docs locally:

```bash
python3 -m pip install --user --break-system-packages -r docs/requirements.txt
PATH="$HOME/.local/bin:$PATH" mkdocs build --strict
```

The built site is written to `site/`.

## Roadmap

Planned work is tracked as docs, tests, and profile additions before it is advertised as working behavior. Current open directions include:

- More evidence profiles for Linux graphics/container runtime boundaries.
- More Windows driver/service/install metadata coverage.
- Stronger game compatibility evidence around frame pacing, HDR, texture replacement, wrapper chains, and Linux/Proton validation.
- A more complete Reversa Studio UI fed by local JSON evidence.
- Better local-model advisory evaluation while keeping scanner output deterministic.

## License

MIT - see [LICENSE](LICENSE).
