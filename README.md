# Reversa-Matrix

**Reverse-engineering evidence mapper for Windows, Android, Linux, and mixed source trees.**

[![Docs](https://img.shields.io/badge/DOCS-Reversa--Matrix-009c3b?style=for-the-badge&logo=material-for-mkdocs&logoColor=white&labelColor=2d2d2d)](https://fractal-echo.github.io/Reversa-Matrix/)

Reversa-Matrix is an evidence-first research assistant for real code trees: Android recovery and kernels, Linux userspace and graphics stacks, Windows services and drivers, build systems, generated files, copied constants, known-good facts, contradictions, and agent handoff.

It is not a patch bot. It is not a flashing tool. It maps evidence so humans and Codex agents can make better decisions.

Reversa-Matrix may name upstream ecosystems such as Android, OrangeFox, TWRP,
Gamescope, Xwayland, Mesa, Wine, Proton, DXVK, Special K, ReShade, 3DMigoto,
WayLandIE, DroidSpaces, or Anland in profiles and reports. Those names describe
classifier targets and evidence domains; they do not mean those projects are
bundled, owned, or endorsed by Reversa-Matrix.

New direction: Reversa can also run a local agent scaffold. The model is not the
agent; Reversa owns memory, typed tools, policy, evidence, and patch gates.

---

## Requirements

- Node.js 18.20.2 or newer
- npm
- Git
- A source tree, config folder, log bundle, or extracted project to inspect

Optional tools depend on what you are researching. Reversa-Matrix does not bundle ADB, compilers, SDKs, debuggers, platform drivers, game files, or device flashing tools.

---

## What It Does

Reversa-Matrix scans source trees and produces:

- structured findings with file and line references
- contradiction groups across source claims and known-good facts
- patch candidates that require review
- compare reports between current and reference trees
- an offline dashboard for guided review
- JSON/JSONL handoff bundles for Codex and other agents

Core rule:

```text
HTML is a view.
JSON and JSONL are the source of truth.
```

---

## Platform Direction

| Area | What Reversa-Matrix should understand |
|---|---|
| Android | recovery trees, kernels, BoardConfig, fstab, init rc, vendor blobs, device facts |
| Linux | containers, systemd, userspace graphics, compositor stacks, kernel/userland boundaries |
| Windows | services, drivers, PE metadata, registry assumptions, MSBuild/Visual Studio trees |
| Games | PCGamingWiki-style fixes, modding runtimes, graphics wrappers, widescreen/framegen evidence, Vulkan loader state, private co-op stability evidence |
| Cross-platform | C/C++/Rust/Java/Kotlin/Python/JS projects, generated artifacts, build scripts, copied constants |

Current strongest lanes: Android recovery evidence mapping with known-good comparison and tree compare mode; Claude/Codex-style agent tooling and provider-gateway audits; Windows service/driver/registry/MSBuild evidence; and PC gaming runtime profiles that classify PCGamingWiki-style fixes, wrappers, widescreen/framegen state, Vulkan loader facts, Linux/Proton paths, and offline/private patch evidence without performing patching or bypass workflows.

---

## Quick Start

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
node ./bin/reversa.js scan --help
```

Default scans honor git ignore rules so private scratch folders and generated
outputs do not pollute live-source evidence. Add `--include-ignored` when you
want a forensic sweep.

Run the included Android recovery fixture:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/android-recovery-current \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

Open the dashboard:

```bash
node ./bin/reversa.js gui --out reversa_out
```

When installed as a package, the equivalent form is:

```bash
npx reversa scan --help
npx reversa gui --out reversa_out
```

Inside this cloned repository, `node ./bin/reversa.js ...` is the most explicit local command.

---

## How To Use It

List available profiles:

```bash
node ./bin/reversa.js scan --profiles
```

Scan any tree with the generic profile:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/tree \
  --profile generic_source_tree \
  --out reversa_out
```

Scan the included game runtime fixture:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/bo3-runtime-diagnostics \
  --profile rm11pro_gaming_runtime \
  --out reversa_game_out
```

Scan a Claude/Codex/agent tooling tree:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/agentic-toolchain \
  --profile agentic_toolchain \
  --out reversa_agentic_out
```

Scan a Claude/Codex provider-gateway or launcher tree:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/agentic-gateway \
  --profile agentic_gateway \
  --out reversa_gateway_out
```

Scan agent instructions for semantic policy contradictions:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/semantic-policy \
  --profile semantic_policy \
  --out reversa_policy_out
```

Open a dashboard for any scan output:

```bash
node ./bin/reversa.js gui --out reversa_game_out
```

Compare two trees:

```bash
node ./bin/reversa.js compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile generic_source_tree \
  --out reversa_compare_out
```

The scanner reads the target tree and writes reports to `--out`. It does not edit the inspected tree.

---

## Local Agent Runtime

Initialize local evidence memory:

```bash
node ./bin/reversa.js agent init-memory
```

Check local prerequisites without requiring a model server:

```bash
node ./bin/reversa.js agent doctor --no-network
```

List models from a local OpenAI-compatible endpoint:

```bash
node ./bin/reversa.js agent models --base-url http://127.0.0.1:8000/v1
```

Capture a read-only phone-safe snapshot:

```bash
node ./bin/reversa.js agent snapshot \
  --serial <adb-serial> \
  --out .reversa/snapshots/rm11-latest
```

Create an auditable scan/report run from existing evidence:

```bash
node ./bin/reversa.js agent run \
  --mode phone-safe \
  --goal "Inspect supplied Nebula evidence for Vulkan loader contradictions. Do not patch." \
  --evidence-file /path/to/PHONE_REVERSA_CONFLICT_SCAN.md \
  --evidence-dir /path/to/raw-snapshot
```

Replay a saved run without relying on chat history:

```bash
node ./bin/reversa.js agent replay \
  --run .reversa/runs/<run-id> \
  --out .reversa/runs/<run-id>-replay
```

The first scaffold writes `.reversa/runs/<run-id>/` with `prompt.md`,
`plan.md`, `tool_calls.jsonl`, `evidence.jsonl`, `contradictions.yaml`,
`PHONE_REVERSA_AGENT_REPORT.md`, `artifacts/evidence_files.sha256`,
`artifacts/evidence_manifest.json`, and `artifacts/policy.json`. Replay writes
`artifacts/replay_source.json` so the reproduced run points back to the source
run and manifest. If a saved SHA-256 no longer matches the evidence file,
replay stops instead of producing a stale report.

See:

- [Reversa Agent Runtime](docs/REVERSA_AGENT_RUNTIME.md)
- [Reversa Local 5090 Plan](docs/REVERSA_LOCAL_5090_PLAN.md)
- [Reversa Tool Policy](docs/REVERSA_TOOL_POLICY.md)

---

## Profiles You Can Test

```text
generic_source_tree
agentic_toolchain
agentic_gateway
semantic_policy
windows_system
windows_compat
android_recovery
orangefox
twrp
android_kernel
kernel
gki_kernel
userspace_graphics
linux_container
gamescope
game_modding
pcgamingwiki_runtime
widescreen_framegen_runtime
game_exe_patch_runtime
graphics_wrapper
vulkan_loader
bo3_zombies_diagnostics
render_enhancement_plugin
rm11pro_gaming_runtime
```

Use `generic_source_tree` when you are not sure which profile fits yet.

For Claude/Codex-style projects, start with `agentic_toolchain`. Use
`agentic_gateway` when the repo contains provider catalogs, Claude/Codex
launchers, Anthropic Messages/OpenAI Responses adapters, smoke matrices,
messaging bridges, or secret-redaction code. Pair both with
`templates/engines/CLAUDE_CODEX_REVERSA_PATTERNS.md`.

Use `semantic_policy` when a repo has AGENTS/CLAUDE/SKILL files, memories,
handoffs, hooks, or project docs that may disagree about approvals, destructive
commands, device access, network access, write-forbidden rules, source patching,
commits, pushes, sandboxing, attribution, proprietary-source handling, or stale agents. It
normalizes policy claims before comparing them, so "ask before destructive" and
"skip approvals" become a clear contradiction instead of two loose keywords.
`windows_compat` is an alias for `windows_system`; `kernel` is an alias for
`android_kernel`.

For PC game compatibility work, start with `pcgamingwiki_runtime` for game data,
store/version, video, input, audio, network, API, middleware, Wine, Proton, and
Linux notes. Use `widescreen_framegen_runtime` for Flawless Widescreen,
ultrawide/FOV/HUD, DLSSG/FSR FG/XeFG/LSFG, and Windows-vs-Linux framegen
separation. Use `game_exe_patch_runtime` only for hash-guarded offline/private
patch manifests with rollback and Linux/Proton validation evidence.

Print or write that reusable checklist from the CLI:

```bash
node ./bin/reversa.js patterns --pattern claude-codex
node ./bin/reversa.js patterns --pattern claude-codex --out CLAUDE_CODEX_REVERSA_PATTERNS.md
```

---

## Reversa-Matrix Console Preview

`reversa gui` writes an offline `dashboard.html` over existing scan or compare outputs.

The console identity uses a dark evidence-lab layout with a subtle source-tree grid, evidence nodes, contradiction paths, and patch candidate routing. The same lightweight SVG/CSS motif appears in generated scan reports and the dashboard, with animation disabled cleanly when reduced motion is requested.

Tagline:

```text
Reverse-engineering evidence mapper for source trees, contradictions, and analysis.
```

```text
Reversa-Matrix Dashboard
+-- Overview
+-- Setup checklist
+-- Scan metadata
+-- Findings
+-- Contradictions
+-- Patch candidates
+-- Known-good comparison
+-- Risky assumptions
+-- Commands
+-- Tree inventory
+-- Agent handoff
+-- Compare results
```

The dashboard includes search, severity/confidence/category filters, expandable evidence, file/line references, copy buttons for commands, helper text, and a separate warning section for destructive commands if they appear in imported artifacts.

---

## Evidence You Can Inspect

Every scan writes machine-readable and human-readable artifacts:

- `report.json`: complete structured report
- `evidence.jsonl`: one evidence item per line
- `summary.md`: concise Markdown summary
- `report.html`: standalone scan report
- `dashboard.html`: browser dashboard generated by `reversa gui`
- `agent_handoff/`: focused JSON/Markdown files for follow-up work

Current game/runtime categories include frame timing, render hook surfaces, texture injection pipeline, HDR pipeline, API translation layer, Vulkan loader state, mobile Linux runtime, graphics wrapper chains, and safety-boundary findings.

---

## Compare Mode

```bash
node ./bin/reversa.js compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_compare_out
```

Compare mode classifies differences and import candidates. It does not copy, patch, flash, or modify either tree.

---

## Outputs

```text
reversa_out/
+-- report.json
+-- evidence.jsonl
+-- summary.md
+-- report.html
+-- dashboard.html
+-- agent_handoff/
    +-- summary.md
    +-- findings.json
    +-- contradictions.json
    +-- patch_candidates.json
    +-- commands_to_run.md
    +-- questions_for_human.md
    +-- known_good_facts.json
    +-- risky_assumptions.json
    +-- tree_inventory.json
```

For compare output:

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

---

## Plain-English Concepts

- A source tree is the folder of code and artifacts you want to inspect.
- A finding is one evidence-backed observation.
- A contradiction is a conflict between claims.
- A patch candidate is a proposed fix direction, not an automatic edit.
- Known-good facts are observations from real testing or trusted references.
- Evidence IDs let agents cite and track the same claim across scans.
- Destructive commands are separated because OS/device research can break real systems.

---

## Safety

Scan and compare are read-only against the target tree. Reversa-Matrix does not add destructive device workflows.

Game runtime profiles are also read-only. They may flag anti-cheat, DRM, cheat, public-match, or ownership-evasion terms as hard review boundaries, but they do not implement bypasses or competitive advantage behavior.

If imported output contains risky commands, the GUI isolates them under:

```text
DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED
```

Normal validation commands should stay read-only: `grep`, `find`, `test -f`, `sha256sum`, local `node` checks, and similar inspection commands.

---

## Agent Handoff

Codex agents should start with:

1. `agent_handoff/summary.md`
2. `agent_handoff/findings.json`
3. `agent_handoff/contradictions.json`
4. `agent_handoff/patch_candidates.json`
5. `agent_handoff/commands_to_run.md`
6. `agent_handoff/known_good_facts.json`
7. `agent_handoff/risky_assumptions.json`
8. `agent_handoff/tree_inventory.json`

The dashboard is for browsing. The handoff bundle is for continuation.

---

## Future Goals

- Runtime compatibility matrix for Windows desktop, Linux, and RM11Pro-style mobile Linux gaming profiles
- More render enhancement evidence around frame pacing, HDR, texture replacement, and API translation
- Broader Windows service, driver, PE metadata, and registry-profile support
- Stronger Linux graphics and container diagnostics for Vulkan, Mesa, Wine, Proton, box64, and related stacks
- More guided reports that turn evidence into reviewable next steps without hiding uncertainty

---

## Deeper Docs

- [Docs home](docs/index.md)
- [Installation](docs/instalacao.md)
- [First scan](docs/uso.md)
- [CLI](docs/cli.md)
- [GUI Dashboard](docs/gui.md)
- [Platform scope](docs/platforms.md)
- [Evidence pipeline](docs/pipeline.md)
- [Generated outputs](docs/saidas/index.md)
- [Original Reversa compatibility](docs/original-reversa-compatibility.md)

---

## Build Docs Locally

```bash
python3 -m pip install --user --break-system-packages -r docs/requirements.txt
python3 -m mkdocs build --strict
```

This installs MkDocs and Material for MkDocs into the user Python site and writes the built site to `site/`. The `site/` folder is ignored by Git.

---

## Compatibility Note

The `reversa install`, agent teams, and `_reversa_sdd/` workflows remain available for compatibility. Reversa-Matrix is centered on cross-platform evidence mapping, scanner outputs, dashboards, compare mode, and agent handoff.

## License

MIT - see [LICENSE](LICENSE).
