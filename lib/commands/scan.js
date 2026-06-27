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

  const profiles = options.profileList.length > 0 ? options.profileList : [options.profile];
  for (const profile of profiles) {
    const outDir = profiles.length === 1 ? options.outDir : resolve(options.outDir, profile);
    const report = await scanProject({
      projectRoot: options.projectRoot,
      profile,
      knownGood,
      knownGoodPath: options.knownGoodPath,
      outDir,
      maxFileSize: options.maxFileSize,
      includeIgnored: options.includeIgnored,
    });

    const written = await writeScanOutputs(report, {
      outDir,
      html: options.html,
      json: options.json,
      jsonl: options.jsonl,
      markdown: options.markdown,
      agentHandoff: options.agentHandoff,
    });

    printScanSummary(report, outDir, written, chalk);
  }
}

function parseArgs(args) {
  const options = {
    projectRoot: resolve(process.cwd()),
    profile: 'generic_source_tree',
    profileList: [],
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
  let explicitProjectRoot = false;

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
        if (inlineValue !== null) {
          options.profileList = parseProfileList(requireValue(flag, inlineValue));
        } else if (args[index + 1] && !String(args[index + 1]).startsWith('--')) {
          options.profileList = parseProfileList(args[index + 1]);
          index += 1;
        } else {
          options.listProfiles = true;
        }
        break;
      case '--project-root':
        options.projectRoot = resolve(requireValue(flag, value));
        explicitProjectRoot = true;
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
        if (!String(arg).startsWith('-') && !explicitProjectRoot) {
          options.projectRoot = resolve(arg);
          explicitProjectRoot = true;
          break;
        }
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

function parseProfileList(value) {
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function printScanSummary(report, outDir, written, chalk) {
  console.log(chalk.bold('\n  Reversa: Scan complete\n'));
  console.log(`  Project:          ${chalk.cyan(report.scan.project_root)}`);
  console.log(`  Profile:          ${chalk.cyan(report.scan.profile)}`);
  console.log(`  Output:           ${chalk.cyan(outDir)}`);
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

  Evidence-driven scan for contradictions, runtime facts, and agent handoff.

  Usage:
    npx reversa scan [options]

  Options:
    --project-root <path>     Source tree to scan (default: current directory)
    --profile <id>            Scan profile (default: generic_source_tree)
    --profiles [ids]          List profiles, or scan comma-separated profile ids
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

  Examples:
    npx reversa scan --profiles
    npx reversa scan --profiles semantic_policy .
    npx reversa scan --profiles semantic_policy,agentic_gateway /path/to/project
`);
}
