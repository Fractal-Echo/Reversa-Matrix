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
import { buildLocalCoderSftDataset } from '../scripts/build-local-coder-sft-dataset.js';
import { buildPrivateCorpus } from '../scripts/build-private-corpus.js';
import { queryPrivateCorpus } from '../scripts/query-private-corpus.js';

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

test('private corpus can mark reference material as local experimental training only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-private-corpus-local-training-'));
  const reference = join(root, 'reference');
  const outDir = join(root, 'corpus');
  await mkdir(reference, { recursive: true });
  await writeFile(join(reference, 'SKILL.md'), [
    '# Reference Skill',
    '',
    'Observe patterns, cluster failures, predict the next test, and verify with proof.',
  ].join('\n'), 'utf8');

  const manifestPath = join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    schema: 'reversa.private_corpus_manifest.v1',
    corpus_id: 'local-training-fixture',
    max_file_bytes: 8192,
    max_chunk_chars: 512,
    sources: [{
      id: 'reference_only_skill',
      root: reference,
      role: 'operator_note',
      tags: ['skills', 'reference_only'],
      training_allowed: true,
      local_experimental_training_allowed: true,
    }],
  }, null, 2), 'utf8');

  await buildPrivateCorpus({
    manifest: manifestPath,
    out: outDir,
  });

  const records = await readJsonl(join(outDir, 'private-corpus-records.jsonl'));
  assert.equal(records.length, 1);
  assert.equal(records[0].source_authority, false);
  assert.equal(records[0].authority_class, 'operator_note');
  assert.equal(records[0].training_allowed, true);
  assert.equal(records[0].local_experimental_training_allowed, true);
  assert.equal(records[0].training_scope, 'personal_local_experimental_only_no_redistribution');
  assert.equal(records[0].export_allowed, false);
  assert.equal(records[0].redistribution_allowed, false);
  assert.equal(records[0].commercial_use_allowed, false);
  assert.equal(records[0].fine_tune_allowed, false);
});

test('agentic pack keeps personal-local no-copy references trainable as pattern signal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-agentic-pack-personal-local-'));
  const scanOut = join(root, 'scan', 'claude_code_modern');
  const outDir = join(root, 'pack');
  await mkdir(scanOut, { recursive: true });
  await writeFile(join(scanOut, 'report.json'), JSON.stringify({
    summary: {
      total_findings: 12,
      total_contradictions: 0,
      total_patch_candidates: 1,
      highest_severity: 'LOW',
      by_category: {
        agent_skill_contracts: 7,
        permission_safety_policy: 5,
      },
    },
    tree_inventory: {
      important_files: ['skills/example/SKILL.md'],
    },
  }, null, 2), 'utf8');

  const manifestPath = join(root, 'source-sync.json');
  await writeFile(manifestPath, JSON.stringify({
    generated_at: '2026-06-29',
    target: {
      repo: 'Fractal-Echo/Reversa-Matrix',
    },
    reversa_profile: 'claude_code_modern',
    sources: [{
      repo: 'example/reference-skills',
      url: 'https://example.test/reference-skills',
      default_branch: 'main',
      commit: 'abc123',
      local_path: join(root, 'reference'),
      claude_code_modern_scan_output: scanOut,
      license_evidence: 'No root license observed.',
      import_stance: 'concept_only_training_reference_only_no_copy_reversa_owned_rewrite',
    }],
  }, null, 2), 'utf8');

  const result = spawnSync(process.execPath, [
    join(repoRoot, 'scripts/build-agentic-training-pack.js'),
    '--manifest',
    manifestPath,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const records = await readJsonl(join(outDir, 'agentic-training-pack.jsonl'));
  const sourcePolicy = records.find(record => record.type === 'source_import_policy');
  assert.equal(sourcePolicy.import_policy_class, 'personal_local');
  assert.equal(sourcePolicy.training_weight, 35);
  assert.equal(sourcePolicy.local_experimental_training_allowed, true);
  assert.equal(sourcePolicy.redistribution_allowed, false);
  assert.equal(sourcePolicy.commercial_use_allowed, false);
  assert.match(sourcePolicy.copy_boundary, /Do not copy/);
});

