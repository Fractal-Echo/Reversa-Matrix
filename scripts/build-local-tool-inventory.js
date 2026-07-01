#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { extname, join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_HASHES = 12;
const DEFAULT_MAX_HASH_BYTES = 16 * 1024 * 1024;

export async function buildLocalToolInventory(options = {}) {
  const manifestPath = resolve(options.manifest);
  const outDir = resolve(options.out);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const tools = Array.isArray(manifest) ? manifest : manifest.tools || [];
  if (!Array.isArray(tools)) throw new Error('local tool inventory manifest must be an array or { "tools": [...] }');

  const config = {
    maxDepth: Number(options.maxDepth || DEFAULT_MAX_DEPTH),
    maxFiles: Number(options.maxFiles || DEFAULT_MAX_FILES),
    maxHashes: Number(options.maxHashes || DEFAULT_MAX_HASHES),
    maxHashBytes: Number(options.maxHashBytes || DEFAULT_MAX_HASH_BYTES),
  };
  await mkdir(outDir, { recursive: true });

  const records = [];
  for (const [index, tool] of tools.entries()) {
    records.push(await inventoryTool(tool, index, config));
  }

  const summary = summarize(records);
  const sftRows = records.map(record => toolRecordToSft(record));
  await writeFile(join(outDir, 'local-tool-inventory.json'), `${JSON.stringify({ schema: 'reversa.local_tool_inventory.bundle.v1', config, summary, records }, null, 2)}\n`, 'utf8');
  await writeJsonl(join(outDir, 'local-tool-inventory.jsonl'), records);
  await writeJsonl(join(outDir, 'local-tool-inventory-sft.jsonl'), sftRows);
  await writeFile(join(outDir, 'local-tool-inventory-summary.md'), buildSummaryMarkdown({ config, summary, records }), 'utf8');
  await writeFile(join(outDir, 'sha256sums.txt'), buildSha256Sums(records), 'utf8');

  return {
    outDir,
    totalRecords: records.length,
    present: summary.present,
    missing: summary.missing,
    hashes: summary.hashes,
  };
}

export function normalizeLocalToolPath(input) {
  const value = String(input || '');
  const windowsDrive = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (windowsDrive) {
    const drive = windowsDrive[1].toLowerCase();
    const rest = windowsDrive[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return value;
}

async function inventoryTool(tool, index, config) {
  const id = tool.id || slugify(tool.name || tool.label || `tool-${index + 1}`);
  const sourcePath = normalizeLocalToolPath(tool.path);
  const root = resolve(sourcePath);
  const present = existsSync(root);
  const record = {
    schema: 'reversa.local_tool_inventory.v1',
    id,
    label: tool.label || tool.name || id,
    source_path: tool.path,
    normalized_path: root,
    present,
    source_boundary: 'local_metadata_only',
    training_allowed: 'local_experimental_metadata_only',
    redistribution_allowed: false,
    launch_allowed: false,
    tags: Array.isArray(tool.tags) ? tool.tags : [],
    notes: tool.notes || '',
    file_count_limited: 0,
    dir_count_limited: 0,
    truncated: false,
    executable_names: [],
    dll_names: [],
    config_names: [],
    archive_names: [],
    representative_hashes: [],
  };
  if (!present) return record;

  const inventory = await collectToolFiles(root, config);
  record.file_count_limited = inventory.files.length;
  record.dir_count_limited = inventory.dirCount;
  record.truncated = inventory.truncated;
  record.executable_names = uniqueNames(inventory.files.filter(file => file.role === 'executable'));
  record.dll_names = uniqueNames(inventory.files.filter(file => file.role === 'dll'));
  record.config_names = uniqueNames(inventory.files.filter(file => file.role === 'config'));
  record.archive_names = uniqueNames(inventory.files.filter(file => file.role === 'archive'));
  record.representative_hashes = await representativeHashes(inventory.files, root, config);
  return record;
}

async function collectToolFiles(root, config) {
  const files = [];
  let dirCount = 0;
  let truncated = false;

  async function walk(dir, depth) {
    if (depth > config.maxDepth || files.length >= config.maxFiles) {
      truncated = true;
      return;
    }
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        dirCount += 1;
        await walk(path, depth + 1);
      } else if (entry.isFile()) {
        if (files.length >= config.maxFiles) {
          truncated = true;
          return;
        }
        const info = await stat(path).catch(() => null);
        files.push({
          path,
          name: entry.name,
          size: info?.size ?? 0,
          role: classifyFileRole(entry.name),
        });
      }
    }
  }

  await walk(root, 0);
  return { files, dirCount, truncated };
}

async function representativeHashes(files, root, config) {
  const priority = { executable: 0, dll: 1, config: 2, archive: 3, document: 4, other: 5 };
  const selected = [...files]
    .sort((left, right) => (priority[left.role] ?? 9) - (priority[right.role] ?? 9)
      || left.path.localeCompare(right.path))
    .slice(0, config.maxHashes);
  const hashes = [];
  for (const file of selected) {
    if (file.size > config.maxHashBytes) {
      hashes.push({
        relative_path: relative(root, file.path),
        size: file.size,
        role: file.role,
        sha256: null,
        hash_scope: 'skipped_size_over_limit',
      });
      continue;
    }
    const data = await readFile(file.path);
    hashes.push({
      relative_path: relative(root, file.path),
      size: file.size,
      role: file.role,
      sha256: createHash('sha256').update(data).digest('hex'),
      hash_scope: 'full_file',
    });
  }
  return hashes;
}

