import { existsSync } from 'fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';

export const DROIDSPACES_KERNEL_STOP_CONDITION = [
  'Do not call this driver/security/ABL/runtime tuning again until PID namespace',
  'and IPC namespace are present in the booted kernel.',
].join(' ');

const REQUIRED_FILE_GROUPS = [
  { id: 'droidspaces_requirements', names: ['droidspaces-v6.3.0-requirements.txt'] },
  { id: 'uname', names: ['uname-a.txt'] },
  { id: 'kernel_config', names: ['kernel.config'] },
  { id: 'defconfig', names: ['defconfig'] },
  { id: 'boot_img', names: ['boot.img'] },
  { id: 'vendor_boot_img', names: ['vendor_boot.img'] },
  { id: 'vendor_dlkm', names: ['vendor_dlkm.img'], directoryNames: ['vendor_dlkm'] },
  { id: 'dtbo_img', names: ['dtbo.img'] },
  { id: 'vbmeta_img', names: ['vbmeta.img'] },
  { id: 'dmesg', names: ['dmesg.txt'] },
  { id: 'logcat', names: ['logcat.txt'] },
  { id: 'build_log', names: ['build.log', 'kernel-build.log', 'build-log.txt'] },
];

const REQUIRED_CONFIG_TARGETS = [
  'CONFIG_NAMESPACES',
  'CONFIG_PID_NS',
  'CONFIG_IPC_NS',
  'CONFIG_UTS_NS',
  'CONFIG_NET_NS',
  'CONFIG_CGROUPS',
  'CONFIG_CGROUP_NS',
];

const RECOMMENDED_CONFIG_TARGETS = [
  'CONFIG_DEVTMPFS',
  'CONFIG_DEVTMPFS_MOUNT',
];

const HARD_BLOCKER_CONFIG_TARGETS = [
  'CONFIG_PID_NS',
  'CONFIG_IPC_NS',
];

