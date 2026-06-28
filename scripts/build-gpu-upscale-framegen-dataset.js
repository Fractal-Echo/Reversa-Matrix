#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const REQUIRED_LABELS = [
  'UPSCALE_RUNTIME_CANDIDATE',
  'FRAMEGEN_RUNTIME_CANDIDATE',
  'VIDEO_INTERPOLATION_CANDIDATE',
  'MODEL_METADATA_ONLY',
  'MODEL_LICENSE_OK',
  'MODEL_LICENSE_UNKNOWN',
  'MODEL_HASH_MISSING',
  'MODEL_PROVENANCE_MISSING',
  'MODEL_WEIGHT_DOWNLOAD_DEFERRED',
  'CUDA_BACKEND_PRESENT',
  'CUDA_CLAIM_UNVERIFIED',
  'CANDIDATE_CUDA_5090',
  'VULKAN_NCNN_BACKEND_PRESENT',
  'CANDIDATE_VULKAN_NCNN',
  'ONNX_BACKEND_PRESENT',
  'CANDIDATE_ONNX',
  'TENSORRT_BACKEND_PRESENT',
  'CANDIDATE_TENSORRT',
  'DIRECTML_BACKEND_PRESENT',
  'CANDIDATE_DIRECTML',
  'WINDOWS_ONLY_RUNTIME',
  'LINUX_RUNTIME_UNKNOWN',
  'PROTON_COMPATIBLE_CANDIDATE',
  'GAME_PATCH_UNSAFE',
  'GAME_PATCH_REVIEW_SAFE',
  'EXE_PATCH_HASH_REQUIRED',
  'REVERSIBLE_PATCH_REQUIRED',
  'GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY',
];

const SCAN_CATEGORY_LABELS = new Map([
  ['gpu_upscale_runtime', ['UPSCALE_RUNTIME_CANDIDATE']],
  ['gpu_framegen_runtime', ['FRAMEGEN_RUNTIME_CANDIDATE', 'VIDEO_INTERPOLATION_CANDIDATE']],
  ['gpu_backend_surface', []],
  ['gpu_model_assets', ['MODEL_METADATA_ONLY']],
  ['gpu_model_asset_guard', []],
  ['gpu_cuda_guard', []],
  ['gpu_runtime_platform', ['WINDOWS_ONLY_RUNTIME']],
  ['gpu_linux_proton_guard', []],
  ['gpu_game_patch_guard', []],
  ['gpu_media_pipeline', []],
  ['gpu_performance_tuning', []],
]);

const SOURCE_RECORD_LIMITS = {
  cupscale: 80,
  flowframes: 320,
};

