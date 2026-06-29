# Claude Code Base Test Drive 2026-06-29

Purpose: verify the rebuilt Reversa Claude/Codex base contract against the
trained source repo, Reversa itself, and BO3-Transformed without mutating those
projects.

Output root:

```text
local/test-drive-2026-06-29-claude-code-base
```

## Training Pack

Command:

```bash
node scripts/build-agentic-training-pack.js \
  --manifest docs/upstreams/claude-code-matrix/source-sync.json \
  --out local/test-drive-2026-06-29-claude-code-base/training-pack
```

Result: pass. The pack validates against
`trained_claude_code_base` and writes metadata/evidence-only outputs.

## Scan Results

| Project | Profile | Findings | Contradictions | Patch candidates | Highest |
| --- | --- | ---: | ---: | ---: | --- |
| `claude-code-matrix` | `claude_code_modern` | 16721 | 0 | 0 | HIGH |
| `claude-code-matrix` | `agentic_gateway` | 20751 | 0 | 0 | HIGH |
| `reversa-fractal-echo` | `claude_code_modern` | 5870 | 0 | 0 | HIGH |
| `reversa-fractal-echo` | `agentic_gateway` | 4315 | 0 | 0 | HIGH |
| `BO3-Transformed` | `pcgamingwiki_runtime` | 7639 | 0 | 2 | HIGH |
| `BO3-Transformed` | `game_exe_patch_runtime` | 8141 | 0 | 2 | HIGH |
| `BO3-Transformed` | `rm11pro_gaming_runtime` | 7784 | 0 | 2 | HIGH |

## BO3 Patch Candidate Notes

The two BO3 patch candidates are review-only placeholder cleanup items:

- `profiles/bo3-vulkan/training/BO3ENHANCED_MENU_CONTRACT.md`
- `profiles/bo3-vulkan/training/bo3enhanced-menu-contract.json`

No contradictions were emitted in the BO3 scans.

## Interpretation

The Claude/Codex base is behaving as intended:

- `claude-code-matrix` remains contradiction-free under both modern workflow
  and provider-gateway profiles.
- Reversa self-scan remains contradiction-free and emits no patch candidates.
- BO3-Transformed runtime profiles still find game research evidence and only
  flag review-only training placeholder cleanup.
