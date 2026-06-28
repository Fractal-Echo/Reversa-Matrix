#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export const READINESS_LEVELS = [
  'BACKEND_UNAVAILABLE',
  'BACKEND_VISIBLE',
  'BACKEND_IMPORT_PROVEN',
  'BACKEND_TINY_OP_PROVEN',
  'BACKEND_CANDIDATE',
  'BACKEND_BLOCKED_LICENSE',
  'BACKEND_BLOCKED_ARTIFACT',
  'BACKEND_BLOCKED_HASH',
  'BACKEND_BLOCKED_RUNTIME',
  'BACKEND_READY_FOR_CONTROLLED_TEST',
  'BACKEND_READY_FOR_RECOMMENDATION',
];

export async function buildBackendReadinessMatrix(options) {
  const datasetPath = resolveRequiredPath(options.dataset, '--dataset');
  const cudaProofPath = resolveRequiredPath(options.cudaProof, '--cuda-proof');
  const amdProofPath = resolveRequiredPath(options.amdProof, '--amd-proof');
  const onnxDirectmlProofPath = resolveRequiredPath(options.onnxDirectmlProof, '--onnx-directml-proof');
  const outDir = resolveRequiredPath(options.out, '--out');
  await mkdir(outDir, { recursive: true });

  const records = await readJsonl(datasetPath);
  const cudaProof = JSON.parse(await readFile(cudaProofPath, 'utf8'));
  const amdProof = JSON.parse(await readFile(amdProofPath, 'utf8'));
  const onnxDirectmlProof = JSON.parse(await readFile(onnxDirectmlProofPath, 'utf8'));
  const proofSummary = buildProofSummary(cudaProof, amdProof, onnxDirectmlProof);
  const rows = records.map(record => classifyBackendReadiness(record, proofSummary));
  const summary = summarizeBackendMatrix(rows, proofSummary);
  const matrix = {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    dataset_path: datasetPath,
    proof_summary: proofSummary,
    summary,
    records: rows,
  };

  await writeFile(join(outDir, 'backend-readiness-matrix.json'), JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'backend-readiness-matrix.tsv'), renderMatrixTsv(rows), 'utf8');
  await writeFile(join(outDir, 'backend-readiness-matrix.md'), renderMatrixMarkdown(matrix), 'utf8');
  await writeFile(join(outDir, 'backend-gate-summary.tsv'), renderGateSummaryTsv(summary), 'utf8');
  await writeFile(join(outDir, 'candidate-routing.tsv'), renderCandidateRoutingTsv(rows), 'utf8');
  await writeFile(join(outDir, 'blocked-candidates.tsv'), renderBlockedCandidatesTsv(rows), 'utf8');

  return { outDir, matrix, summary };
}

