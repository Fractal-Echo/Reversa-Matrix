# DroidSpaces Dock Lease Proof

Reversa can scan DroidSpaces/Nebula Dock lease schemas, fixtures, and command-plan
reports as authority-bound evidence.

This profile is for the host-only planning layer. It does not approve runtime
mutation, create DRM leases, stage modules, install APKs, run compositors, or
touch a phone.

## Profiles

Use:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/Droidspaces-Nebula \
  --profile droidspaces_dock_lease \
  --out /path/to/reversa-dock-lease
```

Aliases:

- `droidspaces_dock_lease`
- `nebula_dock_schema`
- `dock_command_plan`

## Input

The scanner recognizes:

- `docs/integration/schemas/dock-lease-command.schema.json`
- `docs/integration/schemas/dock-lease-result.schema.json`
- `tests/fixtures/dock-lease/*.json`
- generated Dock command-plan JSON or Markdown reports

## Evidence Extracted

The profile records:

- host-only command-plan proof
- `BLOCKED_NOT_READY` Dock status
- mutation denied by policy
- no start command available
- runtime/app allowlists unmodified
- external-display-only scope
- dynamic discovery requirement
- blocked manual connector, CRTC, plane, fd, shell, internal panel, and whole-card inputs
- `TEST_ONLY`, `SCM_RIGHTS`, stop/revoke, rollback, and crash-gate requirements
- `HOST_ONLY_FIXTURE` markers

## Guard Rule

Positive runtime or mutation flags are treated as a guard violation:

- `execute=true`
- `executed=true`
- `mutation_performed=true`
- `mutation_allowed_by_policy=true`
- `start_command_available=true`
- `runtime_allowlists_modified=true`
- `app_allowlists_modified=true`
- manual connector, CRTC, plane, fd, raw-shell, internal-panel, or whole-card inputs

When these appear, Reversa reports:

```text
Dock lease runtime promotion blocked by host-only proof
```

The likely winner is:

```text
HOST_ONLY_DOCK_SCHEMA_BOUNDARY
```

The profile intentionally emits no patch candidates. The safe next action is to
repair the authority model or fixture, then rerun the scan.

## Runtime Boundary

This profile does not prove an active Dock runtime. Before runtime work, Nebula
still needs bounded proof for:

- receiver smoke
- `TEST_ONLY`
- `SCM_RIGHTS` fd handoff
- stop/revoke
- rollback
- crash-counter behavior
- explicit operator approval
- dynamic external-only DRM object discovery
