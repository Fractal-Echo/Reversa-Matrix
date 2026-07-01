# Reversa Rebuild One-Shot Contract

Date: 2026-06-30
Status: binding rebuild protocol

## Purpose

The Reversa rebuild must be handled as an evidence protocol, not a memory performance.

The assistant gets one shot to prove it is reading the current project correctly by matching current artifacts, preserving blockers, and refusing stale-state promotion.

## Pass / Fail Rule

Fail if the assistant:

```text
answers from memory before checking current supplied evidence
calls training complete without coverage proof
reclassifies Droidspaces as app/wrapper/UI when it is a kernel blocker
blurs license boundaries
loses the operator-steer protocol
buries the current stack under old recovery archaeology
promotes stale summaries over current logs
```

Pass only if the assistant:

```text
reads the current source-of-truth first
checks active audit/addendum
checks live training/rebuild status
preserves unknowns
classifies blockers
refuses stale summary promotion
produces repo-usable artifacts
```

## Current Source-Of-Truth Order

Before answering rebuild questions, inspect in this order:

```text
1. local/audits/codex-handwave-audit-20260630/full-stack-addendum.md
2. local/audits/codex-handwave-audit-20260630/failure-log.md
3. docs/protocols/OPERATOR_STEER_PROTOCOL.md
4. docs/REVERSA_TRAINING_OPERATION_2026-06-30.md
5. current repo state
6. current training metrics/logs
```

Do not promote older recovery-heavy summaries above these artifacts.

## Binding Rules

```text
No stale summaries.
No recovery-history takeover.
No "probably done."
No vague blocker hunting.
No pretending unavailable local files were inspected.
No completion claims without coverage proof.
```

## Droidspaces Lock

Classification:

```text
DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL
```

Hard missing:

```text
PID namespace -> CONFIG_PID_NS=y
IPC namespace -> CONFIG_IPC_NS=y
```

Recommended:

```text
devtmpfs -> CONFIG_DEVTMPFS=y
CONFIG_DEVTMPFS_MOUNT=y if appropriate
```

Forbidden reclassification:

```text
not app-side
not wrapper-side
not Nebula profile-side
not random graphics tuning
not ABL/security maybe-language without new contradictory artifact proof
```

## Training Lock

Reversa training is not done until final artifacts prove completion.

Required completion proof:

```text
coverage_complete=true
unique_rows_seen=53631/53631
metrics.json
metrics-live.json
train_log.jsonl
row-coverage.tsv
sha256sums.txt
final adapter hash
checkpoint list
exact command
train/val/test hashes
held-out eval report
adversarial eval report
```

Partial runs, smoke tests, classifier baselines, and sampled packs are not "all-data training."

## Active Lanes

The rebuild must preserve these active lanes:

```text
Reversa-Matrix training/rebuild
Droidspaces kernel blocker protocol
Nebula / wrapper / runtime / profile work
BO3 / game-wrapper lane
Pandemonium / D project setup
future PS1-era JRPG preservation/remaster lane
Hyperon / DAS license-boundary lane
repo / workflow cleanup
audit / failure-log trail
```

Recovery history is support context only:

```text
OrangeFox / TWRP / D2B-D2E matters when relevant,
but it is not the current center.
```

## Hyperon / DAS Boundary

```text
Hyperon: MIT; notices required.
DAS / das-proto / das-toolbox: local-only/reference-only unless license evidence changes.
```

Do not launder license uncertainty into normal redistributable training data.

## Required Rebuild Artifacts

The first useful rebuild output should be artifacts, not a motivational essay:

```text
CURRENT_STATE.md
BLOCKERS.md
TRAINING_STATUS.md
LANE_MAP.md
UNKNOWN_UNTIL_VERIFIED.md
NEXT_ACTIONS.md
```

Each artifact must be evidence-first and must include source paths, hashes, labels, unknowns, and next allowed action where applicable.

## Required Response Shape

```text
1. Operator hypothesis:
2. Evidence checked:
3. Result:
4. Classification:
5. Next one action:
```

## Compact Reminder

```text
operator-aware project memory
evidence-first state tracking
current-stack prioritization
hard blocker preservation
no stale-state resurrection
```
