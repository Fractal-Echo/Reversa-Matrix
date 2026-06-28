#!/usr/bin/env node

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  classifyAdvisoryRecordForLocalGpu,
  summarizeJoinedRecords,
} from './join-gpu-proof-with-advisory.js';

const __filename = fileURLToPath(import.meta.url);

export async function exportGpuAdvisoryUiFixtures(options) {
  const datasetInput = resolve(options.dataset);
  const outDir = resolve(options.out);
  const datasetPaths = resolveDatasetPaths(datasetInput);
  const records = await readJsonl(datasetPaths.advisory);
  const labelSummary = await readTsvOptional(datasetPaths.labelSummary);
  const sourceSummary = await readTsvOptional(datasetPaths.sourceSummary);

  await mkdir(outDir, { recursive: true });

  const modelLibrary = buildModelLibrary(records, labelSummary);
  const project = buildProjectFixture(records, labelSummary, sourceSummary);
  const patchDossier = buildPatchDossier(records);
  const gpuProof = buildSampleGpuProofFixture();
  const localFit = buildSampleLocalFitFixture(records, labelSummary);

  await writeFile(join(outDir, 'sample-model-library.json'), JSON.stringify(modelLibrary, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'sample-project.json'), JSON.stringify(project, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'sample-patch-dossier.json'), JSON.stringify(patchDossier, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'sample-gpu-proof.json'), JSON.stringify(gpuProof, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'sample-local-fit.json'), JSON.stringify(localFit, null, 2) + '\n', 'utf8');

  return {
    outDir,
    records: records.length,
    models: modelLibrary.models.length,
    patchChecks: patchDossier.checklist.length,
    hardBlocks: project.safetyGate.hardBlocks.length,
    localFitRecords: localFit.records.length,
  };
}

export function resolveDatasetPaths(datasetInput) {
  const advisory = datasetInput.endsWith('.jsonl')
    ? datasetInput
    : join(datasetInput, 'gpu-upscale-framegen-advisory.jsonl');
  const baseDir = datasetInput.endsWith('.jsonl') ? dirname(datasetInput) : datasetInput;
  if (!existsSync(advisory)) {
    throw new Error(`Advisory dataset does not exist: ${advisory}`);
  }
  return {
    advisory,
    labelSummary: join(baseDir, 'label-summary.tsv'),
    sourceSummary: join(baseDir, 'source-summary.tsv'),
  };
}

export function buildModelLibrary(records, labelSummary = []) {
  const hfRecords = records
    .filter(record => record.source_project === 'huggingface' && record.source_kind === 'model_card_metadata')
    .slice(0, 18);

  const models = hfRecords.map(record => {
    const licenseUnknown = record.labels.includes('MODEL_LICENSE_UNKNOWN');
    const hashMissing = record.labels.includes('MODEL_HASH_MISSING') || !record.required_proof.includes('model_hash');
    const backend = record.backend.length > 0 ? record.backend : ['unknown'];
    return {
      id: modelIdFromPath(record.source_path),
      source: 'Hugging Face metadata',
      source_authority: false,
      generated_artifact: true,
      license: record.source_license || 'UNKNOWN',
      licenseStatus: licenseUnknown ? 'warning' : 'reviewed',
      hashStatus: hashMissing ? 'required_before_use' : 'metadata_only',
      backend,
      runtime: record.runtime,
      vramEstimate: estimateVram(backend),
      acquisitionStatus: licenseUnknown ? 'deferred_license_review' : 'deferred_hash_review',
      risk: record.risk,
      recommendedAction: sanitizeUiText(record.recommended_action),
      labels: uiSafeLabels(record.labels),
    };
  });

  return {
    schema_version: 1,
    generated_fixture: true,
    source_authority: false,
    title: 'Reversa Studio Sample Model Library',
    summary: {
      totalModels: models.length,
      unknownLicense: models.filter(model => model.licenseStatus === 'warning').length,
      backendFamilies: [...new Set(models.flatMap(model => model.backend))].sort(),
      labelCount: labelSummary.length,
    },
    models,
  };
}

