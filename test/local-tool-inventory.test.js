import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildLocalToolInventory,
  normalizeLocalToolPath,
} from '../scripts/build-local-tool-inventory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('local tool inventory normalizes Windows drive paths for WSL', () => {
  assert.equal(
    normalizeLocalToolPath('D:\\Applications\\DLSS.Updater.2.8.0'),
    '/mnt/d/Applications/DLSS.Updater.2.8.0'
  );
  assert.equal(
    normalizeLocalToolPath('E:/SteamLibrary/common'),
    '/mnt/e/SteamLibrary/common'
  );
});

test('local tool inventory builds bounded local-only metadata and SFT rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-local-tool-inventory-'));
  const toolDir = join(root, 'Applications', 'Wrappers and Injectors', 'Fake Wrapper');
  const outDir = join(root, 'out');
  const manifestPath = join(root, 'tools.json');
  await mkdir(toolDir, { recursive: true });
  await writeFile(join(toolDir, 'Wrapper.exe'), 'fake exe\n', 'utf8');
  await writeFile(join(toolDir, 'dxgi.dll'), 'fake dll\n', 'utf8');
  await writeFile(join(toolDir, 'settings.ini'), '[main]\n', 'utf8');
  await writeFile(join(toolDir, 'README.txt'), 'local tool docs\n', 'utf8');
  await writeFile(manifestPath, JSON.stringify({
    tools: [
      {
        id: 'fake_wrapper',
        label: 'Fake Wrapper',
        path: toolDir,
        tags: ['wrapper', 'vulkan'],
      },
      {
        id: 'missing_tool',
        path: join(root, 'Applications', 'Missing'),
      },
    ],
  }, null, 2), 'utf8');

  const result = await buildLocalToolInventory({
    manifest: manifestPath,
    out: outDir,
    maxDepth: 2,
    maxFiles: 20,
    maxHashes: 8,
  });

  assert.equal(result.totalRecords, 2);
  assert.equal(result.present, 1);
  assert.equal(result.missing, 1);
  assert(existsSync(join(outDir, 'local-tool-inventory.jsonl')));
  assert(existsSync(join(outDir, 'local-tool-inventory-sft.jsonl')));
  assert(existsSync(join(outDir, 'sha256sums.txt')));

  const bundle = JSON.parse(await readFile(join(outDir, 'local-tool-inventory.json'), 'utf8'));
  const fake = bundle.records.find(record => record.id === 'fake_wrapper');
  assert.equal(fake.source_boundary, 'local_metadata_only');
  assert.equal(fake.launch_allowed, false);
  assert.equal(fake.redistribution_allowed, false);
  assert.deepEqual(fake.executable_names, ['Wrapper.exe']);
  assert.deepEqual(fake.dll_names, ['dxgi.dll']);
  assert(fake.config_names.includes('settings.ini'));
  assert(fake.representative_hashes.some(hash => hash.relative_path === 'Wrapper.exe' && hash.hash_scope === 'full_file'));

  const sft = await readFile(join(outDir, 'local-tool-inventory-sft.jsonl'), 'utf8');
  assert.match(sft, /local_metadata_only/);
  assert.match(sft, /Do not launch tools/);
});

test('dataset command exposes and runs local-tool-inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-local-tool-cli-'));
  const toolDir = join(root, 'NvidiaProfileInspector');
  const outDir = join(root, 'out');
  const manifestPath = join(root, 'tools.json');
  await mkdir(toolDir, { recursive: true });
  await writeFile(join(toolDir, 'nvidiaProfileInspector.exe'), 'fake profile inspector\n', 'utf8');
  await writeFile(manifestPath, JSON.stringify({ tools: [{ id: 'npi', path: toolDir }] }), 'utf8');

  const help = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'local-tool-inventory',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /local-tool-inventory/);

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'dataset',
    'local-tool-inventory',
    '--manifest',
    manifestPath,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /local tool inventory complete/i);
  assert(existsSync(join(outDir, 'local-tool-inventory-summary.md')));
});
