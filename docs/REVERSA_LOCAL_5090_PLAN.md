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
