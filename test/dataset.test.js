import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildGpuUpscaleFramegenDataset,
  manualRuleRecords,
  readScanReport,
  recordsFromHfIndex,
  recordsFromScanReport,
  syntheticNegativeRecords,
} from '../scripts/build-gpu-upscale-framegen-dataset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('gpu advisory dataset builder parses scan and HF metadata without source-authority recursion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gpu-dataset-'));
  const cupscaleScan = join(root, 'cupscale-scan');
  const flowframesScan = join(root, 'flowframes-scan');
  const outDir = join(root, 'dataset');
  await mkdir(cupscaleScan, { recursive: true });
  await mkdir(flowframesScan, { recursive: true });

  await writeFile(join(cupscaleScan, 'report.json'), JSON.stringify(fakeReport('/tmp/cupscale', [
    evidence('EV-cup-1', 'gpu_upscale_runtime', 'UPSCALE_RUNTIME_CANDIDATE', 'README.md', 'Cupscale Real-ESRGAN upscaling candidate.'),
    evidence('EV-cup-2', 'gpu_model_asset_guard', 'MODEL_HASH_MISSING', 'models.md', 'ModelPath=models/upscale.pth has no hash.'),
  ], [{
    id: 'PATCH-cup',
    title: 'Resolve placeholders in .gitignore',
    reason: 'Placeholder cleanup candidate.',
    risk_level: 'low',
  }]), null, 2), 'utf8');

  await writeFile(join(flowframesScan, 'report.json'), JSON.stringify(fakeReport('/tmp/flowframes', [
    evidence('EV-flow-1', 'gpu_framegen_runtime', 'FRAMEGEN_RUNTIME_CANDIDATE', 'README.md', 'Flowframes supports RIFE video interpolation.'),
    evidence('EV-flow-2', 'gpu_backend_surface', 'VULKAN_NCNN_BACKEND_PRESENT', 'README.md', 'RIFE-NCNN uses ncnn-vulkan.'),
    evidence('EV-flow-3', 'gpu_backend_surface', 'CUDA_BACKEND_PRESENT', 'README.md', 'RIFE PyTorch CUDA backend.'),
    evidence('EV-flow-4', 'gpu_cuda_guard', 'CUDA_CLAIM_UNVERIFIED', 'README.md', 'CUDA acceleration supported without proof.'),
    evidence('EV-flow-5', 'gpu_game_patch_guard', 'GAME_PATCH_UNSAFE', 'patches.md', 'TargetExe=Game.exe FileOffset=0x123 PatchedBytes=90'),
    evidence('EV-flow-6', 'generated_evidence_boundary', 'GENERATED_EVIDENCE:local/scans', 'local/scans/report.json', 'Generated report with model labels.'),
  ]), null, 2), 'utf8');

  const hfIndex = join(root, 'hf.tsv');
  await writeFile(hfIndex, [
    'query_family\tquery\tmodel_id\ttask_tag\tframework_tags\tlicense\tmodel_files\tsize_visible\tlast_update\tdownloads\tlikes\tinference\tsafe_local_use_note\tweights_allowed_later\tlicense_unknown\tlikely_backend\treversa_classification',
    'frame_interpolation\tRIFE\texample/rife-unknown\t\t\tUNKNOWN\t.gitattributes;model.pth\tn/a\t2026-01-01\t0\t0\tunknown\tmetadata only\tdefer_license_unknown\ttrue\tPyTorch\tMODEL_METADATA_ONLY;MODEL_WEIGHT_DOWNLOAD_DEFERRED;MODEL_LICENSE_UNKNOWN;CANDIDATE_CUDA_5090',
    'upscaling\tSwinIR\texample/swinir-onnx\t\tonnx\tmit\tmodel.onnx\tn/a\t2026-01-01\t0\t0\tunknown\tmetadata only\tyes_after_license_and_hash_review\tfalse\tONNX\tMODEL_METADATA_ONLY;MODEL_WEIGHT_DOWNLOAD_DEFERRED;MODEL_LICENSE_OK;CANDIDATE_ONNX',
  ].join('\n') + '\n', 'utf8');

  const result = await buildGpuUpscaleFramegenDataset({
    cupscaleScan,
    flowframesScan,
    hfIndex,
    out: outDir,
    cupscaleCommit: 'cup123',
    flowframesCommit: 'flow123',
    reversaCommit: 'rev123',
  });

  assert(result.totalRecords > 0);
  assert(existsSync(join(outDir, 'gpu-upscale-framegen-advisory.jsonl')));
  assert(existsSync(join(outDir, 'gpu-upscale-framegen-train.jsonl')));
  assert(existsSync(join(outDir, 'gpu-upscale-framegen-val.jsonl')));
  assert(existsSync(join(outDir, 'gpu-upscale-framegen-test.jsonl')));
  assert(existsSync(join(outDir, 'label-summary.tsv')));
  assert(existsSync(join(outDir, 'source-summary.tsv')));
  assert(existsSync(join(outDir, 'rejected-records.tsv')));

  const records = await readJsonl(join(outDir, 'gpu-upscale-framegen-advisory.jsonl'));
  const labels = new Set(records.flatMap(record => record.labels));
  assert(labels.has('MODEL_METADATA_ONLY'));
  assert(labels.has('MODEL_LICENSE_UNKNOWN'));
  assert(labels.has('MODEL_LICENSE_OK'));
  assert(labels.has('MODEL_WEIGHT_DOWNLOAD_DEFERRED'));
  assert(labels.has('CUDA_CLAIM_UNVERIFIED'));
  assert(labels.has('VULKAN_NCNN_BACKEND_PRESENT'));
  assert(labels.has('CUDA_BACKEND_PRESENT'));
  assert(labels.has('GAME_PATCH_UNSAFE'));
  assert(labels.has('EXE_PATCH_HASH_REQUIRED'));
  assert(labels.has('REVERSIBLE_PATCH_REQUIRED'));
  assert(labels.has('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY'));

  const generated = records.find(record => record.source_kind === 'scan_finding');
  assert.equal(generated.source_authority, false);
  assert.equal(generated.generated_artifact, true);

  const trainingLike = records.find(record => record.labels.includes('GENERATED_EVIDENCE_NOT_SOURCE_AUTHORITY'));
  assert.equal(trainingLike.source_authority, false);

  const flowframesSource = records.find(record => record.source_project === 'flowframes' && record.source_kind === 'source' && record.source_path.startsWith('README.md'));
  assert(flowframesSource, 'expected Flowframes source-projected record');
  assert.equal(flowframesSource.source_authority, true);

  const reversaRule = records.find(record => record.source_project === 'reversa' && record.source_kind === 'manual_rule');
  assert(reversaRule, 'expected Reversa manual rule record');
  assert.equal(reversaRule.source_authority, true);

  const unsafePatch = records.find(record => record.evidence_text.includes('TargetExe=Game.exe'));
  assert(unsafePatch.required_proof.includes('original_hash'));
  assert(unsafePatch.required_proof.includes('backup'));
  assert(unsafePatch.required_proof.includes('version'));

  assert(!records.some(record => /\b(weights_downloaded|downloaded_weights|cached_weights)\b/i.test(`${record.notes} ${record.evidence_text}`)));
});

