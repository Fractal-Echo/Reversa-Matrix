import { existsSync } from 'fs';
import { resolve } from 'path';
import { buildGpuUpscaleFramegenDataset } from '../../scripts/build-gpu-upscale-framegen-dataset.js';
import { buildPrivateCorpus } from '../../scripts/build-private-corpus.js';
import { buildTelegramPromotionDataset } from '../../scripts/build-telegram-promotion-dataset.js';
import { queryPrivateCorpus } from '../../scripts/query-private-corpus.js';

export default async function dataset(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  if (subcommand === 'gpu-upscale-framegen') {
    const options = parseGpuDatasetArgs(rest);
    if (options.help) {
      printGpuDatasetHelp();
      return;
    }

    for (const [label, path] of [
      ['Cupscale scan', options.cupscaleScan],
      ['Flowframes scan', options.flowframesScan],
      ['HF metadata index', options.hfIndex],
    ]) {
      if (path && !existsSync(path)) {
        throw new Error(`${label} does not exist: ${path}`);
      }
    }

    const result = await buildGpuUpscaleFramegenDataset(options);
    console.log(chalk.bold('\n  Reversa dataset build complete\n'));
    console.log(`  Dataset:       ${chalk.cyan('gpu-upscale-framegen')}`);
    console.log(`  Output:        ${chalk.cyan(result.outDir)}`);
    console.log(`  Records:       ${chalk.cyan(result.totalRecords)}`);
    console.log(`  Train/val/test:${chalk.cyan(` ${result.splits.train}/${result.splits.val}/${result.splits.test}`)}`);
    console.log('');
    return;
  }

  if (subcommand === 'telegram-promotion') {
    const options = parseTelegramPromotionArgs(rest);
    if (options.help) {
      printTelegramPromotionHelp();
      return;
    }

    for (const [label, path] of [
      ['Telegram claims', options.claims],
      ...options.corroborators.map((path, index) => [`Corroborator ${index + 1}`, path]),
      ...options.artifactManifests.map((path, index) => [`Artifact manifest ${index + 1}`, path]),
    ]) {
      if (path && !existsSync(path)) {
        throw new Error(`${label} does not exist: ${path}`);
      }
    }

    const result = await buildTelegramPromotionDataset(options);
    console.log(chalk.bold('\n  Reversa Telegram promotion gate complete\n'));
    console.log(`  Output:             ${chalk.cyan(result.outDir)}`);
    console.log(`  Claims:             ${chalk.cyan(result.totalClaims)}`);
    console.log(`  Promoted:           ${chalk.cyan(result.promoted)}`);
    console.log(`  Artifact-backed:    ${chalk.cyan(result.artifactBacked)}`);
    console.log(`  Corroboration need: ${chalk.cyan(result.corroborationNeeded)}`);
    console.log(`  Rejected:           ${chalk.cyan(result.rejected)}`);
    console.log('');
    return;
  }

  if (subcommand === 'private-corpus') {
    const options = parsePrivateCorpusArgs(rest);
    if (options.help) {
      printPrivateCorpusHelp();
      return;
    }

    if (!existsSync(options.manifest)) {
      throw new Error(`Corpus manifest does not exist: ${options.manifest}`);
    }

    const result = await buildPrivateCorpus(options);
    console.log(chalk.bold('\n  Reversa private corpus build complete\n'));
    console.log(`  Output:       ${chalk.cyan(result.outDir)}`);
    console.log(`  Records:      ${chalk.cyan(result.totalRecords)}`);
    console.log(`  Skipped:      ${chalk.cyan(result.skipped)}`);
    console.log(`  Index:        ${chalk.cyan(result.indexPath)}`);
    console.log(`  Hashes:       ${chalk.cyan(result.hashesPath)}`);
    console.log('');
    return;
  }

  if (subcommand === 'private-corpus-search') {
    const options = parsePrivateCorpusSearchArgs(rest);
    if (options.help) {
      printPrivateCorpusSearchHelp();
      return;
    }

    if (!existsSync(options.corpus)) {
      throw new Error(`Corpus path does not exist: ${options.corpus}`);
    }

    const result = await queryPrivateCorpus(options);
    console.log(chalk.bold('\n  Reversa private corpus search complete\n'));
    console.log(`  Query:        ${chalk.cyan(result.query)}`);
    console.log(`  Corpus rows:  ${chalk.cyan(result.total_records)}`);
    console.log(`  Returned:     ${chalk.cyan(result.returned)}`);
    for (const [index, item] of result.results.entries()) {
      console.log(`  ${index + 1}. ${chalk.cyan(item.score)} ${item.source_id}/${item.relative_path}#${item.chunk_index}`);
    }
    if (options.out) {
      console.log(`  Output:       ${chalk.cyan(resolve(options.out))}`);
    }
    console.log('');
    return;
  }

  throw new Error(`Unknown dataset subcommand: ${subcommand}`);
}

