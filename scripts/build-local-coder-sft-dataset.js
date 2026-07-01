#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync, statSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const SYSTEM_PROMPT = [
  'You are the Reversa local coder lane.',
  'Operate as advisory reasoning only: deterministic scanner evidence, hashes, tests, and source artifacts outrank model output.',
  'Keep private/local material local-only. Do not reproduce third-party source verbatim when a concise summary or patch plan is enough.',
  'Prefer reversible, testable changes and name the exact evidence needed before mutation.',
].join(' ');

const DEFAULT_MAX_CORPUS_RECORDS = 1200;
const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_SPLITS = { train: 0.82, val: 0.09, test: 0.09 };

export async function buildLocalCoderSftDataset(options) {
  const outDir = resolve(requireValue('out', options.out));
  assertSafeOutDir(outDir);
  await mkdir(outDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const examples = [];
  const sourceRows = [];

  for (const packPath of options.packs ?? []) {
    const resolved = resolve(packPath);
    const records = await readJsonl(resolved);
    const before = examples.length;
    examples.push(...examplesFromAgenticPack(records, resolved, generatedAt));
    sourceRows.push({
      source_kind: 'agentic_pack',
      source_path: resolved,
      source_sha256: await sha256File(resolved),
      records_seen: records.length,
      examples: examples.length - before,
    });
  }

  if (options.corpus) {
    const corpusPath = resolveCorpusPath(options.corpus);
    const records = await readJsonl(corpusPath);
    const before = examples.length;
    examples.push(...examplesFromPrivateCorpus(records, {
      corpusPath,
      generatedAt,
      includeLocalExperimental: Boolean(options.includeLocalExperimental),
      maxCorpusRecords: Number(options.maxCorpusRecords ?? DEFAULT_MAX_CORPUS_RECORDS),
      maxChars: Number(options.maxChars ?? DEFAULT_MAX_CHARS),
    }));
    sourceRows.push({
      source_kind: 'private_corpus',
      source_path: corpusPath,
      source_sha256: await sha256File(corpusPath),
      records_seen: records.length,
      examples: examples.length - before,
    });
  }

  if (examples.length === 0) {
    throw new Error('No local coder SFT examples were produced. Provide --pack and/or --corpus with trainable records.');
  }

  const sorted = examples
    .map(example => ({ ...example, id: example.id ?? exampleId(example) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const splits = splitExamples(sorted, options.splits ?? DEFAULT_SPLITS);

  const allPath = join(outDir, 'local-coder-sft.jsonl');
  const trainPath = join(outDir, 'local-coder-sft-train.jsonl');
  const valPath = join(outDir, 'local-coder-sft-val.jsonl');
  const testPath = join(outDir, 'local-coder-sft-test.jsonl');
  const summaryPath = join(outDir, 'local-coder-sft-summary.md');
  const sourcesPath = join(outDir, 'source-summary.tsv');
  const hashesPath = join(outDir, 'sha256sums.txt');

  await writeJsonl(allPath, sorted);
  await writeJsonl(trainPath, splits.train);
  await writeJsonl(valPath, splits.val);
  await writeJsonl(testPath, splits.test);
  await writeFile(summaryPath, summaryMarkdown(sorted, splits, sourceRows, options), 'utf8');
  await writeFile(sourcesPath, sourceSummaryTsv(sourceRows), 'utf8');
  await writeFile(hashesPath, await hashManifest([allPath, trainPath, valPath, testPath, summaryPath, sourcesPath]), 'utf8');

  return {
    outDir,
    allPath,
    trainPath,
    valPath,
    testPath,
    summaryPath,
    hashesPath,
    totalExamples: sorted.length,
    splits: {
      train: splits.train.length,
      val: splits.val.length,
      test: splits.test.length,
    },
    sources: sourceRows,
  };
}

function examplesFromAgenticPack(records, packPath, generatedAt) {
  const examples = [];
  for (const record of records) {
    if (record.type === 'source_import_policy') {
      examples.push(sftExample({
        generatedAt,
        sourceKind: 'agentic_pack',
        sourcePath: packPath,
        sourceRecordId: `source:${record.repo}`,
        task: 'classify_source_import_policy',
        user: [
          'Classify this Reversa source import policy and return a compact decision.',
          '',
          fencedJson({
            repo: record.repo,
            url: record.url,
            license_evidence: record.license_evidence,
            import_stance: record.import_stance,
            local_experimental_training_allowed: record.local_experimental_training_allowed,
            redistribution_allowed: record.redistribution_allowed,
            commercial_use_allowed: record.commercial_use_allowed,
            scan_summary: record.scan_summary,
            recommended_goodies: record.recommended_goodies,
          }),
        ].join('\n'),
        assistant: fencedJson({
          decision: record.import_policy_class,
          training_weight: record.training_weight,
          copy_boundary: record.copy_boundary,
          local_only: Boolean(record.local_experimental_training_allowed),
          redistribution_allowed: false,
          commercial_use_allowed: false,
          scanner_truth_above_model: true,
        }),
        labels: [record.import_policy_class, 'source_policy'],
      }));
      continue;
    }

    if (record.type === 'evidence_category_weight') {
      examples.push(sftExample({
        generatedAt,
        sourceKind: 'agentic_pack',
        sourcePath: packPath,
        sourceRecordId: `category:${record.repo}:${record.category}`,
        task: 'rank_evidence_category',
        user: [
          'Rank this Reversa evidence category for training and import policy.',
          '',
          fencedJson({
            repo: record.repo,
            category: record.category,
            count: record.count,
            import_policy_class: record.import_policy_class,
            training_weight: record.training_weight,
          }),
        ].join('\n'),
        assistant: fencedJson({
          use_in_profile: Boolean(record.use_in_profile),
          import_policy_class: record.import_policy_class,
          training_weight: record.training_weight,
          reason: record.use_in_profile
            ? 'Use as bounded pattern evidence; keep deterministic scan findings authoritative.'
            : 'Do not promote blocked/import-unsafe rows into implementation guidance.',
        }),
        labels: [record.import_policy_class, 'category_weight'],
      }));
      continue;
    }

    if (record.type === 'functionality_capability') {
      examples.push(sftExample({
        generatedAt,
        sourceKind: 'agentic_pack',
        sourcePath: packPath,
        sourceRecordId: `capability:${record.capability_id}`,
        task: 'plan_reversa_owned_capability',
        user: [
          'Convert this absorbed capability into Reversa-owned implementation guidance.',
          '',
          fencedJson({
            capability_id: record.capability_id,
            reversa_targets: record.reversa_targets,
            absorption_stance: record.absorption_stance,
            test_targets: record.test_targets,
            notes: record.notes,
          }),
        ].join('\n'),
        assistant: fencedJson({
          capability_id: record.capability_id,
          implementation_boundary: record.copy_boundary,
          reversa_targets: record.reversa_targets ?? [],
          test_targets: record.test_targets ?? [],
          guidance: 'Implement the behavior through Reversa-owned code and tests; do not transplant upstream internals.',
        }),
        labels: ['permissive', 'capability'],
      }));
      continue;
    }

    if (record.type === 'gpu_probe') {
      examples.push(sftExample({
        generatedAt,
        sourceKind: 'agentic_pack',
        sourcePath: packPath,
        sourceRecordId: 'gpu_probe',
        task: 'summarize_gpu_proof',
        user: [
          'Summarize this GPU proof row for Reversa training provenance.',
          '',
          fencedJson({
            nvidia_smi_available: record.nvidia_smi_available,
            output: trimText(record.output ?? '', 900),
          }),
        ].join('\n'),
        assistant: fencedJson({
          proof_type: 'gpu_runtime_probe',
          nvidia_smi_available: Boolean(record.nvidia_smi_available),
          use: 'Hardware proof may support training environment claims, but model artifacts and hashes are still required.',
        }),
        labels: ['hardware_proof', 'gpu'],
      }));
    }
  }
  return examples;
}

function examplesFromPrivateCorpus(records, options) {
  const candidates = records
    .filter(record => isTrainableCorpusRecord(record, options.includeLocalExperimental))
    .sort((a, b) => String(a.record_id ?? a.id).localeCompare(String(b.record_id ?? b.id)))
    .slice(0, options.maxCorpusRecords);

  return candidates.map(record => sftExample({
    generatedAt: options.generatedAt,
    sourceKind: 'private_corpus',
    sourcePath: options.corpusPath,
    sourceRecordId: record.record_id ?? record.id,
    task: 'summarize_local_evidence_chunk',
    user: [
      'Summarize this local Reversa evidence chunk without copying it back verbatim.',
      'Return the authority class, useful signal, required proof, and next safe action.',
      '',
      fencedJson({
        source_id: record.source_id,
        source_role: record.source_role,
        authority_class: record.authority_class,
        source_authority: record.source_authority,
        raw_proof: record.raw_proof,
        generated_artifact: record.generated_artifact,
        local_experimental_training_allowed: record.local_experimental_training_allowed,
        training_scope: record.training_scope,
        relative_path: record.relative_path,
        line_start: record.line_start,
        line_end: record.line_end,
        content_sha256: record.content_sha256,
        chunk_sha256: record.chunk_sha256,
        retrieval_tags: record.retrieval_tags ?? [],
        text_excerpt: trimText(record.text ?? '', options.maxChars),
      }),
    ].join('\n'),
    assistant: fencedJson({
      authority_class: record.authority_class,
      source_authority: Boolean(record.source_authority),
      generated_artifact: Boolean(record.generated_artifact),
      raw_proof: Boolean(record.raw_proof),
      local_only: true,
      training_scope: record.training_scope ?? 'local_retrieval_or_advisory_only',
      useful_signal: summarizeSignal(record),
      required_proof: record.required_proof ?? [],
      next_safe_action: nextSafeAction(record),
      evidence_hash: record.chunk_sha256,
    }),
    labels: ['private_corpus', record.authority_class ?? 'context', ...(record.retrieval_tags ?? [])],
  }));
}

function isTrainableCorpusRecord(record, includeLocalExperimental) {
  if (record.generated_artifact) return false;
  if (record.secret_redactions && record.secret_redactions > 0) return false;
  if (record.redaction_status && record.redaction_status !== 'clean') return false;
  if (!record.text || !String(record.text).trim()) return false;
  if (record.training_allowed) return true;
  return includeLocalExperimental && record.local_experimental_training_allowed === true;
}

function summarizeSignal(record) {
  const tags = record.retrieval_tags ?? [];
  if (tags.includes('graphics')) return 'graphics/runtime evidence useful for wrapper, Vulkan, frame pacing, or display-path reasoning';
  if (tags.includes('android')) return 'Android/device evidence useful for guarded build or runtime diagnostics';
  if (tags.includes('policy')) return 'policy evidence useful for safety, authority, or mutation-boundary checks';
  if (tags.includes('training')) return 'training evidence useful for corpus, classifier, or eval pipeline decisions';
  return 'local evidence chunk useful only when corroborated by its source path, hashes, and authority class';
}

function nextSafeAction(record) {
  if (record.raw_proof) return 'Use as corroborating proof and cite the hash before changing code.';
  if (record.source_authority) return 'Use as source evidence, then verify with tests or a fresh scan.';
  if (record.local_experimental_training_allowed) return 'Use for local pattern learning only; do not export or treat as public source authority.';
  return 'Keep retrieval-only until corroborated by source or raw proof.';
}

function sftExample({ generatedAt, sourceKind, sourcePath, sourceRecordId, task, user, assistant, labels }) {
  return {
    schema: 'reversa.local_coder_sft_example.v1',
    type: 'local_coder_sft_example',
    generated_at: generatedAt,
    source_kind: sourceKind,
    source_path_sha256: sha256Text(sourcePath),
    source_record_id: String(sourceRecordId),
    task,
    local_only: true,
    export_allowed: false,
    advisory_only: true,
    deterministic_truth_above_model: true,
    labels: [...new Set(labels.filter(Boolean).map(String))].sort(),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ],
  };
}

function splitExamples(examples, splitConfig) {
  const train = [];
  const val = [];
  const test = [];
  const trainCutoff = Number(splitConfig.train ?? DEFAULT_SPLITS.train);
  const valCutoff = trainCutoff + Number(splitConfig.val ?? DEFAULT_SPLITS.val);

  for (const example of examples) {
    const bucket = Number.parseInt(example.id.slice(0, 8), 16) / 0xffffffff;
    if (bucket < trainCutoff) train.push(example);
    else if (bucket < valCutoff) val.push(example);
    else test.push(example);
  }
  return { train, val, test };
}

function exampleId(example) {
  return sha256Text(JSON.stringify({
    source_kind: example.source_kind,
    source_record_id: example.source_record_id,
    task: example.task,
    labels: example.labels,
    user: example.messages[1]?.content,
  }));
}

function resolveCorpusPath(input) {
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

async function readJsonl(path) {
  const text = await readFile(resolve(path), 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function writeJsonl(path, records) {
  await writeFile(path, records.map(record => jsonlStringify(record)).join('\n') + '\n', 'utf8');
}

function jsonlStringify(record) {
  return JSON.stringify(record)
    .replace(/\u0085/g, '\\u0085')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function fencedJson(value) {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function trimText(text, maxChars) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

function summaryMarkdown(examples, splits, sources, options) {
  const byTask = countBy(examples, example => example.task);
  return [
    '# Reversa Local Coder SFT Dataset',
    '',
    `- Examples: ${examples.length}`,
    `- Train/val/test: ${splits.train.length}/${splits.val.length}/${splits.test.length}`,
    '- Local-only: true',
    '- Export allowed: false',
    '- Advisory only: true',
    '- Deterministic scanner truth above model: true',
    `- Include local experimental corpus: ${Boolean(options.includeLocalExperimental)}`,
    '',
    '## Tasks',
    '',
    ...Object.entries(byTask).map(([task, count]) => `- ${task}: ${count}`),
    '',
    '## Sources',
    '',
    ...sources.map(source => `- ${source.source_kind}: ${source.examples}/${source.records_seen} examples from \`${source.source_path}\``),
    '',
  ].join('\n');
}

function sourceSummaryTsv(sources) {
  return [
    'source_kind\trecords_seen\texamples\tsource_sha256\tsource_path',
    ...sources.map(source => [
      source.source_kind,
      source.records_seen,
      source.examples,
      source.source_sha256,
      source.source_path,
    ].join('\t')),
  ].join('\n') + '\n';
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = keyFn(record) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function hashManifest(paths) {
  const rows = [];
  for (const path of paths) {
    rows.push(`${await sha256File(path)}  ${basename(path)}`);
  }
  return rows.join('\n') + '\n';
}

async function sha256File(path) {
  return sha256Text(await readFile(path));
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertSafeOutDir(outDir) {
  const rel = toPosix(relative(REPO_ROOT, outDir));
  if (rel.startsWith('..') || isAbsolute(rel)) return;
  const first = rel.split('/')[0];
  if (['local', 'logs', 'private', '.reversa'].includes(first)) return;
  throw new Error(`Refusing SFT output inside tracked repo area: ${outDir}. Use local/, logs/, private/, .reversa/, or a path outside this repo.`);
}

function toPosix(value) {
  return value.split('\\').join('/');
}

function requireValue(label, value) {
  if (!value) throw new Error(`Missing required ${label}`);
  return value;
}

function parseArgs(argv) {
  const options = {
    packs: [],
    corpus: null,
    out: null,
    maxCorpusRecords: DEFAULT_MAX_CORPUS_RECORDS,
    maxChars: DEFAULT_MAX_CHARS,
    includeLocalExperimental: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? argv[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--pack':
        options.packs.push(resolve(requireValue(flag, value)));
        if (inlineValue === null) index += 1;
        break;
      case '--corpus':
        options.corpus = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-corpus-records':
        options.maxCorpusRecords = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-chars':
        options.maxChars = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--include-local-experimental':
        options.includeLocalExperimental = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
build-local-coder-sft-dataset

Usage:
  node scripts/build-local-coder-sft-dataset.js \\
    --pack <agentic-training-pack.jsonl> \\
    --corpus <private-corpus-dir-or-jsonl> \\
    --out <local-output-dir>

Options:
  --pack <jsonl>                  May be repeated.
  --corpus <dir-or-jsonl>         Optional private corpus source.
  --max-corpus-records <count>    Default: ${DEFAULT_MAX_CORPUS_RECORDS}
  --max-chars <chars>             Max corpus excerpt chars per example. Default: ${DEFAULT_MAX_CHARS}
  --include-local-experimental    Include local-only experimental corpus rows.

Outputs are local-only SFT chat JSONL files. They are advisory training data,
not source authority, and should stay under ignored local/private storage.
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || (!args.packs.length && !args.corpus) || !args.out) {
      printHelp();
      process.exit(args.help ? 0 : 1);
    }
    const result = await buildLocalCoderSftDataset(args);
    console.log(`Local coder SFT dataset written to ${result.outDir}`);
    console.log(`- examples: ${result.totalExamples}`);
    console.log(`- train/val/test: ${result.splits.train}/${result.splits.val}/${result.splits.test}`);
    console.log(`- hashes: ${result.hashesPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