export function classifyBackendReadiness(record, proofSummary) {
  const labels = record.labels ?? [];
  const backends = record.backend ?? [];
  const requiredProof = record.required_proof ?? [];
  const backendCandidates = detectBackendCandidates(record);
  const modelLike = isModelLikeRecord(record);
  const licenseStatus = classifyLicense(record, modelLike);
  const artifactStatus = classifyArtifact(record, modelLike);
  const hashStatus = classifyHash(record, modelLike);
  const provenanceStatus = classifyProvenance(record);
  const generatedEvidence = record.generated_artifact === true || labels.includes('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY');
  const sourceAuthority = record.source_authority === true && !generatedEvidence;

  const backendStatuses = {
    cuda: backendCandidates.includes('cuda') ? proofSummary.cuda.status : 'BACKEND_UNAVAILABLE',
    directml: backendCandidates.includes('directml') ? proofSummary.directml.status : 'BACKEND_UNAVAILABLE',
    onnx_directml: backendCandidates.includes('onnx_directml') ? proofSummary.onnx_directml.status : 'BACKEND_UNAVAILABLE',
    vulkan_ncnn: backendCandidates.includes('vulkan_ncnn') ? proofSummary.vulkan_ncnn.status : 'BACKEND_UNAVAILABLE',
    tensorrt: backendCandidates.includes('tensorrt') ? proofSummary.tensorrt.status : 'BACKEND_UNAVAILABLE',
  };

  const hardBlocks = [];
  const softWarnings = [];
  if (licenseStatus === 'BLOCKED_LICENSE') hardBlocks.push('LICENSE_REVIEW_REQUIRED');
  if (artifactStatus === 'BLOCKED_ARTIFACT') hardBlocks.push('ARTIFACT_ACQUISITION_DEFERRED');
  if (hashStatus === 'BLOCKED_HASH') hardBlocks.push('HASH_REQUIRED_BEFORE_USE');
  if (provenanceStatus === 'BLOCKED_PROVENANCE') hardBlocks.push('PROVENANCE_REQUIRED_BEFORE_USE');
  if (generatedEvidence) softWarnings.push('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY');
  if (!sourceAuthority) softWarnings.push('SOURCE_AUTHORITY_REVIEW');
  if (labels.includes('PROTON_COMPATIBLE_CANDIDATE') || labels.includes('LINUX_RUNTIME_UNKNOWN')) {
    softWarnings.push('LINUX_RUNTIME_PROOF_REQUIRED');
  }
  if (labels.includes('WINDOWS_ONLY_RUNTIME')) softWarnings.push('WINDOWS_ONLY_RUNTIME_REVIEW');

  let readinessLevel = chooseReadinessLevel({
    backendCandidates,
    backendStatuses,
    licenseStatus,
    artifactStatus,
    hashStatus,
    provenanceStatus,
  });

  if (readinessLevel === 'BACKEND_READY_FOR_CONTROLLED_TEST') {
    softWarnings.push('CONTROLLED_TEST_ONLY_NOT_RECOMMENDATION');
  }

  const candidateStatus = backendCandidates.length === 0 ? 'no_backend_candidate' : 'backend_candidate';
  const recommendedNextAction = recommendNextAction(readinessLevel, backendCandidates, hardBlocks, softWarnings);

  return {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    candidate_id: record.record_id,
    source_project: record.source_project,
    source_kind: record.source_kind,
    source_path: record.source_path,
    labels,
    backend_input: backends,
    backend_candidates: backendCandidates,
    candidate_status: candidateStatus,
    artifact_status: artifactStatus,
    license_status: licenseStatus,
    hash_status: hashStatus,
    provenance_status: provenanceStatus,
    cuda_status: backendStatuses.cuda,
    directml_status: backendStatuses.directml,
    onnx_directml_status: backendStatuses.onnx_directml,
    vulkan_ncnn_status: backendStatuses.vulkan_ncnn,
    tensorrt_status: backendStatuses.tensorrt,
    readiness_level: readinessLevel,
    hard_blocks: hardBlocks,
    soft_warnings: [...new Set(softWarnings)],
    recommended_next_action: recommendedNextAction,
    required_proof: requiredProof,
    source_authority_input: record.source_authority === true,
    source_authority_effective: sourceAuthority,
  };
}

export function buildProofSummary(cudaProof, amdProof, onnxDirectmlProof) {
  return {
    cuda: summarizeCudaProof(cudaProof),
    directml: summarizeDirectmlProof(amdProof),
    onnx_directml: summarizeOnnxDirectmlProof(onnxDirectmlProof),
    vulkan_ncnn: summarizeVulkanNcnnProof(onnxDirectmlProof),
    tensorrt: summarizeTensorrtProof(cudaProof),
  };
}

