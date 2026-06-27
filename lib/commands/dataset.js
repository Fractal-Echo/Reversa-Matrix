import { existsSync } from 'fs';
import { resolve } from 'path';
import { buildGpuUpscaleFramegenDataset } from '../../scripts/build-gpu-upscale-framegen-dataset.js';

export default async function dataset(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  if (subcommand !== 'gpu-upscale-framegen') {
    throw new Error(`Unknown dataset subcommand: ${subcommand}`);
  }

  const options = parseGpuDatasetArgs(rest);
  if (options.help) {
    printGpuDatasetHelp();
    return;
  }

  for (const [label, path] of [
    ['Cupscale scan', options.cupscaleScan],
    ['Flowframes scan', options.flowframesScan],
    ['HF metadata index', options.hfIndex],
  ]) {
    if (path && !existsSync(path)) {
      throw new Error(`${label} does not exist: ${path}`);
    }
  }

  const result = await buildGpuUpscaleFramegenDataset(options);
  console.log(chalk.bold('\n  Reversa dataset build complete\n'));
  console.log(`  Dataset:       ${chalk.cyan('gpu-upscale-framegen')}`);
  console.log(`  Output:        ${chalk.cyan(result.outDir)}`);
  console.log(`  Records:       ${chalk.cyan(result.totalRecords)}`);
  console.log(`  Train/val/test:${chalk.cyan(` ${result.splits.train}/${result.splits.val}/${result.splits.test}`)}`);
  console.log('');
}

function parseGpuDatasetArgs(args) {
  const options = {
    cupscaleScan: null,
    flowframesScan: null,
    hfIndex: null,
    out: null,
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
      case '--cupscale-scan':
        options.cupscaleScan = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--flowframes-scan':
        options.flowframesScan = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--hf-index':
        options.hfIndex = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown gpu-upscale-framegen dataset option: ${arg}`);
    }
  }

  if (!options.help && !options.out) {
    throw new Error('Missing required --out');
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
  Reversa dataset commands

  Usage:
    node ./bin/reversa.js dataset gpu-upscale-framegen --help
`);
}

function printGpuDatasetHelp() {
  console.log(`
  Build the GPU upscale/framegen advisory dataset.

  Usage:
    node ./bin/reversa.js dataset gpu-upscale-framegen \\
      --cupscale-scan <scan-dir-or-report.json> \\
      --flowframes-scan <scan-dir-or-report.json> \\
      --hf-index <HF_MODEL_METADATA_INDEX.tsv> \\
      --out <dataset-dir>

  This command does not download model weights, launch runtimes, patch binaries,
  or mutate scanned projects.
`);
}
