import { existsSync, readFileSync } from 'fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

export const ACTIVE_MODULE_CLI = '/data/adb/modules/nebula_core/bin/nebula-core';
export const PENDING_MODULE_CLI = '/data/adb/modules_update/nebula_core/bin/nebula-core';
export const DEFAULT_ADB_BINARY = '/mnt/c/platform-tools/adb.exe';

const KNOWN_GOOD_CLASSIFICATION = 'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS';
const KNOWN_GOOD_BLOCKER = 'NONE_WAYLAND_DISPLAY';

const ACTIVE_COMMANDS = [
  ['active-status', `${ACTIVE_MODULE_CLI} status --json`, 'json'],
  ['active-display-lanes', `${ACTIVE_MODULE_CLI} display lanes --json`, 'json'],
  ['active-display-method-profiles', `${ACTIVE_MODULE_CLI} display method-profiles --json`, 'json'],
  ['active-display-method-containers', `${ACTIVE_MODULE_CLI} display method-containers --json`, 'json'],
  ['active-integrations-baseline', `${ACTIVE_MODULE_CLI} integrations baseline --json`, 'json'],
  ['active-cooling-policy', `${ACTIVE_MODULE_CLI} cooling policy --json`, 'json'],
];

const PENDING_COMMANDS = [
  ['pending-status', `${PENDING_MODULE_CLI} status --json`, 'json'],
  ['pending-display-lanes', `${PENDING_MODULE_CLI} display lanes --json`, 'json'],
];

const PACKAGE_COMMANDS = [
  ['package-nebula-path', 'pm path io.droidspaces.nebula', 'txt'],
  ['package-waylandie-path', 'pm path io.droidspaces.nebula.waylandie', 'txt'],
  ['package-droidspaces-list', 'cmd package list packages -U | grep -E "droidspaces|nebula|waylandie"', 'txt'],
];

const PENDING_EXISTS_COMMAND = `if [ -x ${PENDING_MODULE_CLI} ]; then echo PRESENT; else echo ABSENT; fi`;
const LOWER_FRONTIER_TERMS = [
  ['A1E', '_BASELINE_SIGBUS_CONFIRMED'].join(''),
  ['SIGBUS', ' stayed fatal'].join(''),
  ['Xserver', ' ready=no'].join(''),
  ['xserver', '_ready=no'].join(''),
  ['sidecar', '-13'].join(''),
  ['keepalive', ' child'].join(''),
  ['GLX', ' skipped'].join(''),
];

const FORBIDDEN_COMMAND_PATTERNS = [
  /\badb\s+install\b/i,
  /\binstall\s+.*\.apk\b/i,
  /\badb\s+reboot\b/i,
  /\breboot\b/i,
  /\brm\s+-rf\s+\/data\/adb\/modules_update\b/i,
  /\bchmod\b.*\s\/dev(?:\/|\s|$)/i,
  /\bsetenforce\b/i,
  /\bksud\s+module\s+install\b/i,
  /\bfastboot\b/i,
  /\bdd\s+if=/i,
  /\bflash\b/i,
  /\bCREATE_LEASE\b/i,
  /\badb\s+push\b/i,
  /\badb\s+pull\b/i,
];

