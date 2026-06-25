# Evidence Pipeline

Reversa-Matrix is built around a scanner pipeline, not a website modernization pipeline.

```text
inventory -> extraction -> normalization -> contradiction pass -> patch candidates -> outputs -> dashboard
```

---

## 1. Inventory

The scanner walks the target tree and records what exists:

- files and directories
- important profile-specific files
- skipped paths
- file sizes
- source paths used later by findings

This becomes `tree_inventory.json` in the handoff bundle.

---

## 2. Extraction

Profile modules extract raw facts from files. For Android recovery, this includes areas such as:

- build variables
- fstab entries
- init rc service paths
- partition/image rules
- vendor blob references
- display and touch assumptions
- decrypt stack assumptions
- suspicious old target leftovers

Future Windows/Linux profiles should add equivalent platform facts, not force everything into Android terms.

---

## 3. Normalization

Raw observations are turned into evidence records with stable fields:

- category
- severity
- confidence
- file and line references
- extracted text
- normalized claim
- related paths, symbols, build vars, or device props

Normalization is what lets agents compare claims across files and runs.

---

## 4. Known-Good Comparison

Known-good JSON stores trusted facts from real testing or accepted references. The scanner compares source claims against those facts and classifies:

- matches
- mismatches
- not-observed facts
- stale assumptions

For Android device work, this catches problems like old board names, wrong SoC values, and partition size mismatches. The same pattern should expand to Windows and Linux facts.

---

## 5. Contradiction Detection

Contradictions are grouped when claims disagree. A contradiction should explain:

- what claims conflict
- where they came from
- which claim appears stronger, if there is enough evidence
- what a safe next step would be

Contradictions are not automatically fixed.

---

## 6. Patch Candidates

Patch candidates are reviewable change ideas. They link back to evidence IDs and include risk, rationale, validation commands, and rollback guidance where available.

They are not automatic patches.

---

## 7. Outputs

The scanner writes machine-readable outputs first:

- `report.json`
- `evidence.jsonl`
- `agent_handoff/*.json`

Readable views come after:

- `summary.md`
- `report.html`
- `dashboard.html`

HTML is always a view over structured data.

---

## 8. Agent Handoff

Codex agents should start with the handoff bundle instead of scraping dashboard HTML:

1. `agent_handoff/summary.md`
2. `agent_handoff/findings.json`
3. `agent_handoff/contradictions.json`
4. `agent_handoff/patch_candidates.json`
5. `agent_handoff/commands_to_run.md`
6. `agent_handoff/known_good_facts.json`
7. `agent_handoff/risky_assumptions.json`
8. `agent_handoff/tree_inventory.json`
