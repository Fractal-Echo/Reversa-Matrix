import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { dirname, resolve, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(__dirname, '../../bin/reversa.js');

export default async function scanFleet(args) {
  const { default: chalk } = await import('chalk');
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.manifestPath) {
    throw new Error('scan-fleet requires --manifest <path>');
  }
  if (!existsSync(options.manifestPath)) {
    throw new Error(`Fleet manifest does not exist: ${options.manifestPath}`);
  }

  const entries = await loadFleetManifest(options.manifestPath, options.baseDir);
  if (entries.length === 0) {
    throw new Error(`Fleet manifest has no scan entries: ${options.manifestPath}`);
  }

  await mkdir(options.outDir, { recursive: true });
  const results = [];
  const total = entries.length * options.profileList.length;
  let index = 0;

  for (const entry of entries) {
    for (const profile of options.profileList) {
      index += 1;
      const shardOut = join(options.outDir, sanitizePathPart(entry.name), profile);
      console.log(chalk.gray(`[${index}/${total}] scan-fleet ${entry.name} ${profile}`));
      const result = await runScanShard({ entry, profile, shardOut, options });
      results.push(result);
      printShardSummary(result, chalk);
    }
  }

  const aggregate = buildAggregate({ options, entries, results });
  await writeAggregateOutputs(options.outDir, aggregate);
  printFleetSummary(aggregate, options.outDir, chalk);
}

export async function loadFleetManifest(manifestPath, baseDir = process.cwd()) {
  const text = await readFile(manifestPath, 'utf8');
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    const rawEntries = Array.isArray(parsed) ? parsed : parsed.repos ?? parsed.entries ?? [];
    if (!Array.isArray(rawEntries)) {
      throw new Error('Fleet manifest JSON must be an array or contain repos/entries array');
    }
    return rawEntries.map((item, index) => normalizeManifestEntry(item, index, baseDir));
  }

  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((line, index) => normalizeManifestEntry(line, index, baseDir));
}

function normalizeManifestEntry(item, index, baseDir) {
  if (typeof item === 'string') {
    const path = resolve(baseDir, item);
    return {
      name: basenameForEntry(path, index),
      path,
    };
  }
  if (!item || typeof item !== 'object') {
    throw new Error(`Invalid fleet manifest entry at index ${index}`);
  }
  const rawPath = item.path ?? item.projectRoot ?? item.project_root;
  if (!rawPath) {
    throw new Error(`Fleet manifest entry ${item.name ?? index} is missing path`);
  }
  const path = resolve(baseDir, rawPath);
  return {
    name: String(item.name ?? basenameForEntry(path, index)),
    path,
    group: item.group ? String(item.group) : '',
  };
}

async function runScanShard({ entry, profile, shardOut, options }) {
  const startedAt = new Date().toISOString();
  if (!existsSync(entry.path)) {
    return {
      repo: entry.name,
      group: entry.group ?? '',
      project_root: entry.path,
      profile,
      out_dir: shardOut,
      status: 'failed',
      classification: 'SCAN_FAILED_MISSING_PROJECT_ROOT',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: null,
      signal: null,
      findings: 0,
      contradictions: 0,
      patch_candidates: 0,
      highest_severity: 'UNKNOWN',
      error: `Project root does not exist: ${entry.path}`,
    };
  }

  const scanArgs = [
    binPath,
    'scan',
    '--project-root',
    entry.path,
    '--profile',
    profile,
    '--out',
    shardOut,
    '--json',
    '--markdown',
    '--jsonl',
  ];
  if (options.maxFileSize) {
    scanArgs.push('--max-file-size', options.maxFileSize);
  }
  if (options.includeIgnored) {
    scanArgs.push('--include-ignored');
  }

  const run = await runChild(process.execPath, scanArgs, {
    timeoutMs: options.timeoutMs,
    env: process.env,
  });

  const finishedAt = new Date().toISOString();
  const reportPath = join(shardOut, 'report.json');
  if (run.status === 0 && existsSync(reportPath)) {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    return {
      repo: entry.name,
      group: entry.group ?? '',
      project_root: entry.path,
      profile,
      out_dir: shardOut,
      report_json: reportPath,
      status: 'passed',
      classification: 'SCAN_SHARD_PASS',
      started_at: startedAt,
      finished_at: finishedAt,
      exit_code: run.status,
      signal: run.signal,
      findings: report.summary?.total_findings ?? 0,
      contradictions: report.summary?.total_contradictions ?? 0,
      patch_candidates: report.summary?.total_patch_candidates ?? 0,
      highest_severity: report.summary?.highest_severity ?? 'UNKNOWN',
    };
  }

  const classification = classifyScanFailure(run);
  return {
    repo: entry.name,
    group: entry.group ?? '',
    project_root: entry.path,
    profile,
    out_dir: shardOut,
    status: 'failed',
    classification,
    started_at: startedAt,
    finished_at: finishedAt,
    exit_code: run.status,
    signal: run.signal,
    findings: 0,
    contradictions: 0,
    patch_candidates: 0,
    highest_severity: 'UNKNOWN',
    error: firstUsefulLine(run.stderr) || firstUsefulLine(run.stdout) || classification,
    stdout_tail: tailLines(run.stdout, 40),
    stderr_tail: tailLines(run.stderr, 40),
  };
}

