# CLI

Reversa has a simple CLI to manage the installation and lifecycle of agents in your project. All commands run with `npx reversa` in the project root.

---

## Initial behavior

When the CLI starts and before it shows the Reversa ASCII logo, it must clear the terminal screen. The logo should appear at the top of the terminal, with no previous content above it.

The `by sandeco` signature must appear in white on the last line of the artwork, after a right-side margin from the end of the large `Reversa` word. It must not float in the middle of the logo height.

Expected format:

```text
  ______
  | ___ \
  | |_/ /_____   _____ _ __ ___  __ _
  |    // _ \ \ / / _ \ '__/ __|/ _` |
  | |\ \  __/\ V /  __/ |  \__ \ (_| |
  \_| \_\___| \_/ \___|_|  |___/\__,_|  by sandeco

  AI-Powered Reverse Engineering Framework
```

---

## Available commands

### `install`

```bash
npx reversa install
```

Installs Reversa in the current legacy project. Detects present engines, asks for your preferences, and creates the entire required structure.

Use once, in the root of the project you want to analyze.

#### Installation Menu Layout

The installer must treat the menu as the main interface, not as a text dump. Questions must be numbered, have a blank line before the question, and, when options are shown, a blank line between the question and the list.

After the user confirms a multi-select question, the CLI must not print every selected item in one continuous line. This is forbidden because it creates a long, unreadable paragraph. Use one of these alternatives:

- Do not render the full selection and continue to the next question.
- Render a short summary, one line per team.

The agents menu lists teams, not individual agents. The user picks at the team level; the installer expands each selected team into its agents:

1. `Reversa Agents Core` (rendered in gray as a separator, always installed)
2. `Migration Agents`
3. `Code Forward Agents`
4. `Pricing and Size Agents`
5. `Translators N8N->Specs->Python` (unchecked by default)

`Reversa Agents Core` is rendered as a gray, non-selectable separator that visually shows `(*)` as if it were a checked-and-disabled item: the user sees it, knows it is included, and the cursor skips over it. It contains all discovery agents (Reversa, Scout, Archaeologist, Detective, Architect, Writer, Reviewer, Visor, Data Master, Design System, Agents Help, Reconstructor), so the previous "Discovery Add-ons" group no longer exists as a separate concept. Even though the menu hides the agent-level detail, the final installation summary still breaks the count down by team (Discovery, Migration, Code Forward, Translators, Pricing).

---

### `status`

```bash
npx reversa status
```

Shows the current analysis state: which phase is in progress, which agents have already run, what's left to complete.

Useful for a quick overview before resuming a session.

---

### `scan`

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

Scans a source tree as evidence, not prose. The command is read-only against the target tree and writes machine-readable artifacts to the output directory:

- `report.json`
- `evidence.jsonl`
- `summary.md`
- `report.html`
- `agent_handoff/findings.json`
- `agent_handoff/contradictions.json`
- `agent_handoff/patch_candidates.json`
- `agent_handoff/commands_to_run.md`
- `agent_handoff/questions_for_human.md`
- `agent_handoff/known_good_facts.json`
- `agent_handoff/risky_assumptions.json`
- `agent_handoff/tree_inventory.json`

Available profiles include `android_recovery`, `orangefox`, `twrp`, `android_kernel`, `gki_kernel`, `userspace_graphics`, `linux_container`, `gamescope`, and `generic_source_tree`. Run `npx reversa scan --profiles` for the current list.

If no output format flags are passed, the command writes HTML, JSON, JSONL, Markdown, and the agent handoff bundle.

#### Required evidence fields

Every generated evidence item includes:

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

Use `report.json` and `evidence.jsonl` as the source of truth. `report.html` is a readable dashboard, not the canonical data format.

#### Android recovery known-good facts

Known-good files are JSON objects with facts observed from the target device. Example:

```bash
npx reversa scan \
  --project-root /path/to/device/nubia/canoe \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

For Codex agents, start with:

1. `agent_handoff/summary.md`
2. `agent_handoff/contradictions.json`
3. `agent_handoff/patch_candidates.json`
4. `agent_handoff/commands_to_run.md`
5. `agent_handoff/risky_assumptions.json`

Commands generated by the scanner are read-only by default. Normal validation output must not include flashing, partition writes, bootloader operations, `dd` writes, or destructive file operations.

---

### `compare`

```bash
npx reversa compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_compare_out
```

Compares two source trees and writes:

- `compare_report.json`
- `compare_summary.md`
- `compare.html`
- `agent_handoff/compare_findings.json`
- `agent_handoff/safe_import_candidates.json`
- `agent_handoff/risky_import_candidates.json`

Compare mode detects files only in one tree, variable differences, fstab differences, init rc differences, vendor blob list differences, decrypt stack differences, display/touch/theme differences, and partition/image rule differences.

It never auto-imports anything. Safe and risky import candidates are classifications for manual review.

---

### `gui`

```bash
npx reversa gui --out reversa_out
```

Builds an offline local dashboard from existing scan or compare outputs. The command verifies that the output directory exists and contains `report.json` or `compare_report.json`, then writes:

```text
dashboard.html
```

The GUI reads structured files such as:

- `report.json`
- `summary.md`
- `agent_handoff/findings.json`
- `agent_handoff/contradictions.json`
- `agent_handoff/patch_candidates.json`
- `agent_handoff/commands_to_run.md`
- `compare_report.json`
- `agent_handoff/compare_findings.json`

It includes Home, setup checklist, metadata, findings, contradictions, patch candidates, known-good comparison, risky assumptions, commands, tree inventory, agent handoff guidance, and compare results when present.

Inside a cloned repository, the explicit local command is:

```bash
node ./bin/reversa.js gui --out reversa_out
```

The GUI does not replace JSON/JSONL outputs and does not modify scan data.

---

### `update`

```bash
npx reversa update
```

Updates agents to the latest version of Reversa.

The command is smart: it checks the SHA-256 manifest of each file and never overwrites files you've customized. If you made adjustments to any agent, they stay intact.

---

### `add-agent`

```bash
npx reversa add-agent
```

Adds a specific agent to the project. Useful if you didn't install all agents during the initial installation and now want to include, for example, Data Master or Design System.

---

### `add-engine`

```bash
npx reversa add-engine
```

Adds support for an AI engine that wasn't present when you installed. For example: you installed only for Claude Code and now want to add Codex.

---

### `uninstall`

```bash
npx reversa uninstall
```

Removes Reversa from the project: deletes the files created by the installation (`.reversa/`, `.agents/skills/reversa-*/`, engine entry files).

!!! info "Your files stay intact"
    `uninstall` removes **only** what Reversa created. No original project file is touched. Specifications generated in `_reversa_sdd/` are also preserved by default.
