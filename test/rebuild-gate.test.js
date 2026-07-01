import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  buildRebuildGateMarkdown,
  evaluateRebuildGate,
} from '../lib/commands/rebuild-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('rebuild gate passes only with full coverage, evals, protocols, and kernel blocker lock', async () => {
  const root = await makeGateFixture();
  const auditRoot = join(root, 'local/audits/codex-handwave-audit-20260630');

  const report = await evaluateRebuildGate({
    repoRoot: root,
    auditRoot,
  });

  assert.equal(report.classification, 'REVERSA_REBUILD_GATE_PASS_WITH_WARNINGS');
  assert.equal(report.ready_for_rebuild, true);
  assert.equal(report.deterministic_scanner_truth_above_model, true);
  assert.deepEqual(report.blocked, []);
  assert(report.warnings.includes('game_wrapper_supplement'));
  assert.equal(report.gates.find(gate => gate.id === 'full_epoch_coverage').observed.unique_rows_seen, 53631);
  assert.equal(report.gates.find(gate => gate.id === 'droidspaces_kernel_blocker_locked').observed.pid_namespace_or_config, true);

  const markdown = buildRebuildGateMarkdown(report);
  assert.match(markdown, /REVERSA_REBUILD_GATE_PASS_WITH_WARNINGS/);
  assert.match(markdown, /full_epoch_coverage/);
  assert.match(markdown, /droidspaces_kernel_blocker_locked/);
});

test('rebuild gate blocks partial training and missing Droidspaces kernel lock', async () => {
  const root = await makeGateFixture({
    training: [
      '- `coverage_complete`: `false`',
      '- `coverage_fraction`: `0.5`',
      '- `train_rows`: `53631`',
      '- `unique_rows_seen`: `12000`',
      '- `missing_rows`: `41631`',
    ].join('\n'),
    failure: 'This file forgot the hard kernel blocker.',
  });
  const auditRoot = join(root, 'local/audits/codex-handwave-audit-20260630');

  const report = await evaluateRebuildGate({
    repoRoot: root,
    auditRoot,
  });

  assert.equal(report.classification, 'REVERSA_REBUILD_GATE_BLOCKED');
  assert.equal(report.ready_for_rebuild, false);
  assert(report.blocked.includes('full_epoch_coverage'));
  assert(report.blocked.includes('droidspaces_kernel_blocker_locked'));
});

test('rebuild-gate command exposes help and can write reports', async () => {
  const root = await makeGateFixture();
  const auditRoot = join(root, 'local/audits/codex-handwave-audit-20260630');
  const outDir = join(root, 'local/rebuild-gate-check');

  const help = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'rebuild-gate',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /rebuild-gate/);
  assert.match(help.stdout, /Droidspaces kernel blocker/);

  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'rebuild-gate',
    '--audit-root',
    auditRoot,
    '--out',
    outDir,
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready_for_rebuild, true);
  assert(existsSync(join(outDir, 'rebuild-gate.json')));
  assert(existsSync(join(outDir, 'rebuild-gate.md')));
  const markdown = await readFile(join(outDir, 'rebuild-gate.md'), 'utf8');
  assert.match(markdown, /Reversa Rebuild Gate/);
});

async function makeGateFixture(overrides = {}) {
  const root = await mkdirTemp('reversa-rebuild-gate-');
  const auditRoot = join(root, 'local/audits/codex-handwave-audit-20260630');
  const protocolsRoot = join(root, 'docs/protocols');
  await mkdir(auditRoot, { recursive: true });
  await mkdir(protocolsRoot, { recursive: true });

  await writeFile(join(auditRoot, 'training-full-epoch-capture.md'), overrides.training ?? [
    '- `coverage_complete`: `true`',
    '- `coverage_fraction`: `1.0`',
    '- `train_rows`: `53631`',
    '- `unique_rows_seen`: `53631`',
    '- `missing_rows`: `0`',
  ].join('\n'), 'utf8');
  await writeFile(join(auditRoot, 'eval-gate-capture.md'), overrides.evalGate ?? [
    'Status: held-out and adversarial offline adapter-loss evals completed.',
    'Finite loss reported.',
  ].join('\n'), 'utf8');
  await writeFile(join(auditRoot, 'game-wrapper-supplement-capture.md'), overrides.supplement ?? [
    'Supplement finite.',
    'The game-wrapper supplement did not solve the original held-out high-loss shape.',
  ].join('\n'), 'utf8');
  await writeFile(join(auditRoot, 'failure-log.md'), overrides.failure ?? [
    'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL',
    'PID namespace -> CONFIG_PID_NS=y',
    'IPC namespace -> CONFIG_IPC_NS=y',
  ].join('\n'), 'utf8');
  await writeFile(join(auditRoot, 'full-stack-addendum.md'), 'Current stack addendum.\n', 'utf8');

  await writeFile(join(protocolsRoot, 'OPERATOR_STEER_PROTOCOL.md'), [
    'Treat operator diagnosis as a priority hypothesis.',
    'Operator steer is a priority hypothesis.',
  ].join('\n'), 'utf8');
  await writeFile(join(protocolsRoot, 'REVERSA_REBUILD_ONE_SHOT_CONTRACT.md'), [
    'Read the current source-of-truth.',
    'Fail if the assistant calls training complete without coverage proof.',
    'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL',
  ].join('\n'), 'utf8');

  return root;
}

async function mkdirTemp(prefix) {
  const { mkdtemp } = await import('fs/promises');
  return mkdtemp(join(tmpdir(), prefix));
}
