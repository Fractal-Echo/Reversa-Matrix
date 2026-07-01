# Claude Code Matrix Functionality Absorption Map

This note records how Reversa-Matrix uses the trained Claude/Codex base from
`Fractal-Echo/claude-code-matrix` without vendoring its Python gateway,
admin UI, provider clients, or messaging implementation.

The tracked source is:

```text
Fractal-Echo/claude-code-matrix
commit=b8dd346f9c3f98abc90a27c0654dc1a48e76b6ba
license=MIT fork target, with separate upstream provenance rules
```

The machine-readable map is:

```text
docs/upstreams/claude-code-matrix/functionality-absorption-map.json
```

## Absorption Rule

Reversa may absorb mechanism shape, tests, profile ideas, and capability
taxonomy. Reversa must not bulk-copy gateway source, decompiled/restored source,
ambiguous-license source, provider clients, admin UI code, or commercial-terms
compatibility code.

The Reversa-owned base contract lives in:

```text
lib/core/claude-code-base.js
```

That contract feeds `claude_code_modern`, the Claude/Codex aliases, training-pack
labels, and the functionality absorption validation gate.

## Capability Lanes

| Lane | Reversa target | Stance |
| --- | --- | --- |
| Provider catalog and registry | `agentic_gateway`, provider evidence | Reimplement detector patterns |
| Model router and gateway IDs | model route provenance | Adapt mechanism with attribution |
| Dual protocol proxy contract | Anthropic Messages / OpenAI Responses adapter evidence | Reimplement contract shape |
| Client launcher and model catalog contract | launcher env and model catalog provenance | Reimplement detector patterns |
| Agent instruction and permission base | `claude_code_modern`, semantic guards | Reimplement as core contract |
| Admin control surface | Reversa Studio panels | UI pattern reference, reimplement |
| Messaging bridge and turn intake | command-plan artifacts | Reimplement as Reversa layer |
| Safe diagnostics and redaction | secret-safe reports | Must reimplement |
| Smoke capabilities | bounded proof manifests | Adapt test taxonomy |
| Process registry/runtime boundary | lifecycle evidence | Reference for boundaries only |
| Voice/transcription lane | `voice_transcription_surface`, optional companion plugin | Owned optional scanner lane |

## Obsolescence Gate

`claude-code-matrix` is not obsolete just because a training pack exists. It only
becomes obsolete when Reversa owns the behavior independently.

Retire or delete the local `claude-code-matrix` source only after all of these
checks pass:

- Every capability in `functionality-absorption-map.json` has a Reversa-owned
  implementation target or an explicit documented rejection.
- Every accepted capability has tests in Reversa, and those tests pass without
  reading `claude-code-matrix` source text.
- The `voice_and_transcription_lane` remains optional and local-only, with
  scanner evidence implemented and any runtime capture/transcription gated by
  explicit consent, redaction, and retention policy.
- Current `claude_code_modern` and `agentic_gateway` scans report no unresolved
  functionality gaps that require returning to the parked source.
- The latest training pack stores only metadata, evidence categories, scan
  summaries, capability labels, hashes, and clean notes.
- No Reversa runtime, CLI, docs, tests, or generated public artifact depends on
  vendored or copied upstream source expression.

Until those checks pass, the parked source remains a local reference/training
vault input. After they pass, `claude-code-matrix` can be treated as obsolete
because Reversa has its own tested implementation and retained clean concepts.

Current voice status: Reversa owns the scanner evidence lane through
`voice_transcription_surface`. Runtime microphone capture, STT/TTS execution,
and companion UI remain future optional work and must stay local-only.

## Current Scan Proof

Quick refresh on 2026-06-28:

```text
agentic_gateway: findings=20751 contradictions=0 patch_candidates=0
claude_code_modern: findings=16721 contradictions=0 patch_candidates=0
```

Output root:

```text
local/current-tests-2026-06-28/claude-code-matrix-absorption-quick
```

Core rebuild on 2026-06-29:

```text
trained_base_contract=trained_claude_code_base
base_profile=claude_code_modern
capability_count=11
source_text_policy=metadata_only_no_third_party_source_text
```
