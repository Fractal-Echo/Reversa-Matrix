# Claude Code Matrix Staging Passes - 2026-06-30

This staging pass separates local concept learning from source copying.

## Policy

- `personal_local`: local concept and pattern learning is allowed for the personal training vault.
- `personal_local` data must not copy, sell, redistribute, commit, or vendor upstream source text.
- Availability on GitHub is not treated as license proof. License evidence, provenance, and source policy still travel with every record.
- Reversa-owned implementation must be written from mechanism understanding, tests, and clean summaries.

## Concept Versus Expression

Reversa may learn the concept, mechanism, category, constraint, failure mode, and test shape from parked local repos. It must not preserve upstream expression as reusable implementation. The clean target is the same idea played with a different hand: independently written Reversa code, different structure where practical, and verification from tests or observable behavior instead of copied source text.

Personal-local concept training stays local until the relevant behavior has been deciphered, reduced to clean notes, and integrated professionally into Reversa-owned code. Resale, redistribution, vendoring, or public release of copied upstream source text is forbidden.

## Passes

| Pass | Profile | Purpose |
| --- | --- | --- |
| `pass-01-permissive-notice-agentic` | `agentic_toolchain` | Reusable agentic/toolchain patterns from permissive or notice-preserved sources. |
| `pass-02-allowlist-agentic` | `agentic_toolchain` | Folder-level allowlist data where repository-level license evidence is mixed or ambiguous. |
| `pass-03-reference-boundary-semantic` | `semantic_policy` | Personal-local concept training for source-boundary, commercial-terms, restored-source, and no-copy risks. |

## Pass 03 Sources

| Source | Class | Boundary |
| --- | --- | --- |
| `ChinaSiro/claude-code-sourcemap` | `personal_local` | Learn provenance and restored-source risk patterns; do not copy source text. |
| `claude-code-best/claude-code` | `personal_local` | Learn concept categories only; cross-check mechanisms against clean Reversa-owned design. |
| `anthropics/claude-code` | `personal_local` | Learn official compatibility surfaces and safety categories; do not vendor implementation or docs. |

The regenerated Pass 03 training pack reports all three sources as `personal_local` with weight `35`.

## Current Retrain Standings

Fresh scans and training packs were regenerated from the current Reversa scanner on 2026-06-30.

| Pass | Policy mix | Sources | Notes |
| --- | --- | --- | --- |
| `pass-01-permissive-notice-agentic` | `permissive`: 4, `notice_required`: 1 | 5 | Main reusable agentic/toolchain signal. |
| `pass-02-allowlist-agentic` | `allowlist`: 1 | 1 | Useful only after folder-level license review. |
| `pass-03-reference-boundary-semantic` | `personal_local`: 3 | 3 | Local concept training only; no copied source text. |

| Source | Class | Findings | Contradictions | Patch candidates |
| --- | --- | --- | --- | --- |
| `shanraisshan/claude-code-best-practice` | `permissive` | 3434 | 0 | 1 |
| `luongnv89/claude-howto` | `permissive` | 8917 | 0 | 17 |
| `anthropics/claude-cookbooks` | `permissive` | 5415 | 5 | 12 |
| `shareAI-lab/learn-claude-code` | `permissive` | 6173 | 0 | 12 |
| `thedotmack/claude-mem` | `notice_required` | 10602 | 5 | 9 |
| `ComposioHQ/awesome-claude-skills` | `allowlist` | 13074 | 0 | 2 |
| `ChinaSiro/claude-code-sourcemap` | `personal_local` | 22095 | 24 | 86 |
| `claude-code-best/claude-code` | `personal_local` | 28880 | 35 | 109 |
| `anthropics/claude-code` | `personal_local` | 5061 | 0 | 4 |

## Functionality Backlog

These lanes should become Reversa-owned functionality only after they have clean implementation and tests.

| Lane | Evidence signal | Next Reversa capability |
| --- | --- | --- |
| MCP/plugin surface | `mcp_plugin_surface`: 23250 | Plugin manifest normalizer, tool-surface diff, and permission-aware plugin audit. |
| Permission policy | `permission_safety_policy`: 7805 | Unified permission lattice across Codex, Claude, scripts, shell commands, and local tools. |
| Memory/context injection | `memory_context_injection`: 7386 | Memory precedence resolver with stale-memory detection and conflict reports. |
| Agent instructions | `agent_instruction_surface`: 6668 | Instruction-source graph that ranks system, developer, repo, user, memory, and generated artifacts. |
| Hook lifecycle | `hook_lifecycle_policy`: 4590 | Hook validator that separates safe formatters from mutation or command-execution risk. |
| Provider routing | `provider_routing_surface`: 3480 | Provider/model registry diff with secret redaction and fallback-route checks. |
| Skills and commands | `agent_skill_contracts`: 2851 | Skill contract parser for inputs, outputs, tool needs, safety gates, and verification commands. |
| Worktree isolation | `worktree_isolation`: 1652 | Repo/worktree hygiene checker for nested repos, generated data, and parked training sources. |
| Source/license boundary | `attribution_license_surface`: 1434 | Concept-versus-expression classifier with explicit resale/redistribution gates. |
| Voice/transcription | `voice_transcription_surface` | Optional local-only voice note and transcription evidence lane with consent, redaction, and retention boundaries. |

Do not promote these lanes into `CLAUDE_CODE_BASE_CAPABILITY_IDS` until the functionality map, tests, and clean Reversa implementation move together.

`voice_and_transcription_lane` is now active as an owned optional scanner lane.
Runtime microphone capture, STT/TTS execution, and companion UI are still future
work and must remain local-only and consent-gated.
