#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export async function joinAmdProofWithAdvisory(options) {
  const proofPath = resolveRequiredPath(options.proof, '--proof');
  const datasetPath = resolveRequiredPath(options.dataset, '--dataset');
  const outDir = resolveRequiredPath(options.out, '--out');
  await mkdir(outDir, { recursive: true });

  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const records = await readJsonl(datasetPath);
  const joined = records.map(record => classifyAdvisoryRecordForAmdProof(record, proof));
  const summary = summarizeAmdJoinedRecords(joined);

  await writeFile(join(outDir, 'amd-advisory-local-fit.jsonl'), joined.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  await writeFile(join(outDir, 'amd-advisory-local-fit.tsv'), renderAmdFitTsv(joined), 'utf8');
  await writeFile(join(outDir, 'amd-advisory-local-fit.md'), renderAmdFitMarkdown(summary, proof), 'utf8');

  return { outDir, totalRecords: joined.length, summary };
}

export function classifyAdvisoryRecordForAmdProof(record, proof) {
  const labels = new Set(record.labels ?? []);
  const backends = new Set(record.backend ?? []);
  const classifications = [];
  const amdRelevant = isAmdRelevant(record);
  const redistributionUndecided = labels.has('MODEL_LICENSE_UNKNOWN')
    || (record.source_kind === 'model_card_metadata' && String(record.source_license ?? '').toUpperCase() === 'UNKNOWN');
  const modelDeferred = labels.has('MODEL_WEIGHT_DOWNLOAD_DEFERRED') || labels.has('MODEL_METADATA_ONLY');
  const backendUnknown = backends.size === 0 || backends.has('unknown');
  const directmlCandidate = backends.has('directml') || labels.has('DIRECTML_BACKEND_PRESENT');
  const onnxCandidate = backends.has('onnx') || labels.has('ONNX_BACKEND_PRESENT');
  const vulkanCandidate = backends.has('vulkan_ncnn') || labels.has('VULKAN_NCNN_BACKEND_PRESENT') || labels.has('CANDIDATE_VULKAN_NCNN');
  const openclCandidate = backends.has('opencl') || labels.has('OPENCL_BACKEND_PRESENT');
  const hipCandidate = backends.has('hip') || labels.has('HIP_BACKEND_PRESENT') || labels.has('ROCM_BACKEND_PRESENT');
  const onnxDirectmlTinyOp = Boolean(proof?.directml?.onnxruntime_tiny_op_pass || proof?.directml?.onnxruntime_directml_tiny_op_pass);
  const directmlTinyOp = Boolean(proof?.directml?.tiny_op_pass);

  if (!amdRelevant) classifications.push('NOT_AMD_RELEVANT');
  if (labels.has('WINDOWS_ONLY_RUNTIME')) classifications.push('AMD_WINDOWS_ONLY_REVIEW');
  if (labels.has('PROTON_COMPATIBLE_CANDIDATE') || labels.has('LINUX_RUNTIME_UNKNOWN')) classifications.push('AMD_LINUX_PROTON_UNPROVEN');
  if (redistributionUndecided) classifications.push('AMD_REDISTRIBUTION_UNDECIDED');
  if (labels.has('MODEL_PROVENANCE_MISSING')) classifications.push('AMD_PROVENANCE_UNKNOWN');
  if (modelDeferred) classifications.push('AMD_RESEARCH_ARTIFACT_DEFERRED');
  if (labels.has('MODEL_HASH_MISSING')) classifications.push('AMD_RESEARCH_HASH_MISSING');

  if (directmlCandidate && proof?.directml?.candidate) classifications.push('AMD_DIRECTML_POSSIBLE');
  if (onnxCandidate && onnxDirectmlTinyOp) classifications.push('AMD_ONNX_DIRECTML_POSSIBLE');
  if (vulkanCandidate && proof?.vulkan?.available) classifications.push('AMD_VULKAN_NCNN_POSSIBLE');
  if (openclCandidate && proof?.opencl?.available) classifications.push('AMD_OPENCL_POSSIBLE');
  if (hipCandidate && !proof?.rocm_hip?.usable) classifications.push('AMD_HIP_ROCM_UNKNOWN');

  const backendPossible = classifications.some(item => [
    'AMD_DIRECTML_POSSIBLE',
    'AMD_ONNX_DIRECTML_POSSIBLE',
    'AMD_VULKAN_NCNN_POSSIBLE',
    'AMD_OPENCL_POSSIBLE',
  ].includes(item));

  if (amdRelevant && (!backendPossible || backendUnknown)) classifications.push('AMD_RUNTIME_NOT_READY');

  if (
    amdRelevant
    && ((directmlCandidate && directmlTinyOp) || (onnxCandidate && onnxDirectmlTinyOp))
    && !labels.has('MODEL_PROVENANCE_MISSING')
    && !backendUnknown
    && (directmlCandidate || onnxCandidate)
  ) {
    classifications.push('AMD_890M_READY_CANDIDATE');
  }

  if (classifications.length === 0) classifications.push(amdRelevant ? 'AMD_RUNTIME_NOT_READY' : 'NOT_AMD_RELEVANT');

  return {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    original_record_id: record.record_id,
    source_project: record.source_project,
    source_kind: record.source_kind,
    backend: [...backends],
    primary_classification: chooseAmdPrimaryClassification(classifications),
    classifications: [...new Set(classifications)],
    safe_for_model_download: false,
    recommended_action: recommendAmdFitAction(classifications),
  };
}

