#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export const POWER_POLICY_CATEGORIES = [
  'READ_ONLY_SAFE',
  'WRITE_DEFERRED',
  'APPROVAL_REQUIRED',
  'RUNTIME_PROOF_REQUIRED',
  'BACKEND_MISSING',
  'BACKEND_PRESENT_NOT_TESTED',
  'GAME_PROFILE_CANDIDATE',
  'BATTERY_POLICY_CANDIDATE',
  'AC_POLICY_CANDIDATE',
  'HANDHELD_DAEMON_CANDIDATE',
  'WINDOWS_POWER_ONLY',
  'LINUX_POWER_ONLY',
  'WSL_NOT_AUTHORITY',
];

export const REQUIRED_ACTION_GATES = [
  'Snapshot current power state',
  'Identify device',
  'Confirm backend',
  'Confirm AC/battery',
  'Confirm min/default/max TDP',
  'Confirm rollback command',
  'Confirm no game/anti-cheat risk',
  'User approval required before any write',
];

export async function buildPowerTdpPolicyMatrix(options) {
  const proofPath = resolveRequiredPath(options.proof, '--proof');
  const datasetPath = resolveRequiredPath(options.dataset, '--dataset');
  const outDir = resolveRequiredPath(options.out, '--out');
  await mkdir(outDir, { recursive: true });

  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const records = await readJsonl(datasetPath);
  const rows = records.map(record => classifyPowerPolicyRecord(record, proof));
  const backendSummary = summarizeBackends(proof);
  const actionGates = buildActionGates(proof);
  const summary = summarizePolicyRows(rows, proof, backendSummary, actionGates);
  const matrix = {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    proposal_only: true,
    proof_path: proofPath,
    dataset_path: datasetPath,
    proof_classification: proof.classification,
    backend_summary: backendSummary,
    summary,
    action_gates: actionGates,
    rows,
  };

  await writeFile(join(outDir, 'power-tdp-policy-matrix.json'), JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'power-tdp-policy-matrix.tsv'), renderPolicyMatrixTsv(rows), 'utf8');
  await writeFile(join(outDir, 'power-tdp-policy-matrix.md'), renderPolicyMatrixMarkdown(matrix), 'utf8');
  await writeFile(join(outDir, 'power-backend-summary.tsv'), renderBackendSummaryTsv(backendSummary), 'utf8');
  await writeFile(join(outDir, 'power-action-gates.tsv'), renderActionGatesTsv(actionGates), 'utf8');

  return { outDir, matrix, summary };
}

export function classifyPowerPolicyRecord(record, proof) {
  const claim = normalizeClaim(record);
  const categories = new Set(['READ_ONLY_SAFE']);
  const gates = new Set();
  const backend = backendForClaim(claim);

  if (proof?.platform?.is_wsl) {
    categories.add('WSL_NOT_AUTHORITY');
    gates.add('Confirm on host or device authority outside WSL before any write');
  }

  if (backend) {
    const status = proof?.tdp_backends?.[backend] ?? 'unknown';
    if (status === 'present') categories.add('BACKEND_PRESENT_NOT_TESTED');
    else categories.add('BACKEND_MISSING');
    if (['ryzenadj', 'hhd', 'acpi_call', 'smu'].includes(backend)) {
      categories.add('WRITE_DEFERRED');
      categories.add('APPROVAL_REQUIRED');
      categories.add('RUNTIME_PROOF_REQUIRED');
      gates.add('Confirm backend');
      gates.add('Confirm rollback command');
      gates.add('User approval required before any write');
    }
    if (backend === 'hhd') categories.add('HANDHELD_DAEMON_CANDIDATE');
    if (backend === 'powercfg') categories.add('WINDOWS_POWER_ONLY');
    if (backend === 'powerprofilesctl') categories.add('LINUX_POWER_ONLY');
  }

  if (/GAME_PROFILE_/.test(claim)) {
    categories.add('GAME_PROFILE_CANDIDATE');
    categories.add('RUNTIME_PROOF_REQUIRED');
    gates.add('Confirm no game/anti-cheat risk');
  }

  if (/BATTERY_CAP|BATTERY/.test(claim)) {
    categories.add('BATTERY_POLICY_CANDIDATE');
    if (proof?.power?.battery_present) categories.add('AC_POLICY_CANDIDATE');
    gates.add('Confirm AC/battery');
  }

  if (/POWER_MODE_PROFILE/.test(claim)) {
    categories.add(proof?.tdp_backends?.powercfg === 'present' ? 'WINDOWS_POWER_ONLY' : 'LINUX_POWER_ONLY');
    categories.add('WRITE_DEFERRED');
    categories.add('APPROVAL_REQUIRED');
  }

  if (/MUTATION_REQUIRES_APPROVAL|PLUGIN_CONFLICT_DETECTED/.test(claim)) {
    categories.add('WRITE_DEFERRED');
    categories.add('APPROVAL_REQUIRED');
    gates.add('Snapshot current power state');
    gates.add('User approval required before any write');
  }

  if (/RUNTIME_PROOF_MISSING|RESEARCH_READY_FOR_CONTROLLED_TEST|STABLE_SAMPLE_HYSTERESIS/.test(claim)) {
    categories.add('RUNTIME_PROOF_REQUIRED');
  }

  if (proof?.proof?.tdp_write_performed === false) categories.add('WRITE_DEFERRED');

  const orderedCategories = POWER_POLICY_CATEGORIES.filter(category => categories.has(category));
  const action = recommendAction(orderedCategories, claim);
  return {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    proposal_only: true,
    write_allowed: false,
    record_id: record.id ?? record.record_id ?? claim,
    source_project: record.source_project ?? 'unknown',
    claim,
    labels: record.labels ?? [],
    categories: orderedCategories,
    backend: backend ?? null,
    backend_status: backend ? (proof?.tdp_backends?.[backend] ?? 'unknown') : 'not_applicable',
    recommended_policy: action,
    required_gates: [...new Set([...gates, ...REQUIRED_ACTION_GATES])],
    text: record.text ?? '',
  };
}

