import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildTelegramPromotionDataset } from '../scripts/build-telegram-promotion-dataset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('telegram promotion gate keeps text-only notes non-authoritative', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-telegram-promotion-'));
  const claims = join(root, 'claims.jsonl');
  const out = join(root, 'out');

  await writeJsonl(claims, [
    telegramClaim('telegram_text_only', 'Nebula DRM lease external display uses SCM_RIGHTS into wlroots.'),
  ]);

  const result = await buildTelegramPromotionDataset({ claims, out });
  assert.equal(result.promoted, 0);
  assert.equal(result.artifactBacked, 0);
  assert.equal(result.corroborationNeeded, 1);

  const records = await readJsonl(join(out, 'telegram-promotion-records.jsonl'));
  assert.equal(records[0].promotion_state, 'corroboration_needed');
  assert.equal(records[0].source_authority, false);
  assert.equal(records[0].telegram_source_authority, false);
});

test('telegram promotion gate promotes when tracked source corroborates the claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-telegram-promotion-'));
  const claims = join(root, 'claims.jsonl');
  const sourceDir = join(root, 'Droidspaces-Nebula', 'docs', 'integration');
  const out = join(root, 'out');
  await mkdir(sourceDir, { recursive: true });

  await writeJsonl(claims, [
    telegramClaim('telegram_drm', 'Nebula DRM lease external display uses SCM_RIGHTS into wlroots labwc with composer fd.'),
  ]);
  await writeFile(join(sourceDir, 'DRM_CONTROL_REFERENCE.md'), [
    '# DRM Control Reference',
    'The broker leases only external-display objects.',
    'The leased fd is sent into the Linux container over a Unix socket with SCM_RIGHTS.',
    'Patched wlroots consumes the received lease fd and labwc can render directly.',
    'Android composer remains alive and owns the card0 composer fd.',
  ].join('\n'), 'utf8');

  const result = await buildTelegramPromotionDataset({
    claims,
    corroborators: [sourceDir],
    out,
  });
  assert.equal(result.promoted, 1);

  const promoted = await readJsonl(join(out, 'promoted-evidence.jsonl'));
  assert.equal(promoted[0].promotion_state, 'promoted');
  assert.equal(promoted[0].source_authority, true);
  assert.equal(promoted[0].telegram_source_authority, false);
  assert.equal(promoted[0].corroborators[0].kind, 'repo_source');
});

test('telegram promotion gate does not let generated Reversa output promote a claim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-telegram-promotion-'));
  const claims = join(root, 'claims.jsonl');
  const generatedDir = join(root, 'local', 'scans');
  const out = join(root, 'out');
  await mkdir(generatedDir, { recursive: true });

  await writeJsonl(claims, [
    telegramClaim('telegram_generated_only', 'Nebula DRM lease external display uses SCM_RIGHTS into wlroots.'),
  ]);
  await writeFile(join(generatedDir, 'report.json'), JSON.stringify({
    evidence: [{
      extracted_text: 'Nebula DRM lease external display uses SCM_RIGHTS into wlroots.',
    }],
  }), 'utf8');

  const result = await buildTelegramPromotionDataset({
    claims,
    corroborators: [generatedDir],
    out,
  });
  assert.equal(result.promoted, 0);
  assert.equal(result.corroborationNeeded, 1);

  const records = await readJsonl(join(out, 'telegram-promotion-records.jsonl'));
  assert.equal(records[0].promotion_state, 'corroboration_needed');
  assert.equal(records[0].source_authority, false);
  assert.equal(records[0].corroborators[0].generated_artifact, true);
});

test('telegram promotion gate treats hashed video with extracted content as artifact-backed evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-telegram-promotion-'));
  const claims = join(root, 'claims.jsonl');
  const manifest = join(root, 'media.jsonl');
  const out = join(root, 'out');

  await writeJsonl(claims, [
    telegramClaim('telegram_video_backed', 'Nebula DRM lease external display uses SCM_RIGHTS into wlroots.', {
      media_ids: ['video-1'],
    }),
  ]);
  await writeJsonl(manifest, [{
    media_id: 'video-1',
    path: 'D:/Downloads/2026-06-22 03-23-14.mp4',
    sha256: 'b54e64faec2b627020a324e8c998a7720522ec86531e404200a349664bdf9582',
    content_summary: 'Video evidence shows Nebula DRM lease external display and SCM_RIGHTS wlroots handoff.',
  }]);

  const result = await buildTelegramPromotionDataset({
    claims,
    artifactManifests: [manifest],
    out,
  });
  assert.equal(result.promoted, 0);
  assert.equal(result.artifactBacked, 1);

  const backed = await readJsonl(join(out, 'artifact-backed-evidence.jsonl'));
  assert.equal(backed[0].promotion_state, 'artifact_backed');
  assert.equal(backed[0].source_authority, false);
  assert.equal(backed[0].artifact_hash_authority, true);
});

test('telegram promotion gate keeps hash-only video as extraction-needed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-telegram-promotion-'));
  const claims = join(root, 'claims.jsonl');
  const manifest = join(root, 'media.jsonl');
  const out = join(root, 'out');

  await writeJsonl(claims, [
    telegramClaim('telegram_hash_only', 'Nebula DRM lease external display uses SCM_RIGHTS into wlroots.', {
      media_ids: ['video-2'],
    }),
  ]);
  await writeJsonl(manifest, [{
    media_id: 'video-2',
    path: 'D:/Downloads/2026-06-22 03-43-05.mp4',
    sha256: 'a1d13d6da3d9f1a720ddb53e6eddb9b83e7aff7f9d6d930ad5a0c5035c4a32ec',
  }]);

  const result = await buildTelegramPromotionDataset({
    claims,
    artifactManifests: [manifest],
    out,
  });
  assert.equal(result.promoted, 0);
  assert.equal(result.artifactBacked, 0);
  assert.equal(result.corroborationNeeded, 1);

  const records = await readJsonl(join(out, 'telegram-promotion-records.jsonl'));
  assert.equal(records[0].promotion_state, 'artifact_backed_needs_content_extraction');
  assert.equal(records[0].artifact_hash_authority, true);
  assert(records[0].required_proof.includes('video_frame_extract_or_transcript'));
});

test('dataset command exposes telegram-promotion help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'telegram-promotion',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /telegram-promotion/);
  assert.match(result.stdout, /Hashed files and videos/);
});

function telegramClaim(id, text, overrides = {}) {
  return {
    schema_version: 'telegram-evidence.v1',
    id,
    message_hash: `${id}_hash`,
    extracted_text: text,
    normalized_claim: `telegram.reported.${id}=${text}`,
    labels: ['SOURCE:TELEGRAM', 'EVIDENCE:CLAIM_UNVERIFIED', 'STATUS:ACTIONABLE'],
    source_authority: false,
    media_ids: [],
    ...overrides,
  };
}

async function writeJsonl(path, rows) {
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

async function readJsonl(path) {
  assert(existsSync(path), `missing ${path}`);
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
