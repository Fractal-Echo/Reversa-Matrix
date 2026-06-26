# Agent And Engine Use

Reversa-Matrix can be used without installing cloud agent skills. The scanner
produces JSON, JSONL, Markdown, HTML, and dashboard files that any agent or local
runtime can read.

---

## Local Reversa-Agent Flow

The preferred durable direction is:

```text
local model endpoint -> Reversa typed tools -> evidence memory -> run report
```

The model is only the reasoning engine. Reversa owns tool permission, memory,
evidence, contradiction detection, and patch gates.

Start with:

```bash
node ./bin/reversa.js agent init-memory
node ./bin/reversa.js agent doctor --no-network
node ./bin/reversa.js agent run \
  --mode scan-only \
  --goal "Inspect supplied evidence and write a contradiction report. Do not patch." \
  --evidence-file /path/to/evidence.md
```

See:

- [Reversa Agent Runtime](REVERSA_AGENT_RUNTIME.md)
- [Reversa Local 5090 Plan](REVERSA_LOCAL_5090_PLAN.md)
- [Reversa Tool Policy](REVERSA_TOOL_POLICY.md)

---

## Handoff Flow

1. Run `scan` or `compare`.
2. Generate the GUI with `gui`.
3. Give a local or external agent the `agent_handoff/` bundle.
4. Ask it to reason from evidence IDs, file paths, and line references.

Start an external agent with:

```text
Read agent_handoff/summary.md first.
Then inspect contradictions.json, patch_candidates.json, commands_to_run.md, known_good_facts.json, risky_assumptions.json, and tree_inventory.json.
Do not scrape dashboard.html when JSON exists.
Do not run destructive commands.
```

---

## Compatible Runtimes

The output format is plain files, so it works with:

- Reversa local agent runs
- vLLM through an OpenAI-compatible endpoint
- Ollama through its OpenAI-compatible endpoint
- llama.cpp or llama-cpp-python servers
- Codex
- Claude Code
- Cursor
- Gemini CLI
- Windsurf
- Aider
- other agents that can read local files

No cloud API key is required by Reversa-Matrix itself.

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

That is compatibility support. The new product center is scanner output, local
agent runs, and structured handoff.

---

## Agent Ground Rules

Agents using Reversa-Matrix output should:

- cite evidence IDs
- preserve file/line references
- separate confirmed facts from assumptions
- run only read-only validation commands unless a human explicitly authorizes more
- treat compare candidates as suggestions, not imports
- update notes when new evidence supersedes old evidence
