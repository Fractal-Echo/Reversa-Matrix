# Online Repository Summary

Public repository:

```text
https://github.com/Fractal-Echo/Reversa-Matrix
```

GitHub description:

```text
AI evidence, contradiction, and guarded patch-intelligence engine for codebases, devices, runtimes, games, and agent workflows
```

GitHub topics:

```text
ai-agents
android
claude
code-intelligence
codex
contradiction-detection
gaming
linux
patching
reverse-engineering
runtime-analysis
static-analysis
```

## Public Identity

Reversa-Matrix is now presented as more than a scanner:

- an evidence engine;
- a contradiction detector;
- a project-memory/frontier tracker;
- a guarded patch-intelligence layer;
- a local model/eval lane;
- a domain profile system for Android, Linux, Windows, games, containers,
  Vulkan/Wayland, kernels, and agent workflows.

## User-Facing Promise

Reversa helps users inspect messy engineering state without losing the proof
trail. It should make the next command or patch easier to trust by showing:

- what was scanned;
- what was found;
- what contradicts;
- what evidence is missing;
- what patch is only a candidate;
- what commands are read-only;
- what actions require approval.

## Boundaries

The online repository must not imply that Reversa:

- applies unrestricted patches;
- flashes devices;
- installs modules;
- bypasses DRM or anti-cheat;
- copies proprietary upstream source;
- treats local model output as proof.

Upstream project names in reports and docs identify evidence domains and
compatibility targets. They do not imply bundling, ownership, or endorsement.

## Installation Snapshot

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
node ./bin/reversa.js scan --help
```

## First Useful Commands

List profiles:

```bash
node ./bin/reversa.js scan --profiles
```

Scan modern Claude/Codex workflow state:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/project \
  --profile claude_code_modern \
  --out reversa_claude_modern_out
```

Scan agent policy drift:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/project \
  --profile semantic_policy \
  --out reversa_policy_out
```

Scan provider gateway state:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/project \
  --profile agentic_gateway \
  --out reversa_gateway_out
```

Draft a guarded patch dossier:

```bash
node ./bin/reversa.js agent patch-wizard \
  --project-root /path/to/project \
  --scan-out reversa_policy_out \
  --candidate <patch-candidate-id> \
  --out .reversa/patch-plans/policy-fix-01
```

## Phone-Connected Direction

Future Reversa/Nebula phone integration should start as a controller/viewer:

- read active Nebula module status;
- compare active and pending module output without staging;
- pull typed evidence bundles;
- show runtime lane status;
- export scan artifacts;
- propose commands with `execute=false`.

Mutating actions must remain explicit, guarded, and user-approved. The active
module remains authoritative unless a pending dry-check is requested and passes
anti-regression comparison.
