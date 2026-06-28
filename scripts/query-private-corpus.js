#!/usr/bin/env node

import { existsSync, statSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const TOKEN_RE = /[A-Za-z0-9_./+-]+/g;
const STOP_WORDS = new Set([
  'and', 'are', 'for', 'from', 'has', 'have', 'into', 'only', 'that', 'the',
  'this', 'with', 'what', 'when', 'where', 'which', 'why',
]);

export async function queryPrivateCorpus(options) {
  const corpusPath = await resolveCorpusPath(options.corpus);
  const query = requireValue('query', options.query);
  const top = Number(options.top ?? 8);
  const records = await readJsonl(corpusPath);
  const queryTerms = terms(query);
  const scored = records
    .filter(record => record.retrieval_allowed !== false)
    .map(record => scoreRecord(record, query, queryTerms))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || authorityRank(b.record) - authorityRank(a.record) || a.record.source_id.localeCompare(b.record.source_id) || a.record.relative_path.localeCompare(b.record.relative_path))
    .slice(0, top);

  const result = {
    schema: 'reversa.private_corpus_query_result.v1',
    query,
    corpus_path: corpusPath,
    total_records: records.length,
    returned: scored.length,
    results: scored.map(item => formatResult(item)),
  };

  if (options.out) {
    const outDir = resolve(options.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'private-corpus-query-results.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    await writeFile(join(outDir, 'private-corpus-query-results.md'), resultMarkdown(result), 'utf8');
  }

  return result;
}

export async function resolveCorpusPath(input) {
  const resolved = resolve(requireValue('corpus', input));
  if (!existsSync(resolved)) {
    throw new Error(`Corpus path does not exist: ${resolved}`);
  }
  if (statSync(resolved).isDirectory()) {
    const candidate = join(resolved, 'private-corpus-records.jsonl');
    if (!existsSync(candidate)) {
      throw new Error(`Corpus directory does not contain private-corpus-records.jsonl: ${resolved}`);
    }
    return candidate;
  }
  return resolved;
}

export async function readJsonl(path) {
  const text = await readFile(resolve(path), 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

export function scoreRecord(record, rawQuery, queryTerms) {
  const text = `${record.relative_path ?? ''}\n${(record.retrieval_tags ?? []).join(' ')}\n${record.text ?? ''}`.toLowerCase();
  const lowerQuery = rawQuery.toLowerCase();
  const matchedTerms = [];
  let score = 0;

  if (text.includes(lowerQuery)) {
    score += 30;
  }

  for (const term of queryTerms) {
    if (!term) continue;
    const count = countOccurrences(text, term);
    if (count > 0) {
      matchedTerms.push(term);
      score += Math.min(12, count * 3);
    }
    if ((record.retrieval_tags ?? []).some(tag => tag.toLowerCase() === term)) {
      score += 6;
    }
  }

  if (record.source_authority) score += 4;
  if (record.raw_proof) score += 12;
  if ((record.retrieval_tags ?? []).includes('known_good')) score += 8;
  if ((record.retrieval_tags ?? []).includes('frontier')) score += 4;
  if (record.generated_artifact) score -= 30;
  if (record.training_allowed) score += 1;

  return {
    score,
    matchedTerms: [...new Set(matchedTerms)].sort(),
    record,
  };
}

function authorityRank(record) {
  if (record.raw_proof) return 4;
  if (record.source_authority) return 3;
  if (record.authority_class === 'operator_note') return 2;
  if (record.generated_artifact) return 0;
  return 1;
}

function formatResult(item) {
  const record = item.record;
  return {
    score: Number(item.score.toFixed(3)),
    record_id: record.record_id ?? record.id,
    source_id: record.source_id,
    source_role: record.source_role,
    authority_class: record.authority_class,
    source_authority: Boolean(record.source_authority),
    generated_artifact: Boolean(record.generated_artifact),
    raw_proof: Boolean(record.raw_proof),
    training_allowed: Boolean(record.training_allowed),
    relative_path: record.relative_path,
    chunk_index: record.chunk_index,
    chunk_count: record.chunk_count,
    line_start: record.line_start ?? null,
    line_end: record.line_end ?? null,
    content_sha256: record.content_sha256,
    chunk_sha256: record.chunk_sha256,
    retrieval_tags: record.retrieval_tags ?? [],
    matched_terms: item.matchedTerms,
    excerpt: excerpt(record.text ?? '', item.matchedTerms),
  };
}

function resultMarkdown(result) {
  return [
    '# Reversa Private Corpus Query',
    '',
    `- Query: \`${result.query}\``,
    `- Corpus records: ${result.total_records}`,
    `- Returned: ${result.returned}`,
    '',
    ...result.results.flatMap((item, index) => [
      `## ${index + 1}. ${item.source_id}/${item.relative_path}`,
      '',
      `- Score: ${item.score}`,
      `- Authority: ${item.authority_class}`,
      `- Source authority: ${item.source_authority}`,
      `- Generated artifact: ${item.generated_artifact}`,
      `- Raw proof: ${item.raw_proof}`,
      `- Lines: ${item.line_start ?? '?'}-${item.line_end ?? '?'}`,
      `- Chunk SHA256: \`${item.chunk_sha256}\``,
      '',
      '```text',
      item.excerpt,
      '```',
      '',
    ]),
  ].join('\n');
}

function terms(value) {
  return [...String(value).toLowerCase().matchAll(TOKEN_RE)]
    .map(match => match[0])
    .filter(term => term.length > 1 && !STOP_WORDS.has(term));
}

function countOccurrences(text, term) {
  let count = 0;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(term, start);
    if (index === -1) break;
    count += 1;
    start = index + term.length;
  }
  return count;
}

function excerpt(text, matchedTerms) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= 420) return clean;
  const lower = clean.toLowerCase();
  const firstMatch = matchedTerms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 160);
  const end = Math.min(clean.length, start + 420);
  return `${start > 0 ? '...' : ''}${clean.slice(start, end)}${end < clean.length ? '...' : ''}`;
}

function requireValue(label, value) {
  if (!value) throw new Error(`Missing required ${label}`);
  return value;
}

function parseArgs(argv) {
  const options = { help: false, top: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? argv[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--corpus':
        options.corpus = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--query':
        options.query = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--top':
        options.top = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
query-private-corpus

Usage:
  node scripts/query-private-corpus.js \\
    --corpus <private-corpus-dir-or-jsonl> \\
    --query "known good wayland real buffer" \\
    --top 8 \\
    --out <query-output-dir>

This command is offline and read-only. It ranks existing corpus chunks and can
write query results to --out.
`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.corpus || !options.query) {
    printHelp();
    return options.help ? 0 : 1;
  }
  const result = await queryPrivateCorpus(options);
  console.log(`Private corpus query: ${result.query}`);
  for (const [index, item] of result.results.entries()) {
    console.log(`${index + 1}. score=${item.score} ${item.source_id}/${item.relative_path}#${item.chunk_index}`);
  }
  if (options.out) {
    console.log(`Results written to ${resolve(options.out)}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
