#!/usr/bin/env node

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import {
  CLAUDE_CODE_BASE_CONTRACT,
  buildClaudeCodeBaseTrainingLabels,
  validateClaudeCodeBaseCapabilities,
} from '../lib/core/claude-code-base.js';

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.manifest || !args.out) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const manifestPath = resolve(args.manifest);
const outDir = resolve(args.out);
await mkdir(outDir, { recursive: true });

const manifest = await readJson(manifestPath);
const generatedAt = new Date().toISOString();
const records = [];
const functionalityMap = await readFunctionalityMap(manifest, manifestPath);

records.push({
  type: 'training_pack',
  generated_at: generatedAt,
  profile: manifest.reversa_profile ?? 'agentic_toolchain',
  manifest_path: manifestPath,
  target: manifest.target,
  license_mode: 'metadata_and_evidence_only',
  source_text_policy: 'No third-party source text is copied into this pack.',
  base_contract: CLAUDE_CODE_BASE_CONTRACT,
  functionality_absorption_map: manifest.functionality_absorption_map ?? null,
});

const rows = [];
for (const source of manifest.sources ?? []) {
  const reportPath = resolveReportPath(source, manifest.reversa_profile);
  const report = existsSync(reportPath) ? await readJson(reportPath) : null;
  const policy = classifyImportPolicy(source.import_stance, source);
  const topCategories = topEntries(report?.summary?.by_category ?? {}, 12);
  const severity = report?.summary?.highest_severity ?? 'UNKNOWN';
  const importantFiles = safeImportantFiles(report?.tree_inventory?.important_files ?? [], source.import_stance);

  const sourceRecord = {
    type: 'source_import_policy',
    repo: source.repo,
    url: source.url,
    commit: source.commit,
    default_branch: source.default_branch,
    license_evidence: source.license_evidence,
    import_stance: source.import_stance,
    import_policy_class: policy.class,
    training_weight: policy.weight,
    local_path: source.local_path,
    reversa_scan_output: source.reversa_scan_output,
    selected_report_path: reportPath,
    scan_summary: report
      ? {
          findings: report.summary.total_findings,
          contradictions: report.summary.total_contradictions,
          patch_candidates: report.summary.total_patch_candidates,
          highest_severity: severity,
          top_categories: topCategories,
        }
      : null,
    safe_important_files: importantFiles,
    recommended_goodies: source.recommended_goodies ?? [],
    copy_boundary: policy.copyBoundary,
    local_experimental_training_allowed: policy.localExperimentalTrainingAllowed,
    redistribution_allowed: false,
    commercial_use_allowed: false,
  };
  records.push(sourceRecord);

  rows.push([
    source.repo,
    source.import_stance,
    policy.class,
    String(policy.weight),
    source.license_evidence,
    report ? String(report.summary.total_findings) : 'missing scan',
    report ? String(report.summary.total_contradictions) : '-',
    severity,
  ]);

  for (const [category, count] of topCategories) {
    records.push({
      type: 'evidence_category_weight',
      repo: source.repo,
      category,
      count,
      import_policy_class: policy.class,
      training_weight: policy.weight,
      use_in_profile: policy.class !== 'blocked',
    });
  }
}

if (functionalityMap) {
  const baseValidation = validateClaudeCodeBaseCapabilities(functionalityMap.capabilities ?? []);
  records.push({
    type: 'functionality_absorption_map',
    generated_at: generatedAt,
    target_repo: functionalityMap.target_repo,
    target_commit: functionalityMap.target_commit,
    source_text_policy: functionalityMap.source_text_policy,
    capability_count: functionalityMap.capabilities?.length ?? 0,
    purpose: functionalityMap.purpose,
    trained_base_contract: CLAUDE_CODE_BASE_CONTRACT.id,
    base_contract_valid: baseValidation.valid,
    missing_base_capabilities: baseValidation.missing,
    extra_capabilities: baseValidation.extra,
  });

  if (!baseValidation.valid) {
    throw new Error(`Functionality absorption map is missing trained base capabilities: ${baseValidation.missing.join(', ')}`);
  }

  for (const capability of functionalityMap.capabilities ?? []) {
    records.push({
      type: 'functionality_capability',
      target_repo: functionalityMap.target_repo,
      target_commit: functionalityMap.target_commit,
      capability_id: capability.id,
      source_paths: capability.source_paths ?? [],
      reversa_targets: capability.reversa_targets ?? [],
      absorption_stance: capability.absorption_stance,
      test_targets: capability.test_targets ?? [],
      notes: capability.notes,
      import_policy_class: 'permissive',
      training_weight: 70,
      copy_boundary: functionalityMap.source_text_policy,
    });
  }
}

