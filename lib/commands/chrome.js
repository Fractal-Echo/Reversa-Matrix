import { resolve } from 'path';
import {
  DEFAULT_CHROME_ENDPOINT,
  buildYouTubeResumeMarkdown,
  runYouTubeResume,
} from '../chrome/youtube-resume.js';

export default async function chrome(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp(chalk);
    return;
  }

  if (subcommand !== 'youtube-resume') {
    throw new Error(`Unknown chrome subcommand: ${subcommand}`);
  }

  const options = parseYouTubeResumeArgs(rest);
  const report = await runYouTubeResume(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (options.markdown) {
    console.log(buildYouTubeResumeMarkdown(report));
    return;
  }

  console.log(chalk.bold('\n  Reversa Chrome YouTube resume\n'));
  console.log(`  Classification: ${colorClassification(chalk, report.classification)}`);
  console.log(`  Endpoint:       ${chalk.cyan(report.endpoint)}`);
  console.log(`  Dry run:        ${chalk.cyan(String(report.dry_run))}`);
  console.log(`  YouTube tabs:   ${chalk.cyan(String(report.youtube_target_count))}`);
  for (const action of report.actions) {
    const clicked = action.result?.clicked ? chalk.green('clicked') : chalk.yellow(action.result?.reason || 'no-click');
    console.log(`  ${clicked} ${chalk.cyan(action.url)} via ${chalk.cyan(action.result?.selector || action.selector)}`);
  }
  console.log('');
}

function parseYouTubeResumeArgs(args) {
  const options = {
    endpoint: DEFAULT_CHROME_ENDPOINT,
    click: false,
    outDir: '',
    json: false,
    markdown: false,
    timeoutMs: 5000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--endpoint':
        options.endpoint = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--click':
        options.click = true;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(requireValue(flag, value));
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 100) {
          throw new Error('--timeout-ms must be a number >= 100');
        }
        if (inlineValue === null) index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--markdown':
      case '--md':
        options.markdown = true;
        break;
      default:
        throw new Error(`Unknown chrome youtube-resume option: ${arg}`);
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

function colorClassification(chalk, classification) {
  if (classification.endsWith('_CLICKED')) return chalk.green(classification);
  if (classification.endsWith('_DRY_RUN_READY')) return chalk.green(classification);
  if (classification.endsWith('_NO_TARGETS')) return chalk.yellow(classification);
  return chalk.red(classification);
}

function printHelp(chalk) {
  console.log(chalk.bold('\n  Reversa Chrome helper\n'));
  console.log('  Explicit, narrow browser automation for local operator requests.\n');
  console.log('  Usage: node ./bin/reversa.js chrome youtube-resume [options]\n');
  console.log('  Subcommands:');
  console.log('    youtube-resume      Dry-run YouTube player resume; add --click to press play');
  console.log('\n  Options:');
  console.log(`    --endpoint <url>    Chrome DevTools endpoint (default: ${DEFAULT_CHROME_ENDPOINT})`);
  console.log('    --click             Actually click the main player play/resume button');
  console.log('    --out <dir>         Write chrome-youtube-resume JSON/Markdown logs');
  console.log('    --json              Print JSON');
  console.log('    --markdown, --md    Print Markdown');
  console.log('    --timeout-ms <n>    DevTools request timeout');
  console.log('\n  Scope: youtube.com/watch and music.youtube.com only. No playlist automation or background autoclicking.\n');
}