export function summarizeAmdJoinedRecords(joined) {
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
    readyCandidates: counts.AMD_890M_READY_CANDIDATE ?? 0,
    directmlPossible: counts.AMD_DIRECTML_POSSIBLE ?? 0,
    onnxDirectmlPossible: counts.AMD_ONNX_DIRECTML_POSSIBLE ?? 0,
    vulkanNcnnPossible: counts.AMD_VULKAN_NCNN_POSSIBLE ?? 0,
    openclPossible: counts.AMD_OPENCL_POSSIBLE ?? 0,
    hipRocmUnknown: counts.AMD_HIP_ROCM_UNKNOWN ?? 0,
    redistributionNotDecided: counts.AMD_REDISTRIBUTION_UNDECIDED ?? 0,
    provenanceUnknown: counts.AMD_PROVENANCE_UNKNOWN ?? 0,
    hashMissing: counts.AMD_RESEARCH_HASH_MISSING ?? 0,
    deferredModelArtifacts: counts.AMD_RESEARCH_ARTIFACT_DEFERRED ?? 0,
    runtimeNotReady: counts.AMD_RUNTIME_NOT_READY ?? 0,
    linuxProtonUnproven: counts.AMD_LINUX_PROTON_UNPROVEN ?? 0,
    windowsOnlyReview: counts.AMD_WINDOWS_ONLY_REVIEW ?? 0,
    counts,
  };
}

function isAmdRelevant(record) {
  const labels = record.labels ?? [];
  const backends = record.backend ?? [];
  return backends.some(backend => ['directml', 'onnx', 'vulkan_ncnn', 'opencl', 'hip'].includes(backend))
    || labels.some(label => /DIRECTML|ONNX|NCNN|OPENCL|HIP|ROCM|UPSCALE|FRAMEGEN|MODEL_|VIDEO_INTERPOLATION/.test(label));
}

function chooseAmdPrimaryClassification(classifications) {
  const priority = [
    'AMD_PROVENANCE_UNKNOWN',
    'AMD_REDISTRIBUTION_UNDECIDED',
    'AMD_RESEARCH_ARTIFACT_DEFERRED',
    'AMD_RESEARCH_HASH_MISSING',
    'AMD_890M_READY_CANDIDATE',
    'AMD_DIRECTML_POSSIBLE',
    'AMD_ONNX_DIRECTML_POSSIBLE',
    'AMD_VULKAN_NCNN_POSSIBLE',
    'AMD_OPENCL_POSSIBLE',
    'AMD_HIP_ROCM_UNKNOWN',
    'AMD_RUNTIME_NOT_READY',
    'AMD_LINUX_PROTON_UNPROVEN',
    'AMD_WINDOWS_ONLY_REVIEW',
    'NOT_AMD_RELEVANT',
  ];
  return priority.find(item => classifications.includes(item)) ?? classifications[0];
}