export function validateReadOnlyCommand(command) {
  const text = Array.isArray(command) ? command.join(' ') : String(command);
  for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Unsafe Nebula companion command rejected: ${text}`);
    }
  }
  return true;
}

export function classifyNebulaModules({ activeDisplayLanes, pendingDisplayLanes = null, proposedText = '' }) {
  const activeLane = extractPhoneLane(activeDisplayLanes);
  const pendingLane = pendingDisplayLanes ? extractPhoneLane(pendingDisplayLanes) : null;
  const activeGood = isKnownGoodLane(activeLane);
  const pendingText = pendingDisplayLanes ? JSON.stringify(pendingDisplayLanes) : '';

  const classes = [];
  classes.push(activeGood ? 'NEBULA_ACTIVE_PROOF_OK' : 'NEBULA_ACTIVE_PROOF_REVIEW_REQUIRED');

  if (!pendingDisplayLanes) {
    classes.push('NEBULA_PENDING_ABSENT');
  } else if (activeGood && isBlockedExportRegression(pendingLane, pendingText)) {
    classes.push('NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT');
  } else if (activeGood && isKnownGoodLane(pendingLane)) {
    classes.push('NEBULA_PENDING_MATCHES_ACTIVE');
  } else {
    classes.push('NEBULA_PENDING_UNKNOWN_REVIEW_REQUIRED');
  }

  if (isLowerFrontierText(proposedText)) {
    classes.push('NEBULA_FRONTIER_BELOW_KNOWN_GOOD');
  } else if (activeGood) {
    classes.push('NEBULA_FRONTIER_MATCHES_KNOWN_GOOD');
  }

  return {
    classifications: classes,
    active: summarizeLane(activeLane),
    pending: pendingDisplayLanes ? summarizeLane(pendingLane) : { state: 'ABSENT' },
    pending_state: pendingStateFromClasses(classes),
    stage_recommendation: stageRecommendationFromClasses(classes),
  };
}

export async function runNebulaCompanion(options) {
  const normalized = {
    adbBinary: options.adbBinary || DEFAULT_ADB_BINARY,
    serial: options.serial || '',
    outDir: resolve(options.outDir || join(process.cwd(), 'reversa_nebula_readonly')),
    mode: options.mode || 'status',
    includePending: Boolean(options.includePending),
  };

  if (!existsSync(normalized.adbBinary)) {
    throw new Error(`ADB binary does not exist: ${normalized.adbBinary}`);
  }

  await mkdir(normalized.outDir, { recursive: true });
  await mkdir(join(normalized.outDir, 'commands'), { recursive: true });

  const serial = normalized.serial || detectSingleDevice(normalized.adbBinary);
  if (!serial) {
    throw new Error('No explicit --adb serial was provided and no single clear ADB device was detected.');
  }
  normalized.serial = serial;

  const results = [];
  const commandLog = [];

  const pendingProbe = runAdbShell({
    adbBinary: normalized.adbBinary,
    serial,
    shellCommand: PENDING_EXISTS_COMMAND,
    root: true,
  });
  await writeText(join(normalized.outDir, 'pending-presence.txt'), pendingProbe.stdout);
  commandLog.push(commandLogEntry('pending-presence', PENDING_EXISTS_COMMAND, pendingProbe));
  const pendingPresent = pendingProbe.stdout.trim() === 'PRESENT';

  if (normalized.mode !== 'propose') {
    for (const spec of PACKAGE_COMMANDS) {
      results.push(await captureSpec(normalized, spec, commandLog, { root: false }));
    }
  }

  const shouldCaptureActive = ['status', 'active-module', 'compare-modules', 'frontier'].includes(normalized.mode);
  const shouldCapturePending = pendingPresent && (normalized.includePending || ['pending-module', 'compare-modules'].includes(normalized.mode));

  if (shouldCaptureActive) {
    for (const spec of ACTIVE_COMMANDS) {
      results.push(await captureSpec(normalized, spec, commandLog, { root: true }));
    }
  }

  if (shouldCapturePending) {
    for (const spec of PENDING_COMMANDS) {
      results.push(await captureSpec(normalized, spec, commandLog, { root: true }));
    }
  }

  const activeDisplayLanes = readJsonIfExists(join(normalized.outDir, 'active-display-lanes.json'));
  const pendingDisplayLanes = shouldCapturePending
    ? readJsonIfExists(join(normalized.outDir, 'pending-display-lanes.json'))
    : null;
  const classification = classifyNebulaModules({
    activeDisplayLanes,
    pendingDisplayLanes,
  });

  if (!pendingPresent) {
    classification.pending_state = 'ABSENT';
  } else if (!shouldCapturePending) {
    classification.pending_state = 'PRESENT_NOT_READ';
  }

  const safety = buildSafetyManifest(commandLog, normalized, pendingPresent, shouldCapturePending);
  await writeJson(join(normalized.outDir, 'command-log.json'), commandLog);
  await writeJson(join(normalized.outDir, 'classification.json'), classification);
  await writeJson(join(normalized.outDir, 'safety.json'), safety);
  await writeText(join(normalized.outDir, 'summary.md'), buildSummaryMarkdown(classification, safety, results));

  return {
    ...classification,
    outDir: normalized.outDir,
    serial,
    pending_present: pendingPresent,
    pending_captured: shouldCapturePending,
    command_count: commandLog.length,
  };
}

export async function proposeFromScanDir(scanDir, outDir = null) {
  const root = resolve(scanDir);
  const output = resolve(outDir || join(root, 'nebula-proposal'));
  await mkdir(output, { recursive: true });
  const text = await collectEvidenceText(root);
  const classification = classifyNebulaModules({
    activeDisplayLanes: null,
    pendingDisplayLanes: null,
    proposedText: text,
  });
  await writeJson(join(output, 'proposal.json'), classification);
  await writeText(join(output, 'proposal.md'), buildProposalMarkdown(classification));
  return { ...classification, outDir: output };
}

function captureSpec(options, spec, commandLog, { root }) {
  const [label, shellCommand, extension] = spec;
  validateReadOnlyCommand(shellCommand);
  const result = runAdbShell({
    adbBinary: options.adbBinary,
    serial: options.serial,
    shellCommand,
    root,
  });
  commandLog.push(commandLogEntry(label, shellCommand, result));
  const base = join(options.outDir, label);
  return Promise.all([
    writeText(`${base}.${extension}`, result.stdout),
    writeText(`${base}.stderr`, result.stderr),
    writeText(`${base}.rc`, `${result.status ?? 'null'}\n`),
  ]).then(() => ({ label, status: result.status, output: `${base}.${extension}` }));
}

function runAdbShell({ adbBinary, serial, shellCommand, root }) {
  validateReadOnlyCommand(shellCommand);
  const args = ['-s', serial, 'shell'];
  if (root) {
    args.push('su', '-c', shellCommand);
  } else if (shellCommand.includes('|')) {
    args.push('sh', '-c', shellCommand);
  } else {
    args.push(...splitShellWords(shellCommand));
  }
  validateReadOnlyCommand([adbBinary, ...args]);
  const result = spawnSync(adbBinary, args, { encoding: 'utf8' });
  return {
    status: result.status,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function detectSingleDevice(adbBinary) {
  const result = spawnSync(adbBinary, ['devices', '-l'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  const devices = result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('List of devices'))
    .filter(line => /\bdevice\b/.test(line) && !/\boffline\b/.test(line))
    .map(line => line.split(/\s+/)[0]);
  return devices.length === 1 ? devices[0] : '';
}

function splitShellWords(command) {
  return command.split(/\s+/).filter(Boolean);
}

function commandLogEntry(label, shellCommand, result) {
  return {
    label,
    command: shellCommand,
    read_only: true,
    status: result.status,
    signal: result.signal,
    stdout_bytes: Buffer.byteLength(result.stdout || '', 'utf8'),
    stderr_bytes: Buffer.byteLength(result.stderr || '', 'utf8'),
    error: result.error,
  };
}

function extractPhoneLane(displayLanes) {
  if (!displayLanes || typeof displayLanes !== 'object') return {};
  if (displayLanes.status_model?.phone_app) return displayLanes.status_model.phone_app;
  const lanes = Array.isArray(displayLanes.lanes) ? displayLanes.lanes : [];
  return lanes.find(lane => lane.id === 'phone_app_bridge' || lane.method_id === 'phone_app_bridge') || {};
}

function summarizeLane(lane) {
  if (!lane || Object.keys(lane).length === 0) return { state: 'UNKNOWN' };
  return {
    proof_classification: lane.proof_classification || lane.classification || null,
    active_blocker: lane.active_blocker || lane.canonical_blocker || null,
    vkGetMemoryFdKHR_failures: metric(lane, 'vkGetMemoryFdKHR_failures', 'vk_get_memory_fd_failures'),
    real_buffer_commits: metric(lane, 'real_buffer_commits'),
    status: lane.status || lane.state || null,
  };
}

function isKnownGoodLane(lane) {
  return (lane?.proof_classification || lane?.classification) === KNOWN_GOOD_CLASSIFICATION
    && (lane?.active_blocker || lane?.canonical_blocker || lane?.blocker) === KNOWN_GOOD_BLOCKER
    && metric(lane, 'vkGetMemoryFdKHR_failures', 'vk_get_memory_fd_failures') === 0
    && metric(lane, 'real_buffer_commits') === 2;
}

function isBlockedExportRegression(lane, text) {
  const markers = [
    'blocked_export',
    'blocked_real_buffer',
    'NEBULA_R6_EXPORT_A1_VULKAN_LOADER_PIN_CONFIRMED',
  ];
  const hasMarker = markers.some(marker => text.includes(marker));
  const vkFailures = metric(lane, 'vkGetMemoryFdKHR_failures', 'vk_get_memory_fd_failures');
  const commits = metric(lane, 'real_buffer_commits');
  return hasMarker || vkFailures === 1199 || commits === 0;
}

function isLowerFrontierText(text) {
  if (!text) return false;
  return LOWER_FRONTIER_TERMS.some(term => text.toLowerCase().includes(term.toLowerCase()))
    && !/NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS[\s\S]*real_buffer_commits[=: ]2/i.test(text);
}

function metric(lane, ...keys) {
  if (!lane || typeof lane !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(lane, key)) return normalizeNumber(lane[key]);
    if (Object.prototype.hasOwnProperty.call(lane.proof_metrics || {}, key)) {
      return normalizeNumber(lane.proof_metrics[key]);
    }
  }
  return undefined;
}

function normalizeNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return value;
}

function pendingStateFromClasses(classes) {
  if (classes.includes('NEBULA_PENDING_ABSENT')) return 'ABSENT';
  if (classes.includes('NEBULA_PENDING_MATCHES_ACTIVE')) return 'MATCHES_ACTIVE';
  if (classes.includes('NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT')) return 'REGRESSED_BELOW_ACTIVE';
  return 'UNREADABLE';
}

function stageRecommendationFromClasses(classes) {
  if (classes.includes('NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT')) return 'UNSAFE_TO_STAGE';
  if (classes.includes('NEBULA_PENDING_UNKNOWN_REVIEW_REQUIRED')) return 'REVIEW_REQUIRED';
  return 'NO_STAGE_ACTION';
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function collectEvidenceText(root, depth = 0) {
  if (depth > 4) return '';
  const entries = await readdir(root, { withFileTypes: true });
  const parts = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      parts.push(await collectEvidenceText(path, depth + 1));
    } else if (/\.(json|jsonl|md|txt|tsv|log)$/i.test(entry.name)) {
      const info = await stat(path);
      if (info.size <= 512 * 1024) parts.push(await readFile(path, 'utf8'));
    }
  }
  return parts.join('\n');
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeText(path, data) {
  await writeFile(path, data || '', 'utf8');
}

function buildSafetyManifest(commandLog, options, pendingPresent, pendingCaptured) {
  return {
    schema_version: 1,
    mode: options.mode,
    serial: options.serial,
    read_only: true,
    arbitrary_shell_execution: false,
    pending_module_default_authority: false,
    pending_present: pendingPresent,
    pending_captured: pendingCaptured,
    forbidden_actions: [
      'adb install',
      'module install',
      'modules_update write',
      'reboot',
      'zygisk install',
      'graphics launch',
      'DRM CREATE_LEASE',
      'Proton/Wine/Steam/DXVK',
    ],
    commands: commandLog.map(item => ({
      label: item.label,
      command: item.command,
      read_only: item.read_only,
      status: item.status,
    })),
  };
}

function buildSummaryMarkdown(classification, safety, results) {
  return [
    '# Reversa Nebula Read-Only Companion Probe',
    '',
    `- pending_state: ${classification.pending_state}`,
    `- stage_recommendation: ${classification.stage_recommendation}`,
    `- classifications: ${classification.classifications.join(', ')}`,
    `- command_count: ${safety.commands.length}`,
    `- read_only: ${safety.read_only}`,
    `- arbitrary_shell_execution: ${safety.arbitrary_shell_execution}`,
    '',
    '## Captured outputs',
    '',
    ...results.map(item => `- ${item.label}: status=${item.status} output=${item.output}`),
    '',
  ].join('\n');
}

function buildProposalMarkdown(classification) {
  return [
    '# Nebula Proposal Classification',
    '',
    `- classifications: ${classification.classifications.join(', ')}`,
    `- stage_recommendation: ${classification.stage_recommendation}`,
    '',
  ].join('\n');
}
