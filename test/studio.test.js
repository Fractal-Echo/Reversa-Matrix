import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildModelLibrary,
  buildPatchDossier,
  buildProjectFixture,
  exportGpuAdvisoryUiFixtures,
} from '../scripts/export-gpu-advisory-ui-fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('studio fixture exporter reads advisory dataset and writes model library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-studio-fixtures-'));
  const dataset = join(root, 'dataset');
  const out = join(root, 'fixtures');
  await writeStudioDataset(dataset);

  const result = await exportGpuAdvisoryUiFixtures({ dataset, out });

  assert.equal(result.records, 4);
  assert.equal(result.models, 2);
  assert(existsSync(join(out, 'sample-model-library.json')));
  assert(existsSync(join(out, 'sample-project.json')));
  assert(existsSync(join(out, 'sample-patch-dossier.json')));
  assert(existsSync(join(out, 'sample-gpu-proof.json')));
  assert(existsSync(join(out, 'sample-local-fit.json')));

  const library = JSON.parse(await readFile(join(out, 'sample-model-library.json'), 'utf8'));
  assert.equal(library.source_authority, false);
  assert.equal(library.generated_fixture, true);
  assert.equal(library.models[0].source_authority, false);
});

test('studio generated fixtures remain display artifacts, not source authority', async () => {
  const records = sampleRecords();
  const project = buildProjectFixture(records, sampleLabelSummary(), sampleSourceSummary());
  const library = buildModelLibrary(records, sampleLabelSummary());
  const dossier = buildPatchDossier(records);

  assert.equal(project.source_authority, false);
  assert.equal(project.generated_fixture, true);
  assert.equal(library.source_authority, false);
  assert.equal(dossier.source_authority, false);
});

test('studio model library warns on unknown-license models', () => {
  const library = buildModelLibrary(sampleRecords(), sampleLabelSummary());
  const unknown = library.models.find(model => model.license === 'UNKNOWN');

  assert(unknown, 'expected unknown-license model fixture');
  assert.equal(unknown.licenseStatus, 'warning');
  assert.equal(unknown.acquisitionStatus, 'deferred_license_review');
});

test('studio patch dossier blocks EXE patch proposal without hash proof', () => {
  const dossier = buildPatchDossier(sampleRecords());

  assert.equal(dossier.status, 'blocked');
  assert(dossier.dossiers.some(item => item.status === 'blocked'));
  assert(dossier.dossiers.some(item => item.labels.includes('EXE_PATCH_HASH_REQUIRED')));
});

test('studio safety gate blocks CUDA/5090 claim without host proof', () => {
  const project = buildProjectFixture(sampleRecords(), sampleLabelSummary(), sampleSourceSummary());

  assert(project.safetyGate.hardBlocks.some(item => /CUDA\/5090/.test(item)));
});

test('studio Linux/Proton claim stays candidate-only without runtime evidence', () => {
  const project = buildProjectFixture(sampleRecords(), sampleLabelSummary(), sampleSourceSummary());

  assert(project.safetyGate.softWarnings.some(item => /candidate-only/.test(item)));
  assert.equal(project.backendMatrix.linuxOrProtonUnproven, 1);
});

test('studio prototype has no external network references', async () => {
  const text = await readStudioSurfaceText();

  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /\bcdn\b/i);
});

test('committed studio fixtures do not reference model weights', async () => {
  const fixtureDir = join(repoRoot, 'reversa-studio', 'fixtures');
  if (!existsSync(fixtureDir)) return;
  const names = (await readdir(fixtureDir)).filter(name => name.endsWith('.json'));
  const text = (await Promise.all(names.map(name => readFile(join(fixtureDir, name), 'utf8')))).join('\n');

  assert.doesNotMatch(text, /MODEL_WEIGHT|weight/i);
});

test('studio prototype avoids protected-runtime bypass wording', async () => {
  const text = await readStudioSurfaceText();
  const fixtureDir = join(repoRoot, 'reversa-studio', 'fixtures');
  if (existsSync(fixtureDir)) {
    const names = (await readdir(fixtureDir)).filter(name => name.endsWith('.json'));
    const fixtureText = (await Promise.all(names.map(name => readFile(join(fixtureDir, name), 'utf8')))).join('\n');
    assert.doesNotMatch(fixtureText, /anti-cheat|DRM|bypass/i);
  }

  assert.doesNotMatch(text, /anti-cheat|DRM|bypass/i);
});

test('studio command exposes export-fixtures help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'studio',
    'export-fixtures',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /export-fixtures/);
  assert.match(result.stdout, /local Reversa Studio fixtures/);
});

test('studio command exposes gpu-proof help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'studio',
    'gpu-proof',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /gpu-proof/);
  assert.match(result.stdout, /--python <path>/);
  assert.match(result.stdout, /local GPU proof/);
});