export function classifyScanFailure(run) {
  const text = `${run.stderr ?? ''}\n${run.stdout ?? ''}`;
  if (run.timedOut) return 'SCAN_FAILED_TIMEOUT';
  if (/JavaScript heap out of memory|Allocation failed - JavaScript heap out of memory|Ineffective mark-compacts near heap limit/i.test(text)) {
    return 'SCAN_FAILED_OOM';
  }
  if (/Project root does not exist/i.test(text)) return 'SCAN_FAILED_MISSING_PROJECT_ROOT';
  if (/Unknown scan profile/i.test(text)) return 'SCAN_FAILED_BAD_PROFILE';
  return 'SCAN_FAILED_PROCESS_ERROR';
}

function runChild(command, args, { timeoutMs = 0, env = process.env } = {}) {
  return new Promise(resolveRun => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer);
      resolveRun({ status, signal, stdout, stderr, timedOut });
    });
  });
}

function buildAggregate({ options, entries, results }) {
  const passed = results.filter(item => item.status === 'passed');
  const failed = results.filter(item => item.status !== 'passed');
  return {
    schema_version: 1,
    tool: 'reversa',
    command: 'scan-fleet',
    generated_at: new Date().toISOString(),
    manifest: options.manifestPath,
    out_dir: options.outDir,
    profiles: options.profileList,
    repos: entries.map(entry => ({
      name: entry.name,
      path: entry.path,
      group: entry.group ?? '',
    })),
    summary: {
      total_shards: results.length,
      passed_shards: passed.length,
      failed_shards: failed.length,
      total_findings: sum(results, 'findings'),
      total_contradictions: sum(results, 'contradictions'),
      total_patch_candidates: sum(results, 'patch_candidates'),
      failed_classifications: countBy(failed, 'classification'),
    },
    results,
  };
}

