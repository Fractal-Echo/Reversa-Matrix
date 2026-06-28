import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { classifyScanFailure, loadFleetManifest } from '../lib/commands/scan-fleet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('scan-fleet parses JSON manifests relative to base dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-fleet-manifest-'));
  await mkdir(join(root, 'repo-a'));
  const manifest = join(root, 'repos.json');
  await writeFile(manifest, JSON.stringify({
    repos: [
      { name: 'repo-a', path: 'repo-a', group: 'test' },
      'repo-b',
    ],
  }), 'utf8');

  const entries = await loadFleetManifest(manifest, root);

  assert.deepEqual(entries, [
    { name: 'repo-a', path: join(root, 'repo-a'), group: 'test' },
    { name: 'repo-b', path: join(root, 'repo-b') },
  ]);
});

test('scan-fleet classifies child process OOM and timeout failures', () => {
  assert.equal(
    classifyScanFailure({ stderr: 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory' }),
    'SCAN_FAILED_OOM'
  );
  assert.equal(
    classifyScanFailure({ timedOut: true, stderr: '' }),
    'SCAN_FAILED_TIMEOUT'
  );
});

test('scan-fleet writes aggregate output and keeps missing repos as classified evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-fleet-run-'));
  const repo = join(root, 'repo-a');
  const out = join(root, 'out');
  await mkdir(repo);
  await writeFile(join(repo, 'README.md'), 'MODEL=local\n', 'utf8');
  const manifest = join(root, 'repos.json');
  await writeFile(manifest, JSON.stringify([
    { name: 'repo-a', path: repo },
    { name: 'missing-repo', path: join(root, 'missing-repo') },
  ]), 'utf8');

  const run = spawnSync(process.execPath, [
    './bin/reversa.js',
    'scan-fleet',
    '--manifest',
    manifest,
    '--profiles',
    'generic_source_tree',
    '--out',
    out,
    '--timeout-ms',
    '60000',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(await readFile(join(out, 'fleet-report.json'), 'utf8'));
  assert.equal(report.summary.total_shards, 2);
  assert.equal(report.summary.passed_shards, 1);
  assert.equal(report.summary.failed_shards, 1);
  assert.equal(report.summary.failed_classifications.SCAN_FAILED_MISSING_PROJECT_ROOT, 1);
  assert(report.results.some(item => item.repo === 'repo-a' && item.status === 'passed'));
  assert(report.results.some(item => item.repo === 'missing-repo' && item.classification === 'SCAN_FAILED_MISSING_PROJECT_ROOT'));
  assert.match(await readFile(join(out, 'fleet-summary.tsv'), 'utf8'), /missing-repo/);
  assert.match(await readFile(join(out, 'fleet-summary.md'), 'utf8'), /SCAN_FAILED_MISSING_PROJECT_ROOT/);
});
