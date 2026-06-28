import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildAmdUmaProof,
} from '../scripts/capture-amd-uma-proof.js';
import {
  classifyAdvisoryRecordForAmdProof,
  joinAmdProofWithAdvisory,
} from '../scripts/join-amd-proof-with-advisory.js';
import {
  buildSampleAmdProofFixture,
  buildSampleGpuProofFixture,
} from '../scripts/export-gpu-advisory-ui-fixtures.js';

test('AMD proof detects Radeon 890M from Windows probe evidence', () => {
  const proof = amdProofFixture();

  assert.equal(proof.gpu.amd_visible, true);
  assert.equal(proof.gpu.name, 'AMD Radeon(TM) 890M Graphics');
  assert(proof.classifications.includes('AMD_PROOF_WINDOWS_GPU_VISIBLE'));
  assert.equal(proof.source_authority, false);
  assert.equal(proof.safe_for_model_download, false);
});

test('AMD proof confirms 64 GiB UMA when modules and shared memory exist', () => {
  const proof = amdProofFixture();

  assert.equal(proof.memory.system_total_mib, 65536);
  assert.equal(proof.memory.uma_shared_mib, 24380);
  assert.equal(proof.memory.uma_status, 'confirmed');
  assert(proof.classifications.includes('AMD_PROOF_UMA_CONFIRMED'));
});

test('AMD proof classifies DX12 Radeon evidence as DirectML candidate', () => {
  const proof = amdProofFixture();

  assert.equal(proof.classification, 'AMD_PROOF_DIRECTML_CANDIDATE');
  assert.equal(proof.directml.candidate, true);
});

test('AMD proof promotes torch-directml import fixture', () => {
  const proof = amdProofFixture({
    pythonProbe: {
      available: true,
      executable: '/venv/python',
      version: '3.11',
      torch_directml_available: true,
      torch_directml_device: 'privateuseone:0',
      torch_directml_tiny_op_pass: false,
      onnxruntime_available: false,
      onnxruntime_directml_available: false,
      onnxruntime_providers: [],
    },
  });

  assert.equal(proof.classification, 'AMD_PROOF_TORCH_DIRECTML_IMPORT');
  assert(proof.classifications.includes('AMD_PROOF_TORCH_DIRECTML_IMPORT'));
});

test('AMD proof promotes torch-directml tiny op fixture', () => {
  const proof = amdProofFixture({
    pythonProbe: {
      available: true,
      executable: '/venv/python',
      version: '3.11',
      torch_directml_available: true,
      torch_directml_device: 'privateuseone:0',
      torch_directml_tiny_op_pass: true,
      onnxruntime_available: false,
      onnxruntime_directml_available: false,
      onnxruntime_providers: [],
    },
  });

  assert.equal(proof.classification, 'AMD_PROOF_TORCH_DIRECTML_TINY_OP_PASS');
  assert.equal(proof.directml.tiny_op_pass, true);
});

test('AMD proof promotes ONNX Runtime DirectML provider fixture', () => {
  const proof = amdProofFixture({
    pythonProbe: {
      available: true,
      executable: '/venv/python',
      version: '3.11',
      torch_directml_available: false,
      torch_directml_tiny_op_pass: false,
      onnxruntime_available: true,
      onnxruntime_directml_available: true,
      onnxruntime_providers: ['DmlExecutionProvider', 'CPUExecutionProvider'],
    },
  });

  assert.equal(proof.classification, 'AMD_PROOF_ONNXRUNTIME_DIRECTML_IMPORT');
  assert(proof.classifications.includes('AMD_PROOF_ONNXRUNTIME_DIRECTML_IMPORT'));
});

test('AMD advisory join blocks unknown-license model from ready status', () => {
  const joined = classifyAdvisoryRecordForAmdProof(advisoryRecord({
    labels: ['MODEL_LICENSE_UNKNOWN', 'MODEL_WEIGHT_DOWNLOAD_DEFERRED', 'DIRECTML_BACKEND_PRESENT'],
    backend: ['directml'],
    source_license: 'UNKNOWN',
  }), amdProofFixture());

  assert(joined.classifications.includes('AMD_MODEL_LICENSE_BLOCKED'));
  assert(!joined.classifications.includes('AMD_890M_READY_CANDIDATE'));
  assert.equal(joined.safe_for_model_download, false);
});

test('AMD DirectML candidate remains possible, not ready, without tiny op proof', () => {
  const joined = classifyAdvisoryRecordForAmdProof(advisoryRecord({
    labels: ['DIRECTML_BACKEND_PRESENT'],
    backend: ['directml'],
    source_license: 'mit',
  }), amdProofFixture());

  assert(joined.classifications.includes('AMD_DIRECTML_POSSIBLE'));
  assert(!joined.classifications.includes('AMD_890M_READY_CANDIDATE'));
});

test('AMD DirectML tiny op can mark reviewed backend as ready candidate', () => {
  const joined = classifyAdvisoryRecordForAmdProof(advisoryRecord({
    labels: ['DIRECTML_BACKEND_PRESENT'],
    backend: ['directml'],
    source_license: 'mit',
  }), amdProofFixture({
    pythonProbe: {
      available: true,
      executable: '/venv/python',
      version: '3.11',
      torch_directml_available: true,
      torch_directml_device: 'privateuseone:0',
      torch_directml_tiny_op_pass: true,
      onnxruntime_available: false,
      onnxruntime_directml_available: false,
      onnxruntime_providers: [],
    },
  }));

  assert(joined.classifications.includes('AMD_890M_READY_CANDIDATE'));
});

