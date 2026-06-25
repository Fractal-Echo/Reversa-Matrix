# Reversa-Matrix

**Reverse-engineering evidence mapper for Windows, Android, Linux, and mixed source trees.**

[![Docs](https://img.shields.io/badge/DOCS-Reversa--Matrix-009c3b?style=for-the-badge&logo=material-for-mkdocs&logoColor=white&labelColor=2d2d2d)](https://fractal-echo.github.io/Reversa-Matrix/)

Reversa-Matrix is an evidence-first research assistant for real code trees: Android recovery and kernels, Linux userspace and graphics stacks, Windows services and drivers, build systems, generated files, copied constants, known-good facts, contradictions, and agent handoff.

It is not a patch bot. It is not a flashing tool. It maps evidence so humans and Codex agents can make better decisions.

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
| Cross-platform | C/C++/Rust/Java/Kotlin/Python/JS projects, generated artifacts, build scripts, copied constants |

Current strongest lane: Android recovery evidence mapping with known-good comparison and tree compare mode.

---

## Beginner Path

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
node ./bin/reversa.js scan --help
```

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

## Dashboard Preview

`reversa gui` writes an offline `dashboard.html` over existing scan or compare outputs.

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
sudo apt install python3-venv
python3 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install -r docs/requirements.txt
python -m mkdocs build --strict
```

---

## Compatibility Note

The `reversa install`, agent teams, and `_reversa_sdd/` workflows remain available for compatibility. Reversa-Matrix is centered on cross-platform evidence mapping, scanner outputs, dashboards, compare mode, and agent handoff.

## License

MIT - see [LICENSE](LICENSE).