test('agentic pack accepts personal-local sources without scan reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-agentic-pack-no-scan-'));
  const outDir = join(root, 'pack');
  const localSource = join(root, 'wrapper-source');
  await mkdir(localSource, { recursive: true });
  await writeFile(join(localSource, 'README.md'), 'Wrapper reference source stays local-only.', 'utf8');

  const manifestPath = join(root, 'source-sync.json');
  await writeFile(manifestPath, JSON.stringify({
    generated_at: '2026-06-30',
    target: {
      repo: 'Fractal-Echo/Reversa-Matrix',
      local_path: repoRoot,
    },
    reversa_profile: 'wrapper_runtime',
    sources: [{
      repo: 'example/wrapper-reference',
      url: 'https://example.test/wrapper-reference',
      default_branch: 'main',
      commit: 'abc123',
      local_path: localSource,
      license_evidence: 'No redistributable source import claimed.',
      import_stance: 'reference_only_no_copy_personal_local_training_reversa_owned_rewrite',
      local_experimental_training_allowed: true,
      recommended_goodies: ['wrapper boundary patterns'],
    }],
  }, null, 2), 'utf8');

  const result = spawnSync(process.execPath, [
    join(repoRoot, 'scripts/build-agentic-training-pack.js'),
    '--manifest',
    manifestPath,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const records = await readJsonl(join(outDir, 'agentic-training-pack.jsonl'));
  const sourcePolicy = records.find(record => record.type === 'source_import_policy');
  assert.equal(sourcePolicy.import_policy_class, 'personal_local');
  assert.equal(sourcePolicy.scan_summary, null);
  assert.equal(sourcePolicy.local_experimental_training_allowed, true);
  assert.equal(sourcePolicy.redistribution_allowed, false);
  assert.equal(sourcePolicy.commercial_use_allowed, false);
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

test('private corpus search ranks source and raw proof above generated artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-private-corpus-search-'));
  const corpusDir = join(root, 'corpus');
  await mkdir(corpusDir, { recursive: true });

  const records = [
    corpusRecord({
      id: 'a',
      sourceId: 'raw_proof',
      authorityClass: 'raw_proof',
      sourceAuthority: true,
      rawProof: true,
      generated: false,
      path: 'result.md',
      text: 'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS vkGetMemoryFdKHR=0 real_buffer_commits=2 sidecar-14',
      tags: ['nebula', 'graphics', 'known_good'],
    }),
    corpusRecord({
      id: 'b',
      sourceId: 'generated_scan',
      authorityClass: 'generated_artifact',
      sourceAuthority: false,
      rawProof: false,
      generated: true,
      path: 'report.json',
      text: 'Generated report repeats NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS real_buffer_commits=2',
      tags: ['nebula', 'graphics'],
    }),
    corpusRecord({
      id: 'c',
      sourceId: 'notes',
      authorityClass: 'operator_note',
      sourceAuthority: false,
      rawProof: false,
      generated: false,
      path: 'note.md',
      text: 'Wayland note needs corroboration.',
      tags: ['nebula'],
    }),
  ];
  await writeFile(join(corpusDir, 'private-corpus-records.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  const result = await queryPrivateCorpus({
    corpus: corpusDir,
    query: 'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS real_buffer_commits',
    top: 2,
    out: join(root, 'query-out'),
  });

  assert.equal(result.returned, 2);
  assert.equal(result.results[0].source_id, 'raw_proof');
  assert.equal(result.results[0].source_authority, true);
  assert.equal(result.results[0].raw_proof, true);
  assert.equal(result.results[1].source_id, 'generated_scan');
  assert.equal(result.results[1].generated_artifact, true);
  assert(existsSync(join(root, 'query-out', 'private-corpus-query-results.json')));
  assert(existsSync(join(root, 'query-out', 'private-corpus-query-results.md')));
});