const gpuProbe = collectGpuProbe();
records.push({
  type: 'gpu_probe',
  generated_at: generatedAt,
  nvidia_smi_available: gpuProbe.available,
  output: gpuProbe.output,
});

const jsonlPath = join(outDir, 'agentic-training-pack.jsonl');
const summaryPath = join(outDir, 'agentic-training-summary.md');
const labelsPath = join(outDir, 'agentic-training-labels.json');
const gpuPath = join(outDir, 'gpu-proof.txt');
const hashesPath = join(outDir, 'sha256sums.txt');

await writeFile(jsonlPath, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
await writeFile(summaryPath, buildSummary(manifest, generatedAt, rows, records), 'utf8');
await writeFile(labelsPath, JSON.stringify(buildLabels(), null, 2) + '\n', 'utf8');
await writeFile(gpuPath, gpuProbe.output + (gpuProbe.output.endsWith('\n') ? '' : '\n'), 'utf8');

const hashes = [];
for (const file of [jsonlPath, summaryPath, labelsPath, gpuPath]) {
  hashes.push(`${await sha256(file)}  ${basename(file)}`);
}
await writeFile(hashesPath, hashes.join('\n') + '\n', 'utf8');

console.log(`Agentic training pack written to ${outDir}`);
console.log(`- ${jsonlPath}`);
console.log(`- ${summaryPath}`);
console.log(`- ${labelsPath}`);
console.log(`- ${gpuPath}`);
console.log(`- ${hashesPath}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`
build-agentic-training-pack

Usage:
  node scripts/build-agentic-training-pack.js \\
    --manifest docs/upstreams/claude-code-matrix/source-sync.json \\
    --out /path/to/output

The pack is metadata/evidence only. It does not copy third-party source text.
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readFunctionalityMap(manifest, sourcePath) {
  if (!manifest.functionality_absorption_map) {
    return null;
  }
  const mapPath = [
    resolve(dirname(sourcePath), manifest.functionality_absorption_map),
    resolve(process.cwd(), manifest.functionality_absorption_map),
    resolve(dirname(sourcePath), '..', '..', '..', manifest.functionality_absorption_map),
  ].find(candidate => existsSync(candidate));
  if (!mapPath) {
    throw new Error(`Functionality absorption map does not exist: ${manifest.functionality_absorption_map}`);
  }
  return readJson(mapPath);
}

function classifyImportPolicy(stance = '', source = {}) {
  if ((/personal_local_training/.test(stance) || source.local_experimental_training_allowed) && /reference_only|no_copy/.test(stance)) {
    return {
      class: 'personal_local',
      weight: 35,
      localExperimentalTrainingAllowed: true,
      copyBoundary: 'Personal local pattern training only. Do not copy, sell, redistribute, or commit source text.',
    };
  }
  if (/reference_only|no_copy/.test(stance)) {
    return {
      class: 'blocked',
      weight: 10,
      localExperimentalTrainingAllowed: false,
      copyBoundary: 'Reference-only. Do not copy code or docs into Reversa.',
    };
  }
  if (/per_folder_allowlist/.test(stance)) {
    return {
      class: 'allowlist',
      weight: 45,
      localExperimentalTrainingAllowed: false,
      copyBoundary: 'Only use folders with explicit compatible license evidence.',
    };
  }
  if (/notice_preservation/.test(stance)) {
    return {
      class: 'notice_required',
      weight: 80,
      localExperimentalTrainingAllowed: false,
      copyBoundary: 'Selective adaptation allowed with Apache-2.0 license and NOTICE preservation.',
    };
  }
  if (/selective_adapt|concept_adapt/.test(stance)) {
    return {
      class: 'permissive',
      weight: 90,
      localExperimentalTrainingAllowed: false,
      copyBoundary: 'Selective adaptation allowed with source URL, commit, and license attribution.',
    };
  }
  return {
    class: 'unknown',
    weight: 25,
    localExperimentalTrainingAllowed: false,
    copyBoundary: 'Manual license review required before reuse.',
  };
}

function resolveReportPath(source, profile = '') {
  const explicit = profile && source[`${profile}_scan_output`];
  if (explicit) {
    return join(explicit, 'report.json');
  }

  const base = source.reversa_scan_output;
  if (profile && base) {
    const profileSuffix = profile.replace(/^agentic_toolchain$/, 'agentic');
    const profilePath = `${base}_${profileSuffix}`;
    if (existsSync(join(profilePath, 'report.json'))) {
      return join(profilePath, 'report.json');
    }
  }

  return join(base, 'report.json');
}

function topEntries(value, limit) {
  return Object.entries(value)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function safeImportantFiles(files, stance = '') {
  const limit = /reference_only|no_copy/.test(stance) ? 20 : 60;
  return files
    .filter(file => !/(^|\/)(package\/cli\.js|restored-src\/|.*\.node$|.*\.tgz$)/i.test(file))
    .slice(0, limit);
}

function collectGpuProbe() {
  try {
    const output = execFileSync('nvidia-smi', [], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { available: true, output };
  } catch (err) {
    return {
      available: false,
      output: `nvidia-smi unavailable: ${String(err.message ?? err)}`,
    };
  }
}

function buildSummary(manifest, generatedAt, rows, records) {
  const sourceCount = manifest.sources?.length ?? 0;
  const labelCounts = countBy(records.filter(record => record.type === 'source_import_policy'), record => record.import_policy_class);
  const capabilityCount = records.filter(record => record.type === 'functionality_capability').length;

  return [
    '# Agentic Toolchain Training Pack',
    '',
    `- Generated at: \`${generatedAt}\``,
    `- Target: \`${manifest.target?.repo ?? '(unknown)'}\``,
    `- Profile: \`${manifest.reversa_profile ?? 'agentic_toolchain'}\``,
    `- Sources: ${sourceCount}`,
    `- Functionality capabilities: ${capabilityCount}`,
    '- Source text policy: no third-party source text is copied into this pack.',
    '',
    '## Policy Counts',
    '',
    markdownTable(
      ['Policy', 'Count'],
      Object.entries(labelCounts).sort((left, right) => left[0].localeCompare(right[0]))
    ),
    '',
    '## Source Weights',
    '',
    markdownTable(
      ['Repo', 'Import stance', 'Class', 'Weight', 'License evidence', 'Findings', 'Contradictions', 'Highest'],
      rows
    ),
    '',
    '## Use',
    '',
    'Use `agentic-training-pack.jsonl` as a deterministic profile-training and review dataset.',
    'Blocked/reference-only lanes may inform classifiers but must not contribute copied source text.',
    'Functionality capability records teach mechanism shape and test targets without copying implementation source.',
    '',
  ].join('\n');
}

function buildLabels() {
  const baseLabels = buildClaudeCodeBaseTrainingLabels();
  return {
    profile: baseLabels.profile,
    base_contract: baseLabels.base_contract,
    profile_id: baseLabels.profile_id,
    aliases: baseLabels.aliases,
    capability_ids: baseLabels.capability_ids,
    guard_claims: baseLabels.guard_claims,
    policy_classes: {
      permissive: 'MIT or equivalent selective adaptation with attribution.',
      notice_required: 'Apache-2.0 or similar; preserve NOTICE when copying.',
      allowlist: 'Repo-level license ambiguous; only explicitly licensed folders are importable.',
      personal_local: 'Personal local pattern training only; no copying, sale, redistribution, or committed source text.',
      blocked: 'Reference-only; no code/doc copying.',
      unknown: 'Manual review required.',
    },
    evidence_categories: [...new Set([
      'agent_instruction_surface',
      'agent_skill_contracts',
      'hook_lifecycle_policy',
      'permission_safety_policy',
      'memory_context_injection',
      'provider_routing_surface',
      'subagent_orchestration',
      'worktree_isolation',
      'mcp_plugin_surface',
      'proprietary_source_risk',
      'attribution_license_surface',
      'functionality_capability',
      'safe_diagnostics_and_redaction',
      'provider_catalog_and_registry',
      'smoke_capabilities',
      ...baseLabels.evidence_categories,
    ])],
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function markdownTable(headers, rows) {
  const clean = value => String(value ?? '').replace(/\|/g, '\\|');
  return [
    `| ${headers.map(clean).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(clean).join(' | ')} |`),
  ].join('\n');
}

async function sha256(path) {
  const text = await readFile(path);
  return createHash('sha256').update(text).digest('hex');
}
