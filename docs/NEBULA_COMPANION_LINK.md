# Nebula Companion Link

Reversa can query Nebula over ADB as a read-only companion. The goal is to make
the host Reversa process the evidence brain while Nebula remains the phone-side
status and control deck.

This first bridge never installs, stages, reboots, launches graphics runtimes, or
writes `/data/adb`.

## Authority Rule

The active module is the default authority:

```text
/data/adb/modules/nebula_core/bin/nebula-core
```

The pending module is not normal authority:

```text
/data/adb/modules_update/nebula_core/bin/nebula-core
```

Pending output may be read only when the operator explicitly requests a guarded
dry-check such as `nebula pending-module` or `nebula compare-modules`.

## Commands

```bash
node ./bin/reversa.js nebula status --adb SERIAL --out out/nebula-status
node ./bin/reversa.js nebula active-module --adb SERIAL --out out/active
node ./bin/reversa.js nebula pending-module --adb SERIAL --out out/pending
node ./bin/reversa.js nebula compare-modules --adb SERIAL --out out/compare
node ./bin/reversa.js nebula frontier --adb SERIAL --out out/frontier
node ./bin/reversa.js nebula propose --from scan-or-log-dir --out out/proposal
```

`--adb SERIAL` is required unless exactly one clear ADB device is connected.

## Read-Only Phone Queries

Active module:

```text
/data/adb/modules/nebula_core/bin/nebula-core status --json
/data/adb/modules/nebula_core/bin/nebula-core display lanes --json
/data/adb/modules/nebula_core/bin/nebula-core display method-profiles --json
/data/adb/modules/nebula_core/bin/nebula-core display method-containers --json
/data/adb/modules/nebula_core/bin/nebula-core integrations baseline --json
/data/adb/modules/nebula_core/bin/nebula-core cooling policy --json
```

Pending module, only by explicit request:

```text
/data/adb/modules_update/nebula_core/bin/nebula-core status --json
/data/adb/modules_update/nebula_core/bin/nebula-core display lanes --json
```

Package and path queries:

```text
pm path io.droidspaces.nebula
pm path io.droidspaces.nebula.waylandie
cmd package list packages -U | grep -E "droidspaces|nebula|waylandie"
```

## Classifications

Active proof:

- `NEBULA_ACTIVE_PROOF_OK`
- `NEBULA_ACTIVE_PROOF_REVIEW_REQUIRED`

Pending module:

- `NEBULA_PENDING_ABSENT`
- `NEBULA_PENDING_MATCHES_ACTIVE`
- `NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT`
- `NEBULA_PENDING_UNKNOWN_REVIEW_REQUIRED`

Frontier:

- `NEBULA_FRONTIER_MATCHES_KNOWN_GOOD`
- `NEBULA_FRONTIER_BELOW_KNOWN_GOOD`

Stage recommendations:

- `NO_STAGE_ACTION`
- `REVIEW_REQUIRED`
- `UNSAFE_TO_STAGE`

## Regression Guard

If active reports:

```text
NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS
NONE_WAYLAND_DISPLAY
vkGetMemoryFdKHR=0
real_buffer_commits=2
```

and pending reports any of:

```text
blocked_export
blocked_real_buffer
NEBULA_R6_EXPORT_A1_VULKAN_LOADER_PIN_CONFIRMED
vkGetMemoryFdKHR=1199
real_buffer_commits=0
```

Reversa classifies the pending module as:

```text
NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT
```

and the stage recommendation becomes:

```text
UNSAFE_TO_STAGE
```

## Forbidden Actions

The companion link rejects command strings for package deployment, device
restart, module mutation, bootloader tooling, raw block writes, enforcement
toggles, destructive deletes, and lease creation. It also does not expose
arbitrary app-side shell execution.

Known-good frontier evidence beats recency. A newer failed lane is not promoted
over older raw proof.
