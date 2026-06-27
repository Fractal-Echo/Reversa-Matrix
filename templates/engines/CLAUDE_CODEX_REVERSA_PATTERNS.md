# Claude/Codex/Reversa Patterns

This template is a Reversa-owned checklist for Claude Code, Codex, and
compatible agent-tooling repos. It is derived from Reversa evidence categories
and source-ingestion policy, not copied third-party source text.

## Instruction Files

- Keep `AGENTS.md` and `CLAUDE.md` aligned when a repo supports both Codex and
  Claude Code.
- Put durable workflow rules in instruction files, not one-off chat memory.
- Make verification commands explicit and reproducible.
- Name destructive operations as human-approved only.

## Permissions And Settings

Prefer a strict baseline:

```json
{
  "allowedTools": ["Read", "Grep", "Glob"],
  "permissions": {
    "defaultMode": "read-only",
    "deny": ["rm", "fastboot flash", "adb reboot"]
  }
}
```

Relax permissions only when the project has local tests and a rollback path.

## Hooks

Map every hook to an event, scope, and allowed side effect before enabling it:

- `PreToolUse`: validate command class, path scope, and destructive intent.
- `PostToolUse`: capture evidence summaries, hashes, and changed-file lists.
- `UserPromptSubmit`: add project facts only when source-backed.
- `Stop`: remind the agent to report verification and residual risk.
- `SessionStart`: load minimal project memory, not entire history dumps.

## Skills

Every skill should have:

- narrow trigger language
- complete `SKILL.md` instructions
- explicit reference-file routing
- no hidden broad context loading
- reusable scripts where they reduce copy/paste

For Reversa, skills should start from `agent_handoff/summary.md`,
`findings.json`, `contradictions.json`, `patch_candidates.json`,
`commands_to_run.md`, `known_good_facts.json`, and `risky_assumptions.json`.

## Memory And Evidence

Memory must be auditable:

- store stable facts separately from guesses
- preserve source file, command, timestamp, and hash where possible
- keep raw evidence in JSON/JSONL before summaries
- replay from evidence instead of trusting repeated claims
- mark device, repo, branch, and runtime context explicitly

Recommended Reversa paths:

```text
.reversa/memory/
.reversa/runs/
.reversa/context/
agent_handoff/
evidence.jsonl
```

## Provider Routing

For Claude/Codex proxy repos, document:

- client protocol: Anthropic Messages, OpenAI Responses, or OpenAI Chat
- auth-token source and precedence
- model routing variables
- local proxy URL and bind scope
- provider fallback order
- environment variables stripped from child processes

Never log raw API keys or bearer tokens.

## Subagents And Worktrees

Parallel agents need ownership:

- assign disjoint files or responsibilities
- write handoff files before merging conclusions
- do not let one agent revert another agent's work
- use worktrees for risky or long-running branches
- close completed agents after their output is integrated

## Import And Attribution

Classify every upstream before copying anything:

- `permissive`: MIT or compatible; keep URL, commit, and license notice
- `notice_required`: Apache-2.0 or similar; preserve NOTICE when copying
- `allowlist`: use only folders with explicit compatible license evidence
- `blocked`: reference-only; no code or docs copied
- `unknown`: manual license review required

Sourcemap-restored, decompiled, no-license, custom-commercial-terms, or
all-rights-reserved material is classifier/reference input only.

## Reversa Validation

Use the agentic profile:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/agent/tooling/repo \
  --profile agentic_toolchain \
  --out reversa_agentic_out
```

Then inspect:

```text
summary.md
agent_handoff/findings.json
agent_handoff/contradictions.json
agent_handoff/patch_candidates.json
agent_handoff/commands_to_run.md
agent_handoff/risky_assumptions.json
```