export function buildProjectFixture(records, labelSummary = [], sourceSummary = []) {
  const labelCounts = Object.fromEntries(labelSummary.map(row => [row.label, Number(row.count) || 0]));
  const sourceCounts = sourceSummary.map(row => ({
    source_project: row.source_project,
    source_kind: row.source_kind,
    source_authority: row.source_authority === 'true',
    generated_artifact: row.generated_artifact === 'true',
    count: Number(row.count) || 0,
  }));
  const generatedCount = sourceCounts.filter(row => row.generated_artifact).reduce((sum, row) => sum + row.count, 0);
  const authoritativeCount = sourceCounts.filter(row => row.source_authority).reduce((sum, row) => sum + row.count, 0);
  const unsafePatch = labelCounts.GAME_PATCH_UNSAFE ?? 0;
  const cudaUnverified = labelCounts.CUDA_CLAIM_UNVERIFIED ?? 0;
  const linuxUnknown = (labelCounts.LINUX_RUNTIME_UNKNOWN ?? 0) + (labelCounts.PROTON_COMPATIBLE_CANDIDATE ?? 0);
  const licenseUnknown = labelCounts.MODEL_LICENSE_UNKNOWN ?? 0;

  return {
    schema_version: 1,
    generated_fixture: true,
    source_authority: false,
    activeProject: {
      name: 'GPU Upscale / Framegen Advisory Sample',
      mode: 'planning_only',
      nextSafeAction: 'Review model license and backend proof before preparing any package.',
    },
    cards: [
      card('Active Project', 'Review', 'Planning fixture loaded from advisory dataset.', records.length),
      card('Evidence Health', 'Review', `${authoritativeCount} source-backed rows, ${generatedCount} generated evidence rows.`, records.length),
      card('Known-Good Frontier', 'Safe', 'Generated artifacts stay separated from authoritative evidence.', generatedCount),
      card('Unsafe Actions Blocked', unsafePatch > 0 ? 'Blocked' : 'Safe', 'Patch plans stay proposal-only until proof exists.', unsafePatch),
      card('GPU Readiness', cudaUnverified > 0 ? 'Review' : 'Candidate', 'CUDA/5090 claims require host runtime proof.', cudaUnverified),
      card('Model License Risk', licenseUnknown > 0 ? 'Review' : 'Safe', 'Unknown-license models remain deferred.', licenseUnknown),
      card('Next Safe Action', 'Review', 'Open Safety Gate and resolve missing proof.', 1),
    ],
    evidenceBoard: {
      totalRecords: records.length,
      generatedEvidenceRows: generatedCount,
      sourceAuthorityRows: authoritativeCount,
      topLabels: Object.entries(labelCounts)
        .filter(([label]) => !isModelWeightLabel(label))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, count]) => ({ label, count })),
    },
    backendMatrix: {
      cuda: labelCounts.CUDA_BACKEND_PRESENT ?? 0,
      vulkanNcnn: labelCounts.VULKAN_NCNN_BACKEND_PRESENT ?? 0,
      onnx: labelCounts.ONNX_BACKEND_PRESENT ?? 0,
      tensorrt: labelCounts.TENSORRT_BACKEND_PRESENT ?? 0,
      directml: labelCounts.DIRECTML_BACKEND_PRESENT ?? 0,
      linuxOrProtonUnproven: linuxUnknown,
    },
    safetyGate: {
      hardBlocks: [
        ...conditionalBlock(unsafePatch > 0, 'Patch dossier missing required proof.'),
        ...conditionalBlock(licenseUnknown > 0, 'Unknown-license model metadata cannot be used for package prep.'),
        ...conditionalBlock(cudaUnverified > 0, 'CUDA/5090 acceleration lacks direct host proof.'),
      ],
      softWarnings: [
        ...conditionalBlock(linuxUnknown > 0, 'Linux/Proton compatibility is candidate-only until runtime evidence exists.'),
      ],
      approvalRequired: true,
    },
  };
}

