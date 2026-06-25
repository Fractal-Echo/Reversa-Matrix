import { existsSync } from 'fs';
import { resolve } from 'path';
import { readJsonSafe } from '../utils/json-safe.js';
import { compareProjects, writeCompareOutputs } from '../scan/compare.js';

export default async function compare(args) {
  const { default: chalk } = await import('chalk');
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  for (const [label, path] of [['left', options.left], ['right', options.right]]) {
    if (!path) {
      throw new Error(`compare requires --${label} <path>`);
    }
    if (!existsSync(path)) {
      throw new Error(`Compare ${label} tree does not exist: ${path}`);
    }
  }

  let knownGood = null;
  if (options.knownGoodPath) {
    if (!existsSync(options.knownGoodPath)) {
      throw new Error(`Known-good file does not exist: ${options.knownGoodPath}`);
    }
    knownGood = readJsonSafe(options.knownGoodPath);
  }

  const report = await compareProjects({
    left: options.left,
    right: options.right,
    profile: options.profile,
    knownGood,
    knownGoodPath: options.knownGoodPath,
    outDir: options.outDir,
  });
  const written = await writeCompareOutputs(report, options.outDir);

  console.log(chalk.bold('\n  Reversa: Compare complete\n'));
  console.log(`  Left:             ${chalk.cyan(report.compare.left_root)}`);
  console.log(`  Right:            ${chalk.cyan(report.compare.right_root)}`);
  console.log(`  Profile:          ${chalk.cyan(report.compare.profile)}`);
  console.log(`  Output:           ${chalk.cyan(options.outDir)}`);
  console.log(`  Findings:         ${chalk.cyan(report.summary.total_findings)}`);
  console.log(`  Safe candidates:  ${chalk.cyan(report.summary.safe_import_candidates)}`);
  console.log(`  Risky candidates: ${chalk.cyan(report.summary.risky_import_candidates)}`);
  console.log('');

  console.log(chalk.bold('  Artifacts:'));
  for (const file of written) {
    console.log(`  - ${file}`);
  }
  console.log('');
}

function parseArgs(args) {
  const options = {
    left: null,
    right: null,
    profile: 'generic_source_tree',
    knownGoodPath: null,
    outDir: resolve(process.cwd(), 'reversa_compare_out'),
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
      case '--left':
        options.left = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--right':
        options.right = resolve(requireValue(flag, value));
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
      default:
        throw new Error(`Unknown compare option: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (value === null || value === undefined || String(value).startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`
  reversa compare

  Compare two source trees and classify manual import candidates.

  Usage:
    npx reversa compare --left <path> --right <path> [options]

  Options:
    --left <path>          Current tree
    --right <path>         Reference tree
    --profile <id>         Scan profile (default: generic_source_tree)
    --known-good <json>    Known-good facts from real device testing
    --out <path>           Output directory (default: reversa_compare_out)

  Compare mode never imports, copies, patches, flashes, or modifies either tree.
`);
}
