# Reversa Local 5090 Plan

This is the local runtime target for a Windows/WSL workstation with an NVIDIA
GPU.

## Architecture

```text
Windows / WSL host
|
+-- OpenAI-compatible local model endpoint
|   +-- vLLM primary
|   +-- Ollama fallback
|   +-- llama.cpp fallback
|
+-- Reversa-Agent
|   +-- planner
|   +-- typed tool router
|   +-- evidence memory
|   +-- contradiction detector
|   +-- patch gate
|   +-- run verifier
|
+-- Reversa-Matrix
|   +-- scan profiles
|   +-- report writers
|   +-- GUI dashboard
|   +-- compare mode
|
+-- Project workspaces and evidence snapshots
```

Use vLLM first when the CUDA/PyTorch stack is healthy. Use Ollama for quick
bring-up. Use llama.cpp when server packaging is the blocker.

## Model Ladder

Start with coder models that fit a 32 GB VRAM workstation when quantized:

1. Primary: Qwen3-Coder 30B-class instruct model.
2. Fallback: Qwen2.5-Coder 32B-class instruct model.
3. Second opinion: Devstral or another code-agent tuned model.
4. Fast classifier: 7B to 14B coder model.

Do not start by optimizing for the largest possible model. Reversa gets leverage
from retrieval, typed tools, memory, replay, and policy.

## GPU Sanity

Run these before blaming Reversa:

```bash
nvidia-smi
wsl --status
wsl --update
```

Docker/GPU setups also need current NVIDIA drivers, WSL2 GPU support, Docker
WSL integration, and NVIDIA container runtime wiring.

## vLLM Target

The provided runtime template is:

```bash
cd reversa-runtime
cp runtime.env.example runtime.env
docker compose up
```

Smoke endpoint defaults favor reliable startup over maximum context:

- `REVERSA_VLLM_MAX_MODEL_LEN=8192`
- `REVERSA_VLLM_GPU_MEMORY_UTILIZATION=0.85`
- vLLM eager mode in `reversa-runtime/docker-compose.yml`

First proof model used for endpoint bring-up:

```bash
REVERSA_VLLM_MODEL=Qwen/Qwen2.5-Coder-7B-Instruct \
REVERSA_SERVED_MODEL=reversa-coder \
docker compose -f reversa-runtime/docker-compose.yml up -d
```

Use the 30B-class target only after `/v1/models` and `agent eval` pass on the
7B smoke model.

The expected endpoint is:

```text
http://127.0.0.1:8000/v1
```

Smoke test:

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "reversa-coder",
    "messages": [
      {"role": "system", "content": "You are Reversa local runtime."},
      {"role": "user", "content": "Return JSON only: {\"ok\":true}"}
    ],
    "temperature": 0
  }'
```

## Ollama Fallback

Example shape:

```bash
ollama pull qwen3-coder:30b
ollama run qwen3-coder:30b
node ./bin/reversa.js agent models --base-url http://127.0.0.1:11434/v1
```

Ollama is useful for endpoint smoke tests and fast experiments even when vLLM is
the stronger long-term service.

## First Success Condition

The first success condition is not patching source code.

The first success condition is:

```text
Reversa reads existing RM11/Nebula evidence, detects dual Freedreno ICD risk,
preserves the A1/B0 lane split, refuses forbidden work, and writes a clean
contradiction report without cloud delegation.
```

## 2026-06-27 Local 5090 Proof

Host probe from WSL:

```text
GPU: NVIDIA GeForce RTX 5090
Driver: 595.97
NVIDIA-SMI: 595.58.02
CUDA reported by nvidia-smi: 13.2
VRAM: 32607 MiB total, 28675 MiB free during probe
Temperature: 34 C
Power draw: 62.50 W during probe
Python: /usr/bin/python3, 3.14.4
pip: /home/richtofen/.local/bin/pip3, 26.1.1
nvcc: not detected in WSL PATH during this pass
```

Current local training/eval artifact:

```text
local/agentic-training-pack-2026-06-27-5090/
```

Generated files:

```text
agentic-training-pack.jsonl
agentic-training-summary.md
agentic-training-labels.json
gpu-proof.txt
sha256sums.txt
```

Hashes:

```text
36b0936cc73002e603ae88c6717ad79edf1ed4e06ffc93210d3f56981f98c6bf  agentic-training-pack.jsonl
22a6ddf49864f26a6acf9b9d404cbafec6e64b40ab6e85bd68edd5e38038ba55  agentic-training-summary.md
3a9f2e243f42e1c556c514202c85481ce02c3c41df2bfe81fc38ba77505fbf1b  agentic-training-labels.json
406c31bf7af06500c59c9761048c1ec4b4eae80c591a7af677418008909494c9  gpu-proof.txt
```

Rebuild command:

```bash
node scripts/build-agentic-training-pack.js \
  --manifest docs/upstreams/claude-code-matrix/source-sync.json \
  --out local/agentic-training-pack-2026-06-27-5090
