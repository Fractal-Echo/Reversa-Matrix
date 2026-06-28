import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildBackendReadinessMatrix,
  buildProofSummary,
  classifyBackendReadiness,
} from '../scripts/build-backend-readiness-matrix.js';
import {
  buildBackendMatrixFixture,
  exportBackendMatrixUiFixtures,
} from '../scripts/export-backend-matrix-ui-fixtures.js';

test('backend matrix marks CUDA tiny-op proof as controlled-test ready only', () => {
  const row = classifyBackendReadiness(record({
    record_id: 'cuda-source',
    source_kind: 'source',
    source_license: 'mit',
    labels: ['CUDA_BACKEND_PRESENT'],
    backend: ['cuda'],
  }), proofSummary());

  assert.equal(row.cuda_status, 'BACKEND_TINY_OP_PROVEN');
  assert.equal(row.readiness_level, 'RESEARCH_READY_FOR_CONTROLLED_TEST');
  assert(row.soft_warnings.includes('CONTROLLED_TEST_ONLY_NOT_RECOMMENDATION'));
});

test('backend matrix treats unknown license as redistribution undecided, not a research blocker', () => {
  const row = classifyBackendReadiness(record({
    record_id: 'unknown-license-model',
    source_kind: 'model_card_metadata',
    source_license: 'UNKNOWN',
    labels: ['MODEL_LICENSE_UNKNOWN', 'DIRECTML_BACKEND_PRESENT'],
    backend: ['directml'],
  }), proofSummary());

  assert.equal(row.redistribution_status, 'REDISTRIBUTION_NOT_DECIDED');
  assert.equal(row.readiness_level, 'RESEARCH_READY_FOR_CONTROLLED_TEST');
  assert(row.research_classifications.includes('RESEARCH_READY_FOR_CONTROLLED_TEST'));
  assert(row.soft_warnings.includes('REDISTRIBUTION_NOT_DECIDED'));
});

test('backend matrix keeps metadata-only rows research-only with deferred artifacts', () => {
  const row = classifyBackendReadiness(record({
    record_id: 'metadata-only-model',
    source_kind: 'model_card_metadata',
    source_license: 'mit',
    labels: ['MODEL_METADATA_ONLY', 'DIRECTML_BACKEND_PRESENT'],
    backend: ['directml'],
  }), proofSummary());

  assert.equal(row.artifact_status, 'ARTIFACT_DEFERRED');
  assert(row.research_classifications.includes('RESEARCH_ARTIFACT_DEFERRED'));
  assert.equal(row.readiness_level, 'RESEARCH_READY_FOR_CONTROLLED_TEST');
});

test('backend matrix records missing hash without blocking research classification', () => {
  const row = classifyBackendReadiness(record({
    record_id: 'hash-missing-model',
    source_kind: 'model_card_metadata',
    source_license: 'mit',
    labels: ['MODEL_HASH_MISSING', 'ONNX_BACKEND_PRESENT'],
    backend: ['onnx'],
  }), proofSummary());

  assert.equal(row.hash_status, 'HASH_MISSING');
  assert(row.research_classifications.includes('RESEARCH_HASH_MISSING'));
  assert.equal(row.readiness_level, 'RESEARCH_READY_FOR_CONTROLLED_TEST');
});

test('backend matrix treats Vulkan visible as candidate, not ready', () => {
  const row = classifyBackendReadiness(record({
    record_id: 'vulkan-ncnn-source',
    source_kind: 'source',
    source_license: 'mit',
    labels: ['VULKAN_NCNN_BACKEND_PRESENT'],
    backend: ['vulkan_ncnn'],
  }), proofSummary());

  assert.equal(row.vulkan_ncnn_status, 'BACKEND_CANDIDATE');
  assert.equal(row.readiness_level, 'RESEARCH_BACKEND_CANDIDATE');
});

test('backend matrix blocks TensorRT until TensorRT runtime proof exists', () => {
  const row = classifyBackendReadiness(record({
    record_id: 'tensorrt-source',
    source_kind: 'source',
    source_license: 'mit',
    labels: ['TENSORRT_BACKEND_PRESENT'],
    backend: ['tensorrt'],
  }), proofSummary());

  assert.equal(row.tensorrt_status, 'BACKEND_BLOCKED_RUNTIME');
  assert.equal(row.readiness_level, 'RESEARCH_RUNTIME_UNPROVEN');
});

