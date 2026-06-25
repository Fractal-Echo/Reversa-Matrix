# Reversa-Matrix
<small>by sandeco / Fractal-Echo</small>

**Reverse-engineering evidence mapper for source trees, contradictions, and analysis.**

[![English Docs](https://img.shields.io/badge/DOCS-English-009c3b?style=for-the-badge&logo=material-for-mkdocs&logoColor=white&labelColor=2d2d2d)](https://fractal-echo.github.io/Reversa-Matrix/)<br>
[![Português Docs](https://img.shields.io/badge/DOCS-Portugu%C3%AAs-ffcc00?style=for-the-badge&logo=material-for-mkdocs&logoColor=black&labelColor=2d2d2d)](https://fractal-echo.github.io/Reversa-Matrix/pt/)<br>
[![Español Docs](https://img.shields.io/badge/DOCS-Espa%C3%B1ol-c60b1e?style=for-the-badge&logo=material-for-mkdocs&logoColor=white&labelColor=2d2d2d)](https://fractal-echo.github.io/Reversa-Matrix/es/)

Reversa-Matrix is a lightweight reverse-engineering workspace for source trees. It scans folders of code and device configuration, turns observations into structured evidence, finds contradictions, compares trees, and generates a local dashboard plus an agent handoff bundle. It is useful for noobs who need a readable map and for Codex agents that need JSON/JSONL instead of scraped HTML.

---

## Dashboard Preview

After a scan, open the local dashboard:

```bash
node ./bin/reversa.js gui --out reversa_out
```

The GUI is a generated offline `dashboard.html` with overview cards, setup help, search, severity/confidence/category filters, findings, contradictions, patch candidates, known-good comparison, commands, tree inventory, agent handoff notes, and compare results when present.

Screenshot placeholder:

```text
Reversa-Matrix Dashboard
├── Home / overview
├── Setup checklist
├── Findings browser
├── Contradictions browser
├── Patch candidates
├── Known-good comparison
├── Commands to run
└── Agent handoff
```

---

## Beginner Path

Clone, install, test, and inspect the CLI:

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
node ./bin/reversa.js scan --help
```

Run the included Android recovery fixture scan:

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

If you are using Reversa-Matrix as an installed package, the equivalent package-style commands are:

```bash
npx reversa scan --help
npx reversa gui --out reversa_out
```

Inside this cloned repository, `node ./bin/reversa.js ...` is the most explicit local command and avoids accidentally resolving a published package from the network.

---

## What It Does

A source tree is the folder of files you want to inspect: code, build files, recovery configs, fstab files, init scripts, vendor blob lists, docs, and generated metadata. Reversa-Matrix reads that tree and writes a separate evidence dataset.

It can:

- scan Android recovery trees, kernels, userspace graphics stacks, containers, and generic source trees
- produce `report.json`, `evidence.jsonl`, `summary.md`, `report.html`, and `agent_handoff/`
- compare a current tree against a reference tree without importing anything
- validate generated evidence against stable schema fields
- compare source declarations against known-good device facts
- classify contradictions and patch candidates by risk
- keep validation commands read-only by default
- generate an offline noob-friendly dashboard over the same structured data

HTML is a view. JSON and JSONL are the source of truth.

---

## First Real Scan

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/source/tree \
  --profile generic_source_tree \
  --out reversa_out
```

Then:

```bash
node ./bin/reversa.js gui --out reversa_out
```

---

## Android Recovery / RM11Pro Example

For RM11Pro / NX809J / canoe recovery work, the repository includes:

```text
examples/known_good_rm11pro_nx809j.json
```

Run:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/device/nubia/canoe \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

This flags old RM10Pro/sm8750/non-canoe leftovers, partition size mismatches, boot header mismatches, init rc service path problems, fstab issues, vendor blob references, decrypt stack assumptions, display/touch/theme assumptions, and patch candidates.

---

## Compare Mode

Compare a current tree with a reference tree:

```bash
node ./bin/reversa.js compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_compare_out
```

Compare mode only classifies differences and manual import candidates. It does not copy, patch, flash, or modify either tree.

---

## Outputs

Scan output:

```text
reversa_out/
├── report.json
├── evidence.jsonl
├── summary.md
├── report.html
├── dashboard.html
└── agent_handoff/
    ├── findings.json
    ├── contradictions.json
    ├── patch_candidates.json
    ├── commands_to_run.md
    ├── questions_for_human.md
    ├── known_good_facts.json
    ├── risky_assumptions.json
    └── tree_inventory.json
```

Compare output:

```text
reversa_compare_out/
├── compare_report.json
├── compare_summary.md
├── compare.html
├── dashboard.html
└── agent_handoff/
    ├── compare_findings.json
    ├── safe_import_candidates.json
    └── risky_import_candidates.json
```

## Plain-English Concepts

- A finding is one evidence-backed observation from a file, line, inventory check, or known-good comparison.
- A contradiction is a conflict between claims, such as one file saying `sm8750` while known-good facts say `sm8850`.
- A patch candidate is a reviewable source-tree change idea. Reversa-Matrix does not blindly patch.
- Known-good facts are observations from real testing, stored as JSON, used to catch stale source assumptions.
- Evidence IDs matter because agents can cite, track, and compare the same claim across scans.
- Destructive commands are separated because source-tree research must not quietly become flashing, partition writing, or bootloader work.

## Agent Handoff

Codex agents should start with:

1. `agent_handoff/summary.md`
2. `agent_handoff/contradictions.json`
3. `agent_handoff/patch_candidates.json`
4. `agent_handoff/commands_to_run.md`
5. `agent_handoff/known_good_facts.json`
6. `agent_handoff/risky_assumptions.json`
7. `agent_handoff/tree_inventory.json`

The dashboard is for browsing. The handoff bundle is for agent continuation.

## Safety

Reversa-Matrix does not add destructive device workflows. Normal validation commands are read-only: `grep`, `find`, `test -f`, `sha256sum`, and local `node` checks. If imported output ever contains destructive commands, the GUI isolates them under:

```text
DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED
```

## Deeper Docs

- [CLI](docs/cli.md)
- [Enhanced Reversa](docs/enhanced-reversa.md)
- [GUI Dashboard](docs/gui.md)
- [Generated outputs](docs/saidas/index.md)
- [Developing from specs](docs/desenvolvendo-com-specs.md)

---

## Agent Installation

In the root of the legacy project:

```bash
npx reversa install
```

The installer will:
1. Detect the AI engines present in the environment (Claude Code, Codex, Cursor, etc.)
2. Ask which agents to install — all selected by default
3. Collect project name, language, and preferences
4. Copy agents to `.agents/skills/` (and `.claude/skills/` for Claude Code)
5. Create the engine entry file (`CLAUDE.md`, `AGENTS.md`, etc.)
6. Create the `.reversa/` structure with state, configuration, and plan
7. Generate SHA-256 manifest for safe updates

> Reversa **never deletes or modifies** existing files in your project.
> Agents write only to `.reversa/` and the output folder (`_reversa_sdd/` by default).

**Requirements:** Node.js 18+

---

> [!IMPORTANT]
> ### 🔒 Guaranteed immutability of the legacy project
>
> The installer only creates new files (`CLAUDE.md`, `AGENTS.md`, `.agents/skills/`, etc.) and **never modifies or deletes any existing file** in your project. During analysis, agents operate under a strict and inviolable directive: **all writes are restricted to `.reversa/` and `_reversa_sdd/`** — no other file in your project is touched.

> [!CAUTION]
> ### 💾 Back up your project before starting
>
> Although Reversa never modifies your files, AI agents can make mistakes. **We strongly recommend:**
>
> 1. **Version the project in Git** — make sure all files are committed before starting the analysis
> 2. **Have the repository on GitHub** (or GitLab, Bitbucket) — so you have a safe remote copy
> 3. **Make a local copy of the folder** — a simple `cp -r my-project my-project-backup` protects against any unexpected event
>
> If something unexpected happens during analysis, you can restore the original state with `git restore .` or from the backup copy.

> [!WARNING]
> 🔑 **Reversa does not request, store, or transmit API keys from any LLM service.** All intelligence is delegated to the AI agent already present in your environment (Claude Code, Codex, Cursor, etc.) — no external authentication dependencies.

---

## How to use

After installation, open the project in the AI agent and activate Reversa:

```
/reversa
```

For engines without slash command support (like Codex):

```
reversa
```

Reversa will introduce itself, create a personalized exploration plan, and coordinate the entire analysis. Progress is saved in `.reversa/state.json` at each checkpoint — if the session is interrupted, just type `reversa` to resume where you left off.

For other workflows, use the matching entry command:

| Goal | Command |
|------|---------|
| Analyze an existing legacy and produce specs | `/reversa` |
| Scan a source tree into machine-readable evidence | `npx reversa scan` |
| Compare current/reference trees without importing | `npx reversa compare` |
| Start a brand new project from a one-line idea | `/reversa-new` |
| Evolve the system one feature at a time, from spec to code | `/reversa-forward` |
| Rebuild the legacy on a modern stack | `/reversa-migrate` |
| Render the extracted knowledge as an HTML mini-site | `/reversa-docs` |
| Estimate effort and pricing on top of the specs | `/reversa-pricing-profile`, `/reversa-pricing-size`, `/reversa-pricing-estimate` |

Each orchestrator pauses between agents and asks for `CONTINUAR` before advancing, so you stay in control of every step.

---

## How it works

The Discovery pipeline (`/reversa`) is the heart of the framework: a 5-phase sequence orchestrated by the **Reversa** agent.

```
Reconnaissance  Excavation  Interpretation  Generation  Review
    Scout       Archaeologist  Detective      Writer    Reviewer
                                Architect
```

Independent agents (run at any phase): **Visor**, **Data Master**, **Design System**, **Soul Extractor**, **Tracer**, **Chronicler**.

Once the specs exist, you can move forward in three directions, depending on the goal:

```
Discovery (/reversa)
        │
        ├── /reversa-forward    Evolve the system from specs to code
        ├── /reversa-migrate    Rebuild the legacy on a modern stack
        └── /reversa-docs       Render specs as an HTML mini-site
```

For a **greenfield** project (no legacy to extract), start with `/reversa-new` instead. It walks from a one-line idea to SDD specs and then hands off to `/reversa-forward`.

---

## Agents

Reversa organizes its agents in **six specialized Teams**. The Discovery Team (Reversa Agents Core) is always installed; the other five Teams are pre-checked in the installer and you can opt out of any of them.

| Team | Purpose | Entry command |
|------|---------|---------------|
| **Reversa Agents Core** (Discovery) | Analyze the existing legacy and produce specs | `/reversa` |
| **Code New Project Agents** | Start a new project (greenfield) from a one-line idea and produce specs | `/reversa-new` |
| **Code Forward Agents** | Evolve the system from specs to running code, one feature at a time | `/reversa-forward` |
| **Migration Agents** | Turn legacy specs into a rebuild plan for a modern stack | `/reversa-migrate` |
| **Pricing and Size Agents** | Estimate effort, size and pricing on top of the specs | `/reversa-pricing-*` |
| **Documentation Team** | Render the extracted knowledge as a self-contained HTML mini-site | `/reversa-docs` |

### Discovery Team, required

These run the main `/reversa` pipeline.

| Agent | Role |
|-------|------|
| **Reversa** | Central orchestrator. Coordinates all agents, saves checkpoints, guides the user |
| **Scout** | Maps the surface: folder structure, languages, frameworks, dependencies, entry points |
| **Archaeologist** | Deep module-by-module analysis: algorithms, control flows, data structures |
| **Detective** | Extracts implicit business knowledge: rules, retroactive ADRs, state machines, permissions |
| **Architect** | Synthesizes everything into C4 diagrams, full ERD, integration map, and technical debt |
| **Writer** | Generates specifications as operational contracts with code traceability |

### Discovery Team, optional (installed by default)

| Agent | Role |
|-------|------|
| **Reviewer** | Reviews specs, finds inconsistencies, and validates gaps with the user |
| **Tracer** | Dynamic analysis: resolves gaps via logs, tracing, and real data (read-only) |
| **Visor** | Documents the interface from screenshots, without needing the system to be running |
| **Data Master** | Complete database analysis: DDL, migrations, ORM, ERD, triggers, procedures |
| **Design System** | Extracts design tokens: colors, typography, spacing, themes, and components |
| **Soul Extractor** | Produces a single executive Spec (`soul.md`) with purpose, core entities and founding decisions, useful right after Scout |
| **Chronicler** | Documents code changes during development sessions |

### Code New Project Agents (greenfield)

For projects that do not exist yet. Activate with `/reversa-new` and the orchestrator drives the pipeline `Ideator → Researcher → Drafter → Spec SDD`, with a `CONTINUAR` checkpoint between agents. Final handoff suggests `/reversa-forward` to take the specs to code.

| Agent | Role |
|-------|------|
| **Reversa New** | Orchestrator. Reads the initial brief, walks the pipeline, saves `newproject_progress` in `state.json` |
| **Ideator** | Structured brainstorm with 6 divergent questions (root problem, value, alternatives, audience, success metrics, dangerous assumptions). Produces `_reversa_sdd/ideation.md` |
| **Researcher** | Turns the raw audience into 1 to 3 structured personas with journeys. Produces `_reversa_sdd/personas.md` |
| **Drafter** | Synthesizes ideation and personas into a complete PRD (problem, metrics, scope, non-goals, constraints, risks). Produces `_reversa_sdd/prd.md` |
| **Spec SDD** | Decomposes the PRD into logical components and writes one SDD spec per component, with an automatic quality score. Vendored from the global `sdd-spec` skill. Produces `_reversa_sdd/sdd/*.md` |

### Code Forward Agents (evolution)

The bridge from specs to running code. Pipeline: `requirements → clarify → quality → plan → to-do → audit → coding`. Use `/reversa-forward` as the entry point: it detects the **physical stage** of the active feature (by inspecting the artifacts on disk, not metadata) and suggests the next agent.

| Agent | Role |
|-------|------|
| **Reversa Forward** | Orchestrator. Detects the physical stage and suggests the next skill. Never executes code itself |
| **Requirements** | Turns a free-form idea into `requirements.md` anchored to the legacy, with `[DOUBT]` markers, gaps and glossary |
| **Clarify** | Up to 5 targeted questions to resolve `[DOUBT]` markers in place |
| **Quality** | Read-only auditor of writing clarity. Produces `requirements-audit.md` |
| **Plan** | Translates requirements into a technical proposal expressed as a **delta over the legacy**. Produces `roadmap.md`, `investigation.md`, `data-delta.md`, `onboarding.md`, `interfaces/` |
| **To-Do** | Decomposes the roadmap into atomic actions across five phases with stable IDs, dependencies and parallelism markers. Produces `actions.md` |
| **Audit** | Read-only cross-check between requirements, roadmap and actions. Produces `audit/cross-check.md` |
| **Coding** | Executes `actions.md`, flips checkboxes, writes `progress.jsonl`, `legacy-impact.md` and `regression-watch.md` |
| **Principles** | Manages durable project rules (`principles.md`) and emits impact reports when they change |
| **Resume** | Swaps the active feature with one from the `paused-features` queue |

### Migration Team

Use after `/reversa` when the goal is to rebuild the legacy on a modern stack. Activate with `/reversa-migrate`. Pipeline: `Paradigm Advisor → Curator → Strategist → Designer → Inspector`, with a human review pause between agents. Every artifact lands in `_reversa_sdd/migration/`.

### Pricing and Size Team

Three agents on top of the specs to estimate effort, size and price. Activate with `/reversa-pricing-profile`, `/reversa-pricing-size` and `/reversa-pricing-estimate`.

### Translators (input adapters)

Use when the legacy "code" is not source code but a structured artifact like a visual workflow. Generates the SDD spec and prepares the state for the main pipeline to take over.

| Agent | Role |
|-------|------|
| **N8N Translator** | Reads N8N workflows exported as JSON and produces SDD specs ready for Python reimplementation. Activated via `/reversa-n8n` |

### Documentation Team (HTML mini-site)

After discovery completes, this team turns the extracted knowledge into a self-contained HTML mini-site under `.reversa/documentation/`. Run `/reversa-docs` to orchestrate the full team, or activate any agent in isolation to regenerate only its pages.

| Agent | Role |
|-------|------|
| **Reversa Docs** | Orchestrates the team, runs the 3-question interview, computes deterministic seed. Activated via `/reversa-docs` |
| **Mapper** | Spatial structure: `arquitetura.html` (Code City 3D, Three.js), `modulos.html` (force-directed D3), `topologia.html` (legacy vs modern side-by-side) |
| **Analyst** | Quantitative data: `metricas.html` (Highcharts treemap, sankey, histogram, columns), `timeline.html` (events from `.reversa/chronicle.md`) |
| **Storyteller** | Narrative: `glossario.html` (client-side search), `deck.html` (6 to 10 navigable slides), `features/<spec>.html` (one per SDD spec) |
| **Publisher** | Final integration: `index.html` with hero + unique generative seal, auto-discovery of auxiliary HTMLs from other agents, link validation, local telemetry |

The team brings 5 shared skills (`reversa-arquitetura-3d`, `reversa-selo-generativo`, `reversa-highcharts-visualizer`, `reversa-especialista-d3`, `reversa-image-prompt-json`) which are installed automatically alongside the team. The output is a static mini-site that opens via `file://` with no server required.

---

## What is generated

```
_reversa_sdd/
├── inventory.md              # Project inventory
├── dependencies.md           # Dependencies with versions
├── code-analysis.md          # Technical analysis per module
├── data-dictionary.md        # Data dictionary
├── domain.md                 # Glossary and business rules
├── state-machines.md         # State machines in Mermaid
├── permissions.md            # Permission matrix
├── architecture.md           # Architectural overview
├── c4-context.md             # C4 Diagram: Context
├── c4-containers.md          # C4 Diagram: Containers
├── c4-components.md          # C4 Diagram: Components
├── erd-complete.md           # Full ERD in Mermaid
├── confidence-report.md      # Confidence report 🟢🟡🔴
├── gaps.md                   # Identified gaps
├── questions.md              # Questions for human validation
├── dynamic.md                # Dynamic analysis findings (Tracer)
├── sdd/                      # Specs per component
│   └── [component].md
├── openapi/                  # API specs (if applicable)
├── user-stories/             # User stories (if applicable)
├── adrs/                     # Retroactive architectural decisions
├── flowcharts/               # Flowcharts in Mermaid
├── sequences/                # Sequence diagrams
├── ui/                       # Interface specs (Visor)
├── database/                 # Database specs (Data Master)
├── design-system/            # Design tokens (Design System)
└── traceability/
    ├── spec-impact-matrix.md # Which spec impacts which
    └── code-spec-matrix.md   # Code file to corresponding spec
```

In a greenfield run, `/reversa-new` adds the following on top of `_reversa_sdd/`:

```
_reversa_sdd/
├── newproject-brief.md      # Initial brief (Reversa New)
├── ideation.md              # Structured brainstorm (Ideator)
├── personas.md              # Personas with journeys (Researcher)
├── prd.md                   # Product Requirements Document (Drafter)
└── sdd/
    └── [component].md       # SDD specs with quality score (Spec SDD)
```

Forward features land in a separate folder, `_reversa_forward/` by default:

```
_reversa_forward/
└── <NNN>-<short-name>/      # One folder per feature
    ├── requirements.md
    ├── roadmap.md
    ├── investigation.md
    ├── data-delta.md
    ├── onboarding.md
    ├── interfaces/
    ├── actions.md
    ├── progress.jsonl
    ├── legacy-impact.md
    ├── regression-watch.md
    └── audit/
        ├── requirements-audit.md
        └── cross-check.md
```

The Documentation Team writes only inside `.reversa/documentation/` (HTML mini-site, fully offline).

### Confidence scale

Every statement in the specs is marked with:

| Mark | Meaning |
|------|---------|
| 🟢 CONFIRMED | Extracted directly from code — can be cited with file and line |
| 🟡 INFERRED | Deduced from patterns — may be wrong |
| 🔴 GAP | Not determinable from code — requires human validation |

---

## Supported engines

| Engine | File created | Skills path | Activation |
|--------|-------------|-------------|------------|
| Claude Code ⭐ | `CLAUDE.md` | `.claude/skills/reversa-*/` and `.agents/skills/reversa-*/` | `/reversa` |
| Codex ⭐ | `AGENTS.md` | `.agents/skills/reversa-*/` | `reversa` |
| Cursor ⭐ | `.cursorrules` | `.agents/skills/reversa-*/` | `/reversa` |
| Gemini CLI | `GEMINI.md` | `.agents/skills/reversa-*/` | `/reversa` |
| Windsurf | `.windsurfrules` | `.agents/skills/reversa-*/` | `/reversa` |
| Antigravity | `AGENTS.md` | `.agents/skills/reversa-*/` | `/reversa` |
| Kiro | (none) | `.kiro/skills/reversa-*/` and `.agents/skills/reversa-*/` | `/reversa` |
| Opencode | `AGENTS.md` | `.agents/skills/reversa-*/` | `reversa` |
| Cline | `.clinerules` | `.agents/skills/reversa-*/` | `/reversa` |
| Roo Code | `.roorules` | `.agents/skills/reversa-*/` | `/reversa` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.agents/skills/reversa-*/` | `/reversa` |
| Aider | `CONVENTIONS.md` | `.agents/skills/reversa-*/` | `reversa` |
| Amazon Q Developer | `.amazonq/rules/reversa.md` | `.agents/skills/reversa-*/` | `/reversa` |

---

## CLI commands

```bash
npx reversa install      # Install Reversa in the project
npx reversa scan         # Generate evidence, contradictions, reports, and handoff artifacts
npx reversa compare      # Compare two source trees and classify import candidates
npx reversa status       # Show current analysis state
npx reversa update       # Update agents to the latest version
npx reversa add-agent    # Add an agent to the project
npx reversa add-engine   # Add support for a new engine
npx reversa uninstall    # Remove Reversa from the project
```

The `update` command detects files you modified via SHA-256 and never overwrites customizations.
The `uninstall` command removes only files created by Reversa — nothing from the legacy project is touched.

### Evidence scan

```bash
npx reversa scan \
  --project-root /path/to/tree \
  --profile android_recovery \
  --known-good known_good_rm11pro.json \
  --out reversa_out \
  --html \
  --json \
  --jsonl \
  --markdown \
  --agent-handoff
```

The scan command is read-only against the target tree. It writes structured artifacts to the output directory: `report.json`, `evidence.jsonl`, `summary.md`, `report.html`, and an optional `agent_handoff/` bundle with findings, contradictions, patch candidates, validation commands, known-good comparison, risky assumptions, and tree inventory.

---

## Internal structure

```
.reversa/
├── state.json          # Analysis state between sessions
├── config.toml         # Project configuration
├── config.user.toml    # Personal preferences (don't commit)
├── plan.md             # Exploration plan (user-editable)
├── version             # Installed version
├── context/
│   ├── surface.json    # Generated by Scout
│   └── modules.json    # Generated by Archaeologist
└── _config/
    ├── manifest.yaml       # Installation metadata
    └── files-manifest.json # SHA-256 hashes for safe updates

.agents/skills/         # Universal skills (all compatible agents)
.claude/skills/         # Mirror for Claude Code
```

---

## Contributing

Contributions are welcome. Open an issue to discuss before submitting a PR.

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
```

---

## License

MIT — see [LICENSE](LICENSE) for details.
