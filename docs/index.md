# Reversa-Matrix

**Reverse-engineering evidence mapper for Windows, Android, Linux, and mixed source trees.**

Reversa-Matrix is an evidence-first research assistant for operating-system, device, application, kernel, userspace, build, and recovery trees.

It does not assume a web application or modernization workflow. It starts with files, symbols, build declarations, device facts, paths, configs, logs, and contradictions.

---

## What It Is

Reversa-Matrix scans a source tree and emits structured evidence:

- findings with file and line references
- contradictions between source claims and known-good facts
- patch candidates that stay reviewable instead of automatic
- compare reports between current and reference trees
- offline dashboards for humans
- JSON/JSONL handoff bundles for Codex and other agents

The core rule is simple:

```text
HTML is a view.
JSON and JSONL are the source of truth.
```

---

## Supported Direction

The current scanner already understands Android recovery-style trees and generic source trees. The project direction is broader:

| Platform | What Reversa-Matrix should map |
|---|---|
| Android | recovery trees, kernels, vendor blobs, fstab, init rc, BoardConfig, device facts |
| Linux | containers, distro roots, desktop graphics stacks, systemd, kernel/userland boundaries |
| Windows | source projects, drivers, services, registry assumptions, PE metadata, build scripts |
| Cross-platform | C/C++/Rust/Java/Kotlin/Python/JS projects, generated artifacts, copied constants, risky assumptions |

Reversa-Matrix is a platform-aware evidence mapper, not a website modernization wrapper.

---

## Quick Start

Clone and run the local CLI:

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

Open the local dashboard:

```bash
node ./bin/reversa.js gui --out reversa_out
```

---

## What You Get

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
    +-- known_good_facts.json
    +-- risky_assumptions.json
    +-- tree_inventory.json
```

Use `dashboard.html` to browse. Use `report.json`, `evidence.jsonl`, and `agent_handoff/` for automation.

---

## Safety Model

Reversa-Matrix is read-only against the target tree during scan and compare. It does not flash devices, write partitions, run bootloader flows, or patch source files by itself.

When a command list contains risky operations, the dashboard separates them under:

```text
DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED
```

That safety boundary matters because Reversa-Matrix is meant for kernel, recovery, driver, and OS-adjacent work where a careless command can do real damage.

---

## Where To Go Next

- [Installation](instalacao.md)
- [First scan](uso.md)
- [CLI](cli.md)
- [GUI Dashboard](gui.md)
- [Platform scope](platforms.md)
- [Evidence pipeline](pipeline.md)
- [Generated outputs](saidas/index.md)
- [Original Reversa compatibility](original-reversa-compatibility.md)