test('backend matrix builder writes generated matrix artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-backend-matrix-'));
  const datasetPath = join(root, 'advisory.jsonl');
  const cudaProofPath = join(root, 'cuda.json');
  const amdProofPath = join(root, 'amd.json');
  const onnxProofPath = join(root, 'onnx.json');
  const out = join(root, 'out');
  await writeFile(datasetPath, [
    JSON.stringify(record({ record_id: 'cuda', source_kind: 'source', source_license: 'mit', labels: ['CUDA_BACKEND_PRESENT'], backend: ['cuda'] })),
    JSON.stringify(record({ record_id: 'vulkan', source_kind: 'source', source_license: 'mit', labels: ['VULKAN_NCNN_BACKEND_PRESENT'], backend: ['vulkan_ncnn'] })),
    JSON.stringify(record({ record_id: 'blocked', source_kind: 'model_card_metadata', source_license: 'UNKNOWN', labels: ['MODEL_LICENSE_UNKNOWN', 'DIRECTML_BACKEND_PRESENT'], backend: ['directml'] })),
  ].join('\n') + '\n', 'utf8');
  await writeFile(cudaProofPath, JSON.stringify(cudaProof()), 'utf8');
  await writeFile(amdProofPath, JSON.stringify(amdProof()), 'utf8');
  await writeFile(onnxProofPath, JSON.stringify(amdProof()), 'utf8');

  const result = await buildBackendReadinessMatrix({
    dataset: datasetPath,
    cudaProof: cudaProofPath,
    amdProof: amdProofPath,
    onnxDirectmlProof: onnxProofPath,
    out,
  });

  assert.equal(result.summary.totalRecords, 3);
  assert.equal(result.summary.readyForControlledTest, 2);
  assert.equal(result.summary.vulkanNcnnCandidates, 1);
  assert.equal(result.summary.redistributionNotDecided, 1);
  assert.equal(JSON.parse(await readFile(join(out, 'backend-readiness-matrix.json'), 'utf8')).source_authority, false);
  assert.match(await readFile(join(out, 'backend-readiness-matrix.md'), 'utf8'), /Vulkan visibility does not prove Vulkan NCNN runtime readiness/);
});

test('backend matrix UI fixture is generated evidence and display-safe', async () => {
  const matrix = {
    summary: {
      totalRecords: 1,
      readyForControlledTest: 1,
      readyForRecommendation: 0,
      cudaCandidates: 1,
      blockedArtifact: 1,
    },
    proof_summary: proofSummary(),
    records: [
      {
        candidate_id: 'fixture',
        source_project: 'synthetic',
        labels: ['MODEL_WEIGHT_DOWNLOAD_DEFERRED', 'CUDA_BACKEND_PRESENT'],
        backend_candidates: ['cuda'],
        readiness_level: 'RESEARCH_READY_FOR_CONTROLLED_TEST',
        research_classifications: ['RESEARCH_READY_FOR_CONTROLLED_TEST', 'RESEARCH_ARTIFACT_DEFERRED'],
        hard_blocks: [],
        soft_warnings: ['SOURCE_AUTHORITY_REVIEW', 'ARTIFACT_DEFERRED'],
        recommended_next_action: 'Keep model weight download deferred.',
      },
    ],
  };

  const fixture = buildBackendMatrixFixture(matrix);
  const text = JSON.stringify(fixture);
  assert.equal(fixture.source_authority, false);
  assert.equal(fixture.generated_fixture, true);
  assert.doesNotMatch(text, /MODEL_WEIGHT|weight/i);

  const root = await mkdtemp(join(tmpdir(), 'reversa-backend-matrix-fixture-'));
  const matrixPath = join(root, 'matrix.json');
  const out = join(root, 'fixtures');
  await writeFile(matrixPath, JSON.stringify(matrix), 'utf8');
  const result = await exportBackendMatrixUiFixtures({ matrix: matrixPath, out });
  assert.equal(result.totalRecords, 1);
  assert.match(await readFile(join(out, 'sample-backend-matrix.json'), 'utf8'), /Backend Readiness Matrix/);
});

function proofSummary() {
  return buildProofSummary(cudaProof(), amdProof(), amdProof());
}

function cudaProof() {
  return {
    classification: 'GPU_PROOF_TENSOR_OP_PASS',
    gpu: { nvidia_smi_available: true, name: 'NVIDIA GeForce RTX 5090', cuda_version: '13.2' },
    python: { torch_cuda_available: true, tensor_op_pass: true },
    backends: { tensorrt: 'missing' },
  };
}

function amdProof() {
  return {
    classification: 'AMD_PROOF_ONNXRUNTIME_DIRECTML_TINY_OP_PASS',
    gpu: { name: 'AMD Radeon(TM) 890M Graphics' },
    directml: {
      candidate: true,
      torch_directml_available: true,
      torch_directml_tiny_op_pass: true,
      tiny_op_pass: true,
      onnxruntime_directml_available: true,
      onnxruntime_tiny_op_pass: true,
      onnxruntime_directml_tiny_op_pass: true,
    },
    vulkan: { available: true, device_name: 'AMD Vulkan driver component present' },
  };
}

function record(overrides = {}) {
  return {
    schema_version: 1,
    record_id: overrides.record_id ?? 'record-1',
    source_kind: overrides.source_kind ?? 'source',
    source_project: overrides.source_project ?? 'synthetic',
    source_path: overrides.source_path ?? 'fixture',
    source_commit: 'fixture',
    source_license: overrides.source_license ?? 'mit',
    evidence_text: 'Synthetic advisory row.',
    evidence_hash: 'fixture',
    labels: overrides.labels ?? [],
    backend: overrides.backend ?? [],
    runtime: overrides.runtime ?? [],
    risk: [],
    required_proof: overrides.required_proof ?? [],
    recommended_action: 'Review generated advisory row.',
    confidence: 'medium',
    source_authority: overrides.source_authority ?? true,
    generated_artifact: overrides.generated_artifact ?? false,
    notes: 'fixture',
  };
}
