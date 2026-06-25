# Agent And Engine Use

Reversa-Matrix can be used without installing any agent skills. The scanner produces JSON, JSONL, Markdown, HTML, and dashboard files that any agent can read.

---

## Best Current Agent Flow

1. Run `scan` or `compare`.
2. Generate the GUI with `gui`.
3. Give Codex the `agent_handoff/` bundle.
4. Ask it to reason from evidence IDs, file paths, and line references.

Start Codex with:

```text
Read agent_handoff/summary.md first.
Then inspect contradictions.json, patch_candidates.json, commands_to_run.md, known_good_facts.json, risky_assumptions.json, and tree_inventory.json.
Do not scrape dashboard.html when JSON exists.
Do not run destructive commands.
```

---

## Compatible Agents

The output format is plain files, so it works with:

- Codex
- Claude Code
- Cursor
- Gemini CLI
- Windsurf
- Aider
- other agents that can read local files

No engine-specific API key is required by Reversa-Matrix itself.

---

## Optional Original Reversa Installer

The older installer can still create engine entry files and skill folders:

```bash
npx reversa install
```

It can create files such as:

- `AGENTS.md`
- `CLAUDE.md`
- `.agents/skills/`
- `.claude/skills/`
- `.reversa/`

That is compatibility support. The new product center is scanner output plus agent handoff.

---

## Agent Ground Rules

Agents using Reversa-Matrix output should:

- cite evidence IDs
- preserve file/line references
- separate confirmed facts from assumptions
- run only read-only validation commands unless a human explicitly authorizes more
- treat compare candidates as suggestions, not imports
- update notes when new evidence supersedes old evidence
