# Reversa-Matrix Identity

Reversa-Matrix is an AI evidence, contradiction, and guarded patch-intelligence engine.

It exists to keep complex engineering work from losing the thread. Reversa reads
repositories, logs, runtime traces, device reports, generated artifacts, and
agent instructions, then turns them into traceable findings, contradiction
maps, project memory/frontiers, guarded patch dossiers, review-only patch diffs,
and agent-ready operating rules.

The long-term direction is a local Jarvis-style engineering cockpit: evidence
memory, contradiction detection, domain profiles, local model evals, command
plans, and patch review artifacts working together under human approval.

## Mission

Reversa helps a human operator and coding agents answer:

- what is proven;
- what is stale;
- what contradicts what;
- what can be patched safely;
- what must stay behind approval;
- what evidence should be collected next.

The core rule remains:

```text
HTML is a view.
JSON and JSONL are the source of truth.
```

Reversa prevents regressions by preserving and enforcing known-good frontiers.

## Core Lanes

Current practical lanes include:

- `agentic_toolchain`
- `agentic_gateway`
- `semantic_policy`
- `child_libpath`
- `nebula_vulkan_loader`
- `game_exe_patch_runtime`
- `windows_compat`
- `linux_container`
- `android_recovery`
- `kernel`

Additional domain profiles cover userspace graphics, Gamescope, Vulkan loader
state, PCGamingWiki-style game fixes, widescreen/framegen evidence, graphics
wrappers, BO3 diagnostics, render-enhancement plugins, Windows system trees,
Android kernels, OrangeFox/TWRP recovery trees, and RM11Pro gaming runtime
evidence.

## Evidence Model

Evidence items carry file paths, line numbers, categories, severity, confidence,
normalized claims, related paths, related symbols, and timestamps. Generated
reports preserve raw evidence in `evidence.jsonl` and structured summaries in
`report.json`.

Scans are read-only against the inspected tree. The scanner may produce patch
candidates, but candidates are review artifacts, not applied changes.

## Contradiction Model

Reversa groups contradictory claims by normalized meaning instead of relying only
on raw string matches. This matters for agent policy, device state, runtime
state, and copied constants where the same risk may be phrased many ways.

Examples:

- "ask before destructive" conflicts with "skip approvals";
- active module proof conflicts with stale pending-module proof;
- known-good device facts conflict with copied constants;
- runtime evidence conflicts with older documentation.

## Guarded Patch Wizard

`agent patch-wizard` and `agent patch-plan` produce guarded patch review
artifacts:

- `patch_plan.json`
- `patch_plan.md`
- evidence hashes
- rollback notes
- stop conditions
- optional review-only `patch.diff`

They do not edit source files, format files, commit, push, install modules,
flash devices, reboot, or run destructive commands.

## Local 5090 / vLLM / Eval Lane

Reversa can talk to a local OpenAI-compatible model endpoint such as vLLM. Local
model output is advisory. It can help classify evidence and draft plans, but it
does not replace deterministic scanner truth.

`agent eval` scores local models against held-out JSON cases, including:

- Nebula Wayland regression guard;
- destructive-operation policy guard;
- DroidSpaces container command-wizard guard.

The eval lane is how local GPU reasoning gets measured before it influences
workflow decisions.

## Phone / Nebula App Communication Direction

Reversa should be able to communicate with Nebula when a phone is connected, but
the first contract is controller/viewer, not mutating patcher.

Initial phone-connected scope:

- read active Nebula module status;
- compare active module output against pending dry-check output;
- pull typed evidence bundles and hashes;
- show display/runtime/integration lane status;
- export Reversa scan results back to the host;
- propose command plans with `execute=false`;
- keep active module dispatch authoritative by default.

Guarded future scope:

- explicit pending-module dry-check with anti-regression comparison;
- user-approved action requests;
- signed/hashed command dossiers;
- phone UI confirmation for device-mutating actions.

The phone app should never silently stage modules, install APKs, reboot, flash,
or switch to `modules_update` as the default source of truth.

## Domain Profiles

Reversa is designed for cross-domain engineering:

| Domain | Focus |
| --- | --- |
| Android | recovery trees, kernels, BoardConfig, fstab, init rc, vendor blobs, device facts |
| Linux | containers, systemd, userspace graphics, compositor stacks, kernel/userland boundaries |
| Windows | services, drivers, PE metadata, registry assumptions, MSBuild/Visual Studio trees |
| Games | modding runtimes, graphics wrappers, Vulkan loader state, compatibility fixes, offline/private co-op stability evidence |
| Cross-platform | C/C++/Rust/Java/Kotlin/Python/JS projects, generated artifacts, build scripts, copied constants |
| Agent workflows | AGENTS/CLAUDE/SKILL files, hooks, permissions, provider routing, memory, gateways, attribution |

## Safety Boundaries

Reversa is not:

- an autonomous unrestricted patcher;
- a flashing/rooting/rebooting/module-install tool;
- a bypass, piracy, malware, or exploit-delivery system;
- proof that a model answer is correct;
- a replacement for human approval on destructive work.

Device-mutating actions, source-mutating actions, reboot/flash/delete flows, and
module install/remove flows stay behind explicit human approval.

## Example Workflows

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

Run local model evals:

```bash
node ./bin/reversa.js agent eval \
  --base-url http://127.0.0.1:8000/v1 \
  --model reversa-coder \
  --out local/evals/reversa-coder
```
