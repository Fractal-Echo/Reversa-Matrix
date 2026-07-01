import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildDroidspacesKernelBundleMarkdown,
  inspectDroidspacesKernelBundle,
} from '../lib/nebula/kernel-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const READY_REQUIREMENTS = [
  'Droidspaces v6.3.0 requirements',
  'PID namespace: present',
  'IPC namespace: present',
  'devtmpfs: present',
  '',
].join('\n');

const BLOCKED_REQUIREMENTS = [
  'Droidspaces v6.3.0 requirements',
  'PID namespace: missing',
  'IPC namespace: missing',
  'devtmpfs: missing',
  '',
].join('\n');

const READY_CONFIG = [
  'CONFIG_NAMESPACES=y',
  'CONFIG_PID_NS=y',
  'CONFIG_IPC_NS=y',
  'CONFIG_UTS_NS=y',
  'CONFIG_NET_NS=y',
  'CONFIG_CGROUPS=y',
  'CONFIG_CGROUP_NS=y',
  'CONFIG_DEVTMPFS=y',
  'CONFIG_DEVTMPFS_MOUNT=y',
  '',
].join('\n');

const BLOCKED_CONFIG = [
  'CONFIG_NAMESPACES=y',
  '# CONFIG_PID_NS is not set',
  '# CONFIG_IPC_NS is not set',
  'CONFIG_UTS_NS=y',
  'CONFIG_NET_NS=y',
  'CONFIG_CGROUPS=y',
  'CONFIG_CGROUP_NS=y',
  '# CONFIG_DEVTMPFS is not set',
  '# CONFIG_DEVTMPFS_MOUNT is not set',
  '',
].join('\n');

test('Droidspaces kernel bundle checker reports incomplete required artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-kernel-bundle-missing-'));
  await writeFile(join(root, 'droidspaces-v6.3.0-requirements.txt'), BLOCKED_REQUIREMENTS, 'utf8');

  const report = await inspectDroidspacesKernelBundle({ root });

  assert.equal(report.classification, 'DROIDSPACES_KERNEL_BUNDLE_INCOMPLETE');
  assert(report.missing_required.includes('kernel_config'));
  assert(report.missing_required.includes('boot_img'));
  assert.equal(report.read_only, true);
  assert.equal(report.mutation_allowed, false);
});

test('Droidspaces kernel bundle checker locks PID/IPC current-kernel blocker', async () => {
  const root = await completeBundle({ requirements: BLOCKED_REQUIREMENTS, kernelConfig: BLOCKED_CONFIG });

  const report = await inspectDroidspacesKernelBundle({ root });

  assert.equal(report.classification, 'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL');
  assert.deepEqual(report.hard_blockers.current_kernel_requirements, ['PID namespace', 'IPC namespace']);
  assert.deepEqual(report.hard_blockers.kernel_config_targets, ['CONFIG_PID_NS', 'CONFIG_IPC_NS']);
  assert(report.warnings.includes('devtmpfs_missing_in_booted_requirement_check'));
  assert.match(report.stop_condition, /PID namespace and IPC namespace/);
});

test('Droidspaces kernel bundle checker accepts complete PID/IPC proof for review', async () => {
  const root = await completeBundle({ requirements: READY_REQUIREMENTS, kernelConfig: READY_CONFIG });

  const report = await inspectDroidspacesKernelBundle({ root });
  const markdown = buildDroidspacesKernelBundleMarkdown(report);

  assert.equal(report.classification, 'DROIDSPACES_KERNEL_BUNDLE_READY_FOR_REBUILD_REVIEW');
  assert.equal(report.ready_for_rebuild_review, true);
  assert.equal(report.missing_required.length, 0);
  assert.equal(report.missing_required_config_targets.length, 0);
  assert.match(markdown, /Droidspaces Kernel Bundle Gate/);
  assert.match(markdown, /CONFIG_PID_NS/);
});

test('Nebula kernel-bundle CLI writes JSON and markdown artifacts', async () => {
  const root = await completeBundle({ requirements: BLOCKED_REQUIREMENTS, kernelConfig: BLOCKED_CONFIG });
  const outDir = join(root, 'out');

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'nebula',
    'kernel-bundle',
    '--root',
    root,
    '--out',
    outDir,
    '--json',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const stdout = JSON.parse(run.stdout);
  assert.equal(stdout.classification, 'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL');
  assert(existsSync(join(outDir, 'droidspaces-kernel-bundle.json')));
  assert(existsSync(join(outDir, 'droidspaces-kernel-bundle.md')));

  const artifact = JSON.parse(await readFile(join(outDir, 'droidspaces-kernel-bundle.json'), 'utf8'));
  assert.equal(artifact.classification, 'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL');
});

async function completeBundle({ requirements, kernelConfig }) {
  const root = await mkdtemp(join(tmpdir(), 'reversa-kernel-bundle-'));
  await mkdir(join(root, 'vendor_dlkm'), { recursive: true });
  const files = {
    'droidspaces-v6.3.0-requirements.txt': requirements,
    'uname-a.txt': 'Linux rm11pro 6.6.0-test #1 SMP PREEMPT\n',
    'kernel.config': kernelConfig,
    defconfig: kernelConfig,
    'boot.img': 'boot image placeholder\n',
    'vendor_boot.img': 'vendor boot image placeholder\n',
    'dtbo.img': 'dtbo image placeholder\n',
    'vbmeta.img': 'vbmeta image placeholder\n',
    'dmesg.txt': '[0.0] dmesg placeholder\n',
    'logcat.txt': 'logcat placeholder\n',
    'build.log': 'build log placeholder\n',
  };
  await Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(root, name), text, 'utf8')));
  return root;
}
