# Generated Outputs

Reversa-Matrix writes outputs to the directory passed with `--out`.

The inspected source tree is read-only during scan and compare.

---

## Scan Output

```text
reversa_out/
├── report.json
├── evidence.jsonl
├── summary.md
├── report.html
├── dashboard.html
└── agent_handoff/
    ├── summary.md
    ├── findings.json
    ├── evidence.jsonl
    ├── contradictions.json
    ├── patch_candidates.json
    ├── commands_to_run.md
    ├── questions_for_human.md
    ├── known_good_facts.json
    ├── risky_assumptions.json
    └── tree_inventory.json
```

---

## Compare Output

```text
reversa_compare_out/
├── compare_report.json
├── compare_summary.md
├── compare.html
├── dashboard.html
└── agent_handoff/
    ├── compare_findings.json
    ├── safe_import_candidates.json
    └── risky_import_candidates.json
```

---

## Source Of Truth

Use these for automation:

- `report.json`
- `evidence.jsonl`
- `compare_report.json`
- `agent_handoff/*.json`

Use these for human browsing:

- `summary.md`
- `report.html`
- `compare.html`
- `dashboard.html`

Do not scrape dashboard HTML when JSON exists.

---

## What To Commit

For repeatable research, commit small, intentional output sets when they are part of the investigation:

- known-good JSON
- `summary.md`
- curated `agent_handoff/` files
- notes that explain what scan produced the artifact

For noisy local runs, keep output directories ignored.

Suggested ignore pattern:

```gitignore
reversa_out/
reversa_compare_out/
.reversa/config.user.toml
```

Do not commit secrets, device tokens, private keys, or proprietary blobs unless the repository is explicitly meant to contain them.
