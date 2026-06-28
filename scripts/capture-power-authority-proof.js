#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { userInfo } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { capturePowerTdpProof } from './capture-power-tdp-proof.js';

const __filename = fileURLToPath(import.meta.url);

export const POWER_AUTHORITY_LAYERS = new Set([
  'WSL_OBSERVER',
  'WINDOWS_HOST_AUTHORITY',
  'LINUX_BARE_METAL_AUTHORITY',
  'HANDHELD_DAEMON_HHD_AUTHORITY',
  'RYZENADJ_DIRECT_AUTHORITY',
  'UNKNOWN_UNSAFE_AUTHORITY',
]);

export const POWER_AUTHORITY_CLASSIFICATIONS = new Set([
  'POWER_AUTHORITY_WSL_OBSERVER_ONLY',
  'POWER_AUTHORITY_WINDOWS_HOST_CANDIDATE',
  'POWER_AUTHORITY_LINUX_BARE_METAL_CANDIDATE',
  'POWER_AUTHORITY_HHD_CANDIDATE',
  'POWER_AUTHORITY_RYZENADJ_CANDIDATE',
  'POWER_AUTHORITY_CONFLICTING_BACKENDS',
  'POWER_AUTHORITY_PRIVILEGE_MISSING',
  'POWER_AUTHORITY_NO_BACKEND',
  'POWER_AUTHORITY_UNKNOWN_UNSAFE',
]);

const BACKEND_ORDER = ['ryzenadj', 'hhd', 'acpi_call', 'smu', 'powerprofilesctl', 'powercfg'];
const PRIMARY_MUTATION_BACKENDS = new Set(['ryzenadj', 'hhd', 'acpi_call', 'smu']);
const MUTATION_CAPABLE_BACKENDS = new Set([...PRIMARY_MUTATION_BACKENDS, 'powerprofilesctl', 'powercfg']);

export async function capturePowerAuthorityProof(options) {
  const outDir = resolveRequiredOut(options.out);
  await mkdir(outDir, { recursive: true });

  let sourcePowerProofPath = options.powerProof ? resolve(options.powerProof) : null;
  let powerProof;
  if (sourcePowerProofPath) {
    powerProof = JSON.parse(await readFile(sourcePowerProofPath, 'utf8'));
  } else {
    const source = await capturePowerTdpProof({
      out: join(outDir, 'source-power-proof'),
      windowsProbe: options.windowsProbe,
      linuxProbe: options.linuxProbe,
    });
    powerProof = source.proof;
    sourcePowerProofPath = join(source.outDir, 'power-tdp-proof.json');
  }

  const privilegeState = options.privilegeProbe
    ? JSON.parse(await readFile(resolve(options.privilegeProbe), 'utf8'))
    : collectPrivilegeState();
  const proof = buildPowerAuthorityProof({
    timestamp: new Date().toISOString(),
    powerProof,
    privilegeState,
    sourcePowerProofPath,
  });

  await writePowerAuthorityOutputs(outDir, proof);
  return { outDir, proof };
}

export function buildPowerAuthorityProof({ timestamp = new Date().toISOString(), powerProof, privilegeState = collectPrivilegeState(), sourcePowerProofPath = null }) {
  const resolved = resolvePowerAuthority(powerProof, privilegeState);
  const proof = {
    schema_version: 1,
    stage: 'STAGE_02_POWER_AUTHORITY',
    timestamp,
    source_power_proof_path: sourcePowerProofPath,
    source_authority: false,
    generated_artifact: true,
    read_only: true,
    os_layer: resolved.os_layer,
    privilege_state: resolved.privilege_state,
    backend_availability: resolved.backend_availability,
    authority: resolved.authority,
    proof: {
      tdp_write_performed: false,
      runtime_test_performed: resolved.runtime_test_performed,
      game_launch_performed: false,
      phone_or_nebula_action_performed: false,
    },
    classification: resolved.classification,
    notes: resolved.notes,
  };

  if (!POWER_AUTHORITY_CLASSIFICATIONS.has(proof.classification)) {
    throw new Error(`Invalid power authority classification: ${proof.classification}`);
  }
  if (!POWER_AUTHORITY_LAYERS.has(proof.authority.detected_authority_layer)) {
    throw new Error(`Invalid power authority layer: ${proof.authority.detected_authority_layer}`);
  }
  return proof;
}

