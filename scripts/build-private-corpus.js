#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync, statSync } from 'fs';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { spawnSync } from 'child_process';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.conf', '.cpp', '.gradle', '.h', '.hpp', '.ini',
  '.java', '.js', '.json', '.jsonl', '.kt', '.kts', '.log', '.md', '.mk',
  '.mjs', '.py', '.rc', '.rs', '.sh', '.toml', '.ts', '.tsv', '.txt',
  '.xml', '.yaml', '.yml',
]);

const DEFAULT_SKIP_DIRS = new Set([
  '.git', '.gradle', '.idea', '.venv', '__pycache__', 'build', 'dist',
  '.reversa', '.tmp-mkdocs-site', 'local', 'logs', 'node_modules', 'out',
  'private', 'reversa_compare_out', 'reversa_out', 'site',
]);

const GENERATED_RE = /(^|\/)(agent_handoff|agentic-training-[^/]+|dashboard\.html|eval_report|evidence\.jsonl|local|patch_candidates\.json|predictions\.jsonl|private-corpus-[^/]+|private-corpus[^/]*|report\.html|report\.json|reversa-datasets|reversa-scans|site|summary\.md|training-pack)(\/|$)/i;
const RAW_PROOF_RE = /(^|\/)(counts\.tsv|evidence|extract|logs|raw-proof|raw_logs|result\.md)(\/|$)/i;
const SOURCE_RE = /(^|\/)(AGENTS\.md|README\.md|app|bin|docs|lib|profiles|scripts|src|test|tests)(\/|$)/i;
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?[^"'\s]{6,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g,
];

const DEFAULT_SPLITS = { train: 0.8, val: 0.1, test: 0.1 };