```

This pack is metadata/evidence only. It does not copy third-party source text.
Reference-only and commercial-license lanes can inform classifiers and policy
recognition, but they must not feed copied implementation text into Reversa.

## 2026-06-27 Core Rebuild Result

The deterministic scanner rebuild is the current source of truth:

```text
npm test: 40/40 passing
self-scan profile: agentic_toolchain
self-scan findings: 2210
self-scan contradictions: 0
self-scan patch candidates: 0
self-scan output: /tmp/reversa-self-scan-20260627c
```

Fixed in this pass:

- Generated Reversa scan outputs are skipped unless explicitly scanned.
- Root generated artifacts can be archived with `npm run clean:generated -- --execute`.
- Nebula runtime layer assignments are scoped before contradiction grouping.
- Scanner/profile placeholder vocabulary no longer becomes fake patch work.
- Live source TODO/FIXME/STUB markers still produce patch candidates.

## Next GPU Job

Do not call Reversa "trained" until one of these is true:

1. A local model endpoint is running on the 5090 and passes deterministic Reversa
   eval prompts against held-out evidence.
2. A classifier/embedding job consumes `agentic-training-pack.jsonl`, writes a
   versioned model artifact, and records reproducible metrics.
3. A fine-tune job is launched with a license-clean dataset, held-out eval split,
   exact base model, exact command, output artifact hash, and rollback path.

Preferred next step: build the held-out eval harness first. It is cheaper,
reversible, and tells us whether the GPU model actually improves Reversa instead
of just generating confident noise.

Implemented first lane:

```bash
node ./bin/reversa.js agent eval \
  --base-url http://127.0.0.1:8000/v1 \
  --model Qwen/Qwen3-Coder-30B-A3B-Instruct \
  --evidence-dir local/evidence/nebula \
  --out local/evals/nebula-wayland
```

`agent eval` uses the local 5090-backed OpenAI-compatible endpoint as an
advisory reasoning engine only. It scores bounded JSON answers against fixed
expectations, writes metrics and evidence hashes, and leaves deterministic scan
truth untouched until repeated evals prove value.

Eval prompts now scope optional evidence by case. Command-wizard and policy
guards do not inherit unrelated scan commands, and semantic policy claims such as
`ask_before_destructive` can be accepted from equivalent safe prose while still
recording the raw model output.

Implemented patch-wizard lane:

```bash
node ./bin/reversa.js agent patch-wizard \
  --scan-out /path/to/reversa-scan \
  --candidate <patch_candidate_id> \
  --project-root /path/to/source-tree \
  --out local/patch-wizards/<run-id>
```

This is the professional patch bridge: scan evidence and patch candidates become
reviewable patch dossiers with target hashes, edit groups, verification commands,
rollback notes, and stop conditions. It is still proposal-only. The 5090 model
can later help rank or draft diffs after `agent eval` passes, but deterministic
Reversa evidence remains the source of truth.

When the operator supplies exact `--find-text` and `--replace-text` values,
patch-wizard can also write a review-only `patch.diff`. It records the target
hash first and does not edit source files, so literal fixes are inspectable
before any human-approved apply step.
