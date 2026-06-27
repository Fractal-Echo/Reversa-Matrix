import { existsSync } from 'fs';
import { resolve } from 'path';
import { readJsonSafe } from '../utils/json-safe.js';
import { listProfiles } from '../scan/profiles.js';
import { scanProject } from '../scan/scanner.js';
import { writeScanOutputs } from '../scan/writers.js';

export default async function scan(args) {
  const { default: chalk } = await import('chalk');
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.listProfiles) {
    console.log('\n  Reversa scan profiles\n');
    for (const profile of listProfiles()) {
      console.log(`  ${chalk.cyan(profile.id.padEnd(22))} ${profile.label}`);
    }
    console.log('');
    return;
  }

  if (!existsSync(options.projectRoot)) {
    throw new Error(`Project root does not exist: ${options.projectRoot}`);
  }

  let knownGood = null;
  if (options.knownGoodPath) {
    if (!existsSync(options.knownGoodPath)) {
      throw new Error(`Known-good file does not exist: ${options.knownGoodPath}`);
    }
    knownGood = readJsonSafe(options.knownGoodPath);
  }

  const report = await scanProject({
    projectRoot: options.projectRoot,
    profile: options.profile,
    knownGood,
    knownGoodPath: options.knownGoodPath,
    outDir: options.outDir,
    maxFileSize: options.maxFileSize,
    includeIgnored: options.includeIgnored,
  });

  const written = await writeScanOutputs(report, {
    outDir: options.outDir,
    html: options.html,
    json: options.json,
    jsonl: options.jsonl,
    markdown: options.markdown,
    agentHandoff: options.agentHandoff,
  });

  console.log(chalk.bold('\n  Reversa: Scan complete\n'));
  console.log(`  Project:          ${chalk.cyan(report.scan.project_root)}`);
  console.log(`  Profile:          ${chalk.cyan(report.scan.profile)}`);
  console.log(`  Output:           ${chalk.cyan(options.outDir)}`);
  console.log(`  Findings:         ${chalk.cyan(report.summary.total_findings)}`);
  console.log(`  Contradictions:   ${chalk.cyan(report.summary.total_contradictions)}`);
  console.log(`  Patch candidates: ${chalk.cyan(report.summary.total_patch_candidates)}`);
  console.log(`  Highest severity: ${severityColor(chalk, report.summary.highest_severity)}`);
  console.log('');

  if (written.length > 0) {
    console.log(chalk.bold('  Artifacts:'));
    for (const file of written) {
      console.log(`  - ${file}`);
    }
    console.log('');
  }
}

function parseArgs(args) {
  const options = {
    projectRoot: resolve(process.cwd()),
    profile: 'generic_source_tree',
    outDir: resolve(process.cwd(), 'reversa_out'),
    knownGoodPath: null,
    html: false,
    json: false,
    jsonl: false,
    markdown: false,
    agentHandoff: false,
    help: false,
    listProfiles: false,
    maxFileSize: undefined,
    includeIgnored: false,
  };

  let explicitOutput = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--profiles':
        options.listProfiles = true;
        break;
      case '--project-root':
        options.projectRoot = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--profile':
        options.profile = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--known-good':
        options.knownGoodPath = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-file-size':
        options.maxFileSize = parseSize(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--include-ignored':
        options.includeIgnored = true;
        break;
      case '--html':
        options.html = true;
        explicitOutput = true;
        break;
      case '--json':
        options.json = true;
        explicitOutput = true;
        break;
      case '--jsonl':
        options.jsonl = true;
        explicitOutput = true;
        break;
      case '--markdown':
      case '--md':
        options.markdown = true;
        explicitOutput = true;
        break;
      case '--agent-handoff':
        options.agentHandoff = true;
        explicitOutput = true;
        break;
      default:
        throw new Error(`Unknown scan option: ${arg}`);
    }
  }

  if (!explicitOutput) {
    options.html = true;
    options.json = true;
    options.jsonl = true;
    options.markdown = true;
    options.agentHandoff = true;
  }

  return options;
}

function requireValue(flag, value) {
  if (value === null || value === undefined || String(value).startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseSize(value) {
  const match = String(value).trim().match(/^([0-9]+)([kKmM]?)$/);
  if (!match) {
    throw new Error(`Invalid --max-file-size value: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'm') return amount * 1024 * 1024;
  if (unit === 'k') return amount * 1024;
  return amount;
}

function severityColor(chalk, severity) {
  if (severity === 'BLOCKER' || severity === 'HIGH') return chalk.red(severity);
  if (severity === 'MEDIUM') return chalk.yellow(severity);
  if (severity === 'LOW') return chalk.green(severity);
  return chalk.gray(severity);
}

function printHelp() {
  console.log(`
  reversa scan

  Evidence-driven source tree scan for reverse-engineering and agent handoff.

  Usage:
    npx reversa scan [options]

  Options:
    --project-root <path>     Source tree to scan (default: current directory)
    --profile <id>            Scan profile (default: generic_source_tree)
    --profiles                List available profiles
    --known-good <json>       Known-good facts from real device testing
    --out <path>              Output directory (default: reversa_out)
    --html                    Write report.html
    --json                    Write report.json
    --jsonl                   Write evidence.jsonl
    --markdown, --md          Write summary.md
    --agent-handoff           Write agent_handoff/ bundle
    --max-file-size <n|nK|nM> Skip larger files (default: 2M)
    --include-ignored         Include files ignored by git exclude rules

  If no output format flags are passed, scan writes HTML, JSON, JSONL,
  Markdown, and the agent handoff bundle.
`);
}
