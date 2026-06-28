# Claude Code Matrix Absorption Pass 2026-06-26

Goal: make Reversa-Matrix stronger on Claude/Codex provider-gateway repos while
keeping the import lane license-clean and source-clean.

## Absorbed Into Reversa

- New scanner profile: `agentic_gateway`.
- New evidence categories:
  - `provider_catalog_surface`
  - `model_routing_surface`
  - `protocol_adapter_surface`
  - `client_launcher_surface`
  - `admin_config_surface`
  - `smoke_coverage_surface`
  - `messaging_bridge_surface`
  - `secret_redaction_surface`
- Gateway-specific assignment classification is profile-gated so older scans do
  not change behavior.
- Token accounting fields such as `input_tokens`, `output_tokens`, and
  `token_counter` stay local implementation state instead of credential
  evidence.
- Provider catalog fields such as `credential_env`, `credential_attr`, and
  `static_credential` are treated as per-provider catalog data instead of
  repo-level contradictions.
- Follow-up 2026-06-28: added
  `functionality-absorption-map.json` so Reversa can ingest the
  Claude-code-matrix capability shape as metadata-only training/profile
  evidence.

## Not Copied

Reversa did not vendor the `claude-code-matrix` Python gateway, admin UI,
launchers, provider clients, messaging bridge, smoke harness, or tests. This
pass reimplemented scanner concepts and regression fixtures in Reversa-owned
JavaScript.

## Final Evidence

Final scan command:

```bash
node ./bin/reversa.js scan \
  --project-root /home/richtofen/.android/repositories/tool-repos/claude-code-matrix \
  --profile agentic_gateway \
  --out /home/richtofen/.android/repositories/nebula-assets/reversa-scans/2026-06-26-claude-code-matrix-agentic-gateway-03 \
  --json --jsonl --markdown --agent-handoff
```

Final scan result:

- Findings: 20,936
- Contradictions: 0
- Patch candidates: 2
- Highest severity: HIGH
- Schema validation: passed
- Summary:
  `/home/richtofen/.android/repositories/nebula-assets/reversa-scans/2026-06-26-claude-code-matrix-agentic-gateway-03/summary.md`

The two remaining patch candidates belong to the inspected target repo, not to
Reversa-Matrix:

- `cli/entrypoints.py` unresolved TODO marker
- `docs/AGENTIC_UPSTREAM_GOODIES.md` unresolved TODO marker

## Source Boundary

`Fractal-Echo/claude-code-matrix` is an MIT fork of
`Alishahryar1/free-claude-code` and remains a credited mechanism source. Other
upstreams remain governed by `source-sync.json` and the import stances in
`THIRD_PARTY_NOTICES.md`.
