# Reversa Studio 5090 Proof Contract

Reversa Studio can capture local GPU proof and use it to rank advisory
candidates. The proof is evidence, not an authority record, and it does not permit
model acquisition, game launch, runtime launch, binary patching, or phone work.

## Proof Levels

| Level | Meaning |
| --- | --- |
| `GPU_PROOF_UNAVAILABLE` | No Nvidia proof was captured. |
| `GPU_PROOF_NVIDIA_SMI_ONLY` | `nvidia-smi` was present and returned GPU metadata. |
| `GPU_PROOF_CUDA_VISIBLE` | Nvidia metadata reported a CUDA runtime version. |
| `GPU_PROOF_TORCH_CUDA_VISIBLE` | PyTorch was already installed and reported CUDA availability. |
| `GPU_PROOF_TENSOR_OP_PASS` | A tiny CUDA tensor operation completed. |
| `GPU_PROOF_BACKEND_READY_CUDA` | CUDA backend is plausible from tensor proof. |
| `GPU_PROOF_BACKEND_READY_TENSORRT` | TensorRT import is present. |
| `GPU_PROOF_BACKEND_READY_ONNX` | ONNX Runtime import is present. |
| `GPU_PROOF_BACKEND_UNKNOWN` | Backend evidence is missing or incomplete. |

The top-level `classification` records the strongest host proof. Backend-ready
levels are also reported as backend readiness evidence where applicable.

## Evidence Shape

```json
{
  "schema_version": 1,
  "timestamp": "2026-06-27T00:00:00.000Z",
  "host": "workstation",
  "gpu": {
    "nvidia_smi_available": true,
    "name": "NVIDIA GPU",
    "driver_version": "0.0",
    "cuda_version": "0.0",
    "memory_total_mib": 0
  },
  "python": {
    "executable": "/usr/bin/python3",
    "version": "3.x",
    "requested_executable": "local/venvs/reversa-torch-cuda-proof/bin/python",
    "torch_available": true,
    "torch_version": "0.0",
    "torch_cuda_available": true,
    "torch_cuda_version": "0.0",
    "torch_device_name": "NVIDIA GPU",
    "tensor_op_pass": true
  },
  "backends": {
    "onnxruntime": "present",
    "tensorrt": "missing",
    "ncnn": "missing",
    "ffmpeg": "present",
    "vapoursynth": "missing"
  },
  "classification": "GPU_PROOF_TENSOR_OP_PASS",
  "safe_for_model_download": false,
  "source_authority": false,
  "generated_artifact": true,
  "notes": []
}
```

## Rules

- `safe_for_model_download` is always `false` in this pass.
- Generated GPU proof is local evidence.
- Missing PyTorch does not fail the proof capture.
- The `studio gpu-proof` command does not install PyTorch or any backend
  package.
- Reversa does not acquire model artifacts.
- Reversa does not launch games, graphics runtimes, phone tools, or Nebula.
- Tiny tensor proof runs only when PyTorch already reports CUDA availability.

## Controlled Local Venv Proof

A separate operator-controlled proof lane may create an isolated venv under:

```text
local/venvs/reversa-torch-cuda-proof
```

That lane may install official PyTorch CUDA wheels into that venv only, then run
a tiny deterministic tensor operation through:

```bash
node ./bin/reversa.js studio gpu-proof \
  --python local/venvs/reversa-torch-cuda-proof/bin/python \
  --out /path/to/gpu-proof
```

Allowed claim:

```text
Reversa Studio can verify that a local PyTorch CUDA tensor operation works on
the RTX 5090.
```

Disallowed claims:

- models are ready;
- frame generation is active;
- all CUDA models can run;
- runtime pipelines have been tested.

## Advisory Fit

The advisory join reads `gpu-proof.json` and the GPU advisory JSONL dataset,
then writes local fit reports outside the public source tree. Each joined row is
generated evidence with `source_authority=false`.

Possible fit classes include:

- `LOCAL_5090_READY_CANDIDATE`
- `LOCAL_5090_POSSIBLE_BUT_MODEL_DEFERRED`
- `CUDA_BACKEND_POSSIBLE`
- `TORCH_CUDA_MISSING`
- `MODEL_LICENSE_BLOCKED`
- `MODEL_WEIGHT_DOWNLOAD_DEFERRED`
- `BACKEND_UNKNOWN`
- `NOT_GPU_RELEVANT`
- `WINDOWS_ONLY_REVIEW`
- `LINUX_PROTON_UNPROVEN`

Unknown licenses and deferred model artifacts block readiness. A CUDA candidate
is only marked possible when proof shows CUDA visibility or a passing CUDA tensor
operation.

## Backend Matrix Role

The backend readiness matrix consumes `gpu-proof.json` as the CUDA proof input.
`GPU_PROOF_TENSOR_OP_PASS` may promote eligible CUDA rows to
`BACKEND_READY_FOR_CONTROLLED_TEST`, but it does not prove TensorRT, Vulkan NCNN,
model artifact suitability, Linux runtime behavior, or production readiness.
