# First Scan

The normal Reversa-Matrix loop is:

```text
scan a tree
inspect evidence
compare against facts or a reference
generate a dashboard
hand JSON to the next agent
```

---

## 1. Choose A Profile

Profiles tell the scanner which patterns matter most.

```bash
node ./bin/reversa.js scan --profiles
```

Current practical profiles include:

- `android_recovery`
- `orangefox`
- `twrp`
- `android_kernel`
- `gki_kernel`
- `userspace_graphics`
- `linux_container`
- `gamescope`
- `generic_source_tree`

Use `generic_source_tree` when no specialized profile exists yet.

---

## 2. Scan A Tree

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/source/tree \
  --profile generic_source_tree \
  --out reversa_out
```

For Android recovery work with known-good facts:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/device/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

The scanner is read-only against `/path/to/source/tree`.

---

## 3. Open The Dashboard

```bash
node ./bin/reversa.js gui --out reversa_out
```

Open the printed `file://` URL. The dashboard lets you browse findings, contradictions, patch candidates, known-good mismatches, commands, tree inventory, and agent handoff files.

---

## 4. Compare Trees

Use compare mode when you have a current tree and a reference tree:

```bash
node ./bin/reversa.js compare \
  --left /path/to/current/tree \
  --right /path/to/reference/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_compare_out
```

Compare mode classifies differences and import candidates. It does not copy files.

---

## 5. Hand Off To Codex

Give the next agent these files first:

1. `agent_handoff/summary.md`
2. `agent_handoff/findings.json`
3. `agent_handoff/contradictions.json`
4. `agent_handoff/patch_candidates.json`
5. `agent_handoff/commands_to_run.md`
6. `agent_handoff/known_good_facts.json`
7. `agent_handoff/risky_assumptions.json`
8. `agent_handoff/tree_inventory.json`

The dashboard is for humans. The JSON and JSONL files are for agents.