export async function inspectDroidspacesKernelBundle(options = {}) {
  const root = resolve(options.root ?? options.bundleRoot ?? process.cwd());
  const fileIndex = existsSync(root) ? await indexBundle(root) : [];
  const files = REQUIRED_FILE_GROUPS.map(group => resolveGroup(fileIndex, group));
  const missingRequired = files.filter(file => !file.present).map(file => file.id);

  const requirementsPath = files.find(file => file.id === 'droidspaces_requirements')?.path ?? '';
  const kernelConfigPath = files.find(file => file.id === 'kernel_config')?.path ?? '';
  const defconfigPath = files.find(file => file.id === 'defconfig')?.path ?? '';

  const requirementsText = requirementsPath ? await readOptional(requirementsPath) : '';
  const kernelConfigText = kernelConfigPath ? await readOptional(kernelConfigPath) : '';
  const defconfigText = defconfigPath ? await readOptional(defconfigPath) : '';

  const requirements = parseDroidspacesRequirements(requirementsText);
  const config = parseKernelConfigTargets(kernelConfigText || defconfigText);
  const requiredConfigMissing = REQUIRED_CONFIG_TARGETS.filter(target => config.targets[target]?.state !== 'enabled');
  const recommendedConfigMissing = RECOMMENDED_CONFIG_TARGETS.filter(target => config.targets[target]?.state !== 'enabled');
  const hardConfigMissing = HARD_BLOCKER_CONFIG_TARGETS.filter(target => config.targets[target]?.state !== 'enabled');
  const hardRequirementMissing = [
    requirements.pid_namespace === 'missing' ? 'PID namespace' : null,
    requirements.ipc_namespace === 'missing' ? 'IPC namespace' : null,
  ].filter(Boolean);
  const hardRequirementUnknown = [
    requirements.pid_namespace === 'unknown' ? 'PID namespace' : null,
    requirements.ipc_namespace === 'unknown' ? 'IPC namespace' : null,
  ].filter(Boolean);

  const warnings = [];
  if (requirements.devtmpfs === 'missing') warnings.push('devtmpfs_missing_in_booted_requirement_check');
  if (requirements.devtmpfs === 'unknown') warnings.push('devtmpfs_requirement_status_unknown');
  for (const target of recommendedConfigMissing) warnings.push(`${target}_not_enabled`);

  const classification = classifyBundle({
    missingRequired,
    hardConfigMissing,
    hardRequirementMissing,
    hardRequirementUnknown,
  });
  const ready = classification === 'DROIDSPACES_KERNEL_BUNDLE_READY_FOR_REBUILD_REVIEW';
  const report = {
    schema: 'reversa.droidspaces_kernel_bundle.v1',
    generated_at: new Date().toISOString(),
    root,
    read_only: true,
    mutation_allowed: false,
    classification,
    ready_for_rebuild_review: ready,
    required_files: files,
    missing_required: missingRequired,
    requirements,
    config,
    required_config_targets: REQUIRED_CONFIG_TARGETS,
    recommended_config_targets: RECOMMENDED_CONFIG_TARGETS,
    missing_required_config_targets: requiredConfigMissing,
    missing_recommended_config_targets: recommendedConfigMissing,
    hard_blockers: {
      current_kernel_requirements: hardRequirementMissing,
      kernel_config_targets: hardConfigMissing,
      unknown_current_kernel_requirements: hardRequirementUnknown,
    },
    warnings,
    required_next_action: nextAction(classification, {
      missingRequired,
      hardConfigMissing,
      hardRequirementMissing,
      hardRequirementUnknown,
    }),
    stop_condition: DROIDSPACES_KERNEL_STOP_CONDITION,
  };

  if (options.outDir || options.out) {
    const outDir = resolve(options.outDir ?? options.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'droidspaces-kernel-bundle.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(join(outDir, 'droidspaces-kernel-bundle.md'), buildDroidspacesKernelBundleMarkdown(report), 'utf8');
  }

  return report;
}

export function buildDroidspacesKernelBundleMarkdown(report) {
  const lines = [
    '# Droidspaces Kernel Bundle Gate',
    '',
    `Classification: \`${report.classification}\``,
    `Ready for rebuild review: \`${String(report.ready_for_rebuild_review)}\``,
    `Root: \`${report.root}\``,
    '',
    '## Required Files',
    '',
    '| Artifact | Status | Path |',
    '| --- | --- | --- |',
    ...report.required_files.map(file => `| \`${file.id}\` | \`${file.present ? 'present' : 'missing'}\` | ${markdownCell(file.path || file.expected.join(', '))} |`),
    '',
    '## Kernel Requirements',
    '',
    `- PID namespace: \`${report.requirements.pid_namespace}\``,
    `- IPC namespace: \`${report.requirements.ipc_namespace}\``,
    `- devtmpfs: \`${report.requirements.devtmpfs}\``,
    '',
    '## Config Targets',
    '',
    '| Target | Status | Value |',
    '| --- | --- | --- |',
    ...Object.entries(report.config.targets).map(([target, item]) => `| \`${target}\` | \`${item.state}\` | \`${item.value ?? ''}\` |`),
    '',
    '## Hard Blockers',
    '',
    `- Current kernel requirements: ${listOrNone(report.hard_blockers.current_kernel_requirements)}`,
    `- Kernel config targets: ${listOrNone(report.hard_blockers.kernel_config_targets)}`,
    `- Unknown current-kernel requirements: ${listOrNone(report.hard_blockers.unknown_current_kernel_requirements)}`,
    '',
    '## Next Action',
    '',
    report.required_next_action,
    '',
    '## Stop Condition',
    '',
    report.stop_condition,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function indexBundle(root, maxDepth = 5) {
  const results = [];

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push({ type: 'dir', name: entry.name, path });
        await walk(path, depth + 1);
      } else if (entry.isFile()) {
        results.push({ type: 'file', name: entry.name, path });
      }
    }
  }

  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return results;
  await walk(root, 0);
  return results;
}

