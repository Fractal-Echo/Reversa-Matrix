import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildGpuProof,
  classifyGpuProof,
  parseCudaVersionFromNvidiaSmi,
  parseNvidiaSmiCsv,
} from '../scripts/capture-local-gpu-proof.js';
import {
  classifyAdvisoryRecordForLocalGpu,
  joinGpuProofWithAdvisory,
} from '../scripts/join-gpu-proof-with-advisory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('GPU proof classifies nvidia-smi unavailable as unavailable', () => {
  const proof = proofFixture({ nvidiaSmi: { available: false } });

  assert.equal(proof.classification, 'GPU_PROOF_UNAVAILABLE');
  assert.equal(classifyGpuProof(proof), 'GPU_PROOF_UNAVAILABLE');
  assert.equal(proof.safe_for_model_download, false);
});

test('GPU proof parses nvidia-smi CUDA version from table output', () => {
  const cudaVersion = parseCudaVersionFromNvidiaSmi('NVIDIA-SMI 595.58.02 Driver Version: 595.97 CUDA Version: 13.2');
  const parsed = parseNvidiaSmiCsv('NVIDIA GeForce RTX 5090, 595.97, 32607', cudaVersion);

  assert.equal(cudaVersion, '13.2');
  assert.equal(parsed.name, 'NVIDIA GeForce RTX 5090');
  assert.equal(parsed.driver_version, '595.97');
  assert.equal(parsed.cuda_version, '13.2');
  assert.equal(parsed.memory_total_mib, 32607);
});

test('GPU proof classifies nvidia-smi CUDA metadata without torch as CUDA visible', () => {
  const proof = proofFixture({
    nvidiaSmi: {
      available: true,
      name: 'NVIDIA GeForce RTX 5090',
      driver_version: '580.00',
      cuda_version: '13.0',
      memory_total_mib: 32768,
    },
  });

  assert.equal(proof.classification, 'GPU_PROOF_CUDA_VISIBLE');
  assert.equal(proof.python.torch_cuda_status, 'TORCH_MISSING');
});

test('GPU proof records TORCH_CUDA_MISSING when torch is installed without CUDA', () => {
  const proof = proofFixture({
    nvidiaSmi: { available: true, name: 'NVIDIA GPU', driver_version: '580.00', cuda_version: '13.0', memory_total_mib: 32768 },
    pythonProbe: {
      executable: '/usr/bin/python3',
      version: '3.12',
      torch_available: true,
      torch_version: '2.8.0',
      torch_cuda_available: false,
      torch_cuda_version: 'unknown',
      torch_device_name: 'unknown',
      tensor_op_pass: false,
    },
  });

  assert.equal(proof.python.torch_cuda_status, 'TORCH_CUDA_MISSING');
  assert(proof.notes.includes('TORCH_CUDA_MISSING'));
});

test('GPU proof records selected Python command separately from sys executable', () => {
  const proof = proofFixture({
    pythonProbe: {
      requested_executable: '/opt/reversa/bin/python',
      executable: '/opt/reversa/bin/python3.12',
      version: '3.12',
      torch_available: false,
      torch_version: 'unknown',
      torch_cuda_available: false,
      torch_cuda_version: 'unknown',
      torch_device_name: 'unknown',
      tensor_op_pass: false,
    },
  });

  assert.equal(proof.python.requested_executable, '/opt/reversa/bin/python');
  assert.equal(proof.python.executable, '/opt/reversa/bin/python3.12');
});

test('GPU proof classifies torch CUDA tensor op pass as tensor proof', () => {
  const proof = proofFixture({
    nvidiaSmi: { available: true, name: 'NVIDIA GeForce RTX 5090', driver_version: '580.00', cuda_version: '13.0', memory_total_mib: 32768 },
    pythonProbe: {
      executable: '/usr/bin/python3',
      version: '3.12',
      torch_available: true,
      torch_version: '2.8.0',
      torch_cuda_available: true,
      torch_cuda_version: '13.0',
      torch_device_name: 'NVIDIA GeForce RTX 5090',
      tensor_op_pass: true,
    },
    backendProbe: { onnxruntime: 'present', tensorrt: 'present', ncnn: 'missing', ffmpeg: 'present', vapoursynth: 'missing' },
  });

  assert.equal(proof.classification, 'GPU_PROOF_TENSOR_OP_PASS');
  assert(proof.backend_classifications.includes('GPU_PROOF_BACKEND_READY_CUDA'));
  assert(proof.backend_classifications.includes('GPU_PROOF_BACKEND_READY_TENSORRT'));
  assert(proof.backend_classifications.includes('GPU_PROOF_BACKEND_READY_ONNX'));
});

test('advisory join does not mark unknown-license model ready', () => {
  const proof = tensorProof();
  const joined = classifyAdvisoryRecordForLocalGpu(advisoryRecord({
    labels: ['MODEL_LICENSE_UNKNOWN', 'MODEL_WEIGHT_DOWNLOAD_DEFERRED', 'CUDA_BACKEND_PRESENT'],
    backend: ['cuda', 'pytorch'],
    source_license: 'UNKNOWN',
  }), proof);

  assert.equal(joined.source_authority, false);
  assert.equal(joined.safe_for_model_download, false);
  assert(joined.classifications.includes('MODEL_LICENSE_BLOCKED'));
  assert(!joined.classifications.includes('LOCAL_5090_READY_CANDIDATE'));
});

