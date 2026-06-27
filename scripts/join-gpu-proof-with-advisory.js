#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export async function joinGpuProofWithAdvisory(options) {
  const proofPath = resolveRequiredPath(options.proof, '--proof');
  const datasetPath = resolveRequiredPath(options.dataset, '--dataset');
  const outDir = resolveRequiredPath(options.out, '--out');
  await mkdir(outDir, { recursive: true });

  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const records = await readJsonl(datasetPath);
  const joined = records.map(record => classifyAdvisoryRecordForLocalGpu(record, proof));
  const summary = summarizeJoinedRecords(joined);

  await writeFile(join(outDir, 'gpu-advisory-local-fit.jsonl'), joined.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  await writeFile(join(outDir, 'gpu-advisory-local-fit.tsv'), renderLocalFitTsv(joined), 'utf8');
  await writeFile(join(outDir, 'gpu-advisory-local-fit.md'), renderLocalFitMarkdown(summary, proof), 'utf8');

  return { outDir, totalRecords: joined.length, summary };
}

export function classifyAdvisoryRecordForLocalGpu(record, proof) {
  const labels = new Set(record.labels ?? []);
  const backends = new Set(record.backend ?? []);
  const classifications = [];
  const gpuRelevant = isGpuRelevant(record);
  const licenseBlocked = labels.has('MODEL_LICENSE_UNKNOWN')
    || (record.source_kind === 'model_card_metadata' && String(record.source_license ?? '').toUpperCase() === 'UNKNOWN');
  const modelDeferred = labels.has('MODEL_WEIGHT_DOWNLOAD_DEFERRED') || labels.has('MODEL_METADATA_ONLY');
  const backendUnknown = backends.size === 0 || backends.has('unknown');
  const cudaCandidate = backends.has('cuda') || backends.has('pytorch') || labels.has('CANDIDATE_CUDA_5090') || labels.has('CUDA_BACKEND_PRESENT');
  const tensorrtCandidate = backends.has('tensorrt') || labels.has('TENSORRT_BACKEND_PRESENT');
  const onnxCandidate = backends.has('onnx') || labels.has('ONNX_BACKEND_PRESENT');
  const ncnnCandidate = backends.has('vulkan_ncnn') || labels.has('VULKAN_NCNN_BACKEND_PRESENT');
  const backendMissing = (tensorrtCandidate && proof?.backends?.tensorrt !== 'present')
    || (onnxCandidate && proof?.backends?.onnxruntime !== 'present')
    || (ncnnCandidate && proof?.backends?.ncnn !== 'present');

  if (!gpuRelevant) classifications.push('NOT_GPU_RELEVANT');
  if (labels.has('WINDOWS_ONLY_RUNTIME')) classifications.push('WINDOWS_ONLY_REVIEW');
  if (labels.has('PROTON_COMPATIBLE_CANDIDATE') || labels.has('LINUX_RUNTIME_UNKNOWN')) classifications.push('LINUX_PROTON_UNPROVEN');
  if (licenseBlocked) classifications.push('MODEL_LICENSE_BLOCKED');
  if (labels.has('MODEL_WEIGHT_DOWNLOAD_DEFERRED')) classifications.push('MODEL_WEIGHT_DOWNLOAD_DEFERRED');
  if ((backendUnknown || backendMissing) && gpuRelevant) classifications.push('BACKEND_UNKNOWN');

  if (cudaCandidate) {
    if (proofSupportsCuda(proof)) {
      classifications.push('CUDA_BACKEND_POSSIBLE');
    } else {
      classifications.push('TORCH_CUDA_MISSING');
    }
  }

  const backendReady = (
    (cudaCandidate && proof?.python?.tensor_op_pass) ||
    (tensorrtCandidate && proof?.backends?.tensorrt === 'present') ||
    (onnxCandidate && proof?.backends?.onnxruntime === 'present') ||
    (ncnnCandidate && proof?.backends?.ncnn === 'present')
  );

  if (gpuRelevant && backendReady && !licenseBlocked && !modelDeferred && !backendUnknown) {
    classifications.push('LOCAL_5090_READY_CANDIDATE');
  } else if (gpuRelevant && proofSupportsCuda(proof) && modelDeferred) {
    classifications.push('LOCAL_5090_POSSIBLE_BUT_MODEL_DEFERRED');
  }

  if (classifications.length === 0) classifications.push(gpuRelevant ? 'BACKEND_UNKNOWN' : 'NOT_GPU_RELEVANT');

  return {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    original_record_id: record.record_id,
    source_project: record.source_project,
    source_kind: record.source_kind,
    backend: [...backends],
    primary_classification: choosePrimaryClassification(classifications),
    classifications: [...new Set(classifications)],
    safe_for_model_download: false,
    recommended_action: recommendLocalFitAction(classifications),
  };
}