test('private corpus search performs facet-aware reranking for confirmed kernel blockers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-private-corpus-facet-search-'));
  const corpusDir = join(root, 'corpus');
  await mkdir(corpusDir, { recursive: true });

  const blockerText = [
    'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL',
    'Droidspaces v6.3.0 reports PID namespace missing and IPC namespace missing.',
    'Required targets: CONFIG_PID_NS=y and CONFIG_IPC_NS=y.',
  ].join(' ');
  const records = [
    corpusRecord({
      id: 'raw-kernel',
      sourceId: 'requirements_raw',
      authorityClass: 'raw_proof',
      sourceAuthority: true,
      rawProof: true,
      generated: false,
      path: 'droidspaces-v6.3.0-requirements.txt',
      text: blockerText,
      tags: ['droidspaces', 'kernel', 'known_good'],
    }),
    corpusRecord({
      id: 'generated-kernel',
      sourceId: 'generated_scan',
      authorityClass: 'generated_artifact',
      sourceAuthority: false,
      rawProof: false,
      generated: true,
      path: 'report.json',
      text: `Generated report repeats ${blockerText}`,
      tags: ['droidspaces', 'kernel'],
    }),
  ];
  await writeFile(join(corpusDir, 'private-corpus-records.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  const result = await queryPrivateCorpus({
    corpus: corpusDir,
    query: 'confirmed kernel blocker PID namespace IPC namespace',
    facets: ['subsystem=kernel'],
    top: 2,
    out: join(root, 'query-out'),
  });

  assert.equal(result.returned, 2);
  assert.deepEqual(result.facet_filters, [{ key: 'subsystem', value: 'kernel' }]);
  assert.equal(result.query_facet_intent.subsystem, 'kernel');
  assert.equal(result.query_facet_intent.required_next_artifact, 'running_kernel_config_and_requirements_check');
  assert.equal(result.results[0].source_id, 'requirements_raw');
  assert.equal(result.results[0].facets.subsystem, 'kernel');
  assert.equal(result.results[0].facets.authority, 'raw_artifact');
  assert.equal(result.results[0].facets.source_boundary, 'source_authority');
  assert.equal(result.results[0].facets.proof_level, 'artifact_backed');
  assert.equal(result.results[0].facets.operator_steer_state, 'confirmed_or_locked');
  assert.equal(result.results[0].facets.deterministic_truth_above_model, true);
  assert(result.results[0].facet_score > result.results[1].facet_score);
  assert.equal(result.results[1].source_id, 'generated_scan');
  assert.equal(result.results[1].facets.source_boundary, 'generated_non_authority');
  assert.equal(result.facet_summary.subsystem.kernel, 2);
  assert(existsSync(join(root, 'query-out', 'private-corpus-query-results.md')));
});

test('dataset command exposes private-corpus-search help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'private-corpus-search',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /private-corpus-search/);
  assert.match(result.stdout, /24-TET facets/);
  assert.match(result.stdout, /does not mutate source files/);
});