function classifyFileRole(name) {
  const lower = name.toLowerCase();
  const ext = extname(lower);
  if (['.exe', '.bat', '.cmd', '.ps1', '.sh', '.com'].includes(ext)) return 'executable';
  if (['.dll', '.asi'].includes(ext)) return 'dll';
  if (['.ini', '.cfg', '.conf', '.json', '.toml', '.yaml', '.yml', '.xml'].includes(ext)) return 'config';
  if (['.zip', '.7z', '.rar', '.tar', '.gz'].includes(ext)) return 'archive';
  if (/^(readme|license|copying|changelog)(\.|$)/i.test(lower) || ['.md', '.txt', '.rtf'].includes(ext)) return 'document';
  return 'other';
}

function uniqueNames(files) {
  return [...new Set(files.map(file => file.name))].slice(0, 40);
}

function toolRecordToSft(record) {
  return {
    schema: 'reversa.local_tool_inventory_sft.v1',
    source_id: record.id,
    source_boundary: record.source_boundary,
    training_allowed: record.training_allowed,
    redistribution_allowed: false,
    messages: [
      {
        role: 'system',
        content: 'You are Reversa. Treat local tool inventory as metadata-only evidence. Do not launch tools or promote local binaries as redistributable source.',
      },
      {
        role: 'user',
        content: [
          `Tool: ${record.label}`,
          `Path: ${record.source_path}`,
          `Present: ${record.present}`,
          `Tags: ${record.tags.join(', ') || 'none'}`,
          `Executables: ${record.executable_names.join(', ') || 'none'}`,
          `DLLs: ${record.dll_names.join(', ') || 'none'}`,
          `Configs: ${record.config_names.join(', ') || 'none'}`,
        ].join('\n'),
      },
      {
        role: 'assistant',
        content: [
          `Classification: ${record.present ? 'LOCAL_TOOL_METADATA_PRESENT' : 'LOCAL_TOOL_METADATA_MISSING'}`,
          'Boundary: local_metadata_only',
          'Allowed: use names, file roles, and hashes as private evidence.',
          'Forbidden: launching executables, copying binaries into public outputs, or treating this metadata as license permission.',
        ].join('\n'),
      },
    ],
  };
}

function summarize(records) {
  return {
    total: records.length,
    present: records.filter(record => record.present).length,
    missing: records.filter(record => !record.present).length,
    hashes: records.reduce((sum, record) => sum + record.representative_hashes.filter(hash => hash.sha256).length, 0),
  };
}

function buildSummaryMarkdown({ config, summary, records }) {
  const lines = [
    '# Local Tool Inventory',
    '',
    `Records: \`${summary.total}\``,
    `Present: \`${summary.present}\``,
    `Missing: \`${summary.missing}\``,
    `Representative hashes: \`${summary.hashes}\``,
    `Limits: depth=\`${config.maxDepth}\`, files=\`${config.maxFiles}\`, hashes=\`${config.maxHashes}\``,
    '',
    'Boundary: `local_metadata_only`; no executable launch; no redistribution permission implied.',
    '',
    '| Tool | Present | Executables | DLLs | Hashes |',
    '| --- | --- | --- | --- | --- |',
    ...records.map(record => [
      markdownCell(record.label),
      `\`${String(record.present)}\``,
      markdownCell(record.executable_names.join(', ') || 'none'),
      markdownCell(record.dll_names.join(', ') || 'none'),
      `\`${record.representative_hashes.filter(hash => hash.sha256).length}\``,
    ].join(' | ')).map(row => `| ${row} |`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function buildSha256Sums(records) {
  const lines = [];
  for (const record of records) {
    for (const hash of record.representative_hashes) {
      if (hash.sha256) lines.push(`${hash.sha256}  ${record.id}/${hash.relative_path}`);
    }
  }
  return `${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

async function writeJsonl(path, records) {
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
}

function slugify(value) {
  return String(value || 'tool')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tool';
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

function parseArgs(argv) {
  const options = {
    manifest: '',
    out: '',
    maxDepth: DEFAULT_MAX_DEPTH,
    maxFiles: DEFAULT_MAX_FILES,
    maxHashes: DEFAULT_MAX_HASHES,
    maxHashBytes: DEFAULT_MAX_HASH_BYTES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? argv[index + 1];
    switch (flag) {
      case '--manifest':
        options.manifest = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-depth':
        options.maxDepth = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-files':
        options.maxFiles = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-hashes':
        options.maxHashes = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-hash-bytes':
        options.maxHashBytes = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.manifest) throw new Error('Missing required --manifest');
  if (!options.out) throw new Error('Missing required --out');
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
build-local-tool-inventory

Usage:
  node scripts/build-local-tool-inventory.js \\
    --manifest <local-tool-manifest.json> \\
    --out <out-dir>

Manifest:
  { "tools": [{ "id": "dlss_updater", "path": "D:/Applications/DLSS.Updater.2.8.0", "tags": ["dlss"] }] }
`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildLocalToolInventory(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
