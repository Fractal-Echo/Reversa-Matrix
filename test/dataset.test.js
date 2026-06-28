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
import { buildPrivateCorpus } from '../scripts/build-private-corpus.js';

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

test('private corpus builder writes local-only hashed retrieval chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-private-corpus-'));
  const project = join(root, 'project');
  const notes = join(root, 'telegram-notes');
  const outDir = join(root, 'corpus');
  await mkdir(join(project, 'docs'), { recursive: true });
  await mkdir(join(project, 'reversa-scans'), { recursive: true });
  await mkdir(join(project, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(notes, { recursive: true });

  await writeFile(join(project, 'docs', 'NEBULA.md'), [
    'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS',
    'vkGetMemoryFdKHR=0',
    'real_buffer_commits=2',
    'sidecar-14 sidecar-06 force-composition',
  ].join('\n'), 'utf8');
  await writeFile(join(project, 'docs', 'secret.txt'), [
    'token=sk-test_123456789012345678901234567890',
    'nebula private corpus redaction proof',
  ].join('\n'), 'utf8');
  await writeFile(join(project, 'reversa-scans', 'report.json'), JSON.stringify({
    generated: true,
    classification: 'stale blocked_export report',
  }), 'utf8');
  await writeFile(join(project, 'node_modules', 'pkg', 'ignored.md'), 'ignore me', 'utf8');
  await writeFile(join(project, 'image.bin'), Buffer.from([0, 1, 2, 3, 0]));
  await writeFile(join(notes, 'telegram-note.md'), 'Nebula note says Wayland needs corroboration before source authority.', 'utf8');

  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    schema: 'reversa.private_corpus_manifest.v1',
    corpus_id: 'fixture-corpus',
    max_file_bytes: 8192,
    max_chunk_chars: 256,
    sources: [{
      id: 'fixture_project',
      root: project,
      role: 'repo_source',
      tags: ['nebula', 'fixture'],
    }, {
      id: 'operator_notes',
      root: notes,
      role: 'telegram_notes',
      tags: ['telegram', 'nebula'],
    }],
  }, null, 2), 'utf8');

  const result = await buildPrivateCorpus({
    manifest: manifestPath,
    out: outDir,
  });

  assert.equal(result.totalRecords, 4);
  assert(existsSync(join(outDir, 'private-corpus-records.jsonl')));
  assert(existsSync(join(outDir, 'private-corpus-train.jsonl')));
  assert(existsSync(join(outDir, 'private-corpus-val.jsonl')));
  assert(existsSync(join(outDir, 'private-corpus-test.jsonl')));
  assert(existsSync(join(outDir, 'private-corpus-index.json')));
  assert(existsSync(join(outDir, 'private-corpus-summary.md')));
  assert(existsSync(join(outDir, 'source-summary.tsv')));
  assert(existsSync(join(outDir, 'label-summary.tsv')));
  assert(existsSync(join(outDir, 'rejected-records.tsv')));
  assert(existsSync(join(outDir, 'privacy-summary.tsv')));
  assert(existsSync(join(outDir, 'result.md')));
  assert(existsSync(join(outDir, 'sha256sums.txt')));

  const records = await readJsonl(join(outDir, 'private-corpus-records.jsonl'));
  assert(records.every(record => record.local_only === true));
  assert(records.every(record => record.commit_allowed === false));
  assert(records.every(record => record.export_allowed === false));
  assert(records.every(record => record.content_sha256 && record.chunk_sha256));
  assert(records.every(record => record.manifest_sha256));

  const knownGood = records.find(record => record.relative_path === 'docs/NEBULA.md');
  assert(knownGood);
  assert.equal(knownGood.source_authority, true);
  assert.equal(knownGood.generated_artifact, false);
  assert.equal(knownGood.authority_class, 'repo_source');
  assert.equal(knownGood.training_allowed, true);
  assert(knownGood.retrieval_tags.includes('graphics'));

  const redacted = records.find(record => record.relative_path === 'docs/secret.txt');
  assert(redacted);
  assert.equal(redacted.redaction_status, 'redacted');
  assert.equal(redacted.training_allowed, false);
  assert(!redacted.text.includes('sk-test_123456789012345678901234567890'));
  assert(redacted.text.includes('[REDACTED]'));

  const generated = records.find(record => record.relative_path === 'reversa-scans/report.json');
  assert(generated);
  assert.equal(generated.source_authority, false);
  assert.equal(generated.generated_artifact, true);
  assert.equal(generated.authority_class, 'generated_artifact');
  assert.equal(generated.training_allowed, false);

  const operatorNote = records.find(record => record.source_id === 'operator_notes');
  assert(operatorNote);
  assert.equal(operatorNote.source_authority, false);
  assert.equal(operatorNote.telegram_source_authority, false);
  assert.equal(operatorNote.training_allowed, false);
  assert.equal(operatorNote.promotion_state, 'retrieval_only_requires_corroboration');

  const skipped = await readFile(join(outDir, 'rejected-records.tsv'), 'utf8');
  assert.match(skipped, /node_modules/);
  assert.match(skipped, /extension_not_indexed|binary_or_non_text/);

  const privacy = await readFile(join(outDir, 'privacy-summary.tsv'), 'utf8');
  assert.match(privacy, /docs\/secret\.txt/);
});

test('dataset command exposes private-corpus help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'private-corpus',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /private local retrieval\/training corpus/);
  assert.match(result.stdout, /Do not\s+commit generated corpus outputs/);
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
