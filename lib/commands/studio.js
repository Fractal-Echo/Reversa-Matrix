import { existsSync } from 'fs';
import { resolve } from 'path';
import { captureAmdUmaProof } from '../../scripts/capture-amd-uma-proof.js';
import { captureLocalGpuProof } from '../../scripts/capture-local-gpu-proof.js';
import { exportGpuAdvisoryUiFixtures } from '../../scripts/export-gpu-advisory-ui-fixtures.js';
import { joinAmdProofWithAdvisory } from '../../scripts/join-amd-proof-with-advisory.js';

export default async function studio(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  if (subcommand === 'export-fixtures') {
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
    return;
  }

  if (subcommand === 'gpu-proof') {
    const options = parseGpuProofArgs(rest);
    if (options.help) {
      printGpuProofHelp();
      return;
    }
    const result = await captureLocalGpuProof(options);
    console.log(chalk.bold('\n  Reversa Studio GPU proof captured\n'));
    console.log(`  Output:         ${chalk.cyan(result.outDir)}`);
    console.log(`  Classification:${chalk.cyan(` ${result.proof.classification}`)}`);
    console.log(`  GPU:            ${chalk.cyan(result.proof.gpu.name)}`);
    console.log(`  Tensor op:      ${chalk.cyan(result.proof.python.tensor_op_pass ? 'pass' : 'not run or failed')}`);
    console.log('');
    return;
  }

  if (subcommand === 'amd-proof') {
    const options = parseAmdProofArgs(rest);
    if (options.help) {
      printAmdProofHelp();
      return;
    }
    const result = await captureAmdUmaProof(options);
    console.log(chalk.bold('\n  Reversa Studio AMD proof captured\n'));
    console.log(`  Output:         ${chalk.cyan(result.outDir)}`);
    console.log(`  Classification:${chalk.cyan(` ${result.proof.classification}`)}`);
    console.log(`  GPU:            ${chalk.cyan(result.proof.gpu.name ?? 'not found')}`);
    console.log(`  UMA:            ${chalk.cyan(result.proof.memory.uma_status)}`);
    console.log('');
    return;
  }

  if (subcommand === 'amd-join') {
    const options = parseAmdJoinArgs(rest);
    if (options.help) {
      printAmdJoinHelp();
      return;
    }
    const result = await joinAmdProofWithAdvisory(options);
    console.log(chalk.bold('\n  Reversa Studio AMD advisory fit written\n'));
    console.log(`  Output:         ${chalk.cyan(result.outDir)}`);
    console.log(`  Records:        ${chalk.cyan(result.totalRecords)}`);
    console.log(`  DirectML:       ${chalk.cyan(result.summary.directmlPossible)}`);
    console.log(`  Ready:          ${chalk.cyan(result.summary.readyCandidates)}`);
    console.log('');
    return;
  }

  throw new Error(`Unknown studio subcommand: ${subcommand}`);
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

function parseGpuProofArgs(args) {
  const options = { out: null, python: null, help: false };
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
      case '--python':
        options.python = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown studio gpu-proof option: ${arg}`);
    }
  }
  if (!options.help && !options.out) {
    throw new Error('Missing required --out');
  }
  return options;
}

function parseAmdProofArgs(args) {
  const options = { out: null, python: null, windowsProbe: null, dxdiag: null, wslProbe: null, help: false };
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
      case '--python':
        options.python = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--windows-probe':
        options.windowsProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--dxdiag':
        options.dxdiag = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--wsl-probe':
        options.wslProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown studio amd-proof option: ${arg}`);
    }
  }
  if (!options.help && !options.out) {
    throw new Error('Missing required --out');
  }
  return options;
}

function parseAmdJoinArgs(args) {
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
        throw new Error(`Unknown studio amd-join option: ${arg}`);
    }
  }
  if (!options.help && (!options.proof || !options.dataset || !options.out)) {
    throw new Error('Missing required --proof, --dataset, or --out');
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
    node ./bin/reversa.js studio gpu-proof --help
    node ./bin/reversa.js studio amd-proof --help
    node ./bin/reversa.js studio amd-join --help
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

function printGpuProofHelp() {
  console.log(`
  Capture passive local GPU proof for Reversa Studio.

  Usage:
    node ./bin/reversa.js studio gpu-proof --out <dir> [--python <path>]

  This command runs nvidia-smi when present, probes the existing python3
  or selected Python environment, and writes proof JSON/Markdown/TSV files. It does not install
  packages, acquire model artifacts, launch games, connect to phones, or mutate
  runtimes.
`);
}

function printAmdProofHelp() {
  console.log(`
  Capture passive AMD HX 370 / Radeon 890M / UMA proof for Reversa Studio.

  Usage:
    node ./bin/reversa.js studio amd-proof --out <dir> [--python <path>] [--windows-probe <path>] [--dxdiag <path>] [--wsl-probe <path>]

  This command records Windows/WSL/DirectX/DirectML candidate evidence and probes
  an existing Python interpreter only when --python is provided. It does not
  install packages, acquire model artifacts, launch games, connect to phones, or
  mutate runtimes.
`);
}

function printAmdJoinHelp() {
  console.log(`
  Join AMD 890M / UMA proof with the GPU advisory dataset.

  Usage:
    node ./bin/reversa.js studio amd-join \\
      --proof <amd-uma-proof.json> \\
      --dataset <gpu-upscale-framegen-advisory.jsonl> \\
      --out <dir>

  This command writes generated local-fit evidence only. It does not modify the
  proof, dataset, model artifacts, games, phones, or runtimes.
`);
}