export function summarizeBackendMatrix(rows, proofSummary = null) {
  const counts = Object.fromEntries(READINESS_LEVELS.map(level => [level, 0]));
  const summary = {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    totalRecords: rows.length,
    readyForControlledTest: 0,
    readyForRecommendation: 0,
    cudaCandidates: 0,
    directmlCandidates: 0,
    onnxDirectmlCandidates: 0,
    vulkanNcnnCandidates: 0,
    tensorrtCandidates: 0,
    blockedLicense: 0,
    blockedArtifact: 0,
    blockedHash: 0,
    blockedRuntime: 0,
    blockedProvenance: 0,
    generatedEvidenceRows: 0,
    sourceAuthorityReview: 0,
    counts,
    proof_summary: proofSummary,
  };

  for (const row of rows) {
    counts[row.readiness_level] = (counts[row.readiness_level] ?? 0) + 1;
    if (row.readiness_level === 'BACKEND_READY_FOR_CONTROLLED_TEST') summary.readyForControlledTest += 1;
    if (row.readiness_level === 'BACKEND_READY_FOR_RECOMMENDATION') summary.readyForRecommendation += 1;
    if (row.backend_candidates.includes('cuda')) summary.cudaCandidates += 1;
    if (row.backend_candidates.includes('directml')) summary.directmlCandidates += 1;
    if (row.backend_candidates.includes('onnx_directml')) summary.onnxDirectmlCandidates += 1;
    if (row.backend_candidates.includes('vulkan_ncnn')) summary.vulkanNcnnCandidates += 1;
    if (row.backend_candidates.includes('tensorrt')) summary.tensorrtCandidates += 1;
    if (row.hard_blocks.includes('LICENSE_REVIEW_REQUIRED')) summary.blockedLicense += 1;
    if (row.hard_blocks.includes('ARTIFACT_ACQUISITION_DEFERRED')) summary.blockedArtifact += 1;
    if (row.hard_blocks.includes('HASH_REQUIRED_BEFORE_USE')) summary.blockedHash += 1;
    if (row.hard_blocks.includes('PROVENANCE_REQUIRED_BEFORE_USE')) summary.blockedProvenance += 1;
    if (row.readiness_level === 'BACKEND_BLOCKED_RUNTIME') summary.blockedRuntime += 1;
    if (row.generated_artifact) summary.generatedEvidenceRows += 1;
    if (row.soft_warnings.includes('SOURCE_AUTHORITY_REVIEW')) summary.sourceAuthorityReview += 1;
  }

  return summary;
}

export function detectBackendCandidates(record) {
  const labels = record.labels ?? [];
  const backends = record.backend ?? [];
  const haystack = [...labels, ...backends].join(' ').toUpperCase();
  const candidates = [];
  if (backends.some(item => ['cuda', 'pytorch'].includes(item)) || /\bCUDA\b|CANDIDATE_CUDA_5090/.test(haystack)) candidates.push('cuda');
  if (backends.includes('directml') || /\bDIRECTML\b/.test(haystack)) candidates.push('directml');
  if (backends.includes('onnx') || /\bONNX\b/.test(haystack)) candidates.push('onnx_directml');
  if (backends.includes('vulkan_ncnn') || /\bVULKAN_NCNN\b|\bNCNN\b/.test(haystack)) candidates.push('vulkan_ncnn');
  if (backends.includes('tensorrt') || /\bTENSORRT\b/.test(haystack)) candidates.push('tensorrt');
  return [...new Set(candidates)];
}

