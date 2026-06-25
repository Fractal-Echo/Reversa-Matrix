# Original Reversa Compatibility

Reversa-Matrix keeps parts of the original Reversa project for compatibility.

The old flow installed agent teams into a project and generated `_reversa_sdd/` specifications. That can still be useful, but it is not the center of Reversa-Matrix.

---

## Still Present

Compatibility commands include:

- `install`
- `status`
- `update`
- `uninstall`
- `add-agent`
- `add-engine`
- `diagram`

Compatibility folders may include:

- `.reversa/`
- `.agents/skills/`
- `.claude/skills/`
- `_reversa_sdd/`
- `AGENTS.md`
- `CLAUDE.md`

---

## New Center Of Gravity

Reversa-Matrix is centered on:

- `scan`
- `compare`
- `gui`
- `report.json`
- `evidence.jsonl`
- `agent_handoff/`
- `dashboard.html`
- platform profiles
- known-good facts
- contradictions and patch candidates

---

## Practical Rule

Use the compatibility installer when you specifically want the older agent-team orchestration.

Use scanner/dashboard mode when you want cross-platform source-tree research.