function resolveGroup(fileIndex, group) {
  const names = group.names ?? [];
  const directoryNames = group.directoryNames ?? [];
  const exactFile = fileIndex.find(item => item.type === 'file' && names.includes(item.name));
  const exactDir = fileIndex.find(item => item.type === 'dir' && directoryNames.includes(item.name));
  const match = exactFile ?? exactDir ?? null;
  return {
    id: group.id,
    present: Boolean(match),
    path: match?.path ?? '',
    expected: [...names, ...directoryNames.map(name => `${name}/`)],
    kind: match?.type ?? 'missing',
  };
}

function parseDroidspacesRequirements(text) {
  return {
    pid_namespace: parseRequirementStatus(text, /PID\s+namespace/i),
    ipc_namespace: parseRequirementStatus(text, /IPC\s+namespace/i),
    devtmpfs: parseRequirementStatus(text, /devtmpfs/i),
  };
}

function parseRequirementStatus(text, labelPattern) {
  if (!text) return 'unknown';
  const line = text
    .split(/\r?\n/)
    .find(candidate => labelPattern.test(candidate));
  if (!line) return 'unknown';
  if (/\b(missing|fail|failed|no|absent|disabled|not\s+set)\b/i.test(line)) return 'missing';
  if (/\b(pass|passed|present|yes|ok|enabled|available|found)\b/i.test(line)) return 'present';
  return 'unknown';
}

function parseKernelConfigTargets(text) {
  const targets = {};
  for (const target of [...REQUIRED_CONFIG_TARGETS, ...RECOMMENDED_CONFIG_TARGETS]) {
    targets[target] = parseConfigTarget(text, target);
  }
  return { targets };
}

function parseConfigTarget(text, target) {
  if (!text) return { state: 'unknown', value: null };
  const escaped = escapeRegExp(target);
  const disabled = new RegExp(`^#\\s*${escaped}\\s+is\\s+not\\s+set\\s*$`, 'm');
  if (disabled.test(text)) return { state: 'disabled', value: 'not set' };
  const assigned = new RegExp(`^${escaped}=(.+)$`, 'm').exec(text);
  if (!assigned) return { state: 'unknown', value: null };
  const value = assigned[1].trim();
  if (value === 'y') return { state: 'enabled', value };
  if (value === 'm') return { state: 'module', value };
  return { state: 'set_other', value };
}

function classifyBundle({
  missingRequired,
  hardConfigMissing,
  hardRequirementMissing,
  hardRequirementUnknown,
}) {
  if (missingRequired.length > 0) return 'DROIDSPACES_KERNEL_BUNDLE_INCOMPLETE';
  if (hardRequirementMissing.length > 0 || hardConfigMissing.length > 0) {
    return 'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL';
  }
  if (hardRequirementUnknown.length > 0) return 'DROIDSPACES_KERNEL_BUNDLE_REVIEW_REQUIRED';
  return 'DROIDSPACES_KERNEL_BUNDLE_READY_FOR_REBUILD_REVIEW';
}

function nextAction(classification, detail) {
  if (classification === 'DROIDSPACES_KERNEL_BUNDLE_INCOMPLETE') {
    return `Collect missing required artifacts before kernel work continues: ${detail.missingRequired.join(', ')}.`;
  }
  if (classification === 'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL') {
    return 'Patch defconfig/kernel config for PID_NS and IPC_NS, rebuild kernel artifacts, then boot and rerun Droidspaces v6.3.0 requirements.';
  }
  if (classification === 'DROIDSPACES_KERNEL_BUNDLE_REVIEW_REQUIRED') {
    return 'Requirements text does not prove PID namespace and IPC namespace status; rerun the booted Droidspaces requirement check and attach the raw output.';
  }
  return 'Review artifact hashes, preserve AVB/rollback metadata, and keep this read-only gate above any flashing/repack action.';
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

function listOrNone(items) {
  if (!items?.length) return '`none`';
  return items.map(item => `\`${basename(item)}\``).join(', ');
}