export function buildPatchDossier(records) {
  const patchRecords = records
    .filter(record => record.labels.some(label => label.startsWith('GAME_PATCH') || label.startsWith('EXE_PATCH') || label === 'REVERSIBLE_PATCH_REQUIRED'))
    .slice(0, 18);
  const checklist = [
    'original hash',
    'patched hash',
    'backup path',
    'game version',
    'offset/signature',
    'patch origin',
    'rollback plan',
    'offline/private scope',
  ].map(item => ({
    item,
    status: patchRecords.some(record => record.required_proof.includes(item.replace('/', '_').replace(/\s+/g, '_'))) ? 'required' : 'missing',
  }));

  return {
    schema_version: 1,
    generated_fixture: true,
    source_authority: false,
    status: patchRecords.some(record => record.labels.includes('GAME_PATCH_UNSAFE')) ? 'blocked' : 'review',
    banner: 'Proposal only. Reversa Studio does not patch, inject, launch, or mutate runtime state.',
    checklist,
    dossiers: patchRecords.map(record => ({
      id: record.record_id,
      status: record.labels.includes('GAME_PATCH_UNSAFE') ? 'blocked' : 'review',
      method: record.labels.includes('GAME_PATCH_REVIEW_SAFE') ? 'review-safe dossier' : 'incomplete dossier',
      proofLevel: record.labels.includes('GAME_PATCH_REVIEW_SAFE') ? 'review' : 'blocked',
      source_authority: false,
      generated_artifact: true,
      missingEvidence: record.required_proof,
      recommendedAction: sanitizeUiText(record.recommended_action),
      labels: uiSafeLabels(record.labels),
    })),
  };
}

export function buildSampleGpuProofFixture() {
  return {
    schema_version: 1,
    generated_fixture: true,
    source_authority: false,
    timestamp: 'fixture',
    host: 'sample-host',
    gpu: {
      nvidia_smi_available: true,
      name: 'NVIDIA GeForce RTX 5090',
      driver_version: '595.97',
      cuda_version: '13.2',
      memory_total_mib: 32607,
    },
    python: {
      requested_executable: 'local/venvs/reversa-torch-cuda-proof/bin/python',
      executable: 'local/venvs/reversa-torch-cuda-proof/bin/python',
      version: '3.14.4',
      torch_available: true,
      torch_version: '2.11.0+cu128',
      torch_cuda_available: true,
      torch_cuda_version: '12.8',
      torch_device_name: 'NVIDIA GeForce RTX 5090',
      tensor_op_pass: true,
      torch_cuda_status: 'TORCH_CUDA_TENSOR_OP_PASS',
    },
    backends: {
      onnxruntime: 'unknown',
      tensorrt: 'unknown',
      ncnn: 'unknown',
      ffmpeg: 'unknown',
      vapoursynth: 'unknown',
    },
    backend_classifications: ['GPU_PROOF_BACKEND_READY_CUDA'],
    classification: 'GPU_PROOF_TENSOR_OP_PASS',
    safe_for_model_download: false,
    notes: ['Sample fixture. A tiny PyTorch CUDA tensor op passed; model artifacts and runtime pipelines remain gated.'],
  };
}

export function buildSampleLocalFitFixture(records, labelSummary = []) {
  const proof = buildSampleGpuProofFixture();
  const joined = records.map(record => classifyAdvisoryRecordForLocalGpu(record, proof));
  const summary = summarizeJoinedRecords(joined);
  const labelCounts = Object.fromEntries(labelSummary.map(row => [row.label, Number(row.count) || 0]));
  const licenseBlocked = labelCounts.MODEL_LICENSE_UNKNOWN ?? 0;
  const deferredArtifacts = labelCounts.MODEL_METADATA_ONLY ?? 0;

  return {
    schema_version: 1,
    generated_fixture: true,
    source_authority: false,
    proof_classification: 'GPU_PROOF_TENSOR_OP_PASS',
    summary: {
      totalRecords: records.length,
      readyCandidates: summary.readyCandidates,
      possibleButModelDeferred: summary.possibleButModelDeferred,
      cudaBackendPossible: summary.cudaBackendPossible,
      torchCudaMissing: summary.torchCudaMissing,
      blockedByLicense: licenseBlocked,
      blockedByMissingBackend: summary.blockedByMissingBackend,
      deferredModelArtifacts: deferredArtifacts,
      linuxProtonUnproven: summary.linuxProtonUnproven,
    },
    actions: [
      { label: 'Tensor proof candidate', status: 'candidate', count: summary.readyCandidates },
      { label: 'CUDA possible', status: 'candidate', count: summary.cudaBackendPossible },
      { label: 'License review required', status: 'review', count: licenseBlocked },
      { label: 'Download deferred', status: 'review', count: deferredArtifacts },
      { label: 'Runtime test not run', status: 'blocked', count: records.length },
    ],
    records: records
      .filter(record => (record.labels ?? []).some(label => /CUDA|MODEL_|ONNX|TENSORRT|NCNN/.test(label)))
      .slice(0, 8)
      .map(record => {
        const labels = record.labels ?? [];
        const backend = record.backend ?? [];
        const licenseReview = labels.includes('MODEL_LICENSE_UNKNOWN');
        const cudaCandidate = isCudaRecord(record);
        const deferred = isModelDeferred(record);
        const ready = isTensorProofReadyCandidate(record);
        return {
          id: record.record_id,
          source_project: record.source_project,
          status: licenseReview || deferred ? 'review' : (ready ? 'candidate' : 'review'),
          backend,
          action: licenseReview
            ? 'License review required'
            : (deferred ? 'Download deferred' : (ready ? 'Tensor proof candidate' : (cudaCandidate ? 'CUDA possible' : 'Backend review required'))),
          source_authority: false,
        };
      }),
  };
}

