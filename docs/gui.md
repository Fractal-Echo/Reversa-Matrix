# GUI Dashboard

Reversa-Matrix includes a lightweight offline dashboard for browsing Windows, Android, Linux, and mixed-tree scan/compare outputs.

It is not an Electron app and it does not require internet access. The command reads existing structured artifacts and writes one local file:

```text
dashboard.html
```

JSON and JSONL remain the source of truth. The GUI is a viewer.

## Reversa-Matrix Mission Control

The dashboard opens on a lightweight Reversa-Matrix mission-control console: a
dark RM11Pro-first evidence surface with noir/cyberpunk-inspired paneling,
source-tree grid lines, evidence nodes, contradiction routes, known-good
context, patch review routing, and touch-readable status chips.

```text
Evidence first. Patch second. Repeatable proof always.
```

The motif is implemented with local SVG and CSS. It remains readable without
animation, does not require network access, and is sized for both desktop and
phone screens.

## Open A Dashboard

After a scan:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/android-recovery-current \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out

node ./bin/reversa.js gui --out reversa_out
```

The command prints the generated `dashboard.html` path and a `file://` URL.

When Reversa-Matrix is installed as a package, use:

```bash
npx reversa gui --out reversa_out
```

## What The Dashboard Shows

- Home / overview
- Triage
- Setup checklist
- Scan lanes
- Scan metadata
- Findings browser
- Contradictions browser
- Patch candidates browser
- Known-good comparison
- Risky assumptions
- Commands to run
- Tree inventory
- Agent handoff guidance
- Compare results, when `compare_report.json` is present

## Filters

The dashboard includes:

- search across text, IDs, file paths, and JSON details
- severity filter: `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`, `INFO`
- confidence filter: `confirmed`, `likely`, `possible`, `weak`
- category filter

Each major item includes file/line references when available, expandable JSON details, helper text, and a safe next step.

## RM11Pro-First UX

The dashboard is designed as the control surface for RM11Pro and Nebula work:

- high contrast dark UI for phone use
- original sci-fi noir styling without copied film, OEM, game, or upstream marks
- touch-readable cards, buttons, and filters
- status chips for RM11Pro, Wayland, touch readability, and offline evidence
- triage actions that tell a new user where to click first
- scan lanes for Android recovery, Linux/Wayland containers, game runtime,
  agent toolchains, and provider gateways
- command separation so validation stays away from destructive work

This same visual language is the starting point for a future Reversa/Nebula
icon pack.

## Platform Role

The GUI is intentionally generic. It should show Android recovery contradictions today and grow into Windows/Linux evidence without becoming a separate app per platform.

Good dashboard data should come from the report contract:

- platform/profile metadata
- paths
- symbols
- build variables
- known-good facts
- contradictions
- patch candidates

## Commands And Safety

Read-only validation commands are shown with copy buttons.

If generated or imported output contains a destructive command, the dashboard puts it under:

```text
DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED
```

Normal Reversa-Matrix output should not include flashing, `dd`, partition modification, or bootloader commands.

## Agent Handoff

Codex agents should not scrape the GUI. They should consume:

1. `agent_handoff/summary.md`
2. `agent_handoff/contradictions.json`
3. `agent_handoff/patch_candidates.json`
4. `agent_handoff/commands_to_run.md`
5. `agent_handoff/known_good_facts.json`
6. `agent_handoff/risky_assumptions.json`
7. `agent_handoff/tree_inventory.json`