test('advisory join marks CUDA possible only when proof supports CUDA', () => {
  const record = advisoryRecord({
    labels: ['CUDA_BACKEND_PRESENT'],
    backend: ['cuda'],
    source_license: 'mit',
  });

  const withoutCuda = classifyAdvisoryRecordForLocalGpu(record, proofFixture({ nvidiaSmi: { available: false } }));
  const withCuda = classifyAdvisoryRecordForLocalGpu(record, tensorProof());

  assert(withoutCuda.classifications.includes('TORCH_CUDA_MISSING'));
  assert(!withoutCuda.classifications.includes('CUDA_BACKEND_POSSIBLE'));
  assert(withCuda.classifications.includes('CUDA_BACKEND_POSSIBLE'));
});

test('advisory join keeps Vulkan NCNN rows GPU-relevant when backend proof is missing', () => {
  const joined = classifyAdvisoryRecordForLocalGpu(advisoryRecord({
    labels: ['CANDIDATE_VULKAN_NCNN', 'VULKAN_NCNN_BACKEND_PRESENT'],
    backend: ['vulkan_ncnn'],
    source_license: 'mit',
  }), proofFixture({ nvidiaSmi: { available: false } }));

  assert(joined.classifications.includes('BACKEND_UNKNOWN'));
  assert(!joined.classifications.includes('NOT_GPU_RELEVANT'));
});

test('advisory join writes generated non-authority outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-local-fit-'));
  const proofPath = join(root, 'gpu-proof.json');
  const datasetPath = join(root, 'advisory.jsonl');
  const out = join(root, 'out');
  await writeFile(proofPath, JSON.stringify(tensorProof()), 'utf8');
  await writeFile(datasetPath, JSON.stringify(advisoryRecord({
    labels: ['CUDA_BACKEND_PRESENT'],
    backend: ['cuda'],
    source_license: 'mit',
  })) + '\n', 'utf8');

  const result = await joinGpuProofWithAdvisory({ proof: proofPath, dataset: datasetPath, out });
  const rows = (await readFile(join(out, 'gpu-advisory-local-fit.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);

  assert.equal(result.totalRecords, 1);
  assert.equal(rows[0].source_authority, false);
  assert.equal(rows[0].generated_artifact, true);
  assert(existsSync(join(out, 'gpu-advisory-local-fit.tsv')));
  assert(existsSync(join(out, 'gpu-advisory-local-fit.md')));
});

test('committed Studio GPU fixtures avoid model weight text and remote model file URLs', async () => {
  const fixtureDir = join(repoRoot, 'reversa-studio', 'fixtures');
  if (!existsSync(fixtureDir)) return;
  const names = (await readdir(fixtureDir)).filter(name => name.endsWith('.json'));
  const text = (await Promise.all(names.map(name => readFile(join(fixtureDir, name), 'utf8')))).join('\n');

  assert.doesNotMatch(text, /MODEL_WEIGHT|weight/i);
  assert.doesNotMatch(text, /https?:\/\/\S+\.(safetensors|pth|onnx|bin|pt)/i);
});

test('GPU proof scripts do not contain installer or network acquisition commands', async () => {
  const scripts = [
    join(repoRoot, 'scripts', 'capture-local-gpu-proof.js'),
    join(repoRoot, 'scripts', 'join-gpu-proof-with-advisory.js'),
    join(repoRoot, 'scripts', 'capture-amd-uma-proof.js'),
    join(repoRoot, 'scripts', 'join-amd-proof-with-advisory.js'),
  ];
  const text = (await Promise.all(scripts.map(file => readFile(file, 'utf8')))).join('\n');

  assert.doesNotMatch(text, /\b(?:pip|npm|apt|winget|choco)\s+install\b/i);
  assert.doesNotMatch(text, /\b(?:curl|wget|aria2c)\b/i);
  assert.doesNotMatch(text, /\bhf\s+download\b|\bhuggingface-cli\b/i);
  assert.doesNotMatch(text, /\bgit\s+clone\b/i);
});

function proofFixture(overrides = {}) {
  return buildGpuProof({
    timestamp: 'fixture',
    host: 'test-host',
    nvidiaSmi: overrides.nvidiaSmi ?? { available: false },
    pythonProbe: overrides.pythonProbe ?? {
      executable: 'unknown',
      version: 'unknown',
      torch_available: false,
      torch_version: 'unknown',
      torch_cuda_available: false,
      torch_cuda_version: 'unknown',
      torch_device_name: 'unknown',
      tensor_op_pass: false,
    },
    backendProbe: overrides.backendProbe ?? {
      onnxruntime: 'missing',
      tensorrt: 'missing',
      ncnn: 'missing',
      ffmpeg: 'missing',
      vapoursynth: 'missing',
    },
  });
}

function tensorProof() {
  return proofFixture({
    nvidiaSmi: { available: true, name: 'NVIDIA GeForce RTX 5090', driver_version: '580.00', cuda_version: '13.0', memory_total_mib: 32768 },
    pythonProbe: {
      executable: '/usr/bin/python3',
      version: '3.12',
      torch_available: true,
      torch_version: '2.8.0',
      torch_cuda_available: true,
      torch_cuda_version: '13.0',
      torch_device_name: 'NVIDIA GeForce RTX 5090',
      tensor_op_pass: true,
    },
    backendProbe: {
      onnxruntime: 'present',
      tensorrt: 'missing',
      ncnn: 'missing',
      ffmpeg: 'present',
      vapoursynth: 'missing',
    },
  });
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
