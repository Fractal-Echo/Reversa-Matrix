#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const BLOCKED_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv',
  '.venv-docs',
  'site',
  'reversa_out',
  'reversa_compare_out',
]);

const ROOT_FILES = [
  'README.md',
  'mkdocs.yml',
  'package.json',
];

const SCAN_DIRS = [
  { dir: 'docs', extensions: new Set(['.md']) },
  { dir: 'bin', extensions: new Set(['.js']) },
  { dir: 'lib/commands', extensions: new Set(['.js']) },
  { dir: 'lib/gui', extensions: new Set(['.js']) },
  { dir: 'lib/scan', files: new Set(['writers.js']) },
];

// Keep blocked phrases encoded so the guard itself does not publish them verbatim.
const ENCODED_BANNED_TERMS = [
  'bm9vYg==',
  'dmliZXM=',
  'bG1mYW8=',
  'bXkgcGhvbmU=',
  'bXkgUk0xMVBybw==',
  'cGVyc29uYWwgcmVjb21tZW5kYXRpb24=',
  'cHJpdmF0ZSBub3Rlcw==',
  'bG9jYWwgb25seQ==',
  'U2hlcmxvY2s=',
  'U291bA==',
  'c2FuZGVjbw==',
  'Zmx1ZmZ5',
  'U3Vpa29kZW4=',
];

const BANNED_TERMS = ENCODED_BANNED_TERMS.map(term => Buffer.from(term, 'base64').toString('utf8'));

const checks = BANNED_TERMS.map(term => ({
  term,
  pattern: new RegExp(escapeRegExp(term), 'i'),
}));

const files = collectFiles();
const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const check of checks) {
      if (check.pattern.test(line)) {
        violations.push({
          file: relative(ROOT, file),
          line: index + 1,
          term: check.term,
          text: line.trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Public clean check failed. Remove public-facing personal, casual, or private wording:');
  for (const item of violations) {
    console.error(`${item.file}:${item.line} [${item.term}] ${item.text}`);
  }
  process.exit(1);
}

console.log(`Public clean check passed (${files.length} files scanned).`);

function collectFiles() {
  const results = [];

  for (const file of ROOT_FILES) {
    const path = join(ROOT, file);
    if (existsSync(path)) results.push(path);
  }

  for (const target of SCAN_DIRS) {
    const path = join(ROOT, target.dir);
    if (existsSync(path)) {
      walk(path, target, results);
    }
  }

  return [...new Set(results)].sort();
}

function walk(dir, target, results) {
  if (BLOCKED_DIRS.has(relative(ROOT, dir)) || BLOCKED_DIRS.has(dir.split(/[\\/]/).pop())) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, target, results);
      continue;
    }
    if (!info.isFile()) continue;

    const relName = relative(join(ROOT, target.dir), path).replace(/\\/g, '/');
    const extension = path.slice(path.lastIndexOf('.'));
    if (target.files?.has(relName) || target.extensions?.has(extension)) {
      results.push(path);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