export function summarizeJoinedRecords(joined) {
  const counts = {};
  for (const row of joined) {
    for (const classification of row.classifications) {
      counts[classification] = (counts[classification] ?? 0) + 1;
    }
  }
  return {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    totalRecords: joined.length,
    readyCandidates: counts.LOCAL_5090_READY_CANDIDATE ?? 0,
    possibleButModelDeferred: counts.LOCAL_5090_POSSIBLE_BUT_MODEL_DEFERRED ?? 0,
    cudaBackendPossible: counts.CUDA_BACKEND_POSSIBLE ?? 0,
    torchCudaMissing: counts.TORCH_CUDA_MISSING ?? 0,
    blockedByLicense: counts.MODEL_LICENSE_BLOCKED ?? 0,
    blockedByMissingBackend: counts.BACKEND_UNKNOWN ?? 0,
    deferredModelArtifacts: counts.MODEL_WEIGHT_DOWNLOAD_DEFERRED ?? 0,
    linuxProtonUnproven: counts.LINUX_PROTON_UNPROVEN ?? 0,
    windowsOnlyReview: counts.WINDOWS_ONLY_REVIEW ?? 0,
    counts,
  };
}

function isGpuRelevant(record) {
  const labels = record.labels ?? [];
  const backends = record.backend ?? [];
  return backends.some(backend => ['cuda', 'pytorch', 'tensorrt', 'onnx', 'vulkan_ncnn', 'directml'].includes(backend))
    || labels.some(label => /CUDA|TENSORRT|ONNX|NCNN|UPSCALE|FRAMEGEN|MODEL_|VIDEO_INTERPOLATION/.test(label));
}

function proofSupportsCuda(proof) {
  return Boolean(
    proof?.python?.torch_cuda_available ||
    proof?.python?.tensor_op_pass ||
    (proof?.gpu?.nvidia_smi_available && proof?.gpu?.cuda_version && proof.gpu.cuda_version !== 'unknown')
  );
}

function choosePrimaryClassification(classifications) {
  const priority = [
    'MODEL_LICENSE_BLOCKED',
    'MODEL_WEIGHT_DOWNLOAD_DEFERRED',
    'LOCAL_5090_READY_CANDIDATE',
    'LOCAL_5090_POSSIBLE_BUT_MODEL_DEFERRED',
    'CUDA_BACKEND_POSSIBLE',
    'TORCH_CUDA_MISSING',
    'BACKEND_UNKNOWN',
    'LINUX_PROTON_UNPROVEN',
    'WINDOWS_ONLY_REVIEW',
    'NOT_GPU_RELEVANT',
  ];
  return priority.find(item => classifications.includes(item)) ?? classifications[0];
}

function recommendLocalFitAction(classifications) {
  const set = new Set(classifications);
  if (set.has('MODEL_LICENSE_BLOCKED')) return 'Review license metadata before any package planning.';
  if (set.has('MODEL_WEIGHT_DOWNLOAD_DEFERRED')) return 'Keep model artifact acquisition deferred.';
  if (set.has('TORCH_CUDA_MISSING')) return 'Capture CUDA/PyTorch proof before treating this as locally accelerated.';
  if (set.has('BACKEND_UNKNOWN')) return 'Identify backend and required runtime proof.';
  if (set.has('LOCAL_5090_READY_CANDIDATE')) return 'Candidate is ready for planning evidence review only.';
  if (set.has('LOCAL_5090_POSSIBLE_BUT_MODEL_DEFERRED')) return 'Local GPU appears plausible, but model artifacts remain deferred.';
  return 'No local GPU action recommended.';
}

function renderLocalFitTsv(joined) {
  return [
    'record_id\tsource_project\tprimary_classification\tclassifications\tbackend\tsafe_for_model_download',
    ...joined.map(row => [
      row.original_record_id,
      row.source_project,
      row.primary_classification,
      row.classifications.join(','),
      row.backend.join(','),
      row.safe_for_model_download,
    ].join('\t')),
    '',
  ].join('\n');
}

function renderLocalFitMarkdown(summary, proof) {
  return [
    '# GPU Advisory Local Fit',
    '',
    `- Proof classification: ${proof.classification}`,
    `- Total records: ${summary.totalRecords}`,
    `- Ready candidates: ${summary.readyCandidates}`,
    `- Possible but model deferred: ${summary.possibleButModelDeferred}`,
    `- CUDA backend possible: ${summary.cudaBackendPossible}`,
    `- Torch CUDA missing: ${summary.torchCudaMissing}`,
    `- Blocked by license: ${summary.blockedByLicense}`,
    `- Blocked by missing backend: ${summary.blockedByMissingBackend}`,
    `- Deferred model artifacts: ${summary.deferredModelArtifacts}`,
    `- Linux/Proton unproven: ${summary.linuxProtonUnproven}`,
    `- Windows-only review: ${summary.windowsOnlyReview}`,
    '',
    'Generated local fit output is evidence only and does not modify the advisory dataset.',
    '',
  ].join('\n');
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function resolveRequiredPath(path, flag) {
  if (!path) throw new Error(`Missing required ${flag}`);
  return resolve(path);
}

function parseArgs(args) {
  const options = { proof: null, dataset: null, out: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--proof':
        options.proof = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
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
        throw new Error(`Unknown advisory join option: ${arg}`);
    }
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
  node scripts/join-gpu-proof-with-advisory.js \\
    --proof <gpu-proof.json> \\
    --dataset <gpu-upscale-framegen-advisory.jsonl> \\
    --out <dir>

Joins local GPU proof with the advisory dataset and writes generated evidence
outside the source dataset. It does not modify inputs or acquire model artifacts.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await joinGpuProofWithAdvisory(options);
  console.log(`Local fit written: ${result.outDir}`);
  console.log(`Records: ${result.totalRecords}`);
  console.log(`Ready candidates: ${result.summary.readyCandidates}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