async function readStudioSurfaceText() {
  const files = [
    join(repoRoot, 'reversa-studio', 'README.md'),
    join(repoRoot, 'reversa-studio', 'index.html'),
    join(repoRoot, 'reversa-studio', 'app.js'),
    join(repoRoot, 'reversa-studio', 'styles.css'),
  ];
  return (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
}

async function writeStudioDataset(dataset) {
  await mkdir(dataset, { recursive: true });
  await writeFile(
    join(dataset, 'gpu-upscale-framegen-advisory.jsonl'),
    sampleRecords().map(record => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    join(dataset, 'label-summary.tsv'),
    [
      'label\tcount',
      'MODEL_LICENSE_UNKNOWN\t1',
      'MODEL_HASH_MISSING\t1',
      'CUDA_CLAIM_UNVERIFIED\t1',
      'PROTON_COMPATIBLE_CANDIDATE\t1',
      'GAME_PATCH_UNSAFE\t1',
      'EXE_PATCH_HASH_REQUIRED\t1',
    ].join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    join(dataset, 'source-summary.tsv'),
    [
      'source_project\tsource_kind\tsource_authority\tgenerated_artifact\tcount',
      'huggingface\tmodel_card_metadata\ttrue\tfalse\t2',
      'synthetic\tnegative_example\tfalse\tfalse\t1',
      'reversa\tmanual_rule\ttrue\tfalse\t1',
    ].join('\n') + '\n',
    'utf8',
  );
}

function sampleRecords() {
  return [
    advisoryRecord({
      record_id: 'model-unknown-license',
      source_kind: 'model_card_metadata',
      source_project: 'huggingface',
      source_path: 'example/rife-unknown',
      source_license: 'UNKNOWN',
      labels: ['MODEL_METADATA_ONLY', 'MODEL_LICENSE_UNKNOWN', 'MODEL_HASH_MISSING'],
      backend: ['cuda'],
      required_proof: ['model_hash', 'model_license'],
      recommended_action: 'Review license and hash before package planning.',
    }),
    advisoryRecord({
      record_id: 'model-reviewed-license',
      source_kind: 'model_card_metadata',
      source_project: 'huggingface',
      source_path: 'example/swinir-reviewed',
      source_license: 'mit',
      labels: ['MODEL_METADATA_ONLY', 'MODEL_LICENSE_OK', 'ONNX_BACKEND_PRESENT'],
      backend: ['onnx'],
      required_proof: ['model_hash'],
      recommended_action: 'Review hash before package planning.',
    }),
    advisoryRecord({
      record_id: 'patch-missing-hash',
      source_kind: 'negative_example',
      source_project: 'synthetic',
      labels: ['GAME_PATCH_UNSAFE', 'EXE_PATCH_HASH_REQUIRED', 'REVERSIBLE_PATCH_REQUIRED'],
      required_proof: ['original_hash', 'patched_hash', 'backup', 'version'],
      recommended_action: 'Block patch proposal until hashes and rollback proof exist.',
    }),
    advisoryRecord({
      record_id: 'linux-candidate',
      source_kind: 'manual_rule',
      source_project: 'reversa',
      labels: ['CUDA_CLAIM_UNVERIFIED', 'PROTON_COMPATIBLE_CANDIDATE'],
      backend: ['cuda'],
      required_proof: ['nvidia_smi', 'runtime_log'],
      recommended_action: 'Keep acceleration as a candidate until direct runtime proof exists.',
    }),
  ];
}

function sampleLabelSummary() {
  return [
    { label: 'MODEL_LICENSE_UNKNOWN', count: '1' },
    { label: 'MODEL_HASH_MISSING', count: '1' },
    { label: 'CUDA_CLAIM_UNVERIFIED', count: '1' },
    { label: 'PROTON_COMPATIBLE_CANDIDATE', count: '1' },
    { label: 'GAME_PATCH_UNSAFE', count: '1' },
    { label: 'EXE_PATCH_HASH_REQUIRED', count: '1' },
  ];
}

function sampleSourceSummary() {
  return [
    { source_project: 'huggingface', source_kind: 'model_card_metadata', source_authority: 'true', generated_artifact: 'false', count: '2' },
    { source_project: 'synthetic', source_kind: 'negative_example', source_authority: 'false', generated_artifact: 'false', count: '1' },
    { source_project: 'reversa', source_kind: 'manual_rule', source_authority: 'true', generated_artifact: 'false', count: '1' },
  ];
}

function advisoryRecord(overrides) {
  return {
    schema_version: 1,
    record_id: overrides.record_id,
    source_kind: overrides.source_kind,
    source_project: overrides.source_project,
    source_path: overrides.source_path ?? overrides.record_id,
    source_commit: 'fixture',
    source_license: overrides.source_license ?? 'UNKNOWN',
    evidence_text: 'Synthetic Studio fixture evidence.',
    evidence_hash: 'fixture',
    labels: overrides.labels ?? [],
    backend: overrides.backend ?? [],
    runtime: [],
    risk: [],
    required_proof: overrides.required_proof ?? [],
    recommended_action: overrides.recommended_action,
    confidence: 'medium',
    source_authority: false,
    generated_artifact: true,
    notes: 'Fixture row for Reversa Studio tests.',
  };
}
