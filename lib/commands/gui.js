import { resolve } from 'path';
import { generateDashboard } from '../gui/dashboard.js';

export default async function gui(args) {
  const { default: chalk } = await import('chalk');
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  const result = await generateDashboard({ outDir: options.outDir });

  console.log(chalk.bold('\n  Reversa-Matrix: GUI dashboard ready\n'));
  console.log(`  Output directory: ${chalk.cyan(options.outDir)}`);
  console.log(`  Dashboard:        ${chalk.cyan(result.dashboardPath)}`);
  console.log(`  Open:             ${chalk.cyan(result.fileUrl)}`);
  console.log(`  Scan data:        ${result.hasScan ? chalk.green('found') : chalk.gray('not found')}`);
  console.log(`  Compare data:     ${result.hasCompare ? chalk.green('found') : chalk.gray('not found')}`);
  console.log('');
}

function parseArgs(args) {
  const options = {
    outDir: resolve(process.cwd(), 'reversa_out'),
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
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown gui option: ${arg}`);
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
  reversa gui

  Build an offline local dashboard from existing scan/compare outputs.

  Usage:
    npx reversa gui --out reversa_out

  Options:
    --out <path>    Output directory containing report.json or compare_report.json

  The GUI writes dashboard.html into the output directory. It reads existing
  JSON/Markdown artifacts, does not modify scan data, and does not require
  internet access.
`);
}