export async function buildGpuUpscaleFramegenDataset(options) {
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });

  const rejected = [];
  const records = [];
  const sourceCommits = {
    cupscale: options.cupscaleCommit ?? 'unknown',
    flowframes: options.flowframesCommit ?? 'unknown',
    reversa: options.reversaCommit ?? 'unknown',
    huggingface: 'metadata_snapshot',
    synthetic: 'synthetic',
  };

  if (options.cupscaleScan) {
    const report = await readScanReport(options.cupscaleScan);
    records.push(...recordsFromScanReport(report, {
      sourceProject: 'cupscale',
      sourceCommit: sourceCommits.cupscale,
      sourceLicense: 'UNKNOWN',
      sourceLimit: SOURCE_RECORD_LIMITS.cupscale,
      rejected,
    }));
  }

  if (options.flowframesScan) {
    const report = await readScanReport(options.flowframesScan);
    records.push(...recordsFromScanReport(report, {
      sourceProject: 'flowframes',
      sourceCommit: sourceCommits.flowframes,
      sourceLicense: 'UNKNOWN',
      sourceLimit: SOURCE_RECORD_LIMITS.flowframes,
      rejected,
    }));
  }

  if (options.hfIndex) {
    records.push(...recordsFromHfIndex(await readTsv(options.hfIndex), {
      sourceCommit: sourceCommits.huggingface,
      rejected,
    }));
  }

  records.push(...manualRuleRecords(sourceCommits.reversa));
  records.push(...syntheticNegativeRecords(sourceCommits.synthetic));

  const deduped = dedupeRecords(records);
  ensureRequiredLabels(deduped, rejected);
  const sorted = deduped.sort((a, b) => a.record_id.localeCompare(b.record_id));
  const splits = splitRecords(sorted);

  await writeJsonl(join(outDir, 'gpu-upscale-framegen-advisory.jsonl'), sorted);
  await writeJsonl(join(outDir, 'gpu-upscale-framegen-train.jsonl'), splits.train);
  await writeJsonl(join(outDir, 'gpu-upscale-framegen-val.jsonl'), splits.val);
  await writeJsonl(join(outDir, 'gpu-upscale-framegen-test.jsonl'), splits.test);
  await writeFile(join(outDir, 'label-summary.tsv'), labelSummary(sorted), 'utf8');
  await writeFile(join(outDir, 'source-summary.tsv'), sourceSummary(sorted), 'utf8');
  await writeFile(join(outDir, 'rejected-records.tsv'), rejectedSummary(rejected), 'utf8');

  return {
    outDir,
    totalRecords: sorted.length,
    splits: {
      train: splits.train.length,
      val: splits.val.length,
      test: splits.test.length,
    },
    recordsBySource: countBy(sorted, item => item.source_project),
    labels: countLabels(sorted),
    rejected,
  };
}

export async function readScanReport(scanPath) {
  const resolved = resolve(scanPath);
  const reportPath = resolved.endsWith('.json') ? resolved : join(resolved, 'report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`Scan report does not exist: ${reportPath}`);
  }
  return JSON.parse(await readFile(reportPath, 'utf8'));
}