test('local coder SFT builder creates local-only advisory chat examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-local-coder-sft-'));
  const packPath = join(root, 'agentic-training-pack.jsonl');
  const corpusPath = join(root, 'private-corpus-records.jsonl');
  const outDir = join(root, 'sft');

  await writeFile(packPath, [
    JSON.stringify({
      type: 'source_import_policy',
      repo: 'example/reference',
      url: 'https://example.test/reference',
      license_evidence: 'Local-only reference.',
      import_stance: 'reference_only_no_copy_personal_local_training_reversa_owned_rewrite',
      import_policy_class: 'personal_local',
      training_weight: 35,
      local_experimental_training_allowed: true,
      redistribution_allowed: false,
      commercial_use_allowed: false,
      scan_summary: null,
      recommended_goodies: ['pattern recognition'],
      copy_boundary: 'Do not copy source; rewrite owned behavior.',
    }),
    JSON.stringify({
      type: 'evidence_category_weight',
      repo: 'example/reference',
      category: 'permission_safety_policy',
      count: 3,
      import_policy_class: 'personal_local',
      training_weight: 35,
      use_in_profile: true,
    }),
  ].join('\n') + '\n', 'utf8');

  await writeFile(corpusPath, [
    JSON.stringify(corpusRecord({
      id: 'source-a',
      sourceId: 'fixture_project',
      authorityClass: 'repo_source',
      sourceAuthority: true,
      rawProof: false,
      generated: false,
      path: 'docs/runtime.md',
      text: 'Vulkan wrapper frame pacing needs direct evidence, hashes, and reversible toggles.',
      tags: ['graphics', 'training'],
    })),
    JSON.stringify({
      ...corpusRecord({
        id: 'local-b',
        sourceId: 'local_reference',
        authorityClass: 'operator_note',
        sourceAuthority: false,
        rawProof: false,
        generated: false,
        path: 'SKILL.md',
        text: 'Reference pattern can be learned locally but should never become public source authority.',
        tags: ['policy', 'training'],
      }),
      training_allowed: false,
      local_experimental_training_allowed: true,
      training_scope: 'personal_local_experimental_only_no_redistribution',
    }),
    JSON.stringify({
      ...corpusRecord({
        id: 'generated-c',
        sourceId: 'generated_scan',
        authorityClass: 'generated_artifact',
        sourceAuthority: false,
        rawProof: false,
        generated: true,
        path: 'report.json',
        text: 'Generated report should not be SFT source authority.',
        tags: ['training'],
      }),
      training_allowed: true,
    }),
  ].join('\n') + '\n', 'utf8');

  const result = await buildLocalCoderSftDataset({
    packs: [packPath],
    corpus: corpusPath,
    out: outDir,
    maxCorpusRecords: 20,
    includeLocalExperimental: true,
  });

  assert.equal(result.totalExamples, 4);
  assert(existsSync(join(outDir, 'local-coder-sft.jsonl')));
  assert(existsSync(join(outDir, 'local-coder-sft-train.jsonl')));
  assert(existsSync(join(outDir, 'local-coder-sft-val.jsonl')));
  assert(existsSync(join(outDir, 'local-coder-sft-test.jsonl')));
  assert(existsSync(join(outDir, 'local-coder-sft-summary.md')));
  assert(existsSync(join(outDir, 'source-summary.tsv')));
  assert(existsSync(join(outDir, 'sha256sums.txt')));

  const records = await readJsonl(join(outDir, 'local-coder-sft.jsonl'));
  assert(records.every(record => record.local_only === true));
  assert(records.every(record => record.export_allowed === false));
  assert(records.every(record => record.advisory_only === true));
  assert(records.every(record => record.deterministic_truth_above_model === true));
  assert(records.every(record => Array.isArray(record.messages) && record.messages.length === 3));
  assert(records.some(record => record.task === 'classify_source_import_policy'));
  assert(records.some(record => record.task === 'rank_evidence_category'));
  assert.equal(records.filter(record => record.task === 'summarize_local_evidence_chunk').length, 2);
  assert(!records.some(record => /Generated report should not/.test(record.messages[1].content)));
});

test('dataset command exposes local-coder-sft help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'local-coder-sft',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /local-coder-sft/);
  assert.match(result.stdout, /advisory training data/);
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

function corpusRecord({
  id,
  sourceId,
  authorityClass,
  sourceAuthority,
  rawProof,
  generated,
  path,
  text,
  tags,
}) {
  return {
    id,
    record_id: id,
    source_id: sourceId,
    source_role: authorityClass,
    authority_class: authorityClass,
    source_authority: sourceAuthority,
    raw_proof: rawProof,
    generated_artifact: generated,
    training_allowed: sourceAuthority && !generated,
    retrieval_allowed: true,
    relative_path: path,
    chunk_index: 0,
    chunk_count: 1,
    line_start: 1,
    line_end: 1,
    content_sha256: `content-${id}`,
    chunk_sha256: `chunk-${id}`,
    retrieval_tags: tags,
    text,
  };
}
