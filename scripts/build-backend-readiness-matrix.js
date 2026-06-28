#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export const READINESS_LEVELS = [
  'RESEARCH_METADATA_ONLY',
  'RESEARCH_PROVENANCE_UNKNOWN',
  'RESEARCH_ARTIFACT_DEFERRED',
  'RESEARCH_HASH_MISSING',
  'RESEARCH_BACKEND_PROVEN',
  'RESEARCH_BACKEND_CANDIDATE',
  'RESEARCH_READY_FOR_CONTROLLED_TEST',
  'RESEARCH_RUNTIME_UNPROVEN',
  'RESEARCH_REVIEW_REQUIRED',
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
  const redistributionStatus = classifyRedistribution(record, modelLike);
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
  const researchClassifications = buildResearchClassifications({
    modelLike,
    backendCandidates,
    backendStatuses,
    redistributionStatus,
    artifactStatus,
    hashStatus,
    provenanceStatus,
  });
  if (provenanceStatus === 'PROVENANCE_UNKNOWN') hardBlocks.push('PROVENANCE_REQUIRED_BEFORE_CONTROLLED_TEST');
  if (artifactStatus === 'ARTIFACT_DEFERRED') softWarnings.push('ARTIFACT_DEFERRED');
  if (hashStatus === 'HASH_MISSING') softWarnings.push('HASH_CAPTURE_REQUIRED_BEFORE_EXECUTION');
  if (redistributionStatus === 'REDISTRIBUTION_NOT_DECIDED') softWarnings.push('REDISTRIBUTION_NOT_DECIDED');
  if (generatedEvidence) softWarnings.push('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY');
  if (!sourceAuthority) softWarnings.push('SOURCE_AUTHORITY_REVIEW');
  if (labels.includes('PROTON_COMPATIBLE_CANDIDATE') || labels.includes('LINUX_RUNTIME_UNKNOWN')) {
    softWarnings.push('LINUX_RUNTIME_PROOF_REQUIRED');
  }
  if (labels.includes('WINDOWS_ONLY_RUNTIME')) softWarnings.push('WINDOWS_ONLY_RUNTIME_REVIEW');

  let readinessLevel = chooseResearchReadiness({
    backendCandidates,
    backendStatuses,
    redistributionStatus,
    artifactStatus,
    hashStatus,
    provenanceStatus,
    modelLike,
  });

  if (readinessLevel === 'RESEARCH_READY_FOR_CONTROLLED_TEST') {
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
    redistribution_status: redistributionStatus,
    hash_status: hashStatus,
    provenance_status: provenanceStatus,
    cuda_status: backendStatuses.cuda,
    directml_status: backendStatuses.directml,
    onnx_directml_status: backendStatuses.onnx_directml,
    vulkan_ncnn_status: backendStatuses.vulkan_ncnn,
    tensorrt_status: backendStatuses.tensorrt,
    readiness_level: readinessLevel,
    research_classifications: researchClassifications,
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
    provenanceUnknown: 0,
    artifactDeferred: 0,
    hashMissing: 0,
    runtimeProofMissing: 0,
    redistributionNotDecided: 0,
    backendProven: 0,
    backendCandidate: 0,
    generatedEvidenceRows: 0,
    sourceAuthorityReview: 0,
    counts,
    proof_summary: proofSummary,
  };

  for (const row of rows) {
    counts[row.readiness_level] = (counts[row.readiness_level] ?? 0) + 1;
    if (row.readiness_level === 'RESEARCH_READY_FOR_CONTROLLED_TEST') summary.readyForControlledTest += 1;
    if (row.backend_candidates.includes('cuda')) summary.cudaCandidates += 1;
    if (row.backend_candidates.includes('directml')) summary.directmlCandidates += 1;
    if (row.backend_candidates.includes('onnx_directml')) summary.onnxDirectmlCandidates += 1;
    if (row.backend_candidates.includes('vulkan_ncnn')) summary.vulkanNcnnCandidates += 1;
    if (row.backend_candidates.includes('tensorrt')) summary.tensorrtCandidates += 1;
    if (row.research_classifications.includes('RESEARCH_PROVENANCE_UNKNOWN')) summary.provenanceUnknown += 1;
    if (row.research_classifications.includes('RESEARCH_ARTIFACT_DEFERRED')) summary.artifactDeferred += 1;
    if (row.research_classifications.includes('RESEARCH_HASH_MISSING')) summary.hashMissing += 1;
    if (row.research_classifications.includes('RESEARCH_RUNTIME_UNPROVEN')) summary.runtimeProofMissing += 1;
    if (row.redistribution_status === 'REDISTRIBUTION_NOT_DECIDED') summary.redistributionNotDecided += 1;
    if (row.research_classifications.includes('RESEARCH_BACKEND_PROVEN')) summary.backendProven += 1;
    if (row.research_classifications.includes('RESEARCH_BACKEND_CANDIDATE')) summary.backendCandidate += 1;
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

function chooseResearchReadiness({ backendCandidates, backendStatuses, provenanceStatus, modelLike }) {
  if (backendCandidates.length === 0) return modelLike ? 'RESEARCH_METADATA_ONLY' : 'RESEARCH_REVIEW_REQUIRED';

  if (backendCandidates.includes('tensorrt') && backendStatuses.tensorrt === 'BACKEND_BLOCKED_RUNTIME') {
    return 'RESEARCH_RUNTIME_UNPROVEN';
  }

  const statuses = Object.values(backendStatuses).filter(status => status !== 'BACKEND_UNAVAILABLE');
  if (provenanceStatus === 'PROVENANCE_UNKNOWN') return 'RESEARCH_PROVENANCE_UNKNOWN';
  if (statuses.includes('BACKEND_TINY_OP_PROVEN') || statuses.includes('BACKEND_IMPORT_PROVEN')) {
    return 'RESEARCH_READY_FOR_CONTROLLED_TEST';
  }
  if (statuses.includes('BACKEND_VISIBLE') || statuses.includes('BACKEND_CANDIDATE')) return 'RESEARCH_BACKEND_CANDIDATE';
  if (statuses.includes('BACKEND_BLOCKED_RUNTIME')) return 'RESEARCH_RUNTIME_UNPROVEN';
  return 'RESEARCH_RUNTIME_UNPROVEN';
}

function buildResearchClassifications({ modelLike, backendCandidates, backendStatuses, redistributionStatus, artifactStatus, hashStatus, provenanceStatus }) {
  const statuses = Object.values(backendStatuses).filter(status => status !== 'BACKEND_UNAVAILABLE');
  const classifications = [];
  if (modelLike) classifications.push('RESEARCH_METADATA_ONLY');
  if (provenanceStatus === 'PROVENANCE_UNKNOWN') classifications.push('RESEARCH_PROVENANCE_UNKNOWN');
  if (artifactStatus === 'ARTIFACT_DEFERRED') classifications.push('RESEARCH_ARTIFACT_DEFERRED');
  if (hashStatus === 'HASH_MISSING') classifications.push('RESEARCH_HASH_MISSING');
  if (statuses.includes('BACKEND_TINY_OP_PROVEN') || statuses.includes('BACKEND_IMPORT_PROVEN')) classifications.push('RESEARCH_BACKEND_PROVEN');
  if (statuses.includes('BACKEND_VISIBLE') || statuses.includes('BACKEND_CANDIDATE')) classifications.push('RESEARCH_BACKEND_CANDIDATE');
  if (statuses.includes('BACKEND_BLOCKED_RUNTIME') || (backendCandidates.length > 0 && statuses.length === 0)) classifications.push('RESEARCH_RUNTIME_UNPROVEN');
  if (
    backendCandidates.length > 0
    && provenanceStatus !== 'PROVENANCE_UNKNOWN'
    && (statuses.includes('BACKEND_TINY_OP_PROVEN') || statuses.includes('BACKEND_IMPORT_PROVEN'))
  ) {
    classifications.push('RESEARCH_READY_FOR_CONTROLLED_TEST');
  }
  if (redistributionStatus === 'REDISTRIBUTION_NOT_DECIDED') classifications.push('RESEARCH_REVIEW_REQUIRED');
  if (classifications.length === 0) classifications.push('RESEARCH_REVIEW_REQUIRED');
  return [...new Set(classifications)];
}

function classifyRedistribution(record, modelLike) {
  const labels = record.labels ?? [];
  const license = String(record.source_license ?? '').trim().toUpperCase();
  if (!modelLike) return 'REDISTRIBUTION_NOT_APPLICABLE';
  if (labels.includes('MODEL_LICENSE_UNKNOWN') || !license || ['UNKNOWN', 'NOASSERTION', 'UNSPECIFIED'].includes(license)) {
    return 'REDISTRIBUTION_NOT_DECIDED';
  }
  return 'REDISTRIBUTION_METADATA_PRESENT';
}

function classifyArtifact(record, modelLike) {
  const labels = record.labels ?? [];
  const runtime = record.runtime ?? [];
  if (labels.includes('MODEL_METADATA_ONLY') || labels.includes('MODEL_WEIGHT_DOWNLOAD_DEFERRED') || runtime.includes('metadata_only')) {
    return 'ARTIFACT_DEFERRED';
  }
  if (modelLike) return 'ARTIFACT_REVIEW_REQUIRED';
  return 'ARTIFACT_NOT_REQUIRED_FOR_SOURCE_ROW';
}

function classifyHash(record, modelLike) {
  const labels = record.labels ?? [];
  const requiredProof = record.required_proof ?? [];
  if (labels.includes('MODEL_HASH_MISSING')) return 'HASH_MISSING';
  if (modelLike && requiredProof.includes('model_hash')) return 'HASH_MISSING';
  if (requiredProof.some(item => /hash/i.test(item))) return 'HASH_MISSING';
  return 'HASH_NOT_REQUIRED_FOR_SOURCE_ROW';
}

function classifyProvenance(record) {
  const labels = record.labels ?? [];
  const requiredProof = record.required_proof ?? [];
  const hasSourceIdentity = Boolean(record.record_id || record.source_path || record.source_project);
  if (!hasSourceIdentity) return 'PROVENANCE_UNKNOWN';
  if (labels.includes('MODEL_PROVENANCE_MISSING')) return 'PROVENANCE_UNKNOWN';
  if (requiredProof.some(item => /provenance|source_file_check|ncnn_binary_provenance/i.test(item))) return 'PROVENANCE_UNKNOWN';
  return 'PROVENANCE_RECORDED';
}

function isModelLikeRecord(record) {
  const labels = record.labels ?? [];
  const runtime = record.runtime ?? [];
  return record.source_kind === 'model_card_metadata'
    || labels.some(label => label.startsWith('MODEL_'))
    || runtime.includes('metadata_only');
}

function recommendNextAction(readinessLevel, backendCandidates, hardBlocks, softWarnings) {
  if (hardBlocks.includes('PROVENANCE_REQUIRED_BEFORE_CONTROLLED_TEST')) return 'Record source identity and provenance before controlled testing.';
  if (softWarnings.includes('HASH_CAPTURE_REQUIRED_BEFORE_EXECUTION')) return 'Research-only candidate; capture artifact hash before execution.';
  if (softWarnings.includes('ARTIFACT_DEFERRED')) return 'Research-only candidate; keep artifact acquisition deferred until the controlled test plan is explicit.';
  if (readinessLevel === 'RESEARCH_RUNTIME_UNPROVEN') return 'Capture backend-specific import or tiny-op proof before controlled testing.';
  if (readinessLevel === 'RESEARCH_BACKEND_CANDIDATE') return `Capture runtime proof for ${backendCandidates.join(', ') || 'candidate backend'}.`;
  if (readinessLevel === 'RESEARCH_READY_FOR_CONTROLLED_TEST') return 'Eligible for a controlled local research test plan; not a redistribution recommendation.';
  if (softWarnings.includes('SOURCE_AUTHORITY_REVIEW')) return 'Promote only after source authority is reviewed.';
  return 'No backend action recommended.';
}

function renderMatrixTsv(rows) {
  return [
    'candidate_id\tsource_project\tbackend_candidates\treadiness_level\tresearch_classifications\tredistribution_status\tartifact_status\thash_status\tprovenance_status\tcuda_status\tdirectml_status\tonnx_directml_status\tvulkan_ncnn_status\ttensorrt_status\thard_blocks\tsoft_warnings\trecommended_next_action',
    ...rows.map(row => [
      row.candidate_id,
      row.source_project,
      row.backend_candidates.join(','),
      row.readiness_level,
      row.research_classifications.join(','),
      row.redistribution_status,
      row.artifact_status,
      row.hash_status,
      row.provenance_status,
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
    `provenanceUnknown\t${summary.provenanceUnknown}`,
    `artifactDeferred\t${summary.artifactDeferred}`,
    `hashMissing\t${summary.hashMissing}`,
    `runtimeProofMissing\t${summary.runtimeProofMissing}`,
    `redistributionNotDecided\t${summary.redistributionNotDecided}`,
    `backendProven\t${summary.backendProven}`,
    `backendCandidate\t${summary.backendCandidate}`,
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
    'candidate_id\treadiness_level\tresearch_classifications\thard_blocks\tsoft_warnings\trecommended_next_action',
    ...rows
      .filter(row => row.hard_blocks.length > 0 || row.readiness_level === 'RESEARCH_RUNTIME_UNPROVEN' || row.readiness_level === 'RESEARCH_PROVENANCE_UNKNOWN')
      .map(row => [
        row.candidate_id,
        row.readiness_level,
        row.research_classifications.join(','),
        row.hard_blocks.join(','),
        row.soft_warnings.join(','),
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
    `- Provenance unknown: ${summary.provenanceUnknown}`,
    `- Artifact deferred: ${summary.artifactDeferred}`,
    `- Hash missing: ${summary.hashMissing}`,
    `- Runtime proof missing: ${summary.runtimeProofMissing}`,
    `- Redistribution not decided: ${summary.redistributionNotDecided}`,
    `- Backend proven: ${summary.backendProven}`,
    `- Backend candidate: ${summary.backendCandidate}`,
    '',
    '## Readiness Rules',
    '',
    '- Ready for controlled test is not a production or redistribution recommendation.',
    '- Unknown license metadata does not block research classification.',
    '- Redistribution remains undecided until explicitly approved.',
    '- Metadata-only model rows may stay research-only while artifacts and hashes are deferred.',
    '- Vulkan visibility does not prove Vulkan NCNN runtime readiness.',
    '- CUDA tensor proof does not prove TensorRT readiness.',
    '- Generated Reversa evidence is not an authority record.',
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