function summarizeCudaProof(proof) {
  if (proof?.classification === 'GPU_PROOF_TENSOR_OP_PASS' || proof?.python?.tensor_op_pass === true) {
    return {
      status: 'BACKEND_TINY_OP_PROVEN',
      device: proof?.gpu?.name ?? 'unknown',
      classification: proof?.classification ?? 'unknown',
    };
  }
  if (proof?.python?.torch_cuda_available === true) {
    return { status: 'BACKEND_IMPORT_PROVEN', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  if (proof?.gpu?.nvidia_smi_available === true) {
    return { status: 'BACKEND_VISIBLE', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  return { status: 'BACKEND_UNAVAILABLE', device: 'unknown', classification: proof?.classification ?? 'unknown' };
}

function summarizeDirectmlProof(proof) {
  if (proof?.directml?.torch_directml_tiny_op_pass === true || proof?.directml?.tiny_op_pass === true) {
    return { status: 'BACKEND_TINY_OP_PROVEN', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  if (proof?.directml?.torch_directml_available === true) {
    return { status: 'BACKEND_IMPORT_PROVEN', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  if (proof?.directml?.candidate === true) {
    return { status: 'BACKEND_VISIBLE', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  return { status: 'BACKEND_UNAVAILABLE', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
}

function summarizeOnnxDirectmlProof(proof) {
  if (proof?.directml?.onnxruntime_tiny_op_pass === true || proof?.directml?.onnxruntime_directml_tiny_op_pass === true) {
    return { status: 'BACKEND_TINY_OP_PROVEN', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  if (proof?.directml?.onnxruntime_directml_available === true) {
    return { status: 'BACKEND_IMPORT_PROVEN', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
  }
  return { status: 'BACKEND_UNAVAILABLE', device: proof?.gpu?.name ?? 'unknown', classification: proof?.classification ?? 'unknown' };
}

function summarizeVulkanNcnnProof(proof) {
  if (proof?.vulkan?.available === true) {
    return {
      status: 'BACKEND_CANDIDATE',
      device: proof?.vulkan?.device_name ?? proof?.gpu?.name ?? 'unknown',
      classification: 'VULKAN_VISIBLE_NCNN_NOT_PROVEN',
    };
  }
  return { status: 'BACKEND_UNAVAILABLE', device: 'unknown', classification: 'VULKAN_NOT_VISIBLE' };
}

function summarizeTensorrtProof(proof) {
  if (proof?.backends?.tensorrt === 'present') {
    return { status: 'BACKEND_IMPORT_PROVEN', device: proof?.gpu?.name ?? 'unknown', classification: 'TENSORRT_PRESENT' };
  }
  if (proof?.python?.tensor_op_pass === true || proof?.python?.torch_cuda_available === true) {
    return { status: 'BACKEND_BLOCKED_RUNTIME', device: proof?.gpu?.name ?? 'unknown', classification: 'CUDA_PROVEN_TENSORRT_NOT_PROVEN' };
  }
  return { status: 'BACKEND_UNAVAILABLE', device: proof?.gpu?.name ?? 'unknown', classification: 'TENSORRT_NOT_PROVEN' };
}

function chooseReadinessLevel({ backendCandidates, backendStatuses, licenseStatus, artifactStatus, hashStatus, provenanceStatus }) {
  if (licenseStatus === 'BLOCKED_LICENSE') return 'BACKEND_BLOCKED_LICENSE';
  if (artifactStatus === 'BLOCKED_ARTIFACT') return 'BACKEND_BLOCKED_ARTIFACT';
  if (hashStatus === 'BLOCKED_HASH') return 'BACKEND_BLOCKED_HASH';
  if (provenanceStatus === 'BLOCKED_PROVENANCE') return 'BACKEND_BLOCKED_HASH';
  if (backendCandidates.length === 0) return 'BACKEND_UNAVAILABLE';

  if (backendCandidates.includes('tensorrt') && backendStatuses.tensorrt === 'BACKEND_BLOCKED_RUNTIME') {
    return 'BACKEND_BLOCKED_RUNTIME';
  }

  const statuses = Object.values(backendStatuses).filter(status => status !== 'BACKEND_UNAVAILABLE');
  if (statuses.includes('BACKEND_TINY_OP_PROVEN')) return 'BACKEND_READY_FOR_CONTROLLED_TEST';
  if (statuses.includes('BACKEND_IMPORT_PROVEN')) return 'BACKEND_IMPORT_PROVEN';
  if (statuses.includes('BACKEND_VISIBLE')) return 'BACKEND_VISIBLE';
  if (statuses.includes('BACKEND_CANDIDATE')) return 'BACKEND_CANDIDATE';
  if (statuses.includes('BACKEND_BLOCKED_RUNTIME')) return 'BACKEND_BLOCKED_RUNTIME';
  return 'BACKEND_BLOCKED_RUNTIME';
}

function classifyLicense(record, modelLike) {
  const labels = record.labels ?? [];
  const license = String(record.source_license ?? '').trim().toUpperCase();
  if (labels.includes('MODEL_LICENSE_UNKNOWN')) return 'BLOCKED_LICENSE';
  if (modelLike && (!license || ['UNKNOWN', 'NOASSERTION', 'UNSPECIFIED'].includes(license))) return 'BLOCKED_LICENSE';
  return license ? 'LICENSE_REVIEWED_METADATA' : 'LICENSE_NOT_APPLICABLE';
}

function classifyArtifact(record, modelLike) {
  const labels = record.labels ?? [];
  const runtime = record.runtime ?? [];
  if (labels.includes('MODEL_METADATA_ONLY') || labels.includes('MODEL_WEIGHT_DOWNLOAD_DEFERRED') || runtime.includes('metadata_only')) {
    return 'BLOCKED_ARTIFACT';
  }
  if (modelLike) return 'ARTIFACT_REVIEW_REQUIRED';
  return 'ARTIFACT_NOT_REQUIRED_FOR_SOURCE_ROW';
}

function classifyHash(record, modelLike) {
  const labels = record.labels ?? [];
  const requiredProof = record.required_proof ?? [];
  if (labels.includes('MODEL_HASH_MISSING')) return 'BLOCKED_HASH';
  if (modelLike && requiredProof.includes('model_hash')) return 'BLOCKED_HASH';
  if (requiredProof.some(item => /hash/i.test(item))) return 'BLOCKED_HASH';
  return 'HASH_NOT_REQUIRED_FOR_SOURCE_ROW';
}

function classifyProvenance(record) {
  const labels = record.labels ?? [];
  const requiredProof = record.required_proof ?? [];
  if (labels.includes('MODEL_PROVENANCE_MISSING')) return 'BLOCKED_PROVENANCE';
  if (requiredProof.some(item => /provenance|source_file_check|ncnn_binary_provenance/i.test(item))) return 'BLOCKED_PROVENANCE';
  return 'PROVENANCE_NOT_REQUIRED_FOR_SOURCE_ROW';
}

function isModelLikeRecord(record) {
  const labels = record.labels ?? [];
  const runtime = record.runtime ?? [];
  return record.source_kind === 'model_card_metadata'
    || labels.some(label => label.startsWith('MODEL_'))
    || runtime.includes('metadata_only');
}

function recommendNextAction(readinessLevel, backendCandidates, hardBlocks, softWarnings) {
  if (hardBlocks.includes('LICENSE_REVIEW_REQUIRED')) return 'Review license metadata before controlled testing.';
  if (hardBlocks.includes('ARTIFACT_ACQUISITION_DEFERRED')) return 'Keep artifact acquisition deferred until license, hash, and provenance are approved.';
  if (hardBlocks.includes('HASH_REQUIRED_BEFORE_USE')) return 'Capture hash and provenance proof before ranking this higher.';
  if (readinessLevel === 'BACKEND_BLOCKED_RUNTIME') return 'Capture backend-specific import or tiny-op proof before controlled testing.';
  if (readinessLevel === 'BACKEND_CANDIDATE') return `Capture runtime proof for ${backendCandidates.join(', ') || 'candidate backend'}.`;
  if (readinessLevel === 'BACKEND_READY_FOR_CONTROLLED_TEST') return 'Eligible for a controlled local test plan; not a recommendation.';
  if (softWarnings.includes('SOURCE_AUTHORITY_REVIEW')) return 'Promote only after source authority is reviewed.';
  return 'No backend action recommended.';
}

function renderMatrixTsv(rows) {
  return [
    'candidate_id\tsource_project\tbackend_candidates\treadiness_level\tlicense_status\tartifact_status\thash_status\tcuda_status\tdirectml_status\tonnx_directml_status\tvulkan_ncnn_status\ttensorrt_status\thard_blocks\tsoft_warnings\trecommended_next_action',
    ...rows.map(row => [
      row.candidate_id,
      row.source_project,
      row.backend_candidates.join(','),
      row.readiness_level,
      row.license_status,
      row.artifact_status,
      row.hash_status,
      row.cuda_status,
      row.directml_status,
      row.onnx_directml_status,
      row.vulkan_ncnn_status,
      row.tensorrt_status,
      row.hard_blocks.join(','),
      row.soft_warnings.join(','),
      row.recommended_next_action,
    ].map(tsvCell).join('\t')),
    '',
  ].join('\n');
}

function renderGateSummaryTsv(summary) {
  return [
    'metric\tcount',
    `totalRecords\t${summary.totalRecords}`,
    `readyForControlledTest\t${summary.readyForControlledTest}`,
    `readyForRecommendation\t${summary.readyForRecommendation}`,
    `cudaCandidates\t${summary.cudaCandidates}`,
    `directmlCandidates\t${summary.directmlCandidates}`,
    `onnxDirectmlCandidates\t${summary.onnxDirectmlCandidates}`,
    `vulkanNcnnCandidates\t${summary.vulkanNcnnCandidates}`,
    `tensorrtCandidates\t${summary.tensorrtCandidates}`,
    `blockedLicense\t${summary.blockedLicense}`,
    `blockedArtifact\t${summary.blockedArtifact}`,
    `blockedHash\t${summary.blockedHash}`,
    `blockedRuntime\t${summary.blockedRuntime}`,
    `blockedProvenance\t${summary.blockedProvenance}`,
    '',
  ].join('\n');
}

function renderCandidateRoutingTsv(rows) {
  return [
    'candidate_id\tbackend_candidates\treadiness_level\trecommended_next_action',
    ...rows
      .filter(row => row.backend_candidates.length > 0)
      .map(row => [
        row.candidate_id,
        row.backend_candidates.join(','),
        row.readiness_level,
        row.recommended_next_action,
      ].map(tsvCell).join('\t')),
    '',
  ].join('\n');
}

function renderBlockedCandidatesTsv(rows) {
  return [
    'candidate_id\treadiness_level\thard_blocks\trecommended_next_action',
    ...rows
      .filter(row => row.hard_blocks.length > 0 || row.readiness_level.startsWith('BACKEND_BLOCKED'))
      .map(row => [
        row.candidate_id,
        row.readiness_level,
        row.hard_blocks.join(','),
        row.recommended_next_action,
      ].map(tsvCell).join('\t')),
    '',
  ].join('\n');
}

function renderMatrixMarkdown(matrix) {
  const { summary, proof_summary: proofSummary } = matrix;
  return [
    '# Backend Readiness Matrix',
    '',
    'Generated evidence. This matrix ranks local backend readiness for controlled testing only.',
    '',
    '## Proof Summary',
    '',
    `- CUDA: ${proofSummary.cuda.status} (${proofSummary.cuda.device})`,
    `- DirectML: ${proofSummary.directml.status} (${proofSummary.directml.device})`,
    `- ONNX DirectML: ${proofSummary.onnx_directml.status} (${proofSummary.onnx_directml.device})`,
    `- Vulkan NCNN: ${proofSummary.vulkan_ncnn.status} (${proofSummary.vulkan_ncnn.device})`,
    `- TensorRT: ${proofSummary.tensorrt.status} (${proofSummary.tensorrt.device})`,
    '',
    '## Gate Summary',
    '',
    `- Total records: ${summary.totalRecords}`,
    `- Ready for controlled test: ${summary.readyForControlledTest}`,
    `- Ready for recommendation: ${summary.readyForRecommendation}`,
    `- CUDA candidates: ${summary.cudaCandidates}`,
    `- DirectML candidates: ${summary.directmlCandidates}`,
    `- ONNX DirectML candidates: ${summary.onnxDirectmlCandidates}`,
    `- Vulkan NCNN candidates: ${summary.vulkanNcnnCandidates}`,
    `- TensorRT candidates: ${summary.tensorrtCandidates}`,
    `- Blocked by license: ${summary.blockedLicense}`,
    `- Blocked by artifact: ${summary.blockedArtifact}`,
    `- Blocked by hash: ${summary.blockedHash}`,
    `- Blocked by runtime: ${summary.blockedRuntime}`,
    '',
    '## Readiness Rules',
    '',
    '- Ready for controlled test is not a production recommendation.',
    '- Metadata-only model rows stay blocked until license, artifact, hash, and provenance proof exist.',
    '- Vulkan visibility does not prove Vulkan NCNN runtime readiness.',
    '- CUDA tensor proof does not prove TensorRT readiness.',
    '- Generated Reversa evidence is not source authority.',
    '',
  ].join('\n');
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function tsvCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
}

function resolveRequiredPath(path, flag) {
  if (!path) throw new Error(`Missing required ${flag}`);
  return resolve(path);
}

function parseArgs(args) {
  const options = {
    dataset: null,
    cudaProof: null,
    amdProof: null,
    onnxDirectmlProof: null,
    out: null,
    help: false,
  };
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
      case '--cuda-proof':
        options.cudaProof = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--amd-proof':
        options.amdProof = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--onnx-directml-proof':
        options.onnxDirectmlProof = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown backend matrix option: ${arg}`);
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
  node scripts/build-backend-readiness-matrix.js \\
    --dataset <gpu-upscale-framegen-advisory.jsonl> \\
    --cuda-proof <gpu-proof.json> \\
    --amd-proof <amd-uma-proof.json> \\
    --onnx-directml-proof <amd-uma-proof.json> \\
    --out <dir>

Builds a generated backend readiness matrix from local proof files. It does not
install packages, acquire artifacts, launch runtimes, connect to phones, or
patch binaries.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await buildBackendReadinessMatrix(options);
  console.log(`Backend readiness matrix written: ${result.outDir}`);
  console.log(`Records: ${result.summary.totalRecords}`);
  console.log(`Ready for controlled test: ${result.summary.readyForControlledTest}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
