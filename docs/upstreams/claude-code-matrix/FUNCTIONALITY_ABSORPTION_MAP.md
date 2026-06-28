# Claude Code Matrix Functionality Absorption Map

This note records how Reversa-Matrix should learn from
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

## Capability Lanes

| Lane | Reversa target | Stance |
| --- | --- | --- |
| Provider catalog and registry | `agentic_gateway`, provider evidence | Reimplement detector patterns |
| Model router and gateway IDs | model route provenance | Adapt mechanism with attribution |
| Admin control surface | Reversa Studio panels | UI pattern reference, reimplement |
| Messaging bridge and turn intake | command-plan artifacts | Reimplement as Reversa layer |
| Safe diagnostics and redaction | secret-safe reports | Must reimplement |
| Smoke capabilities | bounded proof manifests | Adapt test taxonomy |
| Process registry/runtime boundary | lifecycle evidence | Reference for boundaries only |
| Voice/transcription lane | optional companion plugin | Defer |

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

