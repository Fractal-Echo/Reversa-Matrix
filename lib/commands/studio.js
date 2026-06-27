import { existsSync } from 'fs';
import { resolve } from 'path';
import { exportGpuAdvisoryUiFixtures } from '../../scripts/export-gpu-advisory-ui-fixtures.js';

export default async function studio(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  if (subcommand !== 'export-fixtures') {
    throw new Error(`Unknown studio subcommand: ${subcommand}`);
  }

  const options = parseExportArgs(rest);
  if (options.help) {
    printExportHelp();
    return;
  }
  if (!existsSync(options.dataset)) {
    throw new Error(`Dataset path does not exist: ${options.dataset}`);
  }

  const result = await exportGpuAdvisoryUiFixtures(options);
  console.log(chalk.bold('\n  Reversa Studio fixtures exported\n'));
  console.log(`  Output:      ${chalk.cyan(result.outDir)}`);
  console.log(`  Records:     ${chalk.cyan(result.records)}`);
  console.log(`  Models:      ${chalk.cyan(result.models)}`);
  console.log(`  Patch checks:${chalk.cyan(` ${result.patchChecks}`)}`);
  console.log(`  Hard blocks: ${chalk.cyan(result.hardBlocks)}`);
  console.log('');
}

function parseExportArgs(args) {
  const options = { dataset: null, out: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
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
        throw new Error(`Unknown studio export option: ${arg}`);
    }
  }
  if (!options.help && (!options.dataset || !options.out)) {
    throw new Error('Missing required --dataset or --out');
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
  Reversa Studio commands

  Usage:
    node ./bin/reversa.js studio export-fixtures --help
`);
}

function printExportHelp() {
  console.log(`
  Export local Reversa Studio fixtures from the GPU advisory dataset.

  Usage:
    node ./bin/reversa.js studio export-fixtures \\
      --dataset <dataset-dir-or-advisory.jsonl> \\
      --out <reversa-studio/fixtures>

  This command reads local JSONL/TSV files only. It does not download models,
  launch games, patch files, connect to phones, or mutate runtimes.
`);
}
