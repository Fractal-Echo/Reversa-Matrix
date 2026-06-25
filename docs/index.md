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

## Report Dashboard Preview

The generated report and offline dashboard share the Reversa-Matrix console identity:

<div class="rm-console-preview" aria-label="Reversa-Matrix console preview">
  <div class="rm-console-copy">
    <strong>Reversa-Matrix Console</strong>
    <span>Reverse-engineering evidence mapper for source trees, contradictions, and analysis.</span>
  </div>
  <div class="rm-console-graph" aria-hidden="true">
    <span class="rm-node evidence"></span>
    <span class="rm-node contradiction"></span>
    <span class="rm-node known-good"></span>
    <span class="rm-node patch"></span>
    <span class="rm-route route-a"></span>
    <span class="rm-route route-b"></span>
    <span class="rm-route route-c"></span>
  </div>
</div>

The visual model is evidence mapping first: source observations route into contradiction groups, known-good facts provide review context, and patch candidates stay separate until a human or agent validates them.

---

## Supported Direction

The current scanner already understands Android recovery-style trees and generic source trees. The project direction is broader:

| Platform | What Reversa-Matrix should map |
|---|---|
| Android | recovery trees, kernels, vendor blobs, fstab, init rc, BoardConfig, device facts |
| Linux | containers, distro roots, desktop graphics stacks, systemd, kernel/userland boundaries |
| Windows | source projects, drivers, services, registry assumptions, PE metadata, build scripts |
| Games | modding runtimes, graphics wrappers, Vulkan loader state, render enhancement manifests |
| Cross-platform | C/C++/Rust/Java/Kotlin/Python/JS projects, generated artifacts, copied constants, risky assumptions |

Reversa-Matrix is a platform-aware evidence mapper, not a website modernization wrapper.

---

## Quick Start

Requirements:

- Node.js 18.20.2 or newer
- npm
- Git
- A source tree, config folder, log bundle, or extracted project to inspect

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

Try the game/runtime fixture:

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/bo3-runtime-diagnostics \
  --profile rm11pro_gaming_runtime \
  --out reversa_game_out
node ./bin/reversa.js gui --out reversa_game_out
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

---

## Future Goals

- Runtime compatibility matrix across desktop and mobile Linux gaming profiles
- More render enhancement evidence for frame timing, texture replacement, HDR, and API translation
- Broader Windows services, drivers, PE metadata, and registry-profile support
- Stronger Linux graphics and container diagnostics