export async function buildPrivateCorpus(options) {
  const manifestPath = resolve(options.manifest);
  const outDir = resolve(options.out);
  assertSafeOutDir(outDir);
  const manifest = await readJson(manifestPath);
  const baseDir = dirname(manifestPath);
  const manifestSha256 = sha256(await readFile(manifestPath));
  const generatedAt = new Date().toISOString();

  await mkdir(outDir, { recursive: true });

  const config = {
    corpusId: manifest.corpus_id ?? `reversa-private-corpus-${dateStamp(generatedAt)}`,
    maxFileBytes: Number(options.maxFileBytes ?? manifest.max_file_bytes ?? 256 * 1024),
    maxFilesPerSource: Number(options.maxFilesPerSource ?? manifest.max_files_per_source ?? 1000),
    maxChunkChars: Number(options.maxChunkChars ?? manifest.max_chunk_chars ?? 1800),
    chunkOverlap: Number(options.chunkOverlap ?? manifest.chunk_overlap ?? 180),
  };

  const records = [];
  const skipped = [];
  const sourceSummaries = [];
  const privacyRows = [];
  const sources = normalizeSources(manifest.sources ?? [], baseDir);

  for (const source of sources) {
    const gitState = collectGitState(source.root);
    const sourceFiles = [];
    await collectFiles(source.root, source, sourceFiles, skipped);
    sourceFiles.sort();

    let indexed = 0;
    let chunks = 0;
    for (const filePath of sourceFiles.slice(0, config.maxFilesPerSource)) {
      const stat = statSync(filePath);
      if (stat.size > config.maxFileBytes) {
        skipped.push(skipRow(source, filePath, 'file_too_large', stat.size));
        continue;
      }
      const content = await readFile(filePath);
      if (isProbablyBinary(content)) {
        skipped.push(skipRow(source, filePath, 'binary_or_non_text', stat.size));
        continue;
      }

      const originalText = content.toString('utf8').replace(/\r\n/g, '\n');
      const redaction = redactSecrets(originalText);
      if (redaction.count > 0) {
        privacyRows.push({
          source_id: source.id,
          relative_path: toPosix(relative(source.root, filePath)),
          redactions: redaction.count,
          content_sha256: sha256(content),
        });
      }
      const relPath = toPosix(relative(source.root, filePath));
      const authority = classifyAuthority(source, relPath);
      const fileChunks = chunkText(redaction.text, config.maxChunkChars, config.chunkOverlap);
      const contentSha = sha256(content);
      indexed += 1;
      chunks += fileChunks.length;

      fileChunks.forEach((chunk, index) => {
        const recordId = sha256(`${source.id}:${relPath}:${index}:${chunk.text}`);
        records.push({
          id: recordId,
          record_id: recordId,
          type: 'private_corpus_chunk',
          schema: 'reversa.private_corpus_chunk.v1',
          corpus_id: config.corpusId,
          generated_at: generatedAt,
          source_id: source.id,
          source_role: source.role,
          source_root_sha256: sha256(source.root),
          git_commit: gitState.commit,
          git_dirty: gitState.dirty,
          manifest_sha256: manifestSha256,
          relative_path: relPath,
          path_sha256: sha256(`${source.id}:${relPath}`),
          extension: extname(filePath).toLowerCase(),
          byte_count: stat.size,
          mtime_ms: Math.trunc(stat.mtimeMs),
          content_sha256: contentSha,
          chunk_index: index,
          chunk_count: fileChunks.length,
          chunk_sha256: sha256(chunk.text),
          char_start: chunk.start,
          char_end: chunk.end,
          line_start: chunk.lineStart,
          line_end: chunk.lineEnd,
          encoding: 'utf8',
          local_only: true,
          commit_allowed: false,
          export_allowed: false,
          source_authority: authority.sourceAuthority,
          telegram_source_authority: false,
          generated_artifact: authority.generatedArtifact,
          raw_proof: authority.rawProof,
          artifact_hash_authority: authority.artifactHashAuthority,
          content_authority: authority.contentAuthority,
          authority_class: authority.authorityClass,
          secret_redactions: redaction.count,
          redaction_status: redaction.count > 0 ? 'redacted' : 'clean',
          secret_scan_status: 'scanned',
          contains_payload: true,
          payload_inline: true,
          retrieval_allowed: true,
          training_allowed: authority.trainingAllowed && redaction.count === 0,
          fine_tune_allowed: false,
          eval_allowed: true,
          reason_not_trainable: authority.trainingAllowed && redaction.count === 0
            ? null
            : authority.reasonNotTrainable ?? (redaction.count > 0 ? 'secret_redactions_present' : null),
          required_proof: authority.requiredProof,
          promotion_state: authority.promotionState,
          corroboration_ids: [],
          chunk_strategy: 'fixed_chars_with_newline_backoff',
          embedding_model: null,
          embedding_model_version: null,
          embedding_hash: null,
          vector_dim: null,
          builder_version: 'private_corpus_v1',
          payload_policy: 'operator_storage_only_do_not_commit_generated_outputs',
          retrieval_tags: [...new Set([...(source.tags ?? []), ...inferTags(relPath, redaction.text)])].sort(),
          text: chunk.text,
        });
      });
    }

    sourceSummaries.push({
      source_id: source.id,
      root: source.root,
      role: source.role,
      git_commit: gitState.commit,
      git_dirty: gitState.dirty,
      files_seen: sourceFiles.length,
      files_indexed: indexed,
      chunks,
    });
  }

  const index = {
    schema: 'reversa.private_corpus_index.v1',
    generated_at: generatedAt,
    corpus_id: config.corpusId,
    manifest_path: manifestPath,
    manifest_sha256: manifestSha256,
    source_count: sources.length,
    chunk_count: records.length,
    skipped_count: skipped.length,
    local_only: true,
    payload_policy: 'Private local retrieval/training corpus. Do not commit generated corpus outputs.',
    sources: sourceSummaries,
    by_authority_class: countBy(records, record => record.authority_class),
    by_source_id: countBy(records, record => record.source_id),
  };

  records.sort((a, b) => a.id.localeCompare(b.id));
  const splits = splitRecords(records, manifest.splits ?? DEFAULT_SPLITS);

  const corpusPath = join(outDir, 'private-corpus-records.jsonl');
  const trainPath = join(outDir, 'private-corpus-train.jsonl');
  const valPath = join(outDir, 'private-corpus-val.jsonl');
  const testPath = join(outDir, 'private-corpus-test.jsonl');
  const indexPath = join(outDir, 'private-corpus-index.json');
  const summaryPath = join(outDir, 'private-corpus-summary.md');
  const sourceSummaryPath = join(outDir, 'source-summary.tsv');
  const labelSummaryPath = join(outDir, 'label-summary.tsv');
  const skippedPath = join(outDir, 'rejected-records.tsv');
  const privacyPath = join(outDir, 'privacy-summary.tsv');
  const resultPath = join(outDir, 'result.md');
  const hashesPath = join(outDir, 'sha256sums.txt');

  await writeJsonl(corpusPath, records);
  await writeJsonl(trainPath, splits.train);
  await writeJsonl(valPath, splits.val);
  await writeJsonl(testPath, splits.test);
  await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  await writeFile(summaryPath, summaryMarkdown(index, skipped), 'utf8');
  await writeFile(sourceSummaryPath, sourceSummaryTsv(sourceSummaries), 'utf8');
  await writeFile(labelSummaryPath, labelSummaryTsv(records), 'utf8');
  await writeFile(skippedPath, skippedTsv(skipped), 'utf8');
  await writeFile(privacyPath, privacySummaryTsv(privacyRows), 'utf8');
  await writeFile(resultPath, resultMarkdown(index, splits, privacyRows), 'utf8');
  await writeFile(
    hashesPath,
    await hashManifest([corpusPath, trainPath, valPath, testPath, indexPath, summaryPath, sourceSummaryPath, labelSummaryPath, skippedPath, privacyPath, resultPath]),
    'utf8',
  );

  return {
    outDir,
    corpusPath,
    indexPath,
    summaryPath,
    hashesPath,
    totalRecords: records.length,
    skipped: skipped.length,
    sources: sourceSummaries,
  };
}