export function resolvePowerAuthority(powerProof, privilegeState = collectPrivilegeState()) {
  const platform = powerProof?.platform ?? {};
  const os = normalizeOsLayer(platform);
  const backends = normalizeBackends(powerProof?.tdp_backends);
  const presentMutationBackends = BACKEND_ORDER
    .filter(backend => PRIMARY_MUTATION_BACKENDS.has(backend))
    .filter(backend => backends[backend] === 'present');
  const conflicts = presentMutationBackends.length > 1;
  const backendOwner = selectBackendOwner(backends, conflicts);
  const runtimeTestPerformed = powerProof?.proof?.runtime_test_performed === true;
  const normalizedPrivilege = normalizePrivilegeState(privilegeState);
  const hasBackend = Object.values(backends).some(status => status === 'present');
  const authorityLayer = detectAuthorityLayer({ os, backends, conflicts, hasBackend });
  const classification = classifyAuthority({
    os,
    authorityLayer,
    conflicts,
    hasBackend,
    normalizedPrivilege,
    backends,
  });
  const denialReasons = buildDenialReasons({
    os,
    authorityLayer,
    conflicts,
    hasBackend,
    normalizedPrivilege,
    runtimeTestPerformed,
  });

  return {
    os_layer: {
      detected: os.detected,
      kernel: platform.kernel ?? 'unknown',
      machine: platform.machine ?? 'unknown',
      observer_only: os.detected === 'wsl',
      source: 'power-tdp-proof',
    },
    privilege_state: normalizedPrivilege,
    backend_availability: BACKEND_ORDER.map(backend => ({
      backend,
      status: backends[backend],
      observable_only: os.detected === 'wsl' || backends[backend] !== 'present',
      mutation_capable_in_principle: MUTATION_CAPABLE_BACKENDS.has(backend),
      mutation_allowed_by_policy: false,
      denial_reason: reasonForBackend({ backend, os, conflicts, status: backends[backend], runtimeTestPerformed, normalizedPrivilege }),
    })),
    authority: {
      detected_authority_layer: authorityLayer,
      observer_layer: os.detected === 'wsl' ? 'WSL_OBSERVER' : 'none',
      backend_owner: backendOwner,
      mutation_status: 'denied_by_policy',
      mutation_capable_in_principle: presentMutationBackends.length > 0,
      mutation_allowed_by_policy: false,
      denial_reason: denialReasons[0],
      denial_reasons: denialReasons,
      next_required_proof: nextRequiredProof(denialReasons),
      conflicting_backends: conflicts ? presentMutationBackends : [],
    },
    runtime_test_performed: runtimeTestPerformed,
    classification,
    notes: buildNotes({ os, authorityLayer, backendOwner, denialReasons }),
  };
}

