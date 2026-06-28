# Reversa Studio AMD UMA Proof Contract

Reversa Studio can capture AMD HX 370 / Radeon 890M / UMA evidence as a
separate proof lane from the RTX 5090 CUDA lane. The proof is generated local
evidence with `source_authority=false`; it is not an authority record and it
does not permit model acquisition, game launch, runtime launch, binary patching,
phone work, or Nebula work.

## Proof Levels

| Level | Meaning |
| --- | --- |
| `AMD_PROOF_UNAVAILABLE` | No AMD proof was captured. |
| `AMD_PROOF_WINDOWS_GPU_VISIBLE` | Windows hardware evidence reports an AMD GPU. |
| `AMD_PROOF_DIRECTX12_VISIBLE` | DirectX 12 evidence is visible. |
| `AMD_PROOF_DIRECTML_CANDIDATE` | DirectML is plausible from AMD GPU plus DirectX 12 evidence. |
| `AMD_PROOF_ONNXRUNTIME_DIRECTML_IMPORT` | ONNX Runtime reports `DmlExecutionProvider`. |
| `AMD_PROOF_ONNXRUNTIME_DIRECTML_TINY_OP_PASS` | A tiny ONNX Runtime DirectML operation passed. |
| `AMD_PROOF_TORCH_DIRECTML_IMPORT` | `torch-directml` imports in the selected Python environment. |
| `AMD_PROOF_TORCH_DIRECTML_TINY_OP_PASS` | A tiny `torch-directml` operation passed. |
| `AMD_PROOF_VULKAN_VISIBLE` | Vulkan evidence is visible. |
| `AMD_PROOF_OPENCL_VISIBLE` | OpenCL evidence is visible. |
| `AMD_PROOF_HIP_VISIBLE` | HIP or ROCm evidence is visible. |
| `AMD_PROOF_UMA_CONFIRMED` | 64 GiB physical memory plus shared-memory display evidence confirms UMA-style memory. |

DirectML candidate status is not model-ready status. It only means the host has
the minimum shape for a future DirectML backend proof.

## Evidence Shape

```json
{
  "schema_version": 1,
  "timestamp": "2026-06-27T00:00:00.000Z",
  "host": "workstation",
  "cpu": {
    "name": "AMD Ryzen AI 9 HX 370 w/ Radeon 890M",
    "cores": 12,
    "threads": 24
  },
  "memory": {
    "system_total_mib": 65536,
    "uma_shared_mib": 24380,
    "uma_status": "confirmed"
  },
  "gpu": {
    "amd_visible": true,
    "name": "AMD Radeon(TM) 890M Graphics",
    "driver_version": "32.0.31019.2002",
    "directx12_visible": true,
    "adapter_index": 1
  },
  "directml": {
    "candidate": true,
    "torch_directml_available": false,
    "onnxruntime_directml_available": false,
    "tiny_op_pass": false
  },
  "vulkan": {
    "available": true,
    "device_name": "AMD Vulkan driver component present"
  },
  "opencl": {
    "available": true,
    "device_name": "AMD OpenCL driver component present"
  },
  "rocm_hip": {
    "hip_sdk_present": false,
    "rocminfo_present": false,
    "usable": false
  },
  "classification": "AMD_PROOF_DIRECTML_CANDIDATE",
  "safe_for_model_download": false,
  "source_authority": false,
  "generated_artifact": true,
  "notes": []
}
```

## Rules

- `safe_for_model_download` is always `false` in this pass.
- Generated AMD proof uses `source_authority=false`.
- UMA inferred is not UMA confirmed.
- DirectML candidate is not DirectML runtime proof.
- ONNX Runtime DirectML provider proof is not a full model proof.
- `torch-directml` should use an isolated compatible environment if tested.
- Reversa does not install drivers, launch games, connect to phones, patch
  binaries, or run Nebula from this lane.
- RTX 5090 and Radeon 890M proof files must not overwrite each other.

## CLI

```bash
node ./bin/reversa.js studio amd-proof \
  --out /path/to/amd-proof

node ./bin/reversa.js studio amd-proof \
  --windows-probe /path/to/windows-amd-hardware-probe.json \
  --dxdiag /path/to/dxdiag.txt \
  --wsl-probe /path/to/wsl-amd-visibility-probe.txt \
  --out /path/to/amd-proof
```

Optional Python probing is read-only against an existing interpreter:

```bash
node ./bin/reversa.js studio amd-proof \
  --python /path/to/venv/bin/python \
  --out /path/to/amd-proof
```

The command writes:

- `amd-uma-proof.json`
- `amd-uma-proof.md`
- `backend-probe.tsv`
- `stderr.log`

## Advisory Fit

```bash
node ./bin/reversa.js studio amd-join \
  --proof /path/to/amd-proof/amd-uma-proof.json \
  --dataset /path/to/gpu-upscale-framegen-advisory.jsonl \
  --out /path/to/amd-local-fit
```

Possible AMD fit classes include:

- `AMD_890M_READY_CANDIDATE`
- `AMD_DIRECTML_POSSIBLE`
- `AMD_ONNX_DIRECTML_POSSIBLE`
- `AMD_VULKAN_NCNN_POSSIBLE`
- `AMD_OPENCL_POSSIBLE`
- `AMD_HIP_ROCM_UNKNOWN`
- `AMD_MODEL_LICENSE_BLOCKED`
- `AMD_MODEL_WEIGHT_DEFERRED`
- `AMD_RUNTIME_NOT_READY`
- `AMD_WINDOWS_ONLY_REVIEW`
- `AMD_LINUX_PROTON_UNPROVEN`
- `NOT_AMD_RELEVANT`

Unknown licenses, deferred model artifacts, candidate-only DirectML, and missing
backend runtime evidence block readiness. Linux and Proton remain unproven until
direct runtime evidence exists.
