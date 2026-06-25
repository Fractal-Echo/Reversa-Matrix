# Working From Evidence

Reversa-Matrix does not ask you to build from prose specs first. It asks you to work from evidence.

---

## Read Order

For a scan output directory, start here:

| File | Why |
|---|---|
| `agent_handoff/summary.md` | Human-readable orientation |
| `report.json` | Canonical scan report |
| `evidence.jsonl` | Streamable evidence records |
| `agent_handoff/contradictions.json` | Conflicting claims and likely winners |
| `agent_handoff/patch_candidates.json` | Reviewable fix directions |
| `agent_handoff/risky_assumptions.json` | Weak claims that need more proof |
| `agent_handoff/commands_to_run.md` | Validation commands, usually read-only |

For compare output, read:

| File | Why |
|---|---|
| `compare_report.json` | Canonical compare report |
| `agent_handoff/compare_findings.json` | Classified differences |
| `agent_handoff/safe_import_candidates.json` | Lower-risk manual imports |
| `agent_handoff/risky_import_candidates.json` | Imports needing deeper review |

---

## Before Changing Code

Check:

1. Which evidence IDs support the change?
2. Is the claim confirmed, likely, possible, or weak?
3. Does known-good data disagree?
4. Is the target file generated or hand-edited?
5. Is there a rollback path?
6. Is the validation command read-only?

If the answer is unclear, collect more evidence before editing.

---

## Patch Candidate Discipline

A patch candidate is a map marker. It is not permission to patch.

Good patch work should:

- cite evidence IDs
- update only the intended files
- avoid importing unrelated reference-tree changes
- keep risky actions separated
- rerun the scan or relevant validation after edits

---

## Compare Discipline

Reference trees are evidence, not authority. A reference file can be useful and still wrong for your target.

Before importing anything:

- inspect why the reference differs
- check target-specific known-good facts
- classify generated vs hand-authored files
- prefer minimal source edits over broad copies
- record what evidence changed after the edit
