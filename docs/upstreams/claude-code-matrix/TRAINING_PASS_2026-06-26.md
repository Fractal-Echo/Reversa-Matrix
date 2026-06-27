# Agentic Training Pass 2026-06-26

Goal: make Reversa-Matrix stronger on Claude/Codex-style agent tooling without
copying restricted third-party source text.

## Inputs

- Target repo: `Fractal-Echo/claude-code-matrix`
- Source manifest: `docs/upstreams/claude-code-matrix/source-sync.json`
- Local cache root:
  `/home/richtofen/.android/repositories/tool-repos/claude-code-matrix-upstreams/2026-06-26`
- Profile: `agentic_toolchain`

## GPU Proof

`nvidia-smi` detected:

- GPU: NVIDIA GeForce RTX 5090
- VRAM: 32607 MiB
- CUDA reported by driver: 13.2

The generated training bundle stores the raw probe at:

`/home/richtofen/.android/repositories/tool-repos/claude-code-matrix-upstreams/2026-06-26/training-pack/gpu-proof.txt`

## Commands

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/agentic-toolchain \
  --profile agentic_toolchain \
  --out reversa_agentic_out
```

```bash
node scripts/build-agentic-training-pack.js \
  --manifest docs/upstreams/claude-code-matrix/source-sync.json \
  --out /home/richtofen/.android/repositories/tool-repos/claude-code-matrix-upstreams/2026-06-26/training-pack
```

## Outputs

- `agentic-training-pack.jsonl`
- `agentic-training-summary.md`
- `agentic-training-labels.json`
- `gpu-proof.txt`
- `sha256sums.txt`

## Policy Counts

- Permissive: 4
- Apache/NOTICE required: 1
- Per-folder allowlist only: 1
- Blocked/reference-only: 3

## Boundary

This pass trains Reversa by strengthening profiles, labels, import policy, and
evidence-category weights. It does not fine-tune a neural model and does not
copy third-party source text. Reference-only lanes may inform classifiers but
must not contribute copied source or docs.
