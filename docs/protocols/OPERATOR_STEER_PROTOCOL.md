# Operator-Steer Protocol

The operator is not background noise.

Treat operator diagnosis as a priority hypothesis.

Operator steer is not background context. Operator steer is a priority hypothesis.

## Rule

When the operator says "look at X first", the assistant must:

1. Inspect X first.
2. State what artifact proves or disproves X.
3. Avoid broad speculation until X is resolved.
4. Confirm it, disprove it, or mark it unproven.
5. Not reopen it as "maybe" once confirmed without new contradictory evidence.

## Confirmed Hypothesis Lock

If the operator's hypothesis is confirmed by an artifact:

```text
lock it as CONFIRMED
assign an evidence label
do not reopen it as maybe without new contradictory evidence
```

If the assistant disagrees:

```text
provide the exact artifact that disproves the operator claim
quote the relevant line/value
state the alternate diagnosis
do not hand-wave
```

## Forbidden Behavior

```text
broad probing after a blocker is proven
"could be driver/runtime/security" when a checklist says kernel feature missing
treating chat memory as source of truth
searching random paths after the operator gave the correct root
narrating "I'm going to" instead of producing the requested artifact
calling partial training "all data"
reopening confirmed blockers as maybe
```

## Required Response Shape

```text
1. Operator hypothesis:
2. Evidence checked:
3. Result:
4. Classification:
5. Next one action:
```

## Compressed Steering Format

Use this when issuing a precise steer:

```text
STEER_LOCK:

My hypothesis:
<say the thing>

Nearest artifact:
<file/log/check/output>

Expected proof:
<what line/value should confirm it>

Do not broaden into:
<driver/runtime/ABL/training/etc.>

Required output:
<artifact or answer>
```

## Droidspaces Example

```text
STEER_LOCK:

My hypothesis:
Droidspaces is blocked by kernel config, not runtime tuning.

Nearest artifact:
Droidspaces v6.3.0 requirements check.

Expected proof:
PID namespace missing and IPC namespace missing.

Do not broaden into:
graphics, wrapper, driver, ABL, security, runtime tuning.

Required output:
Classify the blocker and list exact kernel CONFIG targets.
```

Correct response:

```text
Confirmed.

Classification:
DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL

Missing:
- PID namespace -> CONFIG_PID_NS
- IPC namespace -> CONFIG_IPC_NS

Recommended:
- devtmpfs -> CONFIG_DEVTMPFS / CONFIG_DEVTMPFS_MOUNT

Next action:
Dump running kernel config and compare those CONFIG values.
```

## Operating Principle

The operator's steer gets first pass.

Artifacts decide.

Confirmed blockers stay locked.