export async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

export function normalizeSources(sources, baseDir = process.cwd()) {
  return sources.map((source, index) => {
    const root = resolve(baseDir, requireField(source.root, `sources[${index}].root`));
    if (!existsSync(root)) {
      throw new Error(`Corpus source root does not exist: ${root}`);
    }
    return {
      id: source.id ?? `source_${index + 1}`,
      root,
      role: source.role ?? 'repo_or_artifact',
      authorityClass: source.authority_class ?? null,
      artifactHashAuthority: Boolean(source.artifact_hash_authority),
      contentAuthority: source.content_authority !== false,
      trainingAllowed: source.training_allowed !== false,
      tags: source.tags ?? [],
      includeExtensions: new Set((source.include_extensions ?? [...DEFAULT_EXTENSIONS]).map(item => item.toLowerCase())),
      excludeDirs: new Set([...(source.exclude_dirs ?? []), ...DEFAULT_SKIP_DIRS]),
      excludePathRegex: source.exclude_path_regex ? new RegExp(source.exclude_path_regex, 'i') : null,
    };
  });
}

export function redactSecrets(text) {
  let redacted = text;
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, match => {
      count += 1;
      if (/^\s*(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)/i.test(match)) {
        return match.replace(/[:=]\s*["']?[^"'\s]+/i, '=[REDACTED]');
      }
      return '[REDACTED_SECRET]';
    });
  }
  return { text: redacted, count };
}

async function collectFiles(dir, source, out, skipped) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const relPath = toPosix(relative(source.root, path));
    if (entry.isDirectory()) {
      if (source.excludeDirs.has(entry.name) || source.excludePathRegex?.test(relPath)) {
        skipped.push(skipRow(source, path, 'excluded_directory', 0));
        continue;
      }
      await collectFiles(path, source, out, skipped);
      continue;
    }
    if (!entry.isFile()) continue;
    if (source.excludePathRegex?.test(relPath)) {
      skipped.push(skipRow(source, path, 'excluded_path', statSync(path).size));
      continue;
    }
    if (!source.includeExtensions.has(extname(entry.name).toLowerCase())) {
      skipped.push(skipRow(source, path, 'extension_not_indexed', statSync(path).size));
      continue;
    }
    out.push(path);
  }
}

function classifyAuthority(source, relPath) {
  const authorityClass = source.authorityClass ?? inferAuthorityClass(source, relPath);
  const generatedArtifact = authorityClass === 'generated_artifact' || GENERATED_RE.test(relPath);
  const rawProof = authorityClass === 'raw_proof' || RAW_PROOF_RE.test(relPath);
  const operatorNote = authorityClass === 'operator_note';
  const sourceAuthority = !operatorNote && !generatedArtifact && ['repo_source', 'raw_proof', 'artifact_extract'].includes(authorityClass);
  const trainingAllowed = source.trainingAllowed && sourceAuthority && !generatedArtifact && !operatorNote;
  return {
    authorityClass,
    generatedArtifact,
    rawProof,
    artifactHashAuthority: source.artifactHashAuthority || authorityClass === 'artifact_extract',
    contentAuthority: source.contentAuthority && !generatedArtifact,
    sourceAuthority,
    trainingAllowed,
    promotionState: operatorNote ? 'retrieval_only_requires_corroboration' : null,
    requiredProof: operatorNote ? ['corroborating_source_or_raw_artifact'] : [],
    reasonNotTrainable: !trainingAllowed
      ? operatorNote
        ? 'operator_note_requires_corroboration'
        : generatedArtifact
          ? 'generated_artifact_not_source_authority'
          : source.trainingAllowed
            ? 'not_source_authority'
            : 'source_training_disabled_by_manifest'
      : null,
  };
}