export function summarizePolicyRows(rows, proof, backendSummary, actionGates) {
  const counts = Object.fromEntries(POWER_POLICY_CATEGORIES.map(category => [category, 0]));
  for (const row of rows) {
    for (const category of row.categories) counts[category] = (counts[category] ?? 0) + 1;
  }
  return {
    schema_version: 1,
    source_authority: false,
    generated_artifact: true,
    proposal_only: true,
    total_records: rows.length,
    proof_classification: proof?.classification ?? 'unknown',
    write_allowed: false,
    tdp_write_performed: proof?.proof?.tdp_write_performed === true,
    runtime_test_performed: proof?.proof?.runtime_test_performed === true,
    detected_backends: backendSummary.filter(item => item.status === 'present').length,
    approval_required: counts.APPROVAL_REQUIRED,
    write_deferred: counts.WRITE_DEFERRED,
    runtime_proof_required: counts.RUNTIME_PROOF_REQUIRED,
    game_profile_candidates: counts.GAME_PROFILE_CANDIDATE,
    battery_policy_candidates: counts.BATTERY_POLICY_CANDIDATE,
    ac_policy_candidates: counts.AC_POLICY_CANDIDATE,
    wsl_not_authority: counts.WSL_NOT_AUTHORITY,
    action_gates_total: actionGates.length,
    counts,
  };
}

function summarizeBackends(proof) {
  return Object.entries(proof?.tdp_backends ?? {}).map(([backend, status]) => ({
    backend,
    status,
    write_capable: ['ryzenadj', 'hhd', 'acpi_call', 'smu'].includes(backend),
    policy: status === 'present' ? 'BACKEND_PRESENT_NOT_TESTED' : 'BACKEND_MISSING',
  }));
}

function buildActionGates(proof) {
  return REQUIRED_ACTION_GATES.map(gate => ({
    gate,
    required: true,
    status: initialGateStatus(gate, proof),
  }));
}

function initialGateStatus(gate, proof) {
  if (gate === 'Confirm backend') {
    return Object.values(proof?.tdp_backends ?? {}).some(status => status === 'present') ? 'partially_satisfied_read_only' : 'missing';
  }
  if (gate === 'Confirm AC/battery') {
    return proof?.power?.battery_present || proof?.power?.ac_online !== null ? 'partially_satisfied_read_only' : 'missing';
  }
  if (gate === 'Identify device') {
    return proof?.cpu?.name && proof.cpu.name !== 'unknown' ? 'partially_satisfied_read_only' : 'missing';
  }
  return 'required_before_write';
}

