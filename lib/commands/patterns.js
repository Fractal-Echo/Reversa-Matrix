import { existsSync } from 'fs';
import { copyFile, mkdir, readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const PATTERNS = {
  'claude-codex': {
    id: 'claude-codex',
    label: 'Claude/Codex/Reversa patterns',
    file: 'CLAUDE_CODEX_REVERSA_PATTERNS.md',
    description: 'Strict instruction, hook, skill, memory, provider, subagent, worktree, and attribution checklist.',
  },
};

export default async function patterns(args) {
  const { default: chalk } = await import('chalk');
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.list) {
    printList(chalk);
    return;
  }

  const pattern = PATTERNS[options.pattern ?? 'claude-codex'];
  if (!pattern) {
    throw new Error(`Unknown pattern "${options.pattern}". Known patterns: ${Object.keys(PATTERNS).join(', ')}`);
  }

  const source = join(REPO_ROOT, 'templates', 'engines', pattern.file);
  if (!existsSync(source)) {
    throw new Error(`Pattern template is missing: ${source}`);
  }

  if (options.out) {
    const outPath = resolve(process.cwd(), options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await copyFile(source, outPath);
    console.log(chalk.hex('#ffa203')(`Pattern written: ${outPath}`));
    return;
  }

  console.log(await readFile(source, 'utf8'));
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg === '--pattern') {
      options.pattern = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--out') {
      options.out = args[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printList(chalk) {
  console.log(chalk.bold('\n  Reversa Patterns\n'));

  for (const pattern of Object.values(PATTERNS)) {
    console.log(`  ${chalk.cyan(pattern.id.padEnd(14))} ${pattern.label}`);
    console.log(`  ${chalk.gray(pattern.description)}\n`);
  }
}

function printHelp() {
  console.log(`
  reversa patterns

  Usage:
    npx reversa patterns --list
    npx reversa patterns --pattern claude-codex
    npx reversa patterns --pattern claude-codex --out CLAUDE_CODEX_REVERSA_PATTERNS.md

  Options:
    --list                List available pattern templates
    --pattern <id>        Pattern id (default: claude-codex)
    --out <path>          Write the pattern to a file instead of stdout
`);
}