export function collectPrivilegeState() {
  let info = {};
  try {
    info = userInfo();
  } catch {
    info = {};
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const isRoot = uid === 0;
  return {
    user: info.username ?? 'unknown',
    uid,
    is_root: isRoot,
    is_admin: null,
    has_mutation_privilege: isRoot,
    source: 'node_process',
    state: isRoot ? 'root' : 'user',
  };
}

export function renderPowerAuthorityMarkdown(proof) {
  return [
    '# Power Authority Proof',
    '',
    `- Classification: ${proof.classification}`,
    `- Stage: ${proof.stage}`,
    `- Read-only: ${proof.read_only ? 'yes' : 'no'}`,
    `- OS layer: ${proof.os_layer.detected}`,
    `- Observer only: ${proof.os_layer.observer_only ? 'yes' : 'no'}`,
    `- Privilege state: ${proof.privilege_state.state}`,
    `- Has mutation privilege: ${proof.privilege_state.has_mutation_privilege ? 'yes' : 'no'}`,
    `- Detected authority layer: ${proof.authority.detected_authority_layer}`,
    `- Observer layer: ${proof.authority.observer_layer}`,
    `- Backend owner: ${proof.authority.backend_owner}`,
    `- Mutation status: ${proof.authority.mutation_status}`,
    `- Mutation allowed by policy: ${proof.authority.mutation_allowed_by_policy ? 'yes' : 'no'}`,
    `- Denial reason: ${proof.authority.denial_reason}`,
    `- Next required proof: ${proof.authority.next_required_proof}`,
    '',
    '## Backend Availability',
    '',
    '| Backend | Status | Observable only | Mutation capable | Policy allowed | Denial reason |',
    '|---|---:|---:|---:|---:|---|',
    ...proof.backend_availability.map(backend => [
      `| ${backend.backend}`,
      backend.status,
      backend.observable_only ? 'yes' : 'no',
      backend.mutation_capable_in_principle ? 'yes' : 'no',
      backend.mutation_allowed_by_policy ? 'yes' : 'no',
      `${backend.denial_reason} |`,
    ].join(' | ')),
    '',
    '## Notes',
    '',
    ...proof.notes.map(note => `- ${note}`),
    '',
  ].join('\n');
}

export function renderPowerAuthorityBackendTsv(proof) {
  return [
    'backend\tstatus\tobservable_only\tmutation_capable_in_principle\tmutation_allowed_by_policy\tdenial_reason',
    ...proof.backend_availability.map(backend => [
      backend.backend,
      backend.status,
      String(backend.observable_only),
      String(backend.mutation_capable_in_principle),
      String(backend.mutation_allowed_by_policy),
      backend.denial_reason,
    ].map(tsv).join('\t')),
    '',
  ].join('\n');
}

function normalizeOsLayer(platform) {
  if (platform.is_wsl || platform.os === 'wsl') return { detected: 'wsl' };
  if (platform.os === 'windows' || /windows/i.test(platform.os ?? '')) return { detected: 'windows' };
  if (platform.os === 'linux' || /linux/i.test(platform.os ?? '')) return { detected: 'linux' };
  return { detected: 'unknown' };
}

function normalizeBackends(backends = {}) {
  return Object.fromEntries(BACKEND_ORDER.map(backend => {
    const value = backends?.[backend];
    return [backend, value === 'present' || value === 'missing' || value === 'unknown' ? value : 'unknown'];
  }));
}

function normalizePrivilegeState(privilege = {}) {
  const hasMutationPrivilege = privilege.has_mutation_privilege === true || privilege.is_root === true || privilege.is_admin === true;
  const state = privilege.state
    ?? (privilege.is_root ? 'root' : (privilege.is_admin ? 'admin' : (hasMutationPrivilege ? 'privileged' : 'user')));
  return {
    user: privilege.user ?? 'unknown',
    uid: privilege.uid ?? null,
    is_root: privilege.is_root === true,
    is_admin: privilege.is_admin === true ? true : (privilege.is_admin === false ? false : null),
    has_mutation_privilege: hasMutationPrivilege,
    source: privilege.source ?? 'fixture_or_runtime',
    state,
  };
}

function selectBackendOwner(backends, conflicts) {
  if (conflicts) return 'conflicting_backends';
  if (backends.hhd === 'present') return 'HANDHELD_DAEMON_HHD_AUTHORITY';
  if (backends.ryzenadj === 'present') return 'RYZENADJ_DIRECT_AUTHORITY';
  if (backends.powercfg === 'present') return 'WINDOWS_POWER_PROFILE_AUTHORITY';
  if (backends.powerprofilesctl === 'present') return 'LINUX_POWER_PROFILE_AUTHORITY';
  if (backends.acpi_call === 'present') return 'ACPI_CALL_DIRECT_AUTHORITY';
  if (backends.smu === 'present') return 'SMU_DIRECT_AUTHORITY';
  return 'none';
}

function detectAuthorityLayer({ os, backends, conflicts, hasBackend }) {
  if (os.detected === 'wsl') return 'WSL_OBSERVER';
  if (conflicts || os.detected === 'unknown' || !hasBackend) return 'UNKNOWN_UNSAFE_AUTHORITY';
  if (backends.hhd === 'present') return 'HANDHELD_DAEMON_HHD_AUTHORITY';
  if (backends.ryzenadj === 'present') return 'RYZENADJ_DIRECT_AUTHORITY';
  if (os.detected === 'windows') return 'WINDOWS_HOST_AUTHORITY';
  if (os.detected === 'linux') return 'LINUX_BARE_METAL_AUTHORITY';
  return 'UNKNOWN_UNSAFE_AUTHORITY';
}

function classifyAuthority({ os, authorityLayer, conflicts, hasBackend, normalizedPrivilege, backends }) {
  if (os.detected === 'wsl') return 'POWER_AUTHORITY_WSL_OBSERVER_ONLY';
  if (conflicts) return 'POWER_AUTHORITY_CONFLICTING_BACKENDS';
  if (!hasBackend) return 'POWER_AUTHORITY_NO_BACKEND';
  if (authorityLayer === 'UNKNOWN_UNSAFE_AUTHORITY') return 'POWER_AUTHORITY_UNKNOWN_UNSAFE';
  if (!normalizedPrivilege.has_mutation_privilege) return 'POWER_AUTHORITY_PRIVILEGE_MISSING';
  if (backends.hhd === 'present') return 'POWER_AUTHORITY_HHD_CANDIDATE';
  if (backends.ryzenadj === 'present') return 'POWER_AUTHORITY_RYZENADJ_CANDIDATE';
  if (authorityLayer === 'WINDOWS_HOST_AUTHORITY') return 'POWER_AUTHORITY_WINDOWS_HOST_CANDIDATE';
  if (authorityLayer === 'LINUX_BARE_METAL_AUTHORITY') return 'POWER_AUTHORITY_LINUX_BARE_METAL_CANDIDATE';
  return 'POWER_AUTHORITY_UNKNOWN_UNSAFE';
}

function buildDenialReasons({ os, authorityLayer, conflicts, hasBackend, normalizedPrivilege, runtimeTestPerformed }) {
  const reasons = ['STAGE_02_READ_ONLY'];
  if (os.detected === 'wsl') reasons.push('WSL_OBSERVER_ONLY');
  if (authorityLayer === 'UNKNOWN_UNSAFE_AUTHORITY') reasons.push('UNKNOWN_UNSAFE_AUTHORITY');
  if (conflicts) reasons.push('CONFLICTING_BACKENDS');
  if (!hasBackend) reasons.push('NO_MUTATION_BACKEND');
  if (!normalizedPrivilege.has_mutation_privilege) reasons.push('PRIVILEGE_MISSING');
  if (!runtimeTestPerformed) reasons.push('RUNTIME_PROOF_MISSING');
  reasons.push('APPROVAL_REQUIRED');
  return [...new Set(reasons)];
}

function reasonForBackend({ backend, os, conflicts, status, runtimeTestPerformed, normalizedPrivilege }) {
  if (status !== 'present') return 'BACKEND_NOT_PRESENT';
  if (os.detected === 'wsl') return 'WSL_OBSERVER_ONLY';
  if (conflicts && PRIMARY_MUTATION_BACKENDS.has(backend)) return 'CONFLICTING_BACKENDS';
  if (!normalizedPrivilege.has_mutation_privilege) return 'PRIVILEGE_MISSING';
  if (!runtimeTestPerformed) return 'RUNTIME_PROOF_MISSING';
  return 'APPROVAL_REQUIRED';
}

function nextRequiredProof(denialReasons) {
  if (denialReasons.includes('WSL_OBSERVER_ONLY')) return 'Rerun authority proof from Windows host or Linux bare metal outside WSL.';
  if (denialReasons.includes('CONFLICTING_BACKENDS')) return 'Choose one backend owner and capture a conflict-free read-only proof.';
  if (denialReasons.includes('NO_MUTATION_BACKEND')) return 'Install or expose a supported backend, then rerun read-only discovery.';
  if (denialReasons.includes('UNKNOWN_UNSAFE_AUTHORITY')) return 'Identify OS and backend authority before any mutation planning.';
  if (denialReasons.includes('PRIVILEGE_MISSING')) return 'Capture privileged read-only authority proof without executing writes.';
  if (denialReasons.includes('RUNTIME_PROOF_MISSING')) return 'Run an approved controlled runtime proof that performs no writes.';
  return 'Human approval and rollback proof required before future mutation.';
}

function buildNotes({ os, authorityLayer, backendOwner, denialReasons }) {
  return [
    'Stage 02 is read-only authority resolution; it performs no TDP writes, service changes, game launches, phone actions, or runtime mutations.',
    `OS layer resolved as ${os.detected}; authority layer resolved as ${authorityLayer}.`,
    `Backend owner candidate: ${backendOwner}.`,
    `Mutation remains denied: ${denialReasons.join(', ')}.`,
  ];
}

async function writePowerAuthorityOutputs(outDir, proof) {
  await writeFile(join(outDir, 'power-authority-proof.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'power-authority-proof.md'), renderPowerAuthorityMarkdown(proof), 'utf8');
  await writeFile(join(outDir, 'authority-backends.tsv'), renderPowerAuthorityBackendTsv(proof), 'utf8');
}

function tsv(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function resolveRequiredOut(out) {
  if (!out) throw new Error('Missing required --out');
  const resolved = resolve(out);
  if (!resolved || resolved === resolve('/')) throw new Error('Refusing to write authority output to filesystem root');
  return resolved;
}

function parseArgs(args) {
  const options = {
    out: null,
    powerProof: null,
    windowsProbe: null,
    linuxProbe: null,
    privilegeProbe: null,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--power-proof':
        options.powerProof = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--windows-probe':
        options.windowsProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--linux-probe':
        options.linuxProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--privilege-probe':
        options.privilegeProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown power authority proof option: ${arg}`);
    }
  }
  return options;
}

function requireValue(flag, value) {
  if (!value || String(value).startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/capture-power-authority-proof.js --out <dir> [--power-proof <file>] [--windows-probe <file>] [--linux-probe <file>] [--privilege-probe <file>]

Resolves the read-only authority layer for Power/TDP mutation planning. It can
consume an existing power-tdp-proof.json or capture a fresh read-only source
proof. It never writes TDP limits, starts services, changes power plans, launches
games, connects to phones, or mutates runtimes.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await capturePowerAuthorityProof(options);
  console.log(`Power authority proof written: ${result.outDir}`);
  console.log(`Classification: ${result.proof.classification}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
