import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

const DEFAULT_AUDIT_ROOT = 'local/audits/codex-handwave-audit-20260630';

const REQUIRED_GATES = new Set([
  'full_epoch_coverage',
  'held_out_and_adversarial_eval',
  'operator_protocol_present',
  'droidspaces_kernel_blocker_locked',
]);

export default async function rebuildGate(args) {
  const { default: chalk } = await import('chalk');
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  const report = await evaluateRebuildGate(options);

  if (options.out) {
    const outDir = resolve(options.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'rebuild-gate.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    await writeFile(join(outDir, 'rebuild-gate.md'), buildRebuildGateMarkdown(report), 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (options.markdown) {
    console.log(buildRebuildGateMarkdown(report));
    return;
  }

  console.log(chalk.bold('\n  Reversa rebuild gate\n'));
  console.log(`  Classification: ${colorClassification(chalk, report.classification)}`);
  console.log(`  Ready:          ${report.ready_for_rebuild ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  Audit root:     ${chalk.cyan(report.audit_root)}`);
  console.log('');
  for (const gate of report.gates) {
    const marker = gate.status === 'pass' ? chalk.green('PASS')
      : gate.status === 'warning' ? chalk.yellow('WARN')
        : chalk.red('BLOCK');
    console.log(`  ${marker} ${gate.id}: ${gate.summary}`);
  }
  if (options.out) {
    console.log(`\n  Output: ${chalk.cyan(resolve(options.out))}`);
  }
  console.log('');
}

export async function evaluateRebuildGate(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const auditRoot = resolve(repoRoot, options.auditRoot ?? options.audit ?? DEFAULT_AUDIT_ROOT);
  const files = {
    training: join(auditRoot, 'training-full-epoch-capture.md'),
    evalGate: join(auditRoot, 'eval-gate-capture.md'),
    supplement: join(auditRoot, 'game-wrapper-supplement-capture.md'),
    failureLog: join(auditRoot, 'failure-log.md'),
    fullStack: join(auditRoot, 'full-stack-addendum.md'),
    operatorProtocol: join(repoRoot, 'docs/protocols/OPERATOR_STEER_PROTOCOL.md'),
    rebuildContract: join(repoRoot, 'docs/protocols/REVERSA_REBUILD_ONE_SHOT_CONTRACT.md'),
  };

  const text = {
    training: await readOptional(files.training),
    evalGate: await readOptional(files.evalGate),
    supplement: await readOptional(files.supplement),
    failureLog: await readOptional(files.failureLog),
    fullStack: await readOptional(files.fullStack),
    operatorProtocol: await readOptional(files.operatorProtocol),
    rebuildContract: await readOptional(files.rebuildContract),
  };

  const gates = [
    trainingGate(files.training, text.training),
    evalGate(files.evalGate, text.evalGate),
    protocolGate(files.operatorProtocol, files.rebuildContract, text.operatorProtocol, text.rebuildContract),
    droidspacesGate(files.failureLog, files.fullStack, text.failureLog, text.fullStack),
    supplementGate(files.supplement, text.supplement),
  ];
  const blocked = gates.filter(gate => REQUIRED_GATES.has(gate.id) && gate.status !== 'pass');
  const warnings = gates.filter(gate => gate.status === 'warning');
  const ready = blocked.length === 0;

  return {
    schema: 'reversa.rebuild_gate.v1',
    generated_at: new Date().toISOString(),
    audit_root: auditRoot,
    repo_root: repoRoot,
    classification: ready
      ? warnings.length > 0
        ? 'REVERSA_REBUILD_GATE_PASS_WITH_WARNINGS'
        : 'REVERSA_REBUILD_GATE_PASS'
      : 'REVERSA_REBUILD_GATE_BLOCKED',
    ready_for_rebuild: ready,
    deterministic_scanner_truth_above_model: true,
    gates,
    blocked: blocked.map(gate => gate.id),
    warnings: warnings.map(gate => gate.id),
    next_action: ready
      ? 'Proceed to the next rebuild slice with deterministic scanner evidence above model advice.'
      : `Fix required gate: ${blocked[0]?.id ?? 'unknown'}.`,
  };
}

function trainingGate(path, text) {
  if (!text) {
    return blockGate('full_epoch_coverage', path, 'Missing full-epoch training capture.', [
      'training-full-epoch-capture.md',
    ]);
  }

  const coverageComplete = /coverage_complete[^A-Za-z0-9]+(?:`)?true(?:`)?/i.test(text);
  const coverageFraction = numberAfter(text, 'coverage_fraction');
  const trainRows = numberAfter(text, 'train_rows');
  const uniqueRowsSeen = numberAfter(text, 'unique_rows_seen');
  const missingRows = numberAfter(text, 'missing_rows');
  const pass = coverageComplete
    && coverageFraction === 1
    && trainRows > 0
    && uniqueRowsSeen === trainRows
    && missingRows === 0;

  return {
    id: 'full_epoch_coverage',
    status: pass ? 'pass' : 'block',
    evidence_path: path,
    summary: pass
      ? `Full epoch coverage complete: ${uniqueRowsSeen}/${trainRows}, missing=${missingRows}.`
      : 'Full epoch coverage proof is incomplete or inconsistent.',
    observed: {
      coverage_complete: coverageComplete,
      coverage_fraction: coverageFraction,
      train_rows: trainRows,
      unique_rows_seen: uniqueRowsSeen,
      missing_rows: missingRows,
    },
    required: [
      'coverage_complete=true',
      'coverage_fraction=1.0',
      'unique_rows_seen=train_rows',
      'missing_rows=0',
    ],
  };
}

function evalGate(path, text) {
  if (!text) {
    return blockGate('held_out_and_adversarial_eval', path, 'Missing held-out/adversarial eval capture.', [
      'eval-gate-capture.md',
    ]);
  }
  const hasHeldOut = /held[- ]out/i.test(text);
  const hasAdversarial = /adversarial/i.test(text);
  const completed = /completed|pass|passed/i.test(text);
  const finite = !/non[- ]finite|nan|inf(?:inity)?/i.test(text);
  const pass = hasHeldOut && hasAdversarial && completed && finite;
  return {
    id: 'held_out_and_adversarial_eval',
    status: pass ? 'pass' : 'block',
    evidence_path: path,
    summary: pass
      ? 'Held-out and adversarial eval evidence is present and finite.'
      : 'Held-out/adversarial eval proof is missing, incomplete, or non-finite.',
    observed: { has_held_out: hasHeldOut, has_adversarial: hasAdversarial, completed, finite },
    required: ['held-out eval', 'adversarial eval', 'finite loss/metrics'],
  };
}

function protocolGate(operatorPath, contractPath, operatorText, contractText) {
  const operatorPass = /operator diagnosis as a priority hypothesis|operator steer is a priority hypothesis/i.test(operatorText ?? '');
  const contractPass = /current source-of-truth|calls training complete without coverage proof|DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL/i.test(contractText ?? '');
  const pass = operatorPass && contractPass;
  return {
    id: 'operator_protocol_present',
    status: pass ? 'pass' : 'block',
    evidence_path: [operatorPath, contractPath],
    summary: pass
      ? 'Operator-steer and rebuild one-shot protocols are present.'
      : 'Operator-steer or rebuild one-shot protocol is missing/incomplete.',
    observed: { operator_protocol: operatorPass, rebuild_contract: contractPass },
    required: ['OPERATOR_STEER_PROTOCOL.md', 'REVERSA_REBUILD_ONE_SHOT_CONTRACT.md'],
  };
}

function droidspacesGate(failurePath, fullStackPath, failureText, fullStackText) {
  const combined = `${failureText ?? ''}\n${fullStackText ?? ''}`;
  const classification = /DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL/i.test(combined);
  const pid = /PID namespace|CONFIG_PID_NS/i.test(combined);
  const ipc = /IPC namespace|CONFIG_IPC_NS/i.test(combined);
  const pass = classification && pid && ipc;
  return {
    id: 'droidspaces_kernel_blocker_locked',
    status: pass ? 'pass' : 'block',
    evidence_path: [failurePath, fullStackPath],
    summary: pass
      ? 'Droidspaces kernel blocker is locked to PID_NS and IPC_NS evidence.'
      : 'Droidspaces kernel blocker lock is missing or incomplete.',
    observed: {
      classification,
      pid_namespace_or_config: pid,
      ipc_namespace_or_config: ipc,
    },
    required: [
      'DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL',
      'PID namespace / CONFIG_PID_NS',
      'IPC namespace / CONFIG_IPC_NS',
    ],
  };
}

function supplementGate(path, text) {
  if (!text) {
    return {
      id: 'game_wrapper_supplement',
      status: 'warning',
      evidence_path: path,
      summary: 'Game-wrapper supplement capture is missing; wrapper lane coverage may still be thin.',
      observed: { present: false },
      required: ['game-wrapper supplement capture or explicit deferral'],
    };
  }
  const finite = !/non[- ]finite|nan|inf(?:inity)?/i.test(text);
  const unresolved = /did not solve|high-loss|weak/i.test(text);
  return {
    id: 'game_wrapper_supplement',
    status: finite && !unresolved ? 'pass' : 'warning',
    evidence_path: path,
    summary: unresolved
      ? 'Game-wrapper supplement is finite, but original held-out high-loss shape remains a future target.'
      : 'Game-wrapper supplement evidence is present.',
    observed: { present: true, finite, unresolved_high_loss_shape: unresolved },
    required: ['finite supplement metrics', 'known weakness preserved if unresolved'],
  };
}

export function buildRebuildGateMarkdown(report) {
  return [
    '# Reversa Rebuild Gate',
    '',
    `- Classification: \`${report.classification}\``,
    `- Ready for rebuild: \`${report.ready_for_rebuild}\``,
    `- Audit root: \`${report.audit_root}\``,
    `- Deterministic scanner truth above model: \`${report.deterministic_scanner_truth_above_model}\``,
    '',
    '## Gates',
    '',
    '| Gate | Status | Summary |',
    '| --- | --- | --- |',
    ...report.gates.map(gate => `| \`${gate.id}\` | \`${gate.status}\` | ${markdownCell(gate.summary)} |`),
    '',
    '## Blocked',
    '',
    report.blocked.length ? report.blocked.map(item => `- \`${item}\``).join('\n') : '- none',
    '',
    '## Warnings',
    '',
    report.warnings.length ? report.warnings.map(item => `- \`${item}\``).join('\n') : '- none',
    '',
    '## Next Action',
    '',
    report.next_action,
    '',
  ].join('\n');
}

function blockGate(id, path, summary, required) {
  return {
    id,
    status: 'block',
    evidence_path: path,
    summary,
    observed: { present: false },
    required,
  };
}

async function readOptional(path) {
  if (!existsSync(path)) return null;
  return readFile(path, 'utf8');
}

function numberAfter(text, key) {
  const pattern = new RegExp(`${escapeRegExp(key)}[^0-9]+([0-9]+(?:\\.[0-9]+)?)`, 'i');
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markdownCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function colorClassification(chalk, classification) {
  if (/PASS/.test(classification)) return chalk.green(classification);
  return chalk.red(classification);
}

function parseArgs(args) {
  const options = {
    auditRoot: DEFAULT_AUDIT_ROOT,
    help: false,
    json: false,
    markdown: false,
    out: null,
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
      case '--audit-root':
        options.auditRoot = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--markdown':
      case '--md':
        options.markdown = true;
        break;
      case '--out':
        options.out = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown rebuild-gate option: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (!value || String(value).startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`
  reversa rebuild-gate

  Classify whether the current Reversa rebuild gate is open from local artifacts.

  Usage:
    node ./bin/reversa.js rebuild-gate \\
      --audit-root local/audits/codex-handwave-audit-20260630 \\
      --json \\
      --out local/rebuild-gate-check

  Required proof:
    - full-epoch coverage_complete=true
    - unique_rows_seen=train_rows and missing_rows=0
    - held-out and adversarial evals complete
    - operator-steer/rebuild protocols present
    - Droidspaces kernel blocker locked to PID_NS and IPC_NS

  This command is read-only except for optional --out report files.
`);
}