test('gpu advisory helpers classify generated reports, HF rows, and synthetic guards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gpu-helper-'));
  const scanDir = join(root, 'scan');
  await mkdir(scanDir);
  await writeFile(join(scanDir, 'report.json'), JSON.stringify(fakeReport('/tmp/project', [
    evidence('EV-generated', 'generated_evidence_boundary', 'GENERATED_EVIDENCE:dashboard.html', 'dashboard.html', 'Dashboard HTML with model labels.'),
  ])), 'utf8');

  const report = await readScanReport(scanDir);
  const scanRecords = recordsFromScanReport(report, {
    sourceProject: 'cupscale',
    sourceCommit: 'abc',
    sourceLicense: 'UNKNOWN',
    sourceLimit: 20,
    rejected: [],
  });
  assert(scanRecords.every(record => record.source_authority === false));

  const hfRecords = recordsFromHfIndex([{
    model_id: 'example/rife-ncnn',
    query_family: 'frame_interpolation',
    license: 'UNKNOWN',
    model_files: '.gitattributes;model.param',
    likely_backend: 'NCNN',
    reversa_classification: 'MODEL_METADATA_ONLY;MODEL_WEIGHT_DOWNLOAD_DEFERRED;MODEL_LICENSE_UNKNOWN;CANDIDATE_VULKAN_NCNN',
    license_unknown: 'true',
    safe_local_use_note: 'metadata only',
  }], { sourceCommit: 'metadata', rejected: [] });
  assert(hfRecords[0].labels.includes('MODEL_METADATA_ONLY'));
  assert(hfRecords[0].labels.includes('MODEL_LICENSE_UNKNOWN'));
  assert(hfRecords[0].labels.includes('VULKAN_NCNN_BACKEND_PRESENT'));

  const manual = manualRuleRecords('rev');
  assert(manual.some(record => record.source_project === 'reversa' && record.source_authority));

  const synthetic = syntheticNegativeRecords('synthetic');
  assert(synthetic.some(record => record.labels.includes('GAME_PATCH_REVIEW_SAFE')));
  assert(synthetic.some(record => record.labels.includes('DIRECTML_BACKEND_PRESENT')));
  assert(synthetic.some(record => record.labels.includes('TENSORRT_BACKEND_PRESENT')));
});

test('dataset command exposes gpu-upscale-framegen help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'gpu-upscale-framegen',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /gpu-upscale-framegen/);
  assert.match(result.stdout, /does not download model weights/);
});

function fakeReport(projectRoot, evidenceRows, patchCandidates = []) {
  return {
    scan: { project_root: projectRoot, profile: 'gpu_upscale_framegen' },
    evidence: evidenceRows,
    patch_candidates: patchCandidates,
  };
}

function evidence(id, category, claim, sourceFile, text) {
  return {
    id,
    category,
    severity: 'HIGH',
    confidence: 'likely',
    source_file: sourceFile,
    source_line_start: 1,
    extracted_text: text,
    normalized_claim: claim,
    suggested_action: 'Review this advisory evidence.',
  };
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