export async function readTsv(tsvPath) {
  const text = await readFile(resolve(tsvPath), 'utf8');
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) {
    return [];
  }
  const headers = headerLine.split('\t');
  return lines.filter(Boolean).map(line => {
    const values = line.split('\t');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

export function recordsFromScanReport(report, options) {
  const records = [];
  const relevant = (report.evidence ?? [])
    .filter(isGpuAdvisoryEvidence)
    .slice(0, options.sourceLimit);

  for (const evidence of relevant) {
    const labels = labelsFromEvidence(evidence);
    if (labels.length === 0) {
      continue;
    }
    const evidenceText = shortEvidence(evidence.extracted_text || evidence.normalized_claim || evidence.category);
    records.push(makeRecord({
      source_kind: 'scan_finding',
      source_project: options.sourceProject,
      source_path: `${report.scan?.project_root ?? options.sourceProject}::${evidence.id}`,
      source_commit: options.sourceCommit,
      source_license: options.sourceLicense,
      evidence_text: evidenceText,
      labels: [...labels, 'GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY'],
      backend: backendFromText(evidenceText, labels),
      runtime: runtimeFromText(evidenceText, labels),
      risk: riskFromLabels(labels, evidenceText),
      required_proof: requiredProofFromLabels(labels),
      recommended_action: evidence.suggested_action ?? recommendedActionFromLabels(labels),
      confidence: confidenceFromEvidence(evidence),
      source_authority: false,
      generated_artifact: true,
      notes: 'Derived from a Reversa report; useful as advisory evidence, not source authority.',
    }));

    if (isSourceAuthorityPath(evidence.source_file)) {
      records.push(makeRecord({
        source_kind: 'source',
        source_project: options.sourceProject,
        source_path: `${evidence.source_file}:${evidence.source_line_start ?? 1}`,
        source_commit: options.sourceCommit,
        source_license: options.sourceLicense,
        evidence_text: evidenceText,
        labels,
        backend: backendFromText(evidenceText, labels),
        runtime: runtimeFromText(evidenceText, labels),
        risk: riskFromLabels(labels, evidenceText),
        required_proof: requiredProofFromLabels(labels),
        recommended_action: evidence.suggested_action ?? recommendedActionFromLabels(labels),
        confidence: confidenceFromEvidence(evidence),
        source_authority: true,
        generated_artifact: false,
        notes: 'Short source-projected snippet indexed from scan evidence.',
      }));
    }
  }

  for (const patch of report.patch_candidates ?? []) {
    records.push(makeRecord({
      source_kind: 'generated_evidence',
      source_project: options.sourceProject,
      source_path: `patch_candidates:${patch.id}`,
      source_commit: options.sourceCommit,
      source_license: options.sourceLicense,
      evidence_text: shortEvidence(`${patch.title}. ${patch.reason}`),
      labels: ['GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY'],
      backend: [],
      runtime: [],
      risk: ['review_item_not_auto_patch'],
      required_proof: ['human_review', 'source_file_check'],
      recommended_action: 'Treat scan patch candidates as review items, not automatic edits.',
      confidence: patch.risk_level === 'low' ? 'medium' : 'low',
      source_authority: false,
      generated_artifact: true,
      notes: 'Patch candidate from generated scan output.',
    }));
  }

  return records;
}

export function recordsFromHfIndex(rows, options) {
  const records = [];
  for (const row of rows) {
    const labels = uniq([
      'MODEL_METADATA_ONLY',
      'MODEL_WEIGHT_DOWNLOAD_DEFERRED',
      ...splitClasses(row.reversa_classification),
      row.license_unknown === 'true' || row.license === 'UNKNOWN' ? 'MODEL_LICENSE_UNKNOWN' : 'MODEL_LICENSE_OK',
      ...labelsFromBackend(row.likely_backend, row.model_files),
    ]);
    const backend = backendFromHf(row.likely_backend, row.model_files, row.framework_tags);
    const risk = [];
    if (labels.includes('MODEL_LICENSE_UNKNOWN')) risk.push('redistribution_not_decided');
    if (!row.likely_backend || row.likely_backend === 'unknown') risk.push('backend_unknown');
    if (!row.model_files || row.model_files === '.gitattributes') risk.push('sparse_metadata');
    const evidenceText = shortEvidence(`HF model ${row.model_id}; family=${row.query_family}; license=${row.license || 'UNKNOWN'}; backend=${row.likely_backend || 'unknown'}; files=${row.model_files || 'none'}`);

    records.push(makeRecord({
      source_kind: 'model_card_metadata',
      source_project: 'huggingface',
      source_path: `https://huggingface.co/${row.model_id}`,
      source_commit: options.sourceCommit,
      source_license: row.license || 'UNKNOWN',
      evidence_text: evidenceText,
      labels,
      backend,
      runtime: ['metadata_only'],
      risk,
      required_proof: ['license_review', 'model_hash', 'backend_runtime_probe', 'no_weight_download_until_review'],
      recommended_action: row.safe_local_use_note || 'Keep as metadata-only until license, provenance, hash, and backend proof are reviewed.',
      confidence: risk.length === 0 ? 'medium' : 'low',
      source_authority: true,
      generated_artifact: false,
      notes: 'Metadata-only Hugging Face index row; no weights downloaded.',
    }));

    if (risk.length > 0) {
      options.rejected.push({
        source_project: 'huggingface',
        source_path: row.model_id,
        reason: risk.join(','),
        action: 'kept_low_confidence_metadata_only',
      });
    }
  }
  return records;
}

export function manualRuleRecords(sourceCommit = 'unknown') {
  return [
    {
      text: 'Generated Reversa reports, dashboards, summaries, and training/eval packs are derived evidence and must not become source authority.',
      labels: ['GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY'],
      risk: ['self_reference_loop'],
      proof: ['original_source_file_or_raw_log'],
    },
    {
      text: 'Model files require license, provenance, hash, backend, and local-use review before download or runtime use.',
      labels: ['MODEL_METADATA_ONLY', 'MODEL_WEIGHT_DOWNLOAD_DEFERRED', 'MODEL_HASH_MISSING', 'MODEL_PROVENANCE_MISSING'],
      risk: ['model_provenance_missing'],
      proof: ['license_review', 'model_hash', 'source_url'],
    },
    {
      text: 'CUDA or RTX 5090 acceleration claims require nvidia-smi, torch.cuda availability, CUDA runtime, driver version, and backend proof.',
      labels: ['CUDA_CLAIM_UNVERIFIED'],
      risk: ['unverified_cuda_claim'],
      proof: ['nvidia_smi', 'torch_cuda_available', 'cuda_runtime', 'driver_version', 'backend_identity'],
    },
    {
      text: 'Executable patch dossiers require original and patched hashes, reversible rollback, backup, game version, offset/signature, origin, and legal/offline notes.',
      labels: ['GAME_PATCH_UNSAFE', 'EXE_PATCH_HASH_REQUIRED', 'REVERSIBLE_PATCH_REQUIRED'],
      risk: ['unsafe_binary_patch'],
      proof: ['original_hash', 'patched_hash', 'backup', 'rollback', 'version', 'offset_or_signature'],
    },
  ].map((item, index) => makeRecord({
    source_kind: 'manual_rule',
    source_project: 'reversa',
    source_path: `docs/GPU_UPSCALE_FRAMEGEN_DATASET.md#manual-rule-${index + 1}`,
    source_commit: sourceCommit,
    source_license: 'MIT',
    evidence_text: item.text,
    labels: item.labels,
    backend: backendFromText(item.text, item.labels),
    runtime: runtimeFromText(item.text, item.labels),
    risk: item.risk,
    required_proof: item.proof,
    recommended_action: recommendedActionFromLabels(item.labels),
    confidence: 'high',
    source_authority: true,
    generated_artifact: false,
    notes: 'Manual Reversa dataset rule.',
  }));
}

export function syntheticNegativeRecords(sourceCommit = 'synthetic') {
  const rows = [
    {
      text: 'Generated report claims RIFE CUDA is ready, but the report is inside local/scans/report.json.',
      labels: ['GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY', 'CUDA_CLAIM_UNVERIFIED'],
      risk: ['generated_artifact', 'unverified_cuda_claim'],
    },
    {
      text: 'ModelPath=models/rife-v4/model.pth has no license, provenance, or SHA-256 hash.',
      labels: ['MODEL_METADATA_ONLY', 'MODEL_LICENSE_UNKNOWN', 'MODEL_HASH_MISSING', 'MODEL_PROVENANCE_MISSING', 'MODEL_WEIGHT_DOWNLOAD_DEFERRED'],
      risk: ['license_unknown', 'model_hash_missing', 'model_provenance_missing'],
    },
    {
      text: 'TargetExe=Game.exe FileOffset=0x123 PatchedBytes=90 without backup or hashes.',
      labels: ['GAME_PATCH_UNSAFE', 'EXE_PATCH_HASH_REQUIRED', 'REVERSIBLE_PATCH_REQUIRED'],
      risk: ['unsafe_binary_patch'],
    },
    {
      text: 'RIFE-NCNN Vulkan backend appears in docs, but device selection and model hashes are not proven.',
      labels: ['FRAMEGEN_RUNTIME_CANDIDATE', 'VIDEO_INTERPOLATION_CANDIDATE', 'VULKAN_NCNN_BACKEND_PRESENT', 'CANDIDATE_VULKAN_NCNN'],
      risk: ['runtime_unverified'],
    },
    {
      text: 'RIFE PyTorch CUDA mentions acceleration without nvidia-smi or torch.cuda proof.',
      labels: ['FRAMEGEN_RUNTIME_CANDIDATE', 'CUDA_BACKEND_PRESENT', 'CUDA_CLAIM_UNVERIFIED'],
      risk: ['unverified_cuda_claim'],
    },
    {
      text: 'ONNX Runtime DirectML provider is available on Windows, but Linux proof is absent.',
      labels: ['ONNX_BACKEND_PRESENT', 'CANDIDATE_ONNX', 'DIRECTML_BACKEND_PRESENT', 'CANDIDATE_DIRECTML', 'WINDOWS_ONLY_RUNTIME', 'LINUX_RUNTIME_UNKNOWN'],
      risk: ['runtime_unverified'],
    },
    {
      text: 'TensorRT engine candidate requires version, input shapes, source model, and engine hash before use.',
      labels: ['TENSORRT_BACKEND_PRESENT', 'CANDIDATE_TENSORRT', 'MODEL_HASH_MISSING'],
      risk: ['model_hash_missing'],
    },
    {
      text: 'Proton compatible frame-generation claim has no runtime log or artifact proof.',
      labels: ['PROTON_COMPATIBLE_CANDIDATE', 'LINUX_RUNTIME_UNKNOWN'],
      risk: ['runtime_unverified'],
    },
    {
      text: 'TargetExe=Game.exe has SHA256Before and SHA256After plus BackupPath, RollbackPlan, GameVersion, AOBSignature, patch origin, and legal offline notes.',
      labels: ['GAME_PATCH_REVIEW_SAFE'],
      risk: ['review_only_patch_dossier'],
    },
  ];

  return rows.map((row, index) => makeRecord({
    source_kind: 'negative_example',
    source_project: 'synthetic',
    source_path: `synthetic/gpu-upscale-framegen/${index + 1}`,
    source_commit: sourceCommit,
    source_license: 'synthetic',
    evidence_text: row.text,
    labels: row.labels,
    backend: backendFromText(row.text, row.labels),
    runtime: runtimeFromText(row.text, row.labels),
    risk: row.risk,
    required_proof: requiredProofFromLabels(row.labels),
    recommended_action: recommendedActionFromLabels(row.labels),
    confidence: 'high',
    source_authority: false,
    generated_artifact: false,
    notes: 'Synthetic guardrail example.',
  }));
}

function isGpuAdvisoryEvidence(evidence) {
  if (SCAN_CATEGORY_LABELS.has(evidence.category)) {
    return true;
  }
  return /\b(RIFE|DAIN|FLAVR|XVFI|IFRNet|PyTorch|CUDA|NCNN|Vulkan|FFmpeg|VapourSynth|ImageMagick|Magick\.NET|scene[- ]change|dedup|fp16|half precision|GPU IDs?|TargetExe|ModelPath|Real-?ESRGAN|SwinIR|waifu2x|ONNX|TensorRT|DirectML)\b/i
    .test(`${evidence.extracted_text ?? ''} ${evidence.normalized_claim ?? ''}`);
}

function labelsFromEvidence(evidence) {
  const labels = [...(SCAN_CATEGORY_LABELS.get(evidence.category) ?? [])];
  const claim = evidence.normalized_claim ?? '';
  const text = `${claim} ${evidence.extracted_text ?? ''}`;
  for (const label of REQUIRED_LABELS) {
    if (text.includes(label)) {
      labels.push(label);
    }
  }
  if (/\bRIFE|DAIN|FLAVR|XVFI|IFRNet|interpolation\b/i.test(text)) {
    labels.push('VIDEO_INTERPOLATION_CANDIDATE');
  }
  if (/\bNCNN|ncnn-vulkan|Vulkan NCNN\b/i.test(text)) {
    labels.push('VULKAN_NCNN_BACKEND_PRESENT', 'CANDIDATE_VULKAN_NCNN');
  }
  if (/\bPyTorch|torch\.cuda|CUDA\b/i.test(text)) {
    labels.push('CUDA_BACKEND_PRESENT');
  }
  if (/\bONNX\b/i.test(text)) {
    labels.push('ONNX_BACKEND_PRESENT', 'CANDIDATE_ONNX');
  }
  if (/\bTensorRT\b/i.test(text)) {
    labels.push('TENSORRT_BACKEND_PRESENT', 'CANDIDATE_TENSORRT');
  }
  if (/\bDirectML\b/i.test(text)) {
    labels.push('DIRECTML_BACKEND_PRESENT', 'CANDIDATE_DIRECTML');
  }
  return uniq(labels).filter(label => REQUIRED_LABELS.includes(label));
}

function labelsFromBackend(likelyBackend = '', modelFiles = '') {
  const text = `${likelyBackend} ${modelFiles}`;
  const labels = [];
  if (/\bPyTorch|\.pth|\.pt\b/i.test(text)) labels.push('CANDIDATE_CUDA_5090');
  if (/\bONNX|\.onnx\b/i.test(text)) labels.push('ONNX_BACKEND_PRESENT', 'CANDIDATE_ONNX');
  if (/\bNCNN|\.param\b/i.test(text)) labels.push('VULKAN_NCNN_BACKEND_PRESENT', 'CANDIDATE_VULKAN_NCNN');
  if (/\bTensorRT|\.engine\b/i.test(text)) labels.push('TENSORRT_BACKEND_PRESENT', 'CANDIDATE_TENSORRT');
  if (/\bDirectML\b/i.test(text)) labels.push('DIRECTML_BACKEND_PRESENT', 'CANDIDATE_DIRECTML');
  return labels;
}

function splitClasses(value = '') {
  return String(value)
    .split(';')
    .map(item => item.trim())
    .filter(label => REQUIRED_LABELS.includes(label));
}

function backendFromHf(likelyBackend = '', modelFiles = '', frameworkTags = '') {
  return backendFromText(`${likelyBackend} ${modelFiles} ${frameworkTags}`, labelsFromBackend(likelyBackend, modelFiles));
}

function backendFromText(text, labels = []) {
  const backends = [];
  if (labels.includes('CUDA_BACKEND_PRESENT') || labels.includes('CANDIDATE_CUDA_5090') || /\bCUDA|PyTorch|\.pth|\.pt\b/i.test(text)) backends.push('cuda', 'pytorch');
  if (labels.includes('VULKAN_NCNN_BACKEND_PRESENT') || labels.includes('CANDIDATE_VULKAN_NCNN') || /\bNCNN|Vulkan|\.param\b/i.test(text)) backends.push('vulkan_ncnn');
  if (labels.includes('ONNX_BACKEND_PRESENT') || labels.includes('CANDIDATE_ONNX') || /\bONNX|\.onnx\b/i.test(text)) backends.push('onnx');
  if (labels.includes('TENSORRT_BACKEND_PRESENT') || labels.includes('CANDIDATE_TENSORRT') || /\bTensorRT|\.engine\b/i.test(text)) backends.push('tensorrt');
  if (labels.includes('DIRECTML_BACKEND_PRESENT') || labels.includes('CANDIDATE_DIRECTML') || /\bDirectML\b/i.test(text)) backends.push('directml');
  return uniq(backends);
}

function runtimeFromText(text, labels = []) {
  const runtime = [];
  if (labels.includes('WINDOWS_ONLY_RUNTIME') || /\bWindows|WinForms|\.dll|\.exe\b/i.test(text)) runtime.push('windows');
  if (labels.includes('LINUX_RUNTIME_UNKNOWN') || /\bLinux|SteamOS|Steam Deck\b/i.test(text)) runtime.push('linux');
  if (labels.includes('PROTON_COMPATIBLE_CANDIDATE') || /\bProton|Wine\b/i.test(text)) runtime.push('proton_wine');
  if (/\bFFmpeg|VapourSynth|ImageMagick|Magick\.NET\b/i.test(text)) runtime.push('media_pipeline');
  if (labels.includes('MODEL_METADATA_ONLY')) runtime.push('metadata_only');
  return uniq(runtime);
}

function riskFromLabels(labels, text = '') {
  const risk = [];
  if (labels.includes('MODEL_LICENSE_UNKNOWN')) risk.push('redistribution_not_decided');
  if (labels.includes('MODEL_HASH_MISSING')) risk.push('model_hash_missing');
  if (labels.includes('MODEL_PROVENANCE_MISSING')) risk.push('model_provenance_missing');
  if (labels.includes('CUDA_CLAIM_UNVERIFIED')) risk.push('unverified_cuda_claim');
  if (labels.includes('LINUX_RUNTIME_UNKNOWN') || labels.includes('PROTON_COMPATIBLE_CANDIDATE')) risk.push('runtime_unverified');
  if (labels.includes('GAME_PATCH_UNSAFE') || labels.includes('EXE_PATCH_HASH_REQUIRED') || labels.includes('REVERSIBLE_PATCH_REQUIRED')) risk.push('unsafe_binary_patch');
  if (labels.includes('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY')) risk.push('generated_artifact');
  if (/\bDRM|anti-cheat|public match|ranked\b/i.test(text)) risk.push('safety_boundary');
  return uniq(risk);
}

function requiredProofFromLabels(labels) {
  const proof = [];
  if (labels.some(label => label.startsWith('MODEL_'))) proof.push('license_review', 'model_hash', 'provenance_url');
  if (labels.includes('CUDA_CLAIM_UNVERIFIED') || labels.includes('CANDIDATE_CUDA_5090')) proof.push('nvidia_smi', 'torch_cuda_available', 'cuda_runtime', 'driver_version');
  if (labels.includes('VULKAN_NCNN_BACKEND_PRESENT') || labels.includes('CANDIDATE_VULKAN_NCNN')) proof.push('vulkan_device_selection', 'ncnn_binary_provenance', 'model_hash');
  if (labels.includes('CANDIDATE_ONNX')) proof.push('onnx_execution_provider', 'opset', 'model_hash');
  if (labels.includes('CANDIDATE_TENSORRT')) proof.push('tensorrt_version', 'engine_rebuild_or_hash', 'input_shapes');
  if (labels.includes('CANDIDATE_DIRECTML')) proof.push('directml_provider', 'windows_driver_evidence');
  if (labels.includes('LINUX_RUNTIME_UNKNOWN') || labels.includes('PROTON_COMPATIBLE_CANDIDATE')) proof.push('linux_or_proton_runtime_log');
  if (labels.includes('GAME_PATCH_UNSAFE') || labels.includes('GAME_PATCH_REVIEW_SAFE')) proof.push('original_hash', 'patched_hash', 'backup', 'rollback', 'version', 'offset_or_signature');
  if (labels.includes('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY')) proof.push('original_source_or_raw_log');
  return uniq(proof);
}

function recommendedActionFromLabels(labels) {
  if (labels.includes('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY')) return 'Trace this record back to original source or raw proof before using it as authority.';
  if (labels.includes('GAME_PATCH_UNSAFE')) return 'Keep as review-only until hash, backup, rollback, version, and signature proof exists.';
  if (labels.includes('CUDA_CLAIM_UNVERIFIED')) return 'Require direct CUDA host/runtime proof before promoting acceleration claims.';
  if (labels.includes('MODEL_LICENSE_UNKNOWN')) return 'Keep as research-only metadata until provenance and redistribution status are reviewed.';
  return 'Use as advisory classification evidence only.';
}

function confidenceFromEvidence(evidence) {
  if (evidence.confidence === 'confirmed') return 'high';
  if (evidence.confidence === 'likely') return 'medium';
  return 'low';
}

function isSourceAuthorityPath(path = '') {
  if (!path || isGeneratedEvidencePath(path)) return false;
  return !/(^|\/)(report\.json|summary\.md|dashboard\.html|agent_handoff|reversa-scans|reversa-datasets|local\/scans|local\/evals|training-pack|eval_report)/i.test(path);
}

function isGeneratedEvidencePath(path = '') {
  return /(^|\/)(local\/scans|local\/evals|reversa-scans|reversa-datasets|agent_handoff|.*training.*|.*eval.*|dashboard\.html|report\.json|summary\.md|contradictions\.json|patch_candidates\.json|.*\.jsonl)$/i.test(path);
}

function makeRecord(input) {
  const evidenceText = shortEvidence(input.evidence_text);
  const base = {
    schema_version: 1,
    record_id: '',
    source_kind: input.source_kind,
    source_project: input.source_project,
    source_path: input.source_path,
    source_commit: input.source_commit,
    source_license: input.source_license,
    evidence_text: evidenceText,
    evidence_hash: sha256(evidenceText),
    labels: uniq(input.labels ?? []).filter(label => REQUIRED_LABELS.includes(label)).sort(),
    backend: uniq(input.backend ?? []).sort(),
    runtime: uniq(input.runtime ?? []).sort(),
    risk: uniq(input.risk ?? []).sort(),
    required_proof: uniq(input.required_proof ?? []).sort(),
    recommended_action: input.recommended_action,
    confidence: input.confidence,
    source_authority: input.generated_artifact ? false : Boolean(input.source_authority),
    generated_artifact: Boolean(input.generated_artifact),
    notes: input.notes ?? '',
  };
  base.record_id = `gpuadvisory_${sha256([
    base.source_kind,
    base.source_project,
    base.source_path,
    base.evidence_hash,
    base.labels.join(','),
  ].join('|')).slice(0, 16)}`;
  return base;
}

function shortEvidence(text = '') {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

function dedupeRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.source_kind}:${record.source_project}:${record.source_path}:${record.evidence_hash}:${record.labels.join(',')}`;
    if (!byKey.has(key)) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()];
}

function ensureRequiredLabels(records, rejected) {
  const labels = new Set(records.flatMap(record => record.labels));
  for (const label of REQUIRED_LABELS) {
    if (!labels.has(label)) {
      rejected.push({
        source_project: 'reversa',
        source_path: 'required-labels',
        reason: `missing_required_label:${label}`,
        action: 'builder_test_should_cover_or_source_evidence_absent',
      });
    }
  }
}

function splitRecords(records) {
  const train = [];
  const val = [];
  const test = [];
  for (const record of records) {
    const bucket = Number.parseInt(record.evidence_hash.slice(0, 2), 16) % 10;
    if (bucket === 0) test.push(record);
    else if (bucket === 1) val.push(record);
    else train.push(record);
  }
  return { train, val, test };
}

async function writeJsonl(path, records) {
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
}

function labelSummary(records) {
  const counts = countLabels(records);
  return ['label\tcount', ...Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => `${label}\t${count}`)].join('\n') + '\n';
}

function sourceSummary(records) {
  const counts = countBy(records, record => `${record.source_project}\t${record.source_kind}\t${record.source_authority}\t${record.generated_artifact}`);
  return ['source_project\tsource_kind\tsource_authority\tgenerated_artifact\tcount', ...Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}\t${count}`)].join('\n') + '\n';
}

