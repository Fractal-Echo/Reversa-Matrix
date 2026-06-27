import { resolve } from 'path';
import {
  DEFAULT_ADB_BINARY,
  classifyNebulaModules,
  proposeFromScanDir,
  runNebulaCompanion,
} from '../nebula/companion.js';

export default async function nebula(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp(chalk);
    return;
  }

  if (subcommand === 'classify-fixture') {
    const options = parseClassifyArgs(rest);
    const { readJsonSafe } = await import('../utils/json-safe.js');
    const activeDisplayLanes = options.active ? readJsonSafe(options.active) : null;
    const pendingDisplayLanes = options.pending ? readJsonSafe(options.pending) : null;
    const result = classifyNebulaModules({
      activeDisplayLanes,
      pendingDisplayLanes,
      proposedText: options.proposedText,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'propose') {
    const options = parseProposeArgs(rest);
    const result = await proposeFromScanDir(options.fromDir, options.outDir);
    console.log(chalk.bold('\n  Reversa Nebula proposal classified\n'));
    console.log(`  Output: ${chalk.cyan(result.outDir)}`);
    console.log(`  Classes: ${chalk.cyan(result.classifications.join(', '))}\n`);
    return;
  }

  const modeBySubcommand = {
    status: 'status',
    'active-module': 'active-module',
    'pending-module': 'pending-module',
    'compare-modules': 'compare-modules',
    frontier: 'frontier',
  };

  if (!modeBySubcommand[subcommand]) {
    throw new Error(`Unknown nebula subcommand: ${subcommand}`);
  }

  const options = parseAdbArgs(rest);
  options.mode = modeBySubcommand[subcommand];
  options.includePending = subcommand === 'pending-module' || subcommand === 'compare-modules' || options.includePending;

  const result = await runNebulaCompanion(options);
  console.log(chalk.bold('\n  Reversa Nebula read-only companion probe complete\n'));
  console.log(`  Output:          ${chalk.cyan(result.outDir)}`);
  console.log(`  Serial:          ${chalk.cyan(result.serial)}`);
  console.log(`  Pending present: ${chalk.cyan(String(result.pending_present))}`);
  console.log(`  Pending state:   ${chalk.cyan(result.pending_state)}`);
  console.log(`  Classes:         ${chalk.cyan(result.classifications.join(', '))}`);
  console.log(`  Stage advice:    ${chalk.cyan(result.stage_recommendation)}\n`);
}

function parseAdbArgs(args) {
  const options = {
    adbBinary: DEFAULT_ADB_BINARY,
    serial: '',
    outDir: resolve(process.cwd(), 'reversa_nebula_readonly'),
    includePending: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--adb':
      case '--serial':
        options.serial = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--adb-binary':
        options.adbBinary = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--include-pending':
        options.includePending = true;
        break;
      default:
        throw new Error(`Unknown nebula option: ${arg}`);
    }
  }

  return options;
}

function parseProposeArgs(args) {
  const options = {
    fromDir: '',
    outDir: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--from':
        options.fromDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown nebula propose option: ${arg}`);
    }
  }

  if (!options.fromDir) throw new Error('nebula propose requires --from <scan-dir>');
  return options;
}

function parseClassifyArgs(args) {
  const options = {
    active: '',
    pending: '',
    proposedText: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--active':
        options.active = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--pending':
        options.pending = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--proposed-text':
        options.proposedText = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown nebula classify-fixture option: ${arg}`);
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

function printHelp(chalk) {
  console.log(chalk.bold('\n  Reversa Nebula companion link\n'));
  console.log('  Read-only host bridge for Nebula active-module evidence.\n');
  console.log('  Usage: node ./bin/reversa.js nebula <subcommand> [options]\n');
  console.log('  Subcommands:');
  console.log('    status              Capture active status, display frontier, packages, and pending presence');
  console.log('    active-module       Capture active module JSON command surface only');
  console.log('    pending-module      Explicitly capture pending module status/display lanes');
  console.log('    compare-modules     Compare active vs pending and classify stage safety');
  console.log('    frontier            Capture active frontier evidence');
  console.log('    propose --from DIR  Classify an offline scan/result directory');
  console.log('\n  Options:');
  console.log('    --adb <serial>          Required unless exactly one ADB device is present');
  console.log(`    --adb-binary <path>     ADB binary path (default: ${DEFAULT_ADB_BINARY})`);
  console.log('    --out <dir>             Output bundle directory');
  console.log('    --include-pending       Explicitly read pending module when present');
  console.log('\n  The bridge is read-only: it never installs, stages, reboots, or writes /data/adb.\n');
}
