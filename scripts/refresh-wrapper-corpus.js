#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const args = parseArgs(process.argv.slice(2));
const manifestPath = args.manifest ?? 'docs/upstreams/wrapper-corpus/source-sync.json';
const outRoot = args.out ?? 'local/training-vault/training-runs/wrapper-corpus-refresh-2026-06-30';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
mkdirSync(outRoot, { recursive: true });

const wrapperProfiles = [
  'graphics_wrapper',
  'vulkan_loader',
  'pcgamingwiki_runtime',
  'widescreen_framegen_runtime',
  'render_enhancement_plugin',
];

const results = [];

for (const source of manifest.sources ?? []) {
  if (!existsSync(source.local_path)) {
    results.push({
      repo: source.repo,
      lane: source.wrapper_lane,
      missing: true,
      local_path: source.local_path,
    });
    console.log(`MISSING | ${source.repo} | ${source.local_path}`);
    continue;
  }

  const slug = source.repo.replace(/[^A-Za-z0-9]+/g, '__');
  const profiles = source.wrapper_lane === 'dos_runtime_control_lane'
    ? ['dos_runtime']
    : wrapperProfiles;
  const out = join(outRoot, 'scans', slug);

  console.log(`SCAN | ${source.repo} | ${profiles.join(',')}`);
  const scan = spawnSync(process.execPath, [
    './bin/reversa.js',
    'scan',
    '--project-root',
    source.local_path,
    '--profiles',
    profiles.join(','),
    '--out',
    out,
    '--json',
    '--jsonl',
    '--markdown',
    '--agent-handoff',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });

  if (scan.status !== 0) {
    process.stdout.write(scan.stdout ?? '');
    process.stderr.write(scan.stderr ?? '');
    process.exit(scan.status ?? 1);
  }

  const perProfile = profiles.map(profile => {
    const reportPath = [
      join(out, profile, 'report.json'),
      join(out, `${profile}.json`),
      join(out, 'report.json'),
    ].find(candidate => existsSync(candidate));

    if (!reportPath) {
      return { profile, missing: true };
    }

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    return {
      profile,
      report_path: reportPath,
      findings: report.summary?.total_findings ?? 0,
      contradictions: report.summary?.total_contradictions ?? 0,
      patch_candidates: report.summary?.total_patch_candidates ?? 0,
      highest_severity: report.summary?.highest_severity ?? 'UNKNOWN',
    };
  });

  const row = {
    repo: source.repo,
    lane: source.wrapper_lane,
    profiles,
    out,
    findings: sum(perProfile, 'findings'),
    contradictions: sum(perProfile, 'contradictions'),
    patch_candidates: sum(perProfile, 'patch_candidates'),
    per_profile: perProfile,
  };
  results.push(row);
  console.log(`DONE | ${source.repo} | findings=${row.findings} contradictions=${row.contradictions} patches=${row.patch_candidates}`);
}

mkdirSync(join(outRoot, 'reports'), { recursive: true });
writeFileSync(join(outRoot, 'reports', 'wrapper-refresh-results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
writeFileSync(join(outRoot, 'WRAPPER_REFRESH_SUMMARY.md'), `${buildSummary(manifestPath, results)}\n`, 'utf8');
console.log(`SUMMARY | ${join(outRoot, 'WRAPPER_REFRESH_SUMMARY.md')}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      parsed.manifest = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--out') {
      parsed.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`refresh-wrapper-corpus

Usage:
  node scripts/refresh-wrapper-corpus.js \\
    --manifest docs/upstreams/wrapper-corpus/source-sync.json \\
    --out local/training-vault/training-runs/wrapper-corpus-refresh-YYYY-MM-DD
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function buildSummary(manifestPath, results) {
  return [
    '# Wrapper Corpus Refresh',
    '',
    `- Source manifest: \`${manifestPath}\``,
    '- Policy: personal-local concept training, no copied source text.',
    '- DOSBox/DOS runtime sources are isolated to `dos_runtime` to avoid wrapper-profile pollution.',
    '',
    '| Source | Lane | Profiles | Findings | Contradictions | Patch candidates |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...results.map(row => row.missing
      ? `| \`${row.repo}\` | \`${row.lane ?? 'unknown'}\` | missing local source | - | - | - |`
      : `| \`${row.repo}\` | \`${row.lane}\` | \`${row.profiles.join(',')}\` | ${row.findings} | ${row.contradictions} | ${row.patch_candidates} |`),
    '',
    '## Per-Profile Details',
    '',
    ...results.filter(row => !row.missing).flatMap(row => [
      `### ${row.repo}`,
      '',
      ...row.per_profile.map(profile => profile.missing
        ? `- \`${profile.profile}\`: missing report`
        : `- \`${profile.profile}\`: findings=${profile.findings}, contradictions=${profile.contradictions}, patch_candidates=${profile.patch_candidates}, highest=${profile.highest_severity}`),
      '',
    ]),
  ].join('\n');
}