test('AMD advisory join writes generated non-authority outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-amd-fit-'));
  const proofPath = join(root, 'amd-proof.json');
  const datasetPath = join(root, 'advisory.jsonl');
  const out = join(root, 'out');
  await writeFile(proofPath, JSON.stringify(amdProofFixture()), 'utf8');
  await writeFile(datasetPath, JSON.stringify(advisoryRecord({
    labels: ['DIRECTML_BACKEND_PRESENT'],
    backend: ['directml'],
    source_license: 'mit',
  })) + '\n', 'utf8');

  const result = await joinAmdProofWithAdvisory({ proof: proofPath, dataset: datasetPath, out });
  const rows = (await readFile(join(out, 'amd-advisory-local-fit.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);

  assert.equal(result.totalRecords, 1);
  assert.equal(rows[0].source_authority, false);
  assert.equal(rows[0].generated_artifact, true);
  assert(existsSync(join(out, 'amd-advisory-local-fit.tsv')));
  assert(existsSync(join(out, 'amd-advisory-local-fit.md')));
});

test('RTX 5090 proof fixture and AMD proof fixture remain separate lanes', () => {
  const nvidia = buildSampleGpuProofFixture();
  const amd = buildSampleAmdProofFixture();

  assert.equal(nvidia.classification, 'GPU_PROOF_TENSOR_OP_PASS');
  assert.equal(amd.classification, 'AMD_PROOF_DIRECTML_CANDIDATE');
  assert.equal(nvidia.gpu.name, 'NVIDIA GeForce RTX 5090');
  assert.equal(amd.gpu.name, 'AMD Radeon(TM) 890M Graphics');
  assert.equal(Object.hasOwn(nvidia, 'directml'), false);
  assert.equal(Object.hasOwn(amd, 'python') && Object.hasOwn(amd.python, 'torch_cuda_available'), false);
});

function amdProofFixture(overrides = {}) {
  return buildAmdUmaProof({
    timestamp: 'fixture',
    host: 'test-host',
    windowsProbe: windowsProbeFixture(overrides.windowsProbe),
    dxdiagText: overrides.dxdiagText ?? dxdiagFixture(),
    wslProbeText: overrides.wslProbeText ?? wslProbeFixture(),
    pythonProbe: overrides.pythonProbe ?? { available: false },
  });
}

function windowsProbeFixture(overrides = {}) {
  return {
    cpu: {
      Name: 'AMD Ryzen AI 9 HX 370 w/ Radeon 890M',
      NumberOfCores: 12,
      NumberOfLogicalProcessors: 24,
    },
    video: [
      {
        Name: 'NVIDIA GeForce RTX 5090',
        DriverVersion: '32.0.15.9597',
        AdapterRAM: 4293918720,
        PNPDeviceID: 'PCI\\VEN_10DE&DEV_2B85',
      },
      {
        Name: 'AMD Radeon(TM) 890M Graphics',
        DriverVersion: '32.0.31019.2002',
        AdapterRAM: 4293918720,
        PNPDeviceID: 'PCI\\VEN_1002&DEV_150E',
      },
    ],
    computerSystem: {
      TotalPhysicalMemory: 51129462784,
    },
    operatingSystem: {
      Caption: 'Microsoft Windows 11 Home',
      BuildNumber: '26200',
    },
    physicalMemory: [
      { Capacity: 17179869184 },
      { Capacity: 17179869184 },
      { Capacity: 17179869184 },
      { Capacity: 17179869184 },
    ],
    amdDrivers: [
      { DeviceName: 'AMD-Vulkan User Mode Driver' },
      { DeviceName: 'AMD-OpenCL User Mode Driver' },
    ],
    ...overrides,
  };
}

function dxdiagFixture() {
  return `
------------------
System Information
------------------
DirectX Version: DirectX 12

---------------
Display Devices
---------------
Card name: NVIDIA GeForce RTX 5090
Display Memory: 56567 MB
Dedicated Memory: 32187 MB
Shared Memory: 24380 MB
Driver Version: 32.0.15.9597
Hybrid Graphics GPU: Discrete

Card name: AMD Radeon(TM) 890M Graphics
Display Memory: 40590 MB
Dedicated Memory: 16209 MB
Shared Memory: 24380 MB
Driver Version: 32.0.31019.2002
Hybrid Graphics GPU: Integrated
`;
}

function wslProbeFixture() {
  return `
crw-rw-rw- 1 root root 10, 125 Jun 27 00:00 /dev/dxg
/usr/lib/wsl/lib/libd3d12.so
/usr/lib/wsl/lib/libnvidia-ml.so.1
`;
}

function advisoryRecord(overrides = {}) {
  return {
    schema_version: 1,
    record_id: overrides.record_id ?? 'record-1',
    source_kind: overrides.source_kind ?? 'model_card_metadata',
    source_project: overrides.source_project ?? 'huggingface',
    source_path: overrides.source_path ?? 'example/model',
    source_commit: 'fixture',
    source_license: overrides.source_license ?? 'UNKNOWN',
    evidence_text: 'Synthetic advisory row.',
    evidence_hash: 'fixture',
    labels: overrides.labels ?? [],
    backend: overrides.backend ?? [],
    runtime: [],
    risk: [],
    required_proof: [],
    recommended_action: 'Review generated advisory row.',
    confidence: 'medium',
    source_authority: false,
    generated_artifact: true,
    notes: 'fixture',
  };
}