async function writeAggregateOutputs(outDir, aggregate) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'fleet-report.json'), `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
  await writeFile(join(outDir, 'fleet-summary.tsv'), buildFleetTsv(aggregate), 'utf8');
  await writeFile(join(outDir, 'fleet-summary.md'), buildFleetMarkdown(aggregate), 'utf8');
}

function buildFleetTsv(aggregate) {
  const rows = ['repo\tgroup\tprofile\tstatus\tclassification\tfindings\tcontradictions\tpatch_candidates\thighest_severity\treport_json\terror'];
  for (const item of aggregate.results) {
    rows.push([
      item.repo,
      item.group ?? '',
      item.profile,
      item.status,
      item.classification,
      item.findings,
      item.contradictions,
      item.patch_candidates,
      item.highest_severity,
      item.report_json ?? '',
      (item.error ?? '').replace(/\s+/g, ' ').trim(),
    ].join('\t'));
  }
  return `${rows.join('\n')}\n`;
}

function buildFleetMarkdown(aggregate) {
  const lines = [];
  lines.push('# Reversa Fleet Scan Summary');
  lines.push('');
  lines.push(`- Manifest: \`${aggregate.manifest}\``);
  lines.push(`- Profiles: \`${aggregate.profiles.join(',')}\``);
  lines.push(`- Shards: ${aggregate.summary.total_shards}`);
  lines.push(`- Passed: ${aggregate.summary.passed_shards}`);
  lines.push(`- Failed: ${aggregate.summary.failed_shards}`);
  lines.push(`- Findings: ${aggregate.summary.total_findings}`);
  lines.push(`- Contradictions: ${aggregate.summary.total_contradictions}`);
  lines.push(`- Patch candidates: ${aggregate.summary.total_patch_candidates}`);
  lines.push('');
  lines.push('| Repo | Profile | Status | Classification | Findings | Contradictions | Patch candidates |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const item of aggregate.results) {
    lines.push(`| ${item.repo} | ${item.profile} | ${item.status} | ${item.classification} | ${item.findings} | ${item.contradictions} | ${item.patch_candidates} |`);
  }
  lines.push('');
  if (aggregate.summary.failed_shards > 0) {
    lines.push('## Failed Shards');
    lines.push('');
    for (const item of aggregate.results.filter(result => result.status !== 'passed')) {
      lines.push(`- ${item.repo}/${item.profile}: ${item.classification} - ${item.error ?? 'no error line captured'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printShardSummary(result, chalk) {
  const status = result.status === 'passed' ? chalk.green(result.status) : chalk.red(result.status);
  console.log(`  ${result.repo}/${result.profile}: ${status} ${result.classification} contradictions=${result.contradictions} patches=${result.patch_candidates}`);
}

function printFleetSummary(aggregate, outDir, chalk) {
  console.log(chalk.bold('\n  Reversa: Fleet scan complete\n'));
  console.log(`  Output:           ${chalk.cyan(outDir)}`);
  console.log(`  Shards:           ${chalk.cyan(aggregate.summary.total_shards)}`);
  console.log(`  Passed:           ${chalk.green(aggregate.summary.passed_shards)}`);
  console.log(`  Failed:           ${aggregate.summary.failed_shards ? chalk.red(aggregate.summary.failed_shards) : chalk.green(0)}`);
  console.log(`  Findings:         ${chalk.cyan(aggregate.summary.total_findings)}`);
  console.log(`  Contradictions:   ${chalk.cyan(aggregate.summary.total_contradictions)}`);
  console.log(`  Patch candidates: ${chalk.cyan(aggregate.summary.total_patch_candidates)}`);
  console.log('');
  console.log(chalk.bold('  Artifacts:'));
  console.log(`  - ${join(outDir, 'fleet-report.json')}`);
  console.log(`  - ${join(outDir, 'fleet-summary.tsv')}`);
  console.log(`  - ${join(outDir, 'fleet-summary.md')}`);
  console.log('');
}

function parseArgs(args) {
  const options = {
    manifestPath: null,
    baseDir: process.cwd(),
    profileList: ['generic_source_tree'],
    outDir: resolve(process.cwd(), 'reversa_fleet_out'),
    maxFileSize: '',
    includeIgnored: false,
    timeoutMs: 0,
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
      case '--manifest':
        options.manifestPath = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--base-dir':
        options.baseDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--profiles':
        options.profileList = parseProfileList(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-file-size':
        options.maxFileSize = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--include-ignored':
        options.includeIgnored = true;
        break;
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInteger(requireValue(flag, value), flag);
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown scan-fleet option: ${arg}`);
    }
  }

  if (options.profileList.length === 0) {
    throw new Error('scan-fleet requires at least one profile');
  }

  return options;
}

function parseProfileList(value) {
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function requireValue(flag, value) {
  if (value === null || value === undefined || String(value).startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

function basenameForEntry(path, index) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || `repo-${index + 1}`;
}

function sanitizePathPart(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo';
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function firstUsefulLine(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('at ')) ?? '';
}

function tailLines(text, limit) {
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - limit)).join('\n');
}

function printHelp() {
  console.log(`
  reversa scan-fleet

  Sharded fleet scanner for many repos. Each repo/profile pair runs as an
  isolated child scan so OOMs, timeouts, and broken repos become classified
  evidence instead of killing the whole fleet pass.

  Usage:
    npx reversa scan-fleet --manifest repos.json --profiles semantic_policy,agentic_gateway

  Options:
    --manifest <path>       JSON array, JSON { repos: [...] }, or newline repo paths
    --base-dir <path>       Resolve relative manifest paths from this directory
    --profiles <ids>        Comma-separated scan profiles
    --out <path>            Output directory (default: reversa_fleet_out)
    --max-file-size <n|nK|nM> Forwarded to each shard scan
    --include-ignored       Forwarded to each shard scan
    --timeout-ms <n>        Kill and classify a shard after n ms (0 disables)

  Output:
    fleet-report.json
    fleet-summary.tsv
    fleet-summary.md
`);
}
