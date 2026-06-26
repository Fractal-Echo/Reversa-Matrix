# Reversa Agent Runtime

Reversa-Agent is the local runner direction for Reversa-Matrix.

The rule is:

```text
The model is not the agent. Reversa is the agent.
```

The local model provides reasoning. Reversa owns tool policy, evidence memory,
typed tools, run records, contradiction reports, and patch gates.

## Current CLI

```bash
node ./bin/reversa.js agent doctor --no-network
node ./bin/reversa.js agent init-memory
node ./bin/reversa.js agent models --base-url http://127.0.0.1:8000/v1
node ./bin/reversa.js agent run \
  --mode phone-safe \
  --goal "Inspect supplied Nebula evidence for Vulkan loader contradictions. Do not patch." \
  --evidence-file /path/to/PHONE_REVERSA_CONFLICT_SCAN.md
```

This first scaffold does not need a model endpoint for `run`. It reads supplied
evidence files, writes an auditable run folder, detects the first bounded
Nebula/Vulkan contradictions, and refuses patch-apply modes.

## Run Folder

Each run writes:

```text
.reversa/runs/<run-id>/
+-- prompt.md
+-- plan.md
+-- tool_calls.jsonl
+-- evidence.jsonl
+-- contradictions.yaml
+-- PHONE_REVERSA_AGENT_REPORT.md
+-- stdout/
+-- stderr/
+-- artifacts/
    +-- policy.json
```

The run folder is the audit record. A later daemon can replay it without
depending on chat history.

## Modes

| Mode | Purpose | Mutation |
| --- | --- | --- |
| `scan-only` | Read files and write reports | No patches, no device writes |
| `phone-safe` | Read files plus future read-only ADB tools | No patches, no device writes |
| `patch-propose` | Produce a patch proposal artifact | Does not apply patches |
| `patch-apply` | Future explicit apply mode | Disabled in the scaffold |
| `recovery-danger` | Future recovery/partition mode | Disabled in the scaffold |

`patch-apply` and `recovery-danger` are intentionally blocked until policy,
fixtures, and replay verification exist.

## Agent Loop

The loop is deliberately narrow:

1. Observe.
2. Load memory.
3. Read bounded evidence inputs.
4. Extract normalized observations.
5. Detect contradictions.
6. Write reports.
7. Allow patch proposal only when evidence gates pass.

No raw shell tool is exposed. Shell is split into typed tools such as
`git_diff`, `reversa_scan_profile`, `adb_getprop`, `adb_ls`, and `adb_cat`.

## First Useful Nebula Checks

The scaffold already recognizes these evidence surfaces:

- `VK_ICD_FILENAMES`
- `VK_DRIVER_FILES`
- `LD_LIBRARY_PATH`
- `GAMESCOPE_LIBPATH`
- `CHILD_LIBPATH`
- `BRIDGE_LIBPATH`
- `freedreno_icd.json`
- `libvulkan_freedreno.so`
- Qualcomm/Adreno UMD leakage
- 39-bit runtime limits
- `glxinfo -B`
- `vulkaninfo`

The first contradiction checks are:

- local and system Freedreno ICD candidates present together;
- A1 goals mixed with Qualcomm/Adreno UMD evidence;
- 39-bit runtime evidence missing from memory.

That is enough to start replacing cloud delegation for repetitive RM11
evidence triage.
