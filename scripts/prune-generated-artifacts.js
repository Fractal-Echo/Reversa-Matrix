#!/usr/bin/env node

import { mkdir, rename, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join, relative, resolve } from 'path';

const ROOT = process.cwd();
const TARGETS = [
  '.reversa',
  'agent_handoff',
  'dashboard.html',
  'evidence.jsonl',
  'report.html',
  'report.json',
  'reversa_out',
  'reversa_compare_out',
  'site',
  'summary.md',
];

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const deleteInstead = args.has('--delete');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archiveRoot = resolve(ROOT, 'local', 'pruned-generated', stamp);

const found = [];
for (const target of TARGETS) {
  const path = resolve(ROOT, target);
  if (!existsSync(path)) continue;
  assertInsideRoot(path);
  const info = await stat(path);
  found.push({
    target,
    path,
    type: info.isDirectory() ? 'directory' : 'file',
    size: info.size,
  });
}

if (!execute) {
  printPlan('dry-run', found);
  process.exit(0);
}

const actions = [];

if (!deleteInstead && found.length > 0) {
  await mkdir(archiveRoot, { recursive: true });
}

for (const item of found) {
  if (deleteInstead) {
    await rm(item.path, { recursive: true, force: true });
    actions.push({ ...item, action: 'deleted' });
    continue;
  }

  const destination = join(archiveRoot, basename(item.target));
  await rename(item.path, destination);
  actions.push({ ...item, action: 'archived', destination });
}

if (!deleteInstead && actions.length > 0) {
  const manifest = [
    '# Reversa Generated Artifact Prune',
    '',
    'Mode: archive',
    `Root: ${ROOT}`,
    `Archive: ${archiveRoot}`,
    '',
    '| Action | Type | Path | Destination |',
    '| --- | --- | --- | --- |',
    ...actions.map(item => `| ${item.action} | ${item.type} | \`${item.target}\` | \`${item.destination ?? ''}\` |`),
    '',
  ].join('\n');
  await writeFile(join(archiveRoot, 'MANIFEST.md'), manifest, 'utf8');
}

printPlan(deleteInstead ? 'deleted' : 'archived', actions);

function printPlan(mode, items) {
  console.log(`Reversa generated artifact prune: ${mode}`);
  if (items.length === 0) {
    console.log('No generated root artifacts found.');
    return;
  }
  for (const item of items) {
    const suffix = item.destination ? ` -> ${relative(ROOT, item.destination)}` : '';
    console.log(`- ${item.type}: ${item.target}${suffix}`);
  }
  if (!execute) {
    console.log('\nRun with --execute to archive, or --execute --delete to delete.');
  }
}

function assertInsideRoot(path) {
  const rel = relative(ROOT, path);
  if (!rel || rel.startsWith('..') || rel.includes('..' + sepCompat())) {
    throw new Error(`Refusing to prune outside repo root: ${path}`);
  }
}

function sepCompat() {
  return process.platform === 'win32' ? '\\' : '/';
}