function normalizeClaim(record) {
  return String(record.claim ?? record.id ?? record.record_id ?? '').trim().toUpperCase();
}

function backendForClaim(claim) {
  if (/RYZENADJ/.test(claim)) return 'ryzenadj';
  if (/HHD/.test(claim)) return 'hhd';
  if (/ACPI/.test(claim)) return 'acpi_call';
  if (/SMU/.test(claim)) return 'smu';
  if (/POWERPROFILESCTL/.test(claim)) return 'powerprofilesctl';
  if (/POWERCFG/.test(claim)) return 'powercfg';
  return null;
}

function recommendAction(categories, claim) {
  if (categories.includes('BACKEND_MISSING')) return 'Record as research-only candidate; backend is not visible in current proof.';
  if (categories.includes('GAME_PROFILE_CANDIDATE')) return 'Proposal only: select as a game profile candidate after runtime and safety proof.';
  if (categories.includes('APPROVAL_REQUIRED')) return 'Proposal only: approval, rollback, AC/battery, and runtime proof required before any write.';
  if (/DEVICE_PROFILE|AUTODETECT/.test(claim)) return 'Read-only safe: preserve as device identity evidence.';
  return 'Read-only safe: keep as policy evidence, not an action.';
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
}

function renderPolicyMatrixTsv(rows) {
  return [
    'record_id\tclaim\tbackend\tbackend_status\tcategories\trecommended_policy',
    ...rows.map(row => [
      row.record_id,
      row.claim,
      row.backend ?? '',
      row.backend_status,
      row.categories.join(','),
      row.recommended_policy,
    ].map(tsv).join('\t')),
    '',
  ].join('\n');
}

function renderBackendSummaryTsv(rows) {
  return [
    'backend\tstatus\twrite_capable\tpolicy',
    ...rows.map(row => [row.backend, row.status, String(row.write_capable), row.policy].map(tsv).join('\t')),
    '',
  ].join('\n');
}

function renderActionGatesTsv(rows) {
  return [
    'gate\trequired\tstatus',
    ...rows.map(row => [row.gate, String(row.required), row.status].map(tsv).join('\t')),
    '',
  ].join('\n');
}

function renderPolicyMatrixMarkdown(matrix) {
  return [
    '# Power/TDP Policy Matrix',
    '',
    `- Proof classification: ${matrix.proof_classification}`,
    `- Proposal only: ${matrix.proposal_only ? 'yes' : 'no'}`,
    `- Write allowed: ${matrix.summary.write_allowed ? 'yes' : 'no'}`,
    `- Detected backends: ${matrix.summary.detected_backends}`,
    `- Approval required rows: ${matrix.summary.approval_required}`,
    `- Runtime proof required rows: ${matrix.summary.runtime_proof_required}`,
    `- Game profile candidates: ${matrix.summary.game_profile_candidates}`,
    '',
    '## Backend Summary',
    '',
    '| Backend | Status | Policy |',
    '|---|---:|---|',
    ...matrix.backend_summary.map(row => `| ${row.backend} | ${row.status} | ${row.policy} |`),
    '',
    '## Action Gates',
    '',
    ...matrix.action_gates.map(row => `- ${row.gate}: ${row.status}`),
    '',
    '## Rows',
    '',
    ...matrix.rows.map(row => `- ${row.claim}: ${row.categories.join(', ')}. ${row.recommended_policy}`),
    '',
  ].join('\n');
}

function tsv(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function resolveRequiredPath(value, flag) {
  if (!value) throw new Error(`Missing required ${flag}`);
  return resolve(value);
}

function parseArgs(args) {
  const options = { proof: null, dataset: null, out: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--proof':
        options.proof = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--dataset':
        options.dataset = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown power policy matrix option: ${arg}`);
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
  node scripts/build-power-tdp-policy-matrix.js \\
    --proof <power-tdp-proof.json> \\
    --dataset <power-tdp-runtime-advisory.jsonl> \\
    --out <dir>

Builds proposal-only Power/TDP policy matrix artifacts from local read-only proof
and advisory metadata. It does not write TDP limits, start services, change power
plans, launch games, connect to phones, or mutate runtimes.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await buildPowerTdpPolicyMatrix(options);
  console.log(`Power/TDP policy matrix written: ${result.outDir}`);
  console.log(`Records: ${result.summary.total_records}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