function inferAuthorityClass(source, relPath) {
  if (/telegram|chat|note/i.test(source.role)) return 'operator_note';
  if (GENERATED_RE.test(relPath)) return 'generated_artifact';
  if (RAW_PROOF_RE.test(relPath)) return 'raw_proof';
  if (SOURCE_RE.test(relPath)) return 'repo_source';
  return 'context';
}

function chunkText(text, maxChars, overlap) {
  const clean = text.trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const newline = clean.lastIndexOf('\n', end);
      if (newline > start + Math.floor(maxChars * 0.55)) end = newline;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push({
      start,
      end,
      lineStart: lineNumberAt(clean, start),
      lineEnd: lineNumberAt(clean, end),
      text: chunk,
    });
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

function collectGitState(root) {
  if (!existsSync(join(root, '.git'))) {
    return { commit: null, dirty: null };
  }
  const commit = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' });
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status === 0 ? status.stdout.trim().length > 0 : null,
  };
}

function assertSafeOutDir(outDir) {
  const rel = toPosix(relative(REPO_ROOT, outDir));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return;
  }
  const first = rel.split('/')[0];
  if (['local', 'logs', 'private', '.reversa'].includes(first)) {
    return;
  }
  throw new Error(`Refusing corpus output inside tracked repo area: ${outDir}. Use local/, logs/, private/, .reversa/, or a path outside this repo.`);
}

function inferTags(relPath, text) {
  const haystack = `${relPath}\n${text.slice(0, 4096)}`.toLowerCase();
  const tags = [];
  for (const [tag, pattern] of [
    ['nebula', /nebula/],
    ['droidspaces', /droidspaces|waylandie|anland/],
    ['graphics', /vulkan|gamescope|xwayland|wayland|dmabuf|glx|dxvk/],
    ['android', /android|adb|kernelsu|zygisk|rezygisk|bootloader/],
    ['training', /training|classifier|dataset|corpus|fine[- ]?tune|embedding/],
    ['policy', /policy|guard|authority|approval|mutation/],
  ]) {
    if (pattern.test(haystack)) tags.push(tag);
  }
  return tags;
}

function splitRecords(records, splitConfig) {
  const train = [];
  const val = [];
  const test = [];
  const trainCutoff = Number(splitConfig.train ?? DEFAULT_SPLITS.train);
  const valCutoff = trainCutoff + Number(splitConfig.val ?? DEFAULT_SPLITS.val);

  for (const record of records) {
    const bucket = Number.parseInt(record.id.slice(0, 8), 16) / 0xffffffff;
    if (bucket < trainCutoff) train.push(record);
    else if (bucket < valCutoff) val.push(record);
    else test.push(record);
  }
  return { train, val, test };
}

function isProbablyBinary(buffer) {
  const probe = buffer.subarray(0, Math.min(buffer.length, 4096));
  return probe.includes(0);
}

function skipRow(source, path, reason, size) {
  return {
    source_id: source.id,
    relative_path: toPosix(relative(source.root, path)),
    reason,
    byte_count: size,
  };
}

function summaryMarkdown(index, skipped) {
  return [
    '# Reversa Private Corpus',
    '',
    `- Corpus: \`${index.corpus_id}\``,
    `- Generated: \`${index.generated_at}\``,
    `- Sources: ${index.source_count}`,
    `- Chunks: ${index.chunk_count}`,
    `- Skipped: ${index.skipped_count}`,
    '- Local-only: true',
    '- Payload policy: do not commit generated corpus outputs.',
    '',
    '## Authority Classes',
    '',
    ...Object.entries(index.by_authority_class).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Sources',
    '',
    ...index.sources.map(source => `- ${source.source_id}: files=${source.files_indexed}/${source.files_seen}, chunks=${source.chunks}`),
    '',
    '## Top Skips',
    '',
    ...skipped.slice(0, 20).map(row => `- ${row.reason}: ${row.source_id}/${row.relative_path}`),
    '',
  ].join('\n');
}

