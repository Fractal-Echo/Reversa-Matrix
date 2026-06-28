#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export async function exportBackendMatrixUiFixtures(options) {
  const matrixPath = resolveRequiredPath(options.matrix, '--matrix');
  const outDir = resolveRequiredPath(options.out, '--out');
  await mkdir(outDir, { recursive: true });

  const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
  const fixture = buildBackendMatrixFixture(matrix);
  await writeFile(join(outDir, 'sample-backend-matrix.json'), JSON.stringify(fixture, null, 2) + '\n', 'utf8');

  return {
    outDir,
    totalRecords: fixture.summary.totalRecords,
    readyForControlledTest: fixture.summary.readyForControlledTest,
    blockedRuntime: fixture.summary.blockedRuntime,
  };
}

export function buildBackendMatrixFixture(matrix) {
  const summary = matrix.summary ?? {};
  const proof = matrix.proof_summary ?? {};
  const records = matrix.records ?? [];
  const topRows = records
    .filter(row => row.backend_candidates?.length > 0)
    .slice(0, 12)
    .map(row => ({
      id: sanitizeUiText(row.candidate_id),
      source_project: sanitizeUiText(row.source_project),
      status: readinessStatus(row.readiness_level),
      backend: row.backend_candidates ?? [],
      readiness_level: row.readiness_level,
      hard_blocks: row.hard_blocks ?? [],
      soft_warnings: row.soft_warnings ?? [],
      action: sanitizeUiText(row.recommended_next_action),
      labels: uiSafeLabels(row.labels ?? []),
      source_authority: false,
    }));

  return {
    schema_version: 1,
    generated_fixture: true,
    source_authority: false,
    title: 'Backend Readiness Matrix',
    summary: {
      totalRecords: Number(summary.totalRecords) || 0,
      readyForControlledTest: Number(summary.readyForControlledTest) || 0,
      readyForRecommendation: Number(summary.readyForRecommendation) || 0,
      cudaCandidates: Number(summary.cudaCandidates) || 0,
      directmlCandidates: Number(summary.directmlCandidates) || 0,
      onnxDirectmlCandidates: Number(summary.onnxDirectmlCandidates) || 0,
      vulkanNcnnCandidates: Number(summary.vulkanNcnnCandidates) || 0,
      tensorrtCandidates: Number(summary.tensorrtCandidates) || 0,
      blockedLicense: Number(summary.blockedLicense) || 0,
      blockedArtifact: Number(summary.blockedArtifact) || 0,
      blockedHash: Number(summary.blockedHash) || 0,
      blockedRuntime: Number(summary.blockedRuntime) || 0,
    },
    proof: {
      cuda: proof.cuda?.status ?? 'BACKEND_UNAVAILABLE',
      directml: proof.directml?.status ?? 'BACKEND_UNAVAILABLE',
      onnxDirectml: proof.onnx_directml?.status ?? 'BACKEND_UNAVAILABLE',
      vulkanNcnn: proof.vulkan_ncnn?.status ?? 'BACKEND_UNAVAILABLE',
      tensorrt: proof.tensorrt?.status ?? 'BACKEND_UNAVAILABLE',
    },
    gates: [
      { label: 'Controlled test only', status: summary.readyForControlledTest > 0 ? 'Review' : 'Blocked', count: summary.readyForControlledTest ?? 0 },
      { label: 'Recommendation ready', status: summary.readyForRecommendation > 0 ? 'Review' : 'Safe', count: summary.readyForRecommendation ?? 0 },
      { label: 'License blocked', status: summary.blockedLicense > 0 ? 'Blocked' : 'Safe', count: summary.blockedLicense ?? 0 },
      { label: 'Artifact blocked', status: summary.blockedArtifact > 0 ? 'Blocked' : 'Safe', count: summary.blockedArtifact ?? 0 },
      { label: 'Hash blocked', status: summary.blockedHash > 0 ? 'Blocked' : 'Safe', count: summary.blockedHash ?? 0 },
      { label: 'Runtime blocked', status: summary.blockedRuntime > 0 ? 'Blocked' : 'Safe', count: summary.blockedRuntime ?? 0 },
    ],
    rows: topRows,
  };
}

function readinessStatus(level) {
  if (level === 'BACKEND_READY_FOR_CONTROLLED_TEST') return 'Review';
  if (level === 'BACKEND_READY_FOR_RECOMMENDATION') return 'Safe';
  if (String(level).startsWith('BACKEND_BLOCKED')) return 'Blocked';
  return 'Candidate';
}

function uiSafeLabels(labels) {
  return labels.filter(label => !/MODEL_WEIGHT|WEIGHT_DOWNLOAD|DOWNLOAD/i.test(label));
}

function sanitizeUiText(value) {
  return String(value ?? '')
    .replace(/\bsource authority\b/gi, 'authority record')
    .replace(/\bweight\s+download\b/gi, 'artifact acquisition')
    .replace(/\bweights?\b/gi, 'artifacts')
    .replace(/\bdownload\b/gi, 'acquire')
    .replace(/\banti-cheat\b/gi, 'protected runtime')
    .replace(/\bDRM\b/g, 'protected runtime')
    .replace(/\bbypass\b/gi, 'override');
}

function resolveRequiredPath(path, flag) {
  if (!path) throw new Error(`Missing required ${flag}`);
  return resolve(path);
}

function parseArgs(args) {
  const options = { matrix: null, out: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--matrix':
        options.matrix = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown backend matrix fixture option: ${arg}`);
    }
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
Usage:
  node scripts/export-backend-matrix-ui-fixtures.js \\
    --matrix <backend-readiness-matrix.json> \\
    --out <reversa-studio/fixtures>

Writes a small generated Studio fixture. It reads local JSON only and does not
install packages, acquire artifacts, launch runtimes, or mutate projects.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await exportBackendMatrixUiFixtures(options);
  console.log(`Backend matrix fixture exported: ${result.outDir}`);
  console.log(`Records: ${result.totalRecords}`);
  console.log(`Ready for controlled test: ${result.readyForControlledTest}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