function rejectedSummary(rejected) {
  return ['source_project\tsource_path\treason\taction', ...rejected.map(item => [
    item.source_project,
    item.source_path,
    item.reason,
    item.action,
  ].map(tsvSafe).join('\t'))].join('\n') + '\n';
}

function countLabels(records) {
  const counts = {};
  for (const record of records) {
    for (const label of record.labels) {
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  return counts;
}

function countBy(records, fn) {
  const counts = {};
  for (const record of records) {
    const key = fn(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function tsvSafe(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function parseArgs(args) {
  const options = {
    cupscaleScan: null,
    flowframesScan: null,
    hfIndex: null,
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
      case '--cupscale-scan':
        options.cupscaleScan = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--flowframes-scan':
        options.flowframesScan = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--hf-index':
        options.hfIndex = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown dataset builder option: ${arg}`);
    }
  }

  if (!options.help && !options.out) {
    throw new Error('Missing required --out');
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
  node scripts/build-gpu-upscale-framegen-dataset.js \\
    --cupscale-scan <scan-dir-or-report.json> \\
    --flowframes-scan <scan-dir-or-report.json> \\
    --hf-index <HF_MODEL_METADATA_INDEX.tsv> \\
    --out <dataset-dir>

Outputs advisory JSONL splits and summaries. The builder does not download model
weights, launch runtimes, patch binaries, or mutate scanned projects.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await buildGpuUpscaleFramegenDataset(options);
  console.log(`Dataset records: ${result.totalRecords}`);
  console.log(`Output: ${result.outDir}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