function isCudaRecord(record) {
  const labels = record.labels ?? [];
  const backend = record.backend ?? [];
  return backend.some(item => item === 'cuda' || item === 'pytorch')
    || labels.some(label => /CUDA/.test(label));
}

function isModelDeferred(record) {
  const labels = record.labels ?? [];
  return labels.includes('MODEL_WEIGHT_DOWNLOAD_DEFERRED') || labels.includes('MODEL_METADATA_ONLY');
}

function isLicenseBlocked(record) {
  const labels = record.labels ?? [];
  return labels.includes('MODEL_LICENSE_UNKNOWN')
    || (record.source_kind === 'model_card_metadata' && String(record.source_license ?? '').toUpperCase() === 'UNKNOWN');
}

function isTensorProofReadyCandidate(record) {
  const backend = record.backend ?? [];
  const backendUnknown = backend.length === 0 || backend.includes('unknown');
  return isCudaRecord(record) && !isLicenseBlocked(record) && !isModelDeferred(record) && !backendUnknown;
}

function uiSafeLabels(labels) {
  return labels.filter(label => !isModelWeightLabel(label) && !label.includes('DOWNLOAD'));
}

function isModelWeightLabel(label) {
  return /MODEL_WEIGHT|WEIGHT_DOWNLOAD/i.test(label);
}

function sanitizeUiText(value) {
  return String(value ?? '')
    .replace(/\bpatch source\b/gi, 'patch provenance')
    .replace(/\bsource authority\b/gi, 'authority record')
    .replace(/\bweight\s+download\b/gi, 'artifact acquisition')
    .replace(/\bweights?\b/gi, 'artifacts');
}

function card(title, status, description, count) {
  return { title, status, description, count };
}

function conditionalBlock(condition, text) {
  return condition ? [text] : [];
}

function modelIdFromPath(path) {
  return String(path).replace(/^https:\/\/huggingface\.co\//, '');
}

function estimateVram(backend) {
  if (backend.includes('tensorrt')) return 'high';
  if (backend.includes('cuda') || backend.includes('pytorch')) return 'medium-high';
  if (backend.includes('vulkan_ncnn')) return 'medium';
  if (backend.includes('onnx')) return 'unknown';
  return 'unknown';
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function readTsvOptional(path) {
  if (!existsSync(path)) return [];
  const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function parseArgs(args) {
  const options = { dataset: null, out: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--dataset':
        options.dataset = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown studio fixture export option: ${arg}`);
    }
  }
  if (!options.help && (!options.dataset || !options.out)) {
    throw new Error('Missing required --dataset or --out');
  }
  return options;
}

function requireValue(flag, value) {
  if (!value || String(value).startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/export-gpu-advisory-ui-fixtures.js \\
    --dataset <dataset-dir-or-advisory.jsonl> \\
    --out <reversa-studio/fixtures>

Writes small local Reversa Studio fixtures. No network calls, model downloads,
runtime launches, or mutation actions are performed.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await exportGpuAdvisoryUiFixtures(options);
  console.log(`Fixtures exported: ${result.outDir}`);
  console.log(`Records read: ${result.records}`);
  console.log(`Models: ${result.models}`);
  console.log(`Patch checks: ${result.patchChecks}`);
  console.log(`Hard blocks: ${result.hardBlocks}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