function parseGpuDatasetArgs(args) {
  const options = {
    cupscaleScan: null,
    flowframesScan: null,
    hfIndex: null,
    out: null,
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
      case '--cupscale-scan':
        options.cupscaleScan = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--flowframes-scan':
        options.flowframesScan = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--hf-index':
        options.hfIndex = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown gpu-upscale-framegen dataset option: ${arg}`);
    }
  }

  if (!options.help && !options.out) {
    throw new Error('Missing required --out');
  }
  return options;
}

function parseTelegramPromotionArgs(args) {
  const options = {
    claims: null,
    corroborators: [],
    artifactManifests: [],
    out: null,
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
      case '--claims':
        options.claims = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--corroborator':
        options.corroborators.push(resolve(requireValue(flag, value)));
        if (inlineValue === null) index += 1;
        break;
      case '--artifact-manifest':
        options.artifactManifests.push(resolve(requireValue(flag, value)));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown telegram-promotion dataset option: ${arg}`);
    }
  }

  if (!options.help && (!options.claims || !options.out)) {
    throw new Error('Missing required --claims or --out');
  }
  return options;
}

function parsePrivateCorpusArgs(args) {
  const options = {
    manifest: null,
    out: null,
    maxFileBytes: null,
    maxFilesPerSource: null,
    maxChunkChars: null,
    chunkOverlap: null,
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
      case '--manifest':
        options.manifest = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-file-bytes':
        options.maxFileBytes = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-files-per-source':
        options.maxFilesPerSource = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-chunk-chars':
        options.maxChunkChars = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--chunk-overlap':
        options.chunkOverlap = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown private-corpus dataset option: ${arg}`);
    }
  }

  if (!options.help && (!options.manifest || !options.out)) {
    throw new Error('Missing required --manifest or --out');
  }
  return options;
}

function parsePrivateCorpusSearchArgs(args) {
  const options = {
    corpus: null,
    query: null,
    top: 8,
    out: null,
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
      case '--corpus':
        options.corpus = resolve(requireValue(flag, value));
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
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown private-corpus-search dataset option: ${arg}`);
    }
  }

  if (!options.help && (!options.corpus || !options.query)) {
    throw new Error('Missing required --corpus or --query');
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
  Reversa dataset commands

  Usage:
    node ./bin/reversa.js dataset gpu-upscale-framegen --help
    node ./bin/reversa.js dataset telegram-promotion --help
    node ./bin/reversa.js dataset private-corpus --help
    node ./bin/reversa.js dataset private-corpus-search --help
`);
}

function printGpuDatasetHelp() {
  console.log(`
  Build the GPU upscale/framegen advisory dataset.

  Usage:
    node ./bin/reversa.js dataset gpu-upscale-framegen \\
      --cupscale-scan <scan-dir-or-report.json> \\
      --flowframes-scan <scan-dir-or-report.json> \\
      --hf-index <HF_MODEL_METADATA_INDEX.tsv> \\
      --out <dataset-dir>

  This command does not download model weights, launch runtimes, patch binaries,
  or mutate scanned projects.
`);
}

function printTelegramPromotionHelp() {
  console.log(`
  Build a local Telegram evidence promotion gate.

  Usage:
    node ./bin/reversa.js dataset telegram-promotion \\
      --claims <normalized-telegram-claims.jsonl> \\
      --corroborator <repo-doc-or-raw-proof-file-or-dir> \\
      --artifact-manifest <hashed-file-video-manifest.jsonl> \\
      --out <dataset-dir>

  Telegram text is never source authority by itself. Hashed files and videos
  count as artifact evidence; source authority requires repo source, raw logs,
  or extracted media content. This command is offline and read-only.
`);
}

function printPrivateCorpusHelp() {
  console.log(`
  Build a private local retrieval/training corpus.

  Usage:
    node ./bin/reversa.js dataset private-corpus \\
      --manifest <private-corpus-manifest.json> \\
      --out <local-corpus-dir>

  Optional limits:
    --max-file-bytes <bytes>
    --max-files-per-source <count>
    --max-chunk-chars <chars>
    --chunk-overlap <chars>

  The corpus output is local-only and may include private source text or logs.
  It is meant for local retrieval, eval, and future training lanes. Do not
  commit generated corpus outputs to a public repo.
`);
}

function printPrivateCorpusSearchHelp() {
  console.log(`
  Search a private corpus without network access.

  Usage:
    node ./bin/reversa.js dataset private-corpus-search \\
      --corpus <private-corpus-dir-or-jsonl> \\
      --query "known good wayland real buffer" \\
      --top 8 \\
      --out <query-output-dir>

  The search ranks existing corpus chunks and does not mutate source files,
  launch runtimes, or call a model endpoint.
`);
}
