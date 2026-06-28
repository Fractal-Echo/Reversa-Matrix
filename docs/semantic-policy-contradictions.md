# Semantic Policy Contradictions

Use `semantic_policy` when agent instructions, memories, handoffs, hooks, or
project docs may disagree about what an agent is allowed to do.

Use `claude_code_modern` first when the repo is a Claude/Codex workflow tree
with settings scopes, slash commands, subagents, MCP/plugins, skills, generated
transcripts, active-first module rules, or stale-agent cleanup concerns. It
includes semantic policy checks and adds modern Claude/Codex surface categories.

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/repo \
  --profile semantic_policy \
  --out reversa_policy_out
```

## What It Normalizes

Reversa records normalized claims with source file, line, snippet, raw evidence,
subject, predicate, profile, confidence, and evidence kind. The main claim
families are:

- `approval_required` and `approval_bypass`
- `read_only`, `write_allowed`, `write_forbidden`, `source_patch_allowed`, and `source_patch_forbidden`
- `commit_allowed`, `commit_forbidden`, `push_allowed`, and `push_forbidden`
- `device_action_forbidden` and `device_action_allowed`
- `network_forbidden` and `network_allowed`
- `sandbox_required` and `sandbox_bypass`
- `proprietary_reference_only`, `proprietary_copy_forbidden`, and `source_authority`
- `attribution_required` and `attribution_missing`
- `memory_reference_only` and `memory_authoritative`
- `stale_agent` and `active_agent`

## How To Read Results

HIGH contradictions mean two policy claims directly disagree, such as
"read-only" versus "patch away", "ask for approval" versus
`dangerously-skip-permissions`, or "no ADB" versus `adb install`.

MEDIUM contradictions mean the repo has a strong workflow mismatch that usually
needs cleanup before automation, such as stale-agent cleanup notes alongside
retained active-agent notes.

The scanner guards common false positives. Markdown fenced examples, generated
Reversa outputs, MkDocs `site/` output, test fixtures, and code string
assignments are not treated as durable project policy claims.

## Safe Next Step

Fix the policy source that is stale or too broad, then rerun:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/repo \
  --profile semantic_policy \
  --out reversa_policy_out
```

The contradiction should disappear, and no new HIGH semantic policy conflict
should appear.