function recommendAmdFitAction(classifications) {
  const set = new Set(classifications);
  if (set.has('AMD_PROVENANCE_UNKNOWN')) return 'Record model provenance before controlled testing.';
  if (set.has('AMD_REDISTRIBUTION_UNDECIDED')) return 'Research-only candidate; redistribution is not decided.';
  if (set.has('AMD_RESEARCH_HASH_MISSING')) return 'Capture model artifact hash before execution.';
  if (set.has('AMD_RESEARCH_ARTIFACT_DEFERRED')) return 'Keep model artifact acquisition deferred.';
  if (set.has('AMD_890M_READY_CANDIDATE')) return 'Candidate is ready for planning evidence review only.';
  if (set.has('AMD_DIRECTML_POSSIBLE')) return 'Capture DirectML import or tiny-op proof before treating this as ready.';
  if (set.has('AMD_ONNX_DIRECTML_POSSIBLE')) return 'Capture ONNX Runtime DirectML session proof before treating this as ready.';
  if (set.has('AMD_VULKAN_NCNN_POSSIBLE')) return 'Capture Vulkan NCNN runtime proof before treating this as ready.';
  if (set.has('AMD_OPENCL_POSSIBLE')) return 'Capture OpenCL runtime proof before treating this as ready.';
  if (set.has('AMD_HIP_ROCM_UNKNOWN')) return 'Keep HIP/ROCm status unknown until direct SDK proof exists.';
  if (set.has('AMD_RUNTIME_NOT_READY')) return 'Capture backend-specific AMD proof before ranking this higher.';
  return 'No AMD local-fit action recommended.';
}

function renderAmdFitTsv(joined) {
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

function renderAmdFitMarkdown(summary, proof) {
  return [
    '# AMD Advisory Local Fit',
    '',
    `- Proof classification: ${proof.classification}`,
    `- Total records: ${summary.totalRecords}`,
    `- Ready candidates: ${summary.readyCandidates}`,
    `- DirectML possible: ${summary.directmlPossible}`,
    `- ONNX DirectML possible: ${summary.onnxDirectmlPossible}`,
    `- Vulkan NCNN possible: ${summary.vulkanNcnnPossible}`,
    `- OpenCL possible: ${summary.openclPossible}`,
    `- HIP/ROCm unknown: ${summary.hipRocmUnknown}`,
    `- Redistribution not decided: ${summary.redistributionNotDecided}`,
    `- Provenance unknown: ${summary.provenanceUnknown}`,
    `- Hash missing: ${summary.hashMissing}`,
    `- Deferred model artifacts: ${summary.deferredModelArtifacts}`,
    `- Runtime not ready: ${summary.runtimeNotReady}`,
    `- Linux/Proton unproven: ${summary.linuxProtonUnproven}`,
    `- Windows-only review: ${summary.windowsOnlyReview}`,
    '',
    'Generated AMD local fit output is evidence only and does not modify the advisory dataset.',
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
        throw new Error(`Unknown AMD advisory join option: ${arg}`);
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
  node scripts/join-amd-proof-with-advisory.js \\
    --proof <amd-uma-proof.json> \\
    --dataset <gpu-upscale-framegen-advisory.jsonl> \\
    --out <dir>

Joins AMD 890M / UMA proof with the advisory dataset and writes generated
evidence outside the source dataset. It does not modify inputs, acquire model
artifacts, launch runtimes, or patch binaries.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await joinAmdProofWithAdvisory(options);
  console.log(`AMD local fit written: ${result.outDir}`);
  console.log(`Records: ${result.totalRecords}`);
  console.log(`DirectML possible: ${result.summary.directmlPossible}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