function resultMarkdown(index, splits, privacyRows) {
  return [
    '# Reversa Private Corpus Result',
    '',
    `- Classification: \`REVERSA_PRIVATE_CORPUS_BUILD_PASS\``,
    `- Corpus: \`${index.corpus_id}\``,
    `- Chunks: ${index.chunk_count}`,
    `- Train/val/test: ${splits.train.length}/${splits.val.length}/${splits.test.length}`,
    `- Sources: ${index.source_count}`,
    `- Skipped: ${index.skipped_count}`,
    `- Secret redaction rows: ${privacyRows.length}`,
    '- Safety: read-only input scan; outputs written only to the requested output directory.',
    '- Public repo policy: generated corpus outputs are not source authority and should stay in ignored operator storage.',
    '',
  ].join('\n');
}

function sourceSummaryTsv(sources) {
  return [
    'source_id\trole\tgit_commit\tgit_dirty\tfiles_seen\tfiles_indexed\tchunks\troot',
    ...sources.map(source => [
      source.source_id,
      source.role ?? '',
      source.git_commit ?? '',
      source.git_dirty ?? '',
      source.files_seen,
      source.files_indexed,
      source.chunks,
      source.root,
    ].join('\t')),
  ].join('\n') + '\n';
}

function labelSummaryTsv(records) {
  const rows = [];
  for (const [authorityClass, count] of Object.entries(countBy(records, record => record.authority_class))) {
    rows.push(['authority_class', authorityClass, count]);
  }
  const tagCounts = {};
  for (const record of records) {
    for (const tag of record.retrieval_tags ?? []) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }
  for (const [tag, count] of Object.entries(tagCounts).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push(['retrieval_tag', tag, count]);
  }
  return [
    'kind\tlabel\tcount',
    ...rows.map(row => row.join('\t')),
  ].join('\n') + '\n';
}

function skippedTsv(skipped) {
  return [
    'source_id\trelative_path\treason\tbyte_count',
    ...skipped.map(row => [row.source_id, row.relative_path, row.reason, row.byte_count].join('\t')),
  ].join('\n') + '\n';
}

function privacySummaryTsv(rows) {
  return [
    'source_id\trelative_path\tredactions\tcontent_sha256',
    ...rows.map(row => [row.source_id, row.relative_path, row.redactions, row.content_sha256].join('\t')),
  ].join('\n') + '\n';
}

async function hashManifest(paths) {
  const lines = [];
  for (const path of paths) {
    lines.push(`${sha256(await readFile(path))}  ${basename(path)}`);
  }
  return lines.join('\n') + '\n';
}

async function writeJsonl(path, records) {
  await writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = keyFn(record) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function requireField(value, label) {
  if (!value) throw new Error(`Missing required ${label}`);
  return value;
}

function dateStamp(iso) {
  return iso.slice(0, 10);
}

function toPosix(path) {
  return path.split('\\').join('/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const options = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? argv[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--manifest':
        options.manifest = requireArg(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = requireArg(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--max-file-bytes':
        options.maxFileBytes = Number(requireArg(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-files-per-source':
        options.maxFilesPerSource = Number(requireArg(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-chunk-chars':
        options.maxChunkChars = Number(requireArg(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--chunk-overlap':
        options.chunkOverlap = Number(requireArg(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireArg(flag, value) {
  if (!value || String(value).startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`
build-private-corpus

Usage:
  node scripts/build-private-corpus.js \\
    --manifest <private-corpus-manifest.json> \\
    --out <corpus-output-dir>

This command reads text evidence and source files, writes deterministic corpus
artifacts to --out, redacts common secret patterns, and does not mutate inputs.
`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.manifest || !options.out) {
    printHelp();
    return options.help ? 0 : 1;
  }
  const result = await buildPrivateCorpus(options);
  console.log(`Private corpus written to ${result.outDir}`);
  console.log(`Records: ${result.totalRecords}`);
  console.log(`Hashes: ${result.hashesPath}`);
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
