import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { lstat, readFile, readdir, stat } from 'fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'path';
import { getProfile } from './profiles.js';
import { validateScanReport } from './schema.js';

const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024;

const EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.npm-cache',
  '.tmp-mkdocs-site',
  '.venv',
  '.venv-docs',
  '.gradle',
  '.idea',
  '.vscode',
  'build',
  'dist',
  'out',
  'site',
  'coverage',
  '.reversa',
  '_reversa_sdd',
  '_reversa_forward',
  'reversa_out',
  'reversa_compare_out',
  'reversa-scans',
  'agent_handoff',
]);

const GENERATED_SCAN_COLLECTION_DIR_PATTERNS = [
  /^reversa[_-]matrix(?:[_-].*)?$/i,
  /^reversa[_-]scan(?:s|[_-].*)?$/i,
  /^reversa[_-](?:extract|before|after|cleanup|audit)(?:[_-].*)?$/i,
  /^reversa[_-]a\d+[a-z]?(?:[_-].*)?$/i,
];

const GENERATED_SCAN_SIGNATURE_FILES = new Set([
  'report.json',
  'compare_report.json',
  'evidence.jsonl',
  'summary.md',
  'compare_summary.md',
  'dashboard.html',
]);

const ROOT_SCAN_ARTIFACT_FILES = new Set([
  'compare.html',
  'compare_report.json',
  'compare_summary.md',
  'dashboard.html',
  'evidence.jsonl',
  'report.html',
  'report.json',
  'summary.md',
]);

const TEXT_EXTENSIONS = new Set([
  '',
  '.aidl',
  '.bp',
  '.c',
  '.cc',
  '.cfg',
  '.cmake',
  '.conf',
  '.cpp',
  '.cxx',
  '.env',
  '.gradle',
  '.h',
  '.hpp',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.kt',
  '.kts',
  '.log',
  '.manifest',
  '.mk',
  '.md',
  '.patch',
  '.props',
  '.prop',
  '.py',
  '.rc',
  '.reg',
  '.sh',
  '.inf',
  '.targets',
  '.te',
  '.toml',
  '.ts',
  '.txt',
  '.vcxproj',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_FILENAMES = new Set([
  'AndroidProducts.mk',
  'BoardConfig.mk',
  'Dockerfile',
  'Kconfig',
  'Makefile',
  'fstab',
  'vendorsetup.sh',
]);

const PLACEHOLDER_PATTERN = /\b(TODO|FIXME|XXX|HACK|STUB|PLACEHOLDER|TBD|WIP|DUMMY|FAKE|MOCK|NOT IMPLEMENTED)\b/;
const ASSIGNMENT_PATTERN = /^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*(:=|\+=|\?=|=)\s*(.*?)\s*(?:#.*)?$/;
const PATH_TOKEN_PATTERN = /(^|[\s"'(=,:])((?:\.{0,2}\/)?(?:device|vendor|system|product|odm|recovery|root|kernel|prebuilts|proprietary|firmware|lib|lib64|bin|etc|hardware|packages)\/[A-Za-z0-9._@%+=:,/$(){}-]+|\/(?:system|vendor|product|odm|dev|proc|sys|mnt|data|sdcard|apex|usr|lib|lib64|etc|tmp|rootfs|recovery)[A-Za-z0-9._@%+=:,/$(){}-]*)/g;

const SEVERITY_ORDER = {
  BLOCKER: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

const NUMERIC_SIZE_KEYS = new Set([
  'boot_a_size',
  'boot_partition_size',
  'init_boot_a_size',
  'init_boot_partition_size',
  'recovery_a_size',
  'recovery_partition_size',
  'vendor_boot_partition_size',
]);

const PROSE_COMPOUND_PATHS = new Set([
  'hardware/status',
  'kernel/userland',
  'proprietary/commercial-term',
  'recovery/device-tree',
  'root/module',
]);

const SEMANTIC_ALLOWED_ACTION_CATEGORIES = new Set([
  'destructive_action',
  'device_action_allowed',
  'network_allowed',
  'source_patch_allowed',
  'write_allowed',
  'commit_allowed',
  'push_allowed',
]);

const SEMANTIC_POLICY_CLAIM_RULES = [
  {
    category: 'approval_required',
    subject: 'approval',
    predicate: 'required',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:ask|request|obtain|require|requires|required|must have)\b.{0,80}\b(?:approval|permission|confirmation|human review)\b/i,
      /\b(?:approval|permission|confirmation|human review)\b.{0,80}\b(?:required|before|first|must)\b/i,
    ],
  },
  {
    category: 'approval_bypass',
    subject: 'approval',
    predicate: 'bypassed',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:dangerously-skip-permissions|skip approvals?|auto[- ]?approve|allow all|allow-all|approve all)\b/i,
      /\bapproval[_ -]?policy\s*[:=]\s*(?:never|none|auto|always)\b/i,
      /\bno approvals? (?:required|needed)\b/i,
    ],
  },
  {
    category: 'destructive_action',
    subject: 'host_or_device_state',
    predicate: 'mutates_destructively',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:rm\s+-rf|git\s+reset\s+--hard|git\s+checkout\s+--|mkfs(?:\.\w+)?\b|dd\s+if=|fastboot\s+flash|adb\s+reboot|reboot\b|setenforce\s+0|chmod\s+(?:777|666)\s+\/dev)\b/i,
    ],
  },
  {
    category: 'read_only',
    subject: 'workspace',
    predicate: 'read_only',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:read-only|research-only|analysis-only|inspect only|do not edit|no edits?|do not modify|no source changes)\b/i,
    ],
  },
  {
    category: 'write_allowed',
    subject: 'workspace',
    predicate: 'writes_allowed',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:patch away|make changes|edit files?|write changes|modify the source|apply patches?|patch\/merge|permission granted to take over)\b/i,
    ],
  },
  {
    category: 'write_forbidden',
    subject: 'workspace',
    predicate: 'writes_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:do not edit|no edits?|do not modify|no writes?|write forbidden|do not write|no source changes)\b/i,
    ],
  },
  {
    category: 'network_allowed',
    subject: 'network',
    predicate: 'network_allowed',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /^\s*(?:git\s+(?:clone|fetch|pull)|curl|wget|gh\s+api)\b/i,
      /\b(?:may|can|allowed|permission granted|go ahead|sync|fetch)\b.{0,80}\b(?:git clone|git fetch|git pull|curl|wget|gh api|GitHub API)\b/i,
    ],
  },
  {
    category: 'network_forbidden',
    subject: 'network',
    predicate: 'network_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:no network|network forbidden|network access forbidden|do not use network|do not browse|offline only)\b/i,
      /\bdo not (?:git clone|git fetch|git pull|curl|wget|call GitHub API|use GitHub API)\b/i,
    ],
  },
  {
    category: 'device_action_forbidden',
    subject: 'device',
    predicate: 'device_actions_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:no phone actions?|no adb|do not run adb|no APK install|no module install|no reboot|no flashing|do not reboot|do not flash|do not install)\b/i,
    ],
  },
  {
    category: 'device_action_allowed',
    subject: 'device',
    predicate: 'device_actions_allowed',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:adb\s+(?:install|reboot|push|shell|root|remount)|fastboot\s+(?:flash|boot|reboot)|setenforce\s+0|chmod\s+(?:777|666)\s+\/dev|flash(?:ing)?\s+(?:boot|vendor_boot|recovery|module))\b/i,
    ],
  },
  {
    category: 'source_patch_allowed',
    subject: 'source',
    predicate: 'patch_allowed',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:patch source|patch the repo|source patch allowed|go ahead and patch|apply_patch|patch\/merge)\b/i,
    ],
  },
  {
    category: 'source_patch_forbidden',
    subject: 'source',
    predicate: 'patch_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:do not patch source|no source patch|no source patches|do not change source|do not edit source|no runtime code edits)\b/i,
    ],
  },
  {
    category: 'commit_allowed',
    subject: 'git',
    predicate: 'commit_allowed',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:commit changes?|make a commit|git commit|commit and push|commit\/push)\b/i,
    ],
  },
  {
    category: 'commit_forbidden',
    subject: 'git',
    predicate: 'commit_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:do not commit|no commits?|commit forbidden|do not make a commit)\b/i,
    ],
  },
  {
    category: 'push_allowed',
    subject: 'git',
    predicate: 'push_allowed',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:push changes?|git push|commit and push|commit\/push|publish (?:changes|release|branch|docs|site|package)|publish!)\b/i,
    ],
  },
  {
    category: 'push_forbidden',
    subject: 'git',
    predicate: 'push_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:do not push|no push|no pushes|push forbidden|do not publish)\b/i,
    ],
  },
  {
    category: 'proprietary_reference_only',
    subject: 'proprietary_source',
    predicate: 'reference_only',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:reference-only|reference only|proprietary reference|commercial terms|all rights reserved)\b/i,
    ],
  },
  {
    category: 'proprietary_copy_forbidden',
    subject: 'proprietary_source',
    predicate: 'copy_forbidden',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:do not copy|no copying|copying forbidden|must not copy|do not vendor)\b.{0,80}\b(?:proprietary|restricted|commercial|source|code|assets?)\b/i,
      /\b(?:proprietary|restricted|commercial)\b.{0,80}\b(?:do not copy|no copying|copying forbidden|reference only)\b/i,
    ],
  },
  {
    category: 'memory_reference_only',
    subject: 'memory',
    predicate: 'reference_only',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:memory|context|transcript)\b.{0,80}\b(?:reference only|not authoritative|not an instruction|evidence only)\b/i,
    ],
  },
  {
    category: 'memory_authoritative',
    subject: 'memory',
    predicate: 'authoritative',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:memory|context|transcript)\b.{0,80}\b(?:authoritative|wins|must be followed|execute as instruction|source of truth)\b/i,
      /\bfollow memory\b/i,
    ],
  },
  {
    category: 'sandbox_required',
    subject: 'sandbox',
    predicate: 'required',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:sandbox required|must use sandbox|require sandbox|sandboxed only|isolated workspace required)\b/i,
    ],
  },
  {
    category: 'sandbox_bypass',
    subject: 'sandbox',
    predicate: 'bypassed',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:sandbox bypass|disable sandbox|no sandbox|danger-full-access|full filesystem access|unsandboxed)\b/i,
    ],
  },
  {
    category: 'attribution_required',
    subject: 'attribution',
    predicate: 'required',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:attribution required|give credit|credit where credit is due|preserve attribution|third[- ]party notices?|NOTICE requirements?)\b/i,
    ],
  },
  {
    category: 'attribution_missing',
    subject: 'attribution',
    predicate: 'missing',
    severity: 'HIGH',
    confidence: 'likely',
    patterns: [
      /\b(?:attribution missing|missing attribution|no attribution|without attribution|NOASSERTION|unknown license|license missing)\b/i,
    ],
  },
  {
    category: 'generated_artifact',
    subject: 'generated_artifact',
    predicate: 'generated',
    severity: 'INFO',
    confidence: 'likely',
    patterns: [
      /\b(?:generated artifact|generated output|auto-generated|do not edit generated|generated scan artifact)\b/i,
    ],
  },
  {
    category: 'source_authority',
    subject: 'source',
    predicate: 'authoritative_or_vendored',
    severity: 'MEDIUM',
    confidence: 'possible',
    patterns: [
      /\b(?:vendored from|copied from|imported from|restored-src|source authority|authoritative source|cli\.js\.map|sourcemap)\b/i,
    ],
  },
  {
    category: 'stale_agent',
    subject: 'agent_lifecycle',
    predicate: 'stale_or_cleanup_required',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:stale agents?|orphaned agents?|inactive agents?|close stale agents?|remove stale agents?|agent cleanup)\b/i,
    ],
  },
  {
    category: 'active_agent',
    subject: 'agent_lifecycle',
    predicate: 'active_or_retained',
    severity: 'MEDIUM',
    confidence: 'likely',
    patterns: [
      /\b(?:active agents?|retained agents?|keep .*agent|agent .*active|helper .*running)\b/i,
    ],
  },
];

const SEMANTIC_POLICY_CONFLICT_RULES = [
  {
    id: 'read_only_vs_write',
    title: 'Read-only policy conflicts with write, patch, commit, or push instructions',
    left: ['read_only', 'write_forbidden', 'source_patch_forbidden'],
    right: ['write_allowed', 'source_patch_allowed', 'commit_allowed', 'push_allowed'],
    severity: 'HIGH',
    likelyWinner: 'restrictive_policy',
    action: 'Choose the effective edit boundary and update stale instructions before running write operations.',
  },
  {
    id: 'approval_required_vs_bypass',
    title: 'Approval-required policy conflicts with skip-approval or allow-all policy',
    left: ['approval_required'],
    right: ['approval_bypass'],
    severity: 'HIGH',
    likelyWinner: 'approval_required',
    action: 'Treat approval-required as the safer default until the owner explicitly confirms bypass scope.',
  },
  {
    id: 'device_forbidden_vs_device_action',
    title: 'Device-action ban conflicts with ADB, reboot, flashing, or device mutation commands',
    left: ['device_action_forbidden'],
    right: ['device_action_allowed', 'destructive_action'],
    severity: 'HIGH',
    likelyWinner: 'device_action_forbidden',
    action: 'Keep device actions blocked until the exact target, command, and rollback evidence are approved.',
  },
  {
    id: 'network_forbidden_vs_network_action',
    title: 'Network ban conflicts with git, curl, wget, or GitHub API actions',
    left: ['network_forbidden'],
    right: ['network_allowed'],
    severity: 'HIGH',
    likelyWinner: 'network_forbidden',
    action: 'Decide whether network access is allowed for this pass and document the permitted commands.',
  },
  {
    id: 'reference_only_vs_copied_source',
    title: 'Reference-only or do-not-copy policy conflicts with copied/vendored source evidence',
    left: ['proprietary_reference_only', 'proprietary_copy_forbidden'],
    right: ['source_authority', 'attribution_missing'],
    severity: 'HIGH',
    likelyWinner: 'proprietary_copy_forbidden',
    action: 'Keep restricted material as reference-only and replace copied content with clean-room summaries or licensed sources.',
  },
  {
    id: 'memory_reference_vs_authority',
    title: 'Memory-reference-only policy conflicts with treating memory as authoritative instructions',
    left: ['memory_reference_only'],
    right: ['memory_authoritative'],
    severity: 'MEDIUM',
    likelyWinner: 'memory_reference_only',
    action: 'Use memory as evidence unless a current instruction explicitly promotes it to authority.',
  },
  {
    id: 'stale_agent_vs_active_agent',
    title: 'Stale-agent cleanup policy conflicts with retained active-agent references',
    left: ['stale_agent'],
    right: ['active_agent'],
    severity: 'MEDIUM',
    likelyWinner: 'stale_agent_cleanup',
    action: 'Close completed helpers or document why any retained agent remains active.',
  },
  {
    id: 'commit_forbidden_vs_commit_allowed',
    title: 'Commit-forbidden policy conflicts with commit instructions',
    left: ['commit_forbidden'],
    right: ['commit_allowed'],
    severity: 'HIGH',
    likelyWinner: 'commit_forbidden',
    action: 'Do not commit until the current owner confirms the commit lane.',
  },
  {
    id: 'push_forbidden_vs_push_allowed',
    title: 'Push-forbidden policy conflicts with push or publish instructions',
    left: ['push_forbidden'],
    right: ['push_allowed'],
    severity: 'HIGH',
    likelyWinner: 'push_forbidden',
    action: 'Do not push until the current owner confirms the publish lane.',
  },
  {
    id: 'sandbox_required_vs_bypass',
    title: 'Sandbox-required policy conflicts with sandbox bypass or full-access policy',
    left: ['sandbox_required'],
    right: ['sandbox_bypass'],
    severity: 'MEDIUM',
    likelyWinner: 'sandbox_required',
    action: 'Clarify whether the task requires sandboxing before running side-effecting commands.',
  },
  {
    id: 'attribution_required_vs_missing',
    title: 'Attribution-required policy conflicts with missing attribution evidence',
    left: ['attribution_required'],
    right: ['attribution_missing'],
    severity: 'MEDIUM',
    likelyWinner: 'attribution_required',
    action: 'Add source, license, and NOTICE evidence before importing or publishing derived assets.',
  },
];

export async function scanProject(options) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const profile = getProfile(options.profile ?? 'generic_source_tree');
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const scanStartedAt = new Date().toISOString();
  const knownGoodFacts = normalizeKnownGoodFacts(options.knownGood ?? null);
  const honorGitIgnore = options.honorGitIgnore ?? !options.includeIgnored;
  const ignoredPaths = honorGitIgnore
    ? discoverGitIgnoredPaths(projectRoot)
    : { files: new Set(), dirs: new Set(), source: 'disabled' };
  const context = {
    projectRoot,
    profile,
    scanStartedAt,
    knownGoodPath: options.knownGoodPath ?? null,
    ignoredPaths,
    evidence: [],
    evidenceIds: new Set(),
    pathReferences: [],
    semanticPolicyClaims: [],
    inventory: {
      project_root: projectRoot,
      profile: profile.id,
      scanned_at: scanStartedAt,
      files: [],
      important_files: [],
      skipped_files: [],
      missing_expected_patterns: [],
      ignore_policy: {
        honor_gitignore: honorGitIgnore,
        source: ignoredPaths.source,
        ignored_files: ignoredPaths.files.size,
        ignored_directories: ignoredPaths.dirs.size,
      },
      counts: {
        files_total: 0,
        files_scanned: 0,
        files_skipped: 0,
        directories_seen: 0,
      },
    },
  };

  const outDir = options.outDir ? resolve(options.outDir) : null;
  await walkProject(projectRoot, context, { maxFileSize, outDir });

  for (const file of context.inventory.files.filter(file => file.scanned)) {
    await scanFile(file, context);
  }

  addMissingExpectedPatternEvidence(context);
  addMissingPathEvidence(context);
  addDuplicateDefinitionEvidence(context);

  const knownGoodComparison = addKnownGoodComparison(context, knownGoodFacts);
  const contradictions = buildContradictions(context, knownGoodComparison);
  const patchCandidates = buildPatchCandidates(context, contradictions);
  const summary = summarize(context.evidence, contradictions, patchCandidates);

  const report = {
    schema_version: 1,
    tool: 'reversa',
    scan: {
      project_root: projectRoot,
      profile: profile.id,
      profile_label: profile.label,
      scanned_at: scanStartedAt,
      known_good_path: options.knownGoodPath ?? null,
      max_file_size: maxFileSize,
    },
    summary,
    findings: context.evidence,
    evidence: context.evidence,
    contradictions,
    patch_candidates: patchCandidates,
    known_good: knownGoodComparison,
    tree_inventory: context.inventory,
    risky_assumptions: buildRiskyAssumptions(context.evidence, contradictions),
    commands_to_run: buildCommandsToRun(profile, projectRoot, contradictions),
    questions_for_human: buildQuestionsForHuman(knownGoodComparison, contradictions),
  };

  const schemaValidation = validateScanReport(report);
  report.schema_validation = schemaValidation;
  if (!schemaValidation.valid) {
    throw new Error(`Generated scan report failed schema validation:\n${schemaValidation.errors.join('\n')}`);
  }

  return report;
}

async function walkProject(dir, context, options, relDir = '') {
  context.inventory.counts.directories_seen += 1;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    addEvidence(context, {
      category: 'risk_notes',
      severity: 'MEDIUM',
      confidence: 'confirmed',
      source_file: relDir || '.',
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: String(err.message ?? err),
      normalized_claim: `directory_unreadable:${relDir || '.'}`,
      evidence_type: 'filesystem_error',
      suggested_action: 'Check permissions or remove the unreadable directory from the scan target.',
      rationale: 'The scanner could not inspect this directory, so downstream conclusions may be incomplete.',
    });
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const rootEntryNames = relDir ? null : new Set(entries.map(entry => entry.name));

  for (const entry of entries) {
    const relPath = normalizePath(relDir ? `${relDir}/${entry.name}` : entry.name);
    const absPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const skipReason = await directorySkipReason(entry.name, relPath, absPath, context.projectRoot, options.outDir, context.ignoredPaths);
      if (skipReason) {
        context.inventory.skipped_files.push({ path: relPath, reason: skipReason });
        continue;
      }
      await walkProject(absPath, context, options, relPath);
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    context.inventory.counts.files_total += 1;
    const skipReason = fileSkipReason(relPath, rootEntryNames, context.ignoredPaths);
    if (skipReason) {
      context.inventory.counts.files_skipped += 1;
      context.inventory.skipped_files.push({ path: relPath, reason: skipReason });
      continue;
    }

    let fileStat;
    try {
      fileStat = entry.isSymbolicLink() ? await lstat(absPath) : await stat(absPath);
    } catch {
      context.inventory.counts.files_skipped += 1;
      context.inventory.skipped_files.push({ path: relPath, reason: 'stat_failed' });
      continue;
    }

    const important = isImportantFile(relPath, context.profile);
    const record = {
      path: relPath,
      size: fileStat.size,
      important,
      scanned: false,
      skipped_reason: null,
    };

    if (important) {
      context.inventory.important_files.push(relPath);
    }

    if (entry.isSymbolicLink()) {
      record.skipped_reason = 'symlink';
    } else if (fileStat.size > options.maxFileSize) {
      record.skipped_reason = `larger_than_${options.maxFileSize}`;
    } else if (!isLikelyTextPath(relPath)) {
      record.skipped_reason = 'non_text_extension';
    } else {
      record.scanned = true;
      context.inventory.counts.files_scanned += 1;
    }

    if (record.skipped_reason) {
      context.inventory.counts.files_skipped += 1;
      context.inventory.skipped_files.push({ path: relPath, reason: record.skipped_reason });
    }

    context.inventory.files.push(record);
  }
}

async function directorySkipReason(name, relPath, absPath, projectRoot, outDir, ignoredPaths) {
  if (EXCLUDED_DIRS.has(name)) {
    return 'excluded_directory';
  }

  if (isGeneratedScanCollectionDir(name) && await hasGeneratedScanSignature(absPath)) {
    return 'generated_scan_output_directory';
  }

  if (isGitIgnored(relPath, ignoredPaths)) {
    return 'git_ignored_directory';
  }

  if (!outDir) {
    return null;
  }

  const relOut = normalizePath(relative(projectRoot, outDir));
  return relOut && relOut !== '..' && !relOut.startsWith('../') && relPath === relOut
    ? 'scan_output_directory'
    : null;
}

function isGeneratedScanCollectionDir(name) {
  return GENERATED_SCAN_COLLECTION_DIR_PATTERNS.some(pattern => pattern.test(name));
}

async function hasGeneratedScanSignature(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  const names = new Set(entries.map(entry => entry.name));
  if (names.has('agent_handoff')) {
    return true;
  }
  for (const file of GENERATED_SCAN_SIGNATURE_FILES) {
    if (names.has(file)) {
      return true;
    }
  }
  return false;
}

function fileSkipReason(relPath, rootEntryNames, ignoredPaths) {
  if (isGitIgnored(relPath, ignoredPaths)) {
    return 'git_ignored_file';
  }

  if (relPath.includes('/')) {
    return null;
  }

  if (!ROOT_SCAN_ARTIFACT_FILES.has(relPath)) {
    return null;
  }

  if (relPath === 'summary.md' || relPath === 'compare_summary.md') {
    return rootEntryNames?.has('report.json') || rootEntryNames?.has('compare_report.json')
      ? 'generated_scan_artifact'
      : null;
  }

  return 'generated_scan_artifact';
}

function isGitIgnored(relPath, ignoredPaths) {
  if (!ignoredPaths) {
    return false;
  }

  return ignoredPaths.files.has(relPath)
    || ignoredPaths.dirs.has(relPath)
    || [...ignoredPaths.dirs].some(dir => relPath.startsWith(`${dir}/`));
}

function discoverGitIgnoredPaths(projectRoot) {
  let gitRoot;
  try {
    gitRoot = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return { files: new Set(), dirs: new Set(), source: 'no_git_repository' };
  }

  const pathspec = normalizePath(relative(gitRoot, projectRoot)) || '.';
  let output;
  try {
    output = execFileSync('git', [
      '-C',
      gitRoot,
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
      '--',
      pathspec,
    ], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return { files: new Set(), dirs: new Set(), source: 'git_ignore_unavailable' };
  }

  const files = new Set();
  const dirs = new Set();
  for (const rawItem of output.toString('utf8').split('\0')) {
    if (!rawItem) continue;
    const normalized = normalizePath(rawItem);
    const absPath = join(gitRoot, normalized);
    const relToProject = normalizePath(relative(projectRoot, absPath));
    if (!relToProject || relToProject === '.' || relToProject === '..' || relToProject.startsWith('../')) {
      continue;
    }

    if (normalized.endsWith('/')) {
      dirs.add(relToProject.replace(/\/$/, ''));
    } else {
      files.add(relToProject);
    }
  }

  return { files, dirs, source: 'git_exclude_standard' };
}

function isImportantFile(relPath, profile) {
  return profile.importantFilePatterns?.some(pattern => pattern.test(relPath)) ?? false;
}

function isLikelyTextPath(relPath) {
  const fileName = basename(relPath);
  if (TEXT_FILENAMES.has(fileName)) {
    return true;
  }
  if (/^fstab[._-]?/i.test(fileName)) {
    return true;
  }
  return TEXT_EXTENSIONS.has(extname(fileName).toLowerCase());
}

async function scanFile(file, context) {
  const absPath = join(context.projectRoot, denormalizePath(file.path));
  let buffer;
  try {
    buffer = await readFile(absPath);
  } catch (err) {
    addEvidence(context, {
      category: 'risk_notes',
      severity: 'MEDIUM',
      confidence: 'confirmed',
      source_file: file.path,
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: String(err.message ?? err),
      normalized_claim: `file_unreadable:${file.path}`,
      evidence_type: 'filesystem_error',
      suggested_action: 'Check permissions or remove the unreadable file from the scan target.',
      rationale: 'The scanner could not read this file.',
    });
    return;
  }

  if (looksBinary(buffer)) {
    file.scanned = false;
    file.skipped_reason = 'binary_content';
    context.inventory.counts.files_scanned -= 1;
    context.inventory.counts.files_skipped += 1;
    context.inventory.skipped_files.push({ path: file.path, reason: 'binary_content' });
    return;
  }

  const text = buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  scanFileLevelSignals(file, context);
  const lines = text.split('\n');
  const lineState = { configSection: null, markdownFence: false, runtimeDumpSection: null };
  for (let index = 0; index < lines.length; index += 1) {
    updateLineState(lines[index], file, lineState);
    scanLine(lines[index], index + 1, file, context, lineState);
  }
}

function updateLineState(line, file, state) {
  if (isMarkdownLikePath(file.path) && isMarkdownFenceLine(line)) {
    state.markdownFence = !state.markdownFence;
  }

  const trimmed = line.trim();
  const dumpEnd = trimmed.match(/^([A-Za-z0-9_.-]+)_END$/);
  if (dumpEnd && state.runtimeDumpSection === dumpEnd[1]) {
    state.runtimeDumpSection = null;
  }

  const dumpBegin = trimmed.match(/^([A-Za-z0-9_.-]+)_BEGIN$/);
  if (dumpBegin) {
    state.runtimeDumpSection = dumpBegin[1];
  }

  if (!isSectionedConfigFile(file.path)) {
    return;
  }

  const section = trimmed.match(/^\[([A-Za-z0-9_.-]+)]\s*$/);
  if (section) {
    state.configSection = section[1];
  }
}

function scanLine(line, lineNo, file, context, lineState = {}) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (lineState.markdownFence) {
    return;
  }

  const placeholder = trimmed.match(PLACEHOLDER_PATTERN);
  if (placeholder && !isPlaceholderExample(trimmed, placeholder[1], file.path)) {
    const marker = placeholder[1].toUpperCase();
    addEvidence(context, {
      category: marker === 'TODO' || marker === 'FIXME' || marker === 'STUB'
        ? 'todo_fixme_stub_markers'
        : 'placeholders',
      severity: file.important ? 'HIGH' : 'MEDIUM',
      confidence: 'likely',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: trimmed,
      normalized_claim: `placeholder_marker:${marker}`,
      evidence_type: 'source_line',
      suggested_action: 'Resolve the marker or document why it is safe to leave in place.',
      rationale: 'Unresolved markers in bring-up trees often preserve copied assumptions or unfinished device-specific work.',
      related_symbols: [marker],
    });
  }

  scanRiskyLeftovers(line, lineNo, file, context);
  scanAssignment(line, lineNo, file, context, lineState);
  scanPaths(line, lineNo, file, context);
  scanInitRc(line, lineNo, file, context);
  scanFstab(line, lineNo, file, context);
  scanVendorBlobList(line, lineNo, file, context);
  scanKeywordFamilies(line, lineNo, file, context);
  scanRuntimeKeywordFamilies(line, lineNo, file, context);
  scanPCGamingWikiKeywordFamilies(line, lineNo, file, context);
  scanWidescreenFramegenKeywordFamilies(line, lineNo, file, context);
  scanExePatchKeywordFamilies(line, lineNo, file, context);
  scanWindowsKeywordFamilies(line, lineNo, file, context);
  scanAgenticToolchainKeywordFamilies(line, lineNo, file, context);
  scanSemanticPolicyClaims(line, lineNo, file, context, lineState);
}

function isPlaceholderExample(line, marker, filePath = '') {
  const normalizedMarker = marker.toUpperCase();
  const trimmed = line.trim();

  if (isActionablePlaceholderMarker(trimmed, normalizedMarker)) {
    return false;
  }

  if (isSourceCodePlaceholderLiteralFalsePositive(trimmed, filePath)) {
    return true;
  }

  if (/placeholder_marker:[A-Z ]+/.test(trimmed)) {
    return true;
  }

  if (/\b(?:placeholder|todo|fixme|stub|wip)\b.{0,48}\b(?:markers?|tokens?|detected|examples?|vocabulary|scanner|profile)\b/i.test(trimmed)) {
    return true;
  }

  if (/\b(?:markers?|tokens?|examples?|vocabulary|scanner|profile)\b.{0,48}\b(?:placeholder|todo|fixme|stub|wip)\b/i.test(trimmed)) {
    return true;
  }

  if (/\bunresolved\s+TODO\s+marker\b/i.test(trimmed)) {
    return true;
  }

  if (/\b(?:old|older|stale|historic|historical)\s+(?:comment|note)\s+or\s+TODO\b/i.test(trimmed)) {
    return true;
  }

  if (/\bWIP\s+(?:repos?|trees?|branches?|worktrees?)\b/i.test(trimmed)
    || /\b(?:repos?|trees?|branches?|worktrees?)\b.{0,32}\bWIP\b/i.test(trimmed)) {
    return true;
  }

  if (normalizedMarker !== 'XXX') {
    return false;
  }

  return /(?:^|[^A-Za-z0-9])(?:[A-Z][A-Z0-9-]*-)?XXX(?:[^A-Za-z0-9]|$)/.test(trimmed)
    && /<[^>]*XXX[^>]*>|[A-Z][A-Z0-9-]*-XXX/.test(trimmed);
}

function isActionablePlaceholderMarker(line, marker) {
  if (!['TODO', 'FIXME', 'STUB', 'HACK', 'TBD', 'WIP'].includes(marker)) {
    return false;
  }
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:[-*]\\s*)?(?://|#|/\\*|\\*)?\\s*${escaped}\\b(?:\\s*[:(-]|\\s+[A-Za-z0-9])`, 'i').test(line);
}

function scanFileLevelSignals(file, context) {
  if (!isAgenticToolchainProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /(^|\/)(AGENTS|CLAUDE|WARP)\.md$/i,
      category: 'agent_instruction_surface',
      severity: 'HIGH',
      claim: `agent_instruction_file:${file.path}`,
      action: 'Treat this file as an authoritative local agent instruction source and compare it against generated engine templates.',
      rationale: 'Agent instruction files define durable workflow, safety, and verification behavior for the toolchain.',
    },
    {
      pattern: /(^|\/).*SKILL\.md$/i,
      category: 'agent_skill_contracts',
      severity: 'MEDIUM',
      claim: `skill_contract_file:${file.path}`,
      action: 'Verify frontmatter, required references, and progressive-disclosure boundaries before importing the skill.',
      rationale: 'Skills are executable workflow contracts; missing metadata or broad imports create brittle agent behavior.',
    },
    {
      pattern: /(^|\/).*hooks?(\.json|\.ya?ml|\.md|\.py|\.sh)?$/i,
      category: 'hook_lifecycle_policy',
      severity: 'MEDIUM',
      claim: `hook_policy_file:${file.path}`,
      action: 'Map hook event, trigger scope, and allowed side effects before enabling it.',
      rationale: 'Hook files can change runtime behavior before or after tool use and need explicit policy boundaries.',
    },
    {
      pattern: /(^|\/).*settings.*\.(json|toml|ya?ml)$/i,
      category: 'permission_safety_policy',
      severity: 'HIGH',
      claim: `settings_policy_file:${file.path}`,
      action: 'Check permission, sandbox, and tool allow/deny settings before adopting this config.',
      rationale: 'Agent settings can widen filesystem, shell, network, or tool permissions.',
    },
    {
      pattern: /(^|\/).*(memory|context|transcript).*$/i,
      category: 'memory_context_injection',
      severity: 'MEDIUM',
      claim: `memory_context_file:${file.path}`,
      action: 'Verify memory provenance, compaction boundaries, and injection scope.',
      rationale: 'Persistent context is useful only when provenance and scope are explicit.',
    },
    {
      pattern: /(^|\/).*(mcp|plugins?)(\/|$|.*\.(md|json|toml|ya?ml|py|ts|js)$)/i,
      category: 'mcp_plugin_surface',
      severity: 'MEDIUM',
      claim: `mcp_plugin_file:${file.path}`,
      action: 'Identify connector/plugin boundary, credentials, and external API assumptions before reuse.',
      rationale: 'MCP and plugin files often cross process or service boundaries.',
    },
    {
      pattern: /(^|\/)(restored-src|.*cli\.js\.map|.*sourcemap.*)(\/|$)/i,
      category: 'proprietary_source_risk',
      severity: 'HIGH',
      claim: `proprietary_source_candidate:${file.path}`,
      action: 'Use as reference-only evidence unless license provenance explicitly permits copying.',
      rationale: 'Restored, sourcemap, decompiled, or proprietary source can contaminate an otherwise clean import lane.',
    },
  ];

  for (const check of checks) {
    if (!check.pattern.test(file.path)) {
      continue;
    }
    addEvidence(context, {
      category: check.category,
      severity: check.severity,
      confidence: 'likely',
      source_file: file.path,
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: file.path,
      normalized_claim: check.claim,
      related_paths: [file.path],
      evidence_type: 'file_inventory',
      suggested_action: check.action,
      rationale: check.rationale,
    });
  }
}

function scanRiskyLeftovers(line, lineNo, file, context) {
  if (isSourceCodePolicyLiteralFalsePositive(line, file.path)
    || isSourceCodePlaceholderLiteralFalsePositive(line, file.path)
    || isAuxiliarySourcePath(file.path)
    || normalizePath(file.path).startsWith('test/')) {
    return;
  }

  const lower = line.toLowerCase();
  const seen = new Set();
  for (const token of context.profile.riskyLeftovers ?? []) {
    const needle = token.toLowerCase();
    if (!needle || seen.has(needle) || !lower.includes(needle)) {
      continue;
    }
    seen.add(needle);
    addEvidence(context, {
      category: 'likely_copy_paste_leftovers',
      severity: /sm\d|rm\d|kona|kalama|lahaina|taro|pineapple|waipio/i.test(token) ? 'HIGH' : 'MEDIUM',
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `risky_leftover:${token}`,
      related_symbols: [token],
      evidence_type: 'source_line',
      suggested_action: 'Verify this token against known-good device facts before keeping it.',
      rationale: 'Profile-specific leftover tokens are common sources of wrong target identity, platform, or copied configuration.',
    });
  }
}

function scanAssignment(line, lineNo, file, context, lineState = {}) {
  const match = line.match(ASSIGNMENT_PATTERN);
  if (!match) {
    return;
  }

  const key = match[1].trim();
  const operator = match[2];
  const rawValue = stripInlineComment(match[3]).trim();
  if (!rawValue) {
    return;
  }

  let category = categorizeAssignment(key, rawValue, context.profile);
  const localCodeAssignment = isLocalCodeAssignment(key, file.path);
  const preserveProfileCategory = shouldPreserveLocalAssignmentCategory(category, context.profile, key, file.path);
  if (!preserveProfileCategory
    && (localCodeAssignment || (category === 'build_variables' && !isProjectLevelAssignment(key, file.path)))) {
    category = 'local_code_assignments';
  }

  const normalizedValue = normalizeAssignmentValue(rawValue);
  const claimKey = scopedAssignmentKey(key, file.path, lineState, category);
  const evidence = addEvidence(context, {
    category,
    severity: severityForAssignment(key, category),
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: line.trim(),
    normalized_claim: `${claimKey}=${normalizedValue}`,
    assignment_operator: operator,
    related_paths: extractPathTokens(rawValue),
    related_symbols: [key],
    related_build_vars: category === 'local_code_assignments' || key.startsWith('ro.') ? [] : [key],
    related_device_props: key.startsWith('ro.') ? [key] : [],
    evidence_type: 'source_line',
    suggested_action: category === 'local_code_assignments'
      ? 'Treat this as local code state unless another scanner rule promotes it.'
      : operator === '+='
        ? 'Track this as an additive build-list entry; inspect ordering only if the accumulated list itself fails.'
      : 'Compare this value against other definitions and known-good device facts.',
    rationale: category === 'local_code_assignments'
      ? 'Lowercase/local assignments in code are useful context but should not become cross-file contradictions.'
      : operator === '+='
        ? 'Append assignments add to an accumulated list and should not be treated as mutually exclusive definitions.'
      : 'Build variables and device properties define the assumptions that recovery and bring-up outputs inherit.',
  });

  for (const pathRef of extractPathTokens(rawValue)) {
    rememberPathReference(context, pathRef, file.path, lineNo, line.trim(), evidence.id, category);
  }
}

function scopedAssignmentKey(key, filePath, lineState, category) {
  const nebulaScope = nebulaRuntimeAssignmentScope(key, filePath, lineState, category);
  if (nebulaScope) {
    return `nebula.${nebulaScope}.${key}`;
  }

  if (category !== 'build_variables') {
    return key;
  }

  if (!lineState.configSection || !isSectionedConfigFile(filePath)) {
    return key;
  }

  if (!/^[a-z][a-z0-9_-]*$/.test(key)) {
    return key;
  }

  return `${lineState.configSection}.${key}`;
}

function nebulaRuntimeAssignmentScope(key, filePath, lineState, category) {
  if (!isNebulaLayeredRuntimeKey(key, category)) {
    return null;
  }

  const normalizedPath = normalizePath(filePath).toLowerCase();
  const section = String(lineState.runtimeDumpSection ?? '').toUpperCase();

  if (/^CHILD_/.test(key)
    || section.startsWith('CHILD')
    || section.includes('GLXINFO')
    || section.includes('GLXGEARS')
    || normalizedPath.includes('child-env')
    || normalizedPath.includes('child.meta')
    || normalizedPath.includes('glxinfo')) {
    return 'child';
  }

  if (/^BRIDGE_/.test(key) || section.startsWith('BRIDGE') || normalizedPath.includes('bridge.')) {
    return 'bridge';
  }

  if (/^XWAYLAND_/.test(key) || section.startsWith('XWAYLAND') || normalizedPath.includes('xwayland')) {
    return 'xwayland';
  }

  if (/^GAMESCOPE_/.test(key)
    || section.startsWith('GAMESCOPE')
    || section === 'ENVIRONMENT'
    || section === 'LIBPATHS'
    || section === 'EXPORT_CONTEXT'
    || normalizedPath.includes('gamescope')
    || normalizedPath.endsWith('environment.txt')
    || normalizedPath.endsWith('-env.txt')
    || normalizedPath.endsWith('env.txt')
    || normalizedPath.endsWith('result.txt')) {
    return 'gamescope';
  }

  return null;
}

function isNebulaLayeredRuntimeKey(key, category) {
  if (category !== 'mobile_linux_runtime'
    && category !== 'vulkan_loader'
    && category !== 'nebula_runtime_regression'
    && category !== 'ld_library_path_linker_namespace_issues'
    && category !== 'build_variables') {
    return false;
  }

  return /^(MESA_|GALLIUM_DRIVER|FD_FORCE_KGSL|LIBGL_|VK_ICD_FILENAMES|VK_DRIVER_FILES|TU_DEBUG|GBM_BACKENDS_PATH|__EGL_VENDOR_LIBRARY_FILENAMES|WAYLAND_DISPLAY|WAYLAND_SOCKET|XDG_RUNTIME_DIR|GAMESCOPE_|BRIDGE_|CHILD_|XWAYLAND_|FASTTEST02_)/.test(key);
}

function scanPaths(line, lineNo, file, context) {
  const paths = extractPathTokens(line);
  for (const pathRef of paths) {
    const absoluteDevicePath = pathRef.startsWith('/');
    const category = /(^|\/)lib(64)?\/|\.so(\.|$)|LD_LIBRARY_PATH/.test(line)
      ? 'library_paths'
      : absoluteDevicePath
        ? 'suspicious_hardcoded_paths'
        : null;

    if (category) {
      const evidence = addEvidence(context, {
        category,
        severity: absoluteDevicePath ? 'MEDIUM' : 'LOW',
        confidence: 'possible',
        source_file: file.path,
        source_line_start: lineNo,
        source_line_end: lineNo,
        extracted_text: line.trim(),
        normalized_claim: `path_reference:${pathRef}`,
        related_paths: [pathRef],
        evidence_type: 'source_line',
        suggested_action: 'Verify whether this path is host, source-tree, or target-device scoped.',
        rationale: 'Hardcoded or ambiguous paths are fragile in recovery and container bring-up work.',
      });
      rememberPathReference(context, pathRef, file.path, lineNo, line.trim(), evidence.id, category);
      continue;
    }

    rememberPathReference(context, pathRef, file.path, lineNo, line.trim(), null, 'path_reference');
  }
}

function scanInitRc(line, lineNo, file, context) {
  if (!/\.rc$/i.test(file.path)) {
    return;
  }

  const match = line.match(/^\s*service\s+([A-Za-z0-9_.:-]+)\s+(\S+)/);
  if (!match) {
    return;
  }

  const serviceName = match[1];
  const binaryPath = cleanPathToken(match[2]);
  const evidence = addEvidence(context, {
    category: 'init_rc_services',
    severity: 'HIGH',
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: line.trim(),
    normalized_claim: `init_service:${serviceName}->${binaryPath}`,
    related_paths: [binaryPath],
    related_symbols: [serviceName],
    evidence_type: 'source_line',
    suggested_action: 'Verify that the service binary exists in the recovery root or target image.',
    rationale: 'Init service references fail at runtime when the binary path is wrong or the blob is missing.',
  });
  rememberPathReference(context, binaryPath, file.path, lineNo, line.trim(), evidence.id, 'init_rc_services');
}

function scanFstab(line, lineNo, file, context) {
  const isFstabFile = /(^|\/).*fstab/i.test(file.path);
  const trimmed = line.trim();
  if (isCommentOnlyFstabCandidate(trimmed)) {
    return;
  }

  const fstabLikeLine = /^\s*(\/dev\/block|system|vendor|product|odm|metadata|data|cache|\/)/.test(line)
    && /\s\/[A-Za-z0-9_/.-]+\s/.test(line);
  if (!isFstabFile && fstabLikeLine && !isAndroidRecoveryLikeProfile(context.profile)) {
    return;
  }

  if (!isFstabFile && !fstabLikeLine) {
    return;
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length < 2) {
    return;
  }

  addEvidence(context, {
    category: 'fstab_entries',
    severity: 'HIGH',
    confidence: isFstabFile ? 'likely' : 'possible',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: line.trim(),
    normalized_claim: `fstab:${fields[0]}->${fields[1]}`,
    related_paths: [fields[0], fields[1]].filter(Boolean),
    evidence_type: 'source_line',
    suggested_action: 'Compare partition names, mount points, fs types, and flags against observed device data.',
    rationale: 'Recovery boot and decrypt behavior depends heavily on correct fstab assumptions.',
  });

  if (!/^\/dev\/block\/by-name\/[A-Za-z0-9_.-]+$/.test(fields[0]) && /^\/dev\/block/.test(fields[0])) {
    addEvidence(context, {
      category: 'fstab_entries',
      severity: 'MEDIUM',
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `fstab_suspicious_block:${fields[0]}`,
      related_paths: [fields[0]],
      evidence_type: 'source_line',
      suggested_action: 'Verify the block-device naming against observed recovery partition links.',
      rationale: 'Android recovery device trees usually use stable by-name partition paths; raw block paths are more fragile.',
    });
  }
}

function scanVendorBlobList(line, lineNo, file, context) {
  if (!/(^|\/)(vendor-files|proprietary-files).*\.txt$/i.test(file.path)) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return;
  }

  const localRef = cleanPathToken(trimmed.split(':')[0].replace(/^-/, ''));
  if (!localRef) {
    return;
  }

  const evidence = addEvidence(context, {
    category: 'vendor_blobs',
    severity: 'MEDIUM',
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: trimmed,
    normalized_claim: `vendor_blob:${localRef}`,
    related_paths: [localRef],
    evidence_type: 'source_line',
    suggested_action: 'Verify the listed blob exists in the extracted vendor source or is intentionally provided elsewhere.',
    rationale: 'Vendor blob lists are build contracts; stale entries cause extraction, build, or runtime failures.',
  });
  rememberPathReference(context, localRef, file.path, lineNo, trimmed, evidence.id, 'vendor_blobs');
}

function scanKeywordFamilies(line, lineNo, file, context) {
  const checks = [
    {
      pattern: /\b(AVB|vbmeta|verity|hashtree|BOARD_AVB)\b/i,
      category: 'avb_vbmeta_assumptions',
      severity: 'HIGH',
      action: 'Validate AVB/vbmeta behavior against observed boot/recovery images.',
      rationale: 'Wrong AVB or vbmeta assumptions can block boot, flashing, or recovery startup.',
    },
    {
      pattern: /\b(keymaster|keymint|gatekeeper|qsee|decrypt|FBE|FDE|metadata_encryption)\b/i,
      category: 'keymaster_keymint_gatekeeper_decrypt_dependencies',
      severity: 'HIGH',
      action: 'Verify required decrypt/security blobs and services exist for the target build.',
      rationale: 'Decrypt support depends on matching security HALs, properties, and init services.',
    },
    {
      pattern: /\b(display|touch|framebuffer|fb0|drm|kgsl|panel|brightness|rotation)\b/i,
      category: 'display_touch_framebuffer_config',
      severity: 'MEDIUM',
      action: 'Check display and input assumptions against real recovery behavior.',
      rationale: 'Display and touch mismatches are common recovery usability blockers.',
    },
    {
      pattern: /\b(LD_LIBRARY_PATH|linker|namespace|ld\.config|ld\.so)\b/i,
      category: 'ld_library_path_linker_namespace_issues',
      severity: 'HIGH',
      action: 'Verify linker namespace and library search path behavior on the target runtime.',
      rationale: 'Wrong library lookup assumptions often surface as late runtime failures.',
    },
  ];

  for (const check of checks) {
    if (!check.pattern.test(line)) {
      continue;
    }
    addEvidence(context, {
      category: check.category,
      severity: check.severity,
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `${check.category}:${line.trim().slice(0, 160)}`,
      related_paths: extractPathTokens(line),
      evidence_type: 'source_line',
      suggested_action: check.action,
      rationale: check.rationale,
    });
  }

  if (/\b(PRODUCT_COPY_FILES|vendor|proprietary-files|extract-files|\.so\b|firmware)\b/i.test(line)) {
    addEvidence(context, {
      category: 'vendor_blobs',
      severity: 'MEDIUM',
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `vendor_blob_reference:${line.trim().slice(0, 160)}`,
      related_paths: extractPathTokens(line),
      evidence_type: 'source_line',
      suggested_action: 'Verify blob source paths and target install paths against the extracted vendor set.',
      rationale: 'Missing or stale vendor blob references often produce build or runtime failures.',
    });
  }
}

function scanRuntimeKeywordFamilies(line, lineNo, file, context) {
  if (!isRuntimeProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /\b(BlackOps3(?:\.exe)?|BO3Enhanced|T7Patch|t7patch|Steam AppID\s*311210|steam_appid\.txt|AppID\s*=?\s*311210)\b/i,
      category: 'game_runtime_identity',
      severity: 'MEDIUM',
      action: 'Verify the executable, distribution, app ID, and target build before deriving compatibility claims.',
      rationale: 'Game runtime analysis depends on exact build and distribution identity; copied notes are not enough evidence.',
    },
    {
      pattern: /\b(MaxFPS|SmoothFramerate|MaxFrameLatency|BackbufferCount|VideoMemory|StreamMinResident|RestrictGraphicsOptions|com_maxfps|r_(?:mode|fullscreen|vsync|display)|vid_)\b/i,
      category: 'bo3_config',
      severity: 'MEDIUM',
      action: 'Compare gameplay and renderer config values against the intended private co-op profile.',
      rationale: 'Frame pacing, texture streaming, and renderer limits are high-signal settings for old-game stability work.',
    },
    {
      pattern: /\b(DXVK|VKD3D|d3dcompiler_46\.dll|d3d11\.dll|dxgi\.dll|dinput8\.dll|winmm\.dll|version\.dll|ReShade|SpecialK|3DMigoto|ASI Loader|Reloaded|SUWSF|OptiScaler|nvngx_dlssg|DLSS|FSR|XeSS)\b/i,
      category: 'graphics_wrapper_chain',
      severity: 'MEDIUM',
      action: 'Inventory wrapper DLLs, load order, and compatibility notes before changing runtime files.',
      rationale: 'Wrapper chains are fragile: multiple overlays, upscalers, or DLL proxies can conflict even when each piece is valid alone.',
    },
    {
      pattern: /\b(VK_ICD_FILENAMES|VK_DRIVER_FILES|VK_LOADER_DEBUG|VK_INSTANCE_LAYERS|libvulkan_[a-z0-9_]+\.so|vk_icdNegotiateLoaderICDInterfaceVersion|ERROR_INCOMPATIBLE_DRIVER|api_version|ICD\.library_path)\b/i,
      category: 'vulkan_loader',
      severity: 'HIGH',
      action: 'Validate Vulkan loader variables, ICD JSON, and driver negotiation evidence before changing wrapper settings.',
      rationale: 'Vulkan loader and ICD mismatches commonly produce wrapper failures that look like game or mod bugs.',
    },
    {
      pattern: /\b(RCE|remote code execution|crash exploit|network password|lobby password|friends only|private match|private co-?op|security patch|exploit mitigation)\b/i,
      category: 'runtime_security_surface',
      severity: 'HIGH',
      action: 'Treat this as security-context evidence and require direct validation before recommending runtime changes.',
      rationale: 'Private co-op stability and exploit-mitigation notes affect trust boundaries, not just launch convenience.',
    },
    {
      pattern: /\b(stutter|frame pacing|shader cache|fps drops?|CPU spike|VRAM|texture streaming|hitch(?:ing)?|frametime|framegen|frame generation)\b/i,
      category: 'performance_symptoms',
      severity: 'MEDIUM',
      action: 'Tie the symptom to a reproducible config, wrapper, driver, or log artifact before tuning values.',
      rationale: 'Performance reports are useful only when anchored to a specific runtime state that can be reproduced.',
    },
    {
      pattern: /\b(IDXGISwapChain(?:::(?:Present1?|ResizeBuffers))?|Present1?|ResizeBuffers|CreateSwapChain|D3D11CreateDevice|ID3D11Device|ID3D11DeviceContext|DXGI_SWAP_CHAIN|swapchain hook|present hook)\b/i,
      category: 'render_hook_surface',
      severity: 'HIGH',
      action: 'Map hook targets to a specific API, swapchain, and load order before writing plugin code.',
      rationale: 'Frame timing, HDR, and texture replacement all depend on the exact render surface being observed or wrapped.',
    },
    {
      pattern: /\b(TargetFrameTimeMs|FramerateLimit|WaitableSwapChain|LowLatencyMode|MaxFrameLatency|present interval|sleep granularity|busy wait|frame limiter|latency limiter)\b/i,
      category: 'frame_timing_control',
      severity: 'HIGH',
      action: 'Validate limiter behavior against measured frametime evidence before changing game or wrapper timing.',
      rationale: 'A limiter can improve pacing or make it worse depending on swapchain mode, timer resolution, and wrapper stack.',
    },
    {
      pattern: /\b(TextureInjection|ReplacementManifest|texture manifest|CreateTexture2D|UpdateSubresource|PSSetShaderResources|DDS|BC7|BC3|BC1|mipmaps?|sRGB|texture hash|replacement texture)\b/i,
      category: 'texture_injection_pipeline',
      severity: 'MEDIUM',
      action: 'Validate replacement manifests, formats, hashes, and mip levels before enabling texture injection.',
      rationale: 'Texture injection failures often come from format, color space, mipmap, or hash mismatches rather than the hook itself.',
    },
    {
      pattern: /\b(HDR10|scRGB|PQ|Perceptual Quantizer|Rec\.?2020|DXGI_COLOR_SPACE|SetHDRMetaData|R10G10B10A2|R16G16B16A16_FLOAT|tonemap|paper white|nits)\b/i,
      category: 'hdr_pipeline',
      severity: 'HIGH',
      action: 'Tie HDR mode to swapchain format, color space, metadata, and display capability evidence.',
      rationale: 'HDR injection is sensitive to color space and swapchain format; wrong assumptions can wash out or clip the image.',
    },
    {
      pattern: /\b(D3D11On12|D3D12|D3D11|D3D9|DXGI|OpenGL|Vulkan|DXVK|VKD3D|WineD3D|ANGLE|APITranslation|api translation|wrapper api)\b/i,
      category: 'api_translation_layer',
      severity: 'MEDIUM',
      action: 'Record the selected graphics API path and wrapper before comparing behavior across devices.',
      rationale: 'The same plugin feature can behave differently across native D3D, DXVK, VKD3D, WineD3D, and mobile Vulkan paths.',
    },
    {
      pattern: /\b(RM11Pro|Red Magic|Adreno|Turnip|Mesa|Freedreno|Termux|proot|chroot|box64|box86|Wine|Winlator|Mobox|FEX|VK_DRIVER_FILES|TU_DEBUG|MESA_VK_WSI_PRESENT_MODE)\b/i,
      category: 'mobile_linux_runtime',
      severity: 'HIGH',
      action: 'Separate phone/Linux runtime assumptions from desktop Windows assumptions and validate Vulkan driver selection.',
      rationale: 'RM11Pro gaming depends on container, translation, driver, and display layers that can diverge sharply from desktop behavior.',
    },
  ];

  for (const check of checks) {
    const match = line.match(check.pattern);
    if (!match) {
      continue;
    }

    addEvidence(context, {
      category: check.category,
      severity: check.severity,
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `${check.category}:${line.trim().slice(0, 160)}`,
      related_paths: extractPathTokens(line),
      related_symbols: uniq([match[1] ?? match[0]].filter(Boolean)),
      evidence_type: 'source_line',
      suggested_action: check.action,
      rationale: check.rationale,
    });
  }

  const safetyTerm = findSafetyBoundaryTerm(line);
  if (!safetyTerm) {
    return;
  }

  addEvidence(context, {
    category: 'safety_boundaries',
    severity: 'HIGH',
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: line.trim(),
    normalized_claim: `safety_boundary:${safetyTerm}`,
    related_symbols: [safetyTerm],
    evidence_type: 'source_line',
    suggested_action: 'Keep Reversa-Matrix to evidence mapping and legitimate configuration/modding workflows; do not implement bypass, cheat, public-match, or ownership-evasion behavior.',
    rationale: 'This term can indicate anti-cheat, DRM, public-match, or ownership-evasion functionality and must be handled as a hard review boundary.',
  });
}

function scanPCGamingWikiKeywordFamilies(line, lineNo, file, context) {
  if (!isPCGamingWikiLikeProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /\b(Configuration file(?:\(s\))? location|Save game data location|Game data|Cloud sync|Steam Cloud|XDG_(?:DATA|CONFIG|CACHE)_HOME|AppData|Saved Games|Documents\\|compatdata\/[0-9]+|pfx\/drive_c|user\.reg)\b/i,
      category: 'pcgw_game_data_paths',
      severity: 'HIGH',
      action: 'Classify game config/save/cloud paths by platform and verify whether each path is native Windows, Wine/Proton, or Linux/XDG scoped.',
      rationale: 'PC game fixes often fail because native Windows, Wine prefix, Proton compatdata, and Linux XDG paths are mixed together.',
    },
    {
      pattern: /\b(Availability|DRM|Steam|GOG(?:\.com)?|Epic Games Store|Microsoft Store|Xbox app|EA app|Ubisoft Connect|version differences?|DLC|expansion packs?|demo|free trial|product id|Steam AppID|AppID\s*=?\s*[0-9]+)\b/i,
      category: 'pcgw_availability_drm',
      severity: 'MEDIUM',
      action: 'Separate store/version/DRM facts from runtime fixes and verify product IDs before applying store-specific instructions.',
      rationale: 'PCGamingWiki-style fixes are often edition-specific; store, DRM, and version differences change paths and executable behavior.',
    },
    {
      pattern: /\b(Video|Field of View|FOV|ultrawide|widescreen|multi-monitor|resolution|borderless|fullscreen|V-?Sync|triple buffering|high frame rate|FPS|stutter|frame rate|HDR|DLSS|FSR|XeSS|ray[- ]tracing|sharpening|draw distance)\b/i,
      category: 'pcgw_video_display_fixes',
      severity: 'MEDIUM',
      action: 'Tie display fix notes to API, config file, wrapper, and validation evidence before applying them.',
      rationale: 'Display fixes depend on API, renderer, config location, and wrapper stack; copied values can break other editions or platforms.',
    },
    {
      pattern: /\b(Input|controller|button prompts?|keyboard|mouse|raw input|Audio|EAX|OpenAL|FMOD|Wwise|Network|Multiplayer|co-?op|LAN|ports?|UDP|TCP|NAT|VR support|OpenXR|OpenVR)\b/i,
      category: 'pcgw_input_audio_network',
      severity: 'MEDIUM',
      action: 'Record input/audio/network/VR claims separately from graphics fixes and validate ports or middleware before changing launch profiles.',
      rationale: 'PCGW-style pages group non-graphics fixes separately; mixing them into graphics runtime changes hides real blockers.',
    },
    {
      pattern: /\b(API|Middleware|Direct3D|D3D9|D3D10|D3D11|D3D12|DirectX|OpenGL|Vulkan|Mantle|Glide|Bink|RAD Game Tools|PhysX|Havok|Steamworks|EOS|Easy Anti-Cheat|BattlEye)\b/i,
      category: 'pcgw_api_middleware',
      severity: 'HIGH',
      action: 'Inventory API and middleware claims before choosing wrappers, launch options, or Linux compatibility layers.',
      rationale: 'API and middleware identify the actual runtime boundary that fixes, wrappers, and compatibility layers must target.',
    },
    {
      pattern: /\b(Linux|Steam Deck|SteamOS|Wine|Proton|GE-Proton|Proton Experimental|WINEPREFIX|WINEDLLOVERRIDES|PROTON_LOG|PROTON_USE_WINED3D|DXVK|VKD3D|Gamescope|gamemoderun|MangoHud|Lutris|Heroic|Bottles|XDG|Wayland|X11)\b/i,
      category: 'pcgw_linux_wine_proton',
      severity: 'HIGH',
      action: 'Keep Linux/Wine/Proton fix evidence in its own lane and verify prefix, launch options, wrapper stack, and Vulkan loader state.',
      rationale: 'PCGamingWiki includes Linux gaming fixes; Proton and Wine paths can look like Windows paths but obey different runtime rules.',
    },
    {
      pattern: /\b(Essential improvements|Issues fixed|Issues unresolved|Crash to desktop|crash at startup|hang|freeze|stuttering|FPS drops?|not responsive|microphone gain|skip intro|loading speed|command line arguments|INI settings|fix(?:es)?|workaround)\b/i,
      category: 'pcgw_issue_fix_notes',
      severity: 'MEDIUM',
      action: 'Link each fix note to a reproducible symptom, platform, config file, and rollback path before recommending it.',
      rationale: 'Fix lists are useful triage maps, but each fix must be scoped to the exact edition, platform, and runtime stack.',
    },
  ];

  addKeywordEvidence(checks, line, lineNo, file, context);
}

function scanWidescreenFramegenKeywordFamilies(line, lineNo, file, context) {
  if (!isWidescreenFramegenLikeProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /\b(Flawless Widescreen|WSGF|Widescreen Gaming Forum|SUWSF|ultrawide|super ultrawide|widescreen|21:9|32:9|48:9|Hor\+|Vert-|pillarbox|letterbox|black bars|aspect ratio|FOV|field of view|HUD safe area|HUD fix|camera culling|hex edit)\b/i,
      category: 'widescreen_fix_surface',
      severity: 'HIGH',
      action: 'Separate FOV/aspect/HUD fix evidence by game, API, platform, and runtime before applying widescreen patches.',
      rationale: 'Flawless Widescreen-style fixes often touch memory, camera, HUD, or aspect-ratio assumptions that differ across game builds and compatibility layers.',
    },
    {
      pattern: /\b(frame generation|FrameGeneration|DLSSG|DLSS Frame Generation|FSR[-_ ]?(?:FG|Frame Generation)|FSR ?3|FSR ?4|XeFG|XeSS Frame Generation|OptiScaler|OptiFG|Lossless Scaling|LSFG|AFMF|Streamline|sl\.interposer|nvngx_dlssg|sl\.dlss_g|Reflex|Anti-?Lag)\b/i,
      category: 'frame_generation_pipeline',
      severity: 'HIGH',
      action: 'Inventory frame-generation provider, proxy DLL/layer, upscaler path, and latency companion before changing runtime files.',
      rationale: 'Frame generation is a multi-part pipeline; wrong provider or load order can look like a game bug, wrapper bug, or driver bug.',
    },
    {
      pattern: /\b(nvngx_dlssg\.dll|sl\.dlss_g\.dll|sl\.interposer\.dll|dxgi\.dll|winmm\.dll|version\.dll|dinput8\.dll|d3d12\.dll|HUDless|OptiScaler\.ini|OptiFG|Reflex|NVIDIA Reflex|Anti-?Lag|Windows Graphics Capture|AFMF)\b/i,
      category: 'framegen_windows_runtime',
      severity: 'HIGH',
      action: 'Check native Windows DLL/proxy load order, overlay conflicts, latency settings, and rollback path before enabling frame generation.',
      rationale: 'Windows frame-generation fixes usually depend on DLL proxy order, Streamline/DLSSG files, overlays, and driver control-panel state.',
    },
    {
      pattern: /\b(lsfg-vk|ENABLE_LSFG|VK_LAYER|Vulkan layer|Lossless Scaling on Linux|Proton|Wine|DXVK|VKD3D|Gamescope|MangoHud|Steam Deck|SteamOS|Wayland|X11|WINEPREFIX|PROTON_LOG)\b/i,
      category: 'framegen_linux_runtime',
      severity: 'HIGH',
      action: 'Keep Linux/Proton frame-generation layer evidence separate from native Windows DLL evidence and verify Vulkan loader/layer selection.',
      rationale: 'Linux frame-generation paths often run through Proton, DXVK/VKD3D, Gamescope, and Vulkan layers rather than native Windows proxy DLL loading.',
    },
  ];

  addKeywordEvidence(checks, line, lineNo, file, context);
}

function scanExePatchKeywordFamilies(line, lineNo, file, context) {
  if (!isExePatchProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /\b(TargetExe|TargetExePath|\.exe\b|executable patch|binary patch|offline patch|private co-?op patch|single-player patch|PatchId|PatchScope)\b/i,
      category: 'exe_patch_surface',
      severity: 'HIGH',
      action: 'Confirm target executable identity, game build, platform, and offline/private scope before treating this as a patch candidate.',
      rationale: 'Executable patching must be scoped to the exact binary and legitimate offline modding use case before any byte-level change is considered.',
    },
    {
      pattern: /\b(FileVersion|ProductVersion|SteamBuildId|GOG build|SHA256Before|SHA256After|CRC32Before|CRC32After|PEMachine|PETimestamp|TimeDateStamp)\b/i,
      category: 'exe_version_hash_guard',
      severity: 'HIGH',
      action: 'Require version and hash guards before applying or recommending any executable patch manifest.',
      rationale: 'Offsets and byte signatures drift between builds; hash guards prevent applying a patch to the wrong executable.',
    },
    {
      pattern: /\b(RVA|VA|FileOffset|offset|OriginalBytes|PatchedBytes|AOBSignature|AOB|signature scan|pattern scan|wildcards?|mask|module base)\b/i,
      category: 'exe_rva_signature_mapping',
      severity: 'HIGH',
      action: 'Cross-check RVA, file offset, original bytes, patched bytes, and AOB signature against the guarded executable build.',
      rationale: 'Executable patches are only reproducible when location, original bytes, replacement bytes, and signature evidence agree.',
    },
    {
      pattern: /\b(x64dbg|Ghidra|IDA|Binary Ninja|radare2|Cutter|dnSpy|ILSpy|disassembl(?:y|er)|symbol|function name|callsite|xref|basic block|nop|jmp|jne|je)\b/i,
      category: 'exe_disassembly_symbol_notes',
      severity: 'MEDIUM',
      action: 'Treat tool and symbol notes as explanatory evidence; verify against hash-guarded bytes before deriving a patch.',
      rationale: 'Disassembly notes help humans review intent, but they do not replace byte and version evidence.',
    },
    {
      pattern: /\b(BackupPath|RollbackPlan|restore|rollback|backup before patch|original copy|undo patch|verify original bytes|dry run|no-write|no write)\b/i,
      category: 'exe_patch_backup_rollback',
      severity: 'HIGH',
      action: 'Require backup, dry-run verification, original-byte checks, and rollback notes before any executable patch is allowed.',
      rationale: 'Binary edits are hard to inspect after the fact; rollback and original-byte verification are non-negotiable safety rails.',
    },
    {
      pattern: /\b(LinuxPatchTarget|ProtonPatchTarget|WinePatchTarget|LinuxValidation|ProtonValidation|DXVKValidation|VKD3DValidation|Proton(?:\s|_|-)?patch|Wine(?:\s|_|-)?patch|Steam Deck patch|SteamOS patch|compatdata\/[0-9]+|pfx\/drive_c|WINEPREFIX|PROTON_LOG|DXVK_LOG_LEVEL|VKD3D_DEBUG|Gamescope|MangoHud|gamemoderun)\b/i,
      category: 'exe_patch_linux_compat',
      severity: 'HIGH',
      action: 'Require Linux/Proton/Wine validation evidence, prefix scope, wrapper stack, and rollback path for Linux-targeted executable patches.',
      rationale: 'Linux game patching often touches a Windows PE running inside Wine/Proton; the patch must be validated through the actual Linux compatibility layer, not only native Windows assumptions.',
    },
    {
      pattern: /\b(DRM bypass|anti-cheat bypass|anticheat bypass|stealth injection|public match|ranked|ban evasion|ownership verification|license check|unlock all|trainer online)\b/i,
      category: 'exe_patch_safety_boundary',
      severity: 'HIGH',
      action: 'Stop at evidence mapping. Do not implement or recommend patches for DRM, anti-cheat, ownership checks, public matchmaking, ranked play, or evasion.',
      rationale: 'Those scopes cross the boundary from legitimate offline modding into bypass/evasion or online integrity tampering.',
    },
  ];

  addKeywordEvidence(checks, line, lineNo, file, context);
}

function scanWindowsKeywordFamilies(line, lineNo, file, context) {
  if (!isWindowsProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /\b(ServiceBase|CreateService|OpenSCManager|SERVICE_WIN32|SERVICE_KERNEL_DRIVER|New-Service|Set-Service|sc\.exe|CurrentControlSet\\Services|ImagePath|StartType|ServiceName|DisplayName)\b/i,
      category: 'windows_service_surface',
      severity: 'HIGH',
      action: 'Map service name, ImagePath, start type, account, and install script before changing service configuration.',
      rationale: 'Windows services cross source, registry, installer, and runtime boundaries; drift causes boot/start failures.',
    },
    {
      pattern: /\b(DriverEntry|KMDF|WDF|WDM|IoCreateDevice|IRP_MJ_|AddService|ServiceBinary|ClassGuid|UpperFilters|LowerFilters|\.sys\b|SERVICE_KERNEL_DRIVER)\b/i,
      category: 'windows_driver_surface',
      severity: 'HIGH',
      action: 'Cross-check driver source, INF, service binary, signing posture, and target OS before testing driver installs.',
      rationale: 'Driver evidence is high risk because build metadata, INF service entries, and signing policy must agree.',
    },
    {
      pattern: /\b(HKLM\\|HKCU\\|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|RegistryKey|RegistryView|reg add|reg\.exe|CurrentVersion\\Run|Policies\\|Software\\Classes)\b/i,
      category: 'windows_registry_assumptions',
      severity: 'HIGH',
      action: 'Treat registry paths as assumptions to audit; do not mutate registry without explicit operator approval and backup.',
      rationale: 'Registry edits are host-mutating and must be separated from source-tree evidence mapping.',
    },
    {
      pattern: /\b(PlatformToolset|WindowsTargetPlatformVersion|TargetFramework|RuntimeIdentifier|ConfigurationType|ProjectReference|Directory\.Build\.(?:props|targets)|OutDir|TargetPath|UseWPF|UseWindowsForms|VCToolsVersion)\b/i,
      category: 'windows_msbuild_visualstudio',
      severity: 'MEDIUM',
      action: 'Compare solution/project/platform/toolset declarations before diagnosing build or runtime failures.',
      rationale: 'Visual Studio and MSBuild trees often hide platform, SDK, and output-type assumptions in project metadata.',
    },
    {
      pattern: /\b(PE32\+?|IMAGE_FILE_MACHINE_[A-Z0-9_]+|Subsystem|requestedExecutionLevel|asInvoker|requireAdministrator|dumpbin|sigcheck|signtool|Authenticode|CodeSign|test signing|driver signature)\b/i,
      category: 'windows_pe_metadata',
      severity: 'MEDIUM',
      action: 'Verify PE architecture, subsystem, manifest privilege, and signing metadata against the intended deployment target.',
      rationale: 'PE metadata and signing state explain many failures that look like code bugs or missing dependencies.',
    },
    {
      pattern: /\b(WiX|ProductCode|UpgradeCode|MSI|Inno Setup|NSIS|InstallShield|setup\.exe|installer|Start Menu|Program Files|AppData|ProgramData)\b/i,
      category: 'windows_installer_layout',
      severity: 'MEDIUM',
      action: 'Map installer output, install roots, and upgrade identity before copying runtime paths into docs or scripts.',
      rationale: 'Installer paths and upgrade IDs are another source of copied constants and edition-specific drift.',
    },
  ];

  addKeywordEvidence(checks, line, lineNo, file, context);
}

function addKeywordEvidence(checks, line, lineNo, file, context) {
  for (const check of checks) {
    const match = line.match(check.pattern);
    if (!match) {
      continue;
    }

    addEvidence(context, {
      category: check.category,
      severity: check.severity,
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `${check.category}:${line.trim().slice(0, 160)}`,
      related_paths: extractPathTokens(line),
      related_symbols: uniq([match[1] ?? match[0]].filter(Boolean)),
      evidence_type: 'source_line',
      suggested_action: check.action,
      rationale: check.rationale,
    });
  }
}

function scanSemanticPolicyClaims(line, lineNo, file, context, lineState = {}) {
  if (!isSemanticPolicyProfile(context.profile)) {
    return;
  }
  if (lineState.markdownFence || isAuxiliarySourcePath(file.path) || isGeneratedArtifactPath(file.path)) {
    return;
  }
  if (isSourceImplementationPolicyFalsePositive(line, file.path)) {
    return;
  }
  if (isSourceCodeSemanticFalsePositive(line, file.path)) {
    return;
  }

  const trimmed = line.trim();
  const evidenceKind = semanticEvidenceKind(file.path, context);

  for (const rule of SEMANTIC_POLICY_CLAIM_RULES) {
    const match = rule.patterns.find(pattern => pattern.test(line));
    if (!match) {
      continue;
    }
    if (isNegatedSemanticAction(line, rule.category)) {
      continue;
    }

    const evidence = addEvidence(context, {
      category: rule.category,
      severity: rule.severity,
      confidence: rule.confidence,
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: trimmed,
      normalized_claim: `semantic_policy.${rule.category}.${rule.subject}=${rule.predicate}`,
      related_paths: extractPathTokens(line),
      related_symbols: uniq([rule.subject, rule.predicate, rule.category]),
      evidence_type: 'source_line',
      evidence_kind: evidenceKind,
      raw_evidence: trimmed,
      semantic_policy_category: rule.category,
      semantic_policy_subject: rule.subject,
      semantic_policy_predicate: rule.predicate,
      semantic_policy_profile: context.profile.id,
      suggested_action: semanticPolicyActionFor(rule.category),
      rationale: 'Semantic policy claims normalize natural-language agent instructions into comparable safety, workflow, and provenance rules.',
    });

    if (!context.semanticPolicyClaims.some(claim => claim.id === evidence.id)) {
      context.semanticPolicyClaims.push(evidence);
    }
  }
}

function semanticPolicyActionFor(category) {
  if (category.endsWith('_forbidden') || category === 'read_only' || category === 'device_action_forbidden' || category === 'network_forbidden') {
    return 'Treat this as a restrictive policy claim and compare it against any allowed-action claims before acting.';
  }
  if (SEMANTIC_ALLOWED_ACTION_CATEGORIES.has(category) || category === 'approval_bypass' || category === 'sandbox_bypass') {
    return 'Confirm this permissive policy is current before using it to run side-effecting tools.';
  }
  if (category === 'attribution_required' || category === 'attribution_missing') {
    return 'Preserve source, license, and notice evidence before importing or publishing derived work.';
  }
  return 'Compare this normalized policy claim against the current task instructions and adjacent policy files.';
}

function semanticEvidenceKind(filePath, context = null) {
  const normalized = normalizePath(filePath);
  const name = basename(normalized);
  const ext = extname(normalized).toLowerCase();

  if (isGeneratedArtifactPath(normalized)) {
    return 'generated_artifact';
  }
  if (isFixtureEvidencePath(normalized, context)) {
    return 'fixture';
  }
  if (/^(AGENTS|CLAUDE|WARP)\.md$/i.test(name) || /(^|\/)SKILL\.md$/i.test(normalized)) {
    return 'instruction';
  }
  if (/\.(json|toml|ya?ml|env|ini|cfg|conf)$/i.test(ext) || /settings/i.test(name)) {
    return 'config';
  }
  if (/\.(sh|bash|zsh|fish|ps1|psm1|bat|cmd|py|js|ts|kt|kts)$/i.test(ext)) {
    return 'script';
  }
  return 'doc';
}

function isFixtureEvidencePath(filePath, context) {
  const normalizedRoot = context?.projectRoot ? normalizePath(context.projectRoot) : '';
  return filePath.startsWith('test/fixtures/')
    || normalizedRoot.includes('/test/fixtures/');
}

function isGeneratedArtifactPath(filePath) {
  const normalized = normalizePath(filePath);
  return ROOT_SCAN_ARTIFACT_FILES.has(normalized)
    || normalized.startsWith('site/')
    || normalized.startsWith('reversa_out/')
    || normalized.startsWith('_reversa_sdd/')
    || normalized.startsWith('_reversa_forward/')
    || normalized.startsWith('agent_handoff/')
    || /(^|\/)(generated|auto-generated|autogenerated)(\/|$)/i.test(normalized);
}

function isMarkdownLikePath(filePath) {
  return /\.(md|markdown|mdown|txt)$/i.test(filePath);
}

function isMarkdownFenceLine(line) {
  return /^\s*(```|~~~)/.test(line);
}

function isSourceCodeSemanticFalsePositive(line, filePath) {
  const ext = extname(filePath).toLowerCase();
  if (!['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts', '.py', '.ts', '.tsx'].includes(ext)) {
    return false;
  }

  const trimmed = line.trim();
  if (isCommentLikeLine(trimmed)) {
    return false;
  }
  if (isCommandLikeLine(trimmed)) {
    return false;
  }

  return /^(?:const|let|var|final|private|public|protected|static|readonly|val|String|boolean|bool|def|self\.)?\s*[A-Za-z_$][A-Za-z0-9_.$-]*\s*(?::[^=]+)?=\s*["'`]/.test(trimmed)
    || /^[A-Za-z_$][A-Za-z0-9_.$-]*\s*:\s*["'`]/.test(trimmed);
}

function isSourceImplementationPolicyFalsePositive(line, filePath) {
  const ext = extname(filePath).toLowerCase();
  if (!['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts', '.py', '.ts', '.tsx'].includes(ext)) {
    return false;
  }

  const trimmed = line.trim();
  return !isCommentLikeLine(trimmed) && !isCommandLikeLine(trimmed);
}

function isSourceCodePolicyLiteralFalsePositive(line, filePath) {
  return isSourceCodeSemanticFalsePositive(line, filePath)
    && /\b(?:dangerously-skip-permissions|skip approvals?|approval|allow all|read-only|destructive|sandbox|do not edit|do not push|do not commit|no adb|no network)\b/i.test(line);
}

function isSourceCodePlaceholderLiteralFalsePositive(line, filePath) {
  const normalizedPath = normalizePath(filePath);
  const ext = extname(normalizedPath).toLowerCase();
  const isCodeFile = ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts', '.py', '.ts', '.tsx'].includes(ext);
  if (!isCodeFile) {
    return false;
  }

  const trimmed = line.trim();
  if (isCommentLikeLine(trimmed)) {
    return false;
  }

  if (normalizedPath.startsWith('lib/scan/')
    && /\b(?:TODO|FIXME|XXX|HACK|STUB|PLACEHOLDER|TBD|WIP|DUMMY|FAKE|MOCK|NOT IMPLEMENTED|PLACEHOLDER_PATTERN|riskyLeftovers|validation_commands|evidenceTable|placeholder_marker)\b/.test(trimmed)) {
    return true;
  }

  return /^(?:['"`]|assert(?:No)?Evidence\(|assert\.match\(|assert\.equal\(|assert\(|await writeFile\(|const .*=\s*['"`]|let .*=\s*['"`]|var .*=\s*['"`])/.test(trimmed)
    && /\b(?:TODO|FIXME|XXX|HACK|STUB|PLACEHOLDER|TBD|WIP|DUMMY|FAKE|MOCK|NOT IMPLEMENTED)\b/i.test(trimmed);
}

function isCommentLikeLine(trimmed) {
  return trimmed.startsWith('#')
    || trimmed.startsWith('//')
    || trimmed.startsWith('/*')
    || trimmed.startsWith('*');
}

function isCommandLikeLine(trimmed) {
  return /^(?:adb|fastboot|git|curl|wget|gh|rm|chmod|setenforce|mkfs|dd)\b/i.test(trimmed);
}

function isNegatedSemanticAction(line, category) {
  if (category === 'approval_required') {
    return false;
  }

  const negatable = SEMANTIC_ALLOWED_ACTION_CATEGORIES.has(category)
    || ['approval_bypass', 'sandbox_bypass', 'source_authority', 'memory_authoritative', 'active_agent'].includes(category);
  if (!negatable) {
    return false;
  }

  return /\b(?:no|do not|don't|dont|never|forbid|forbidden|prohibited|not allowed|without)\b.{0,80}\b(?:approval|approvals|skip|allow all|adb|fastboot|install|reboot|flash|device|network|git|curl|wget|gh api|patch|edit|write|commit|push|publish|copy|vendor|memory|agent|sandbox|rm\s+-rf|reset\s+--hard|chmod|setenforce)\b/i.test(line);
}

function scanAgenticToolchainKeywordFamilies(line, lineNo, file, context) {
  if (!isAgenticToolchainProfile(context.profile)) {
    return;
  }
  if (isSourceCodePolicyLiteralFalsePositive(line, file.path)) {
    return;
  }

  const checks = [
    {
      pattern: /\b(AGENTS\.md|CLAUDE\.md|agentic directive|system prompt|coding environment|workflow|verification)\b/i,
      category: 'agent_instruction_surface',
      severity: 'MEDIUM',
      action: 'Compare this instruction surface against local AGENTS/CLAUDE templates before merging.',
      rationale: 'Instruction drift changes how future agents operate and verify work.',
    },
    {
      pattern: /\b(SKILL\.md|skill loading|frontmatter|progressive disclosure|skill-creator|agent-builder|reference files?)\b/i,
      category: 'agent_skill_contracts',
      severity: 'MEDIUM',
      action: 'Check skill metadata, references, and trigger scope before adapting the workflow.',
      rationale: 'A skill should be scoped enough to help agents without pulling unrelated context into every run.',
    },
    {
      pattern: /\b(PreToolUse|PostToolUse|UserPromptSubmit|Stop|SessionStart|Notification|hooks\.json|hook lifecycle|hook event)\b/i,
      category: 'hook_lifecycle_policy',
      severity: 'MEDIUM',
      action: 'Map hook event timing and side effects before enabling or copying the hook.',
      rationale: 'Hooks run around tool calls and can enforce policy or introduce surprising behavior.',
    },
    {
      pattern: /\b(permission|permissions|allowlist|denylist|allowedTools|disallowedTools|dangerously-skip-permissions|sandbox|read-only|destructive|approval)\b/i,
      category: 'permission_safety_policy',
      severity: 'HIGH',
      action: 'Verify permission boundaries and destructive-command handling before applying this setting or advice.',
      rationale: 'Permission policy determines whether an agent can safely run unattended tooling.',
    },
    {
      pattern: /\b(memory|persistent context|context compact|compaction|transcript|session memory|evidence\.jsonl|agent_handoff|context injection)\b/i,
      category: 'memory_context_injection',
      severity: 'MEDIUM',
      action: 'Tie memory writes and reads to explicit provenance, scope, and replay checks.',
      rationale: 'Memory systems become reliable only when captured facts remain auditable and reversible.',
    },
    {
      pattern: /\b(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|NVIDIA_NIM|MODEL_[A-Z0-9_]+|OpenAI Responses|Anthropic Messages|provider|providers|BASE_URL|proxy|gateway)\b/i,
      category: 'provider_routing_surface',
      severity: 'HIGH',
      action: 'Document provider precedence, auth-token source, and client protocol before changing launchers.',
      rationale: 'Provider routing bugs can leak credentials, pick the wrong backend, or break Claude/Codex protocol compatibility.',
    },
    {
      pattern: /\b(subagent|sub-agent|agent teams?|orchestrator|worker agent|explorer agent|delegate|delegation)\b/i,
      category: 'subagent_orchestration',
      severity: 'MEDIUM',
      action: 'Define ownership, concurrency, and handoff files before adopting the orchestration pattern.',
      rationale: 'Parallel agents need clear ownership and evidence handoff to avoid conflicting edits.',
    },
    {
      pattern: /\b(worktree|task isolation|branch isolation|isolated workspace|git worktree)\b/i,
      category: 'worktree_isolation',
      severity: 'MEDIUM',
      action: 'Verify branch/worktree lifecycle and cleanup rules before turning this into automation.',
      rationale: 'Worktree isolation is powerful, but stale branches and split state can hide test or merge failures.',
    },
    {
      pattern: /\b(MCP|mcp server|tool server|plugin|plugins|connector|connectors|marketplace)\b/i,
      category: 'mcp_plugin_surface',
      severity: 'MEDIUM',
      action: 'Identify tool boundary, credentials, external service scope, and install path before reuse.',
      rationale: 'Plugins and MCP servers often bridge local automation with external services.',
    },
    {
      pattern: /\b(NOASSERTION|all rights reserved|Commercial Terms|proprietary|decompiled|decompile|sourcemap|cli\.js\.map|restored-src)\b/i,
      category: 'proprietary_source_risk',
      severity: 'HIGH',
      action: 'Keep this as reference-only evidence unless license provenance explicitly permits reuse.',
      rationale: 'Unknown or proprietary licensing is an import blocker for copied code and docs.',
    },
    {
      pattern: /\b(MIT License|Apache License|Apache-2\.0|NOTICE|Third-Party|third party|attribution|copyright)\b/i,
      category: 'attribution_license_surface',
      severity: 'MEDIUM',
      action: 'Preserve source URL, commit, license, and NOTICE requirements in the import manifest.',
      rationale: 'Attribution is part of the artifact contract when lifting patterns from other projects.',
    },
  ];

  if (isAgenticGatewayProfile(context.profile)) {
    checks.push(
      {
        pattern: /\b(ProviderDescriptor|PROVIDER_CATALOG|SUPPORTED_PROVIDER_IDS|ProviderRegistry|provider_id|credential_env|credential_attr|static_credential|capabilities)\b/i,
        category: 'provider_catalog_surface',
        severity: 'HIGH',
        action: 'Cross-check provider catalog entries against settings, registry factories, docs, and smoke coverage before adding or renaming providers.',
        rationale: 'Provider catalogs are the source of truth for credentials, capabilities, default URLs, and routing behavior.',
      },
      {
        pattern: /\b(ModelRouter|ResolvedModel|resolve_model|resolve_thinking|MODEL_OPUS|MODEL_SONNET|MODEL_HAIKU|gateway_model|decode_gateway_model_id|provider_model_ref)\b/i,
        category: 'model_routing_surface',
        severity: 'HIGH',
        action: 'Verify model precedence, direct provider/model syntax, and thinking flags against provider capabilities and tests.',
        rationale: 'Model routing decides which backend receives a request and is a common place for silent wrong-model failures.',
      },
      {
        pattern: /(?:\b(Anthropic Messages|OpenAI Responses|MessagesRequest|TokenCountRequest|create_response|SSE|server-sent events?|tool_use|tool_result|thinking block|reasoning)\b|\/v1\/(?:messages|responses)\b)/i,
        category: 'protocol_adapter_surface',
        severity: 'HIGH',
        action: 'Map client protocol, streaming events, tool-call conversion, and error shape before changing adapters.',
        rationale: 'Claude/Codex gateway repos are brittle at protocol boundaries; small conversion drift breaks clients.',
      },
      {
        pattern: /\b(fcc-claude|fcc-codex|claude launcher|codex launcher|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY|model_provider|model_catalog_json|OPENAI_API_KEY|CODEX_API_KEY|FCC_CODEX_API_KEY|preflight_proxy)\b/i,
        category: 'client_launcher_surface',
        severity: 'HIGH',
        action: 'Confirm launcher env stripping, auth token source, preflight behavior, and generated model catalog before reuse.',
        rationale: 'Client launchers can leak credentials or accidentally route official clients to the wrong endpoint.',
      },
      {
        pattern: /\b(Admin UI|admin_static|admin_urls|\/admin|loopback|local-only|validate changes?|Apply|configuration UI|BaseSettings|pydantic-settings|dotenv)\b/i,
        category: 'admin_config_surface',
        severity: 'MEDIUM',
        action: 'Check bind address, local-only assumptions, validation path, and dotenv precedence before exposing config controls.',
        rationale: 'Admin/config surfaces mutate provider credentials and routing; they need tight local-only and validation boundaries.',
      },
      {
        pattern: /\b(FEATURE_INVENTORY|CAPABILITY_CONTRACTS|smoke_targets|product_e2e|live smoke|missing_env|upstream_unavailable|product_failure|harness_bug|FCC_LIVE_SMOKE|FCC_SMOKE_TARGETS|pytest)\b/i,
        category: 'smoke_coverage_surface',
        severity: 'MEDIUM',
        action: 'Tie README-public features to contract tests, live prereqs, product E2E scenarios, and explicit skip/fail classes.',
        rationale: 'A gateway is only trustworthy when advertised behavior has deterministic contracts and reproducible smoke gates.',
      },
      {
        pattern: /\b(Discord|Telegram|messaging_platform|ManagedClaudeSession|session pool|transcript|outbox|voice note|transcription|bot token|channel id)\b/i,
        category: 'messaging_bridge_surface',
        severity: 'MEDIUM',
        action: 'Separate fake-platform tests from live bot side effects and verify session ownership, transcript storage, and cancellation.',
        rationale: 'Messaging bridges add long-lived sessions, external side effects, and token-bearing configuration.',
      },
      {
        pattern: /\b(redact|redaction|safe_diagnostics|format_exception_for_log|log_full_message|KEY|TOKEN|SECRET|WEBHOOK|AUTH|credential|api key)\b/i,
        category: 'secret_redaction_surface',
        severity: 'HIGH',
        action: 'Verify logs, smoke artifacts, diagnostics, and errors redact secret-bearing values by default.',
        rationale: 'Provider gateways handle credentials; diagnostics must preserve evidence without leaking secrets.',
      }
    );
  }

  for (const check of checks) {
    const match = line.match(check.pattern);
    if (!match) {
      continue;
    }

    addEvidence(context, {
      category: check.category,
      severity: check.severity,
      confidence: 'possible',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: line.trim(),
      normalized_claim: `${check.category}:${line.trim().slice(0, 160)}`,
      related_paths: extractPathTokens(line),
      related_symbols: uniq([match[1] ?? match[0]].filter(Boolean)),
      evidence_type: 'source_line',
      suggested_action: check.action,
      rationale: check.rationale,
    });
  }
}

function isRuntimeProfile(profile) {
  return profile?.runtimeProfile === true || [
    'userspace_graphics',
    'gamescope',
    'child_libpath',
    'nebula_child_libpath',
    'nebula_gamescope',
    'nebula_vulkan_loader',
    'linux_container',
  ].includes(profile?.id);
}

function isNebulaRuntimeProfile(profile) {
  return profile?.nebulaRuntimeProfile === true || [
    'child_libpath',
    'nebula_child_libpath',
    'nebula_gamescope',
    'nebula_vulkan_loader',
    'gamescope',
    'userspace_graphics',
    'vulkan_loader',
    'rm11pro_gaming_runtime',
  ].includes(profile?.id);
}

function isPCGamingWikiLikeProfile(profile) {
  return profile?.pcgamingwikiProfile === true || [
    'game_modding',
    'graphics_wrapper',
    'vulkan_loader',
    'bo3_zombies_diagnostics',
    'render_enhancement_plugin',
    'rm11pro_gaming_runtime',
  ].includes(profile?.id);
}

function isWidescreenFramegenLikeProfile(profile) {
  return profile?.widescreenFramegenProfile === true || [
    'render_enhancement_plugin',
    'rm11pro_gaming_runtime',
  ].includes(profile?.id);
}

function isExePatchProfile(profile) {
  return profile?.exePatchProfile === true;
}

function isWindowsProfile(profile) {
  return profile?.windowsProfile === true;
}

function isAndroidRecoveryLikeProfile(profile) {
  return [
    'android_recovery',
    'orangefox',
    'twrp',
  ].includes(profile?.id);
}

function isAgenticToolchainProfile(profile) {
  return profile?.agenticToolchainProfile === true;
}

function isAgenticGatewayProfile(profile) {
  return profile?.agenticGatewayProfile === true;
}

function isSemanticPolicyProfile(profile) {
  return profile?.semanticPolicyProfile === true;
}

function isCommentOnlyFstabCandidate(trimmed) {
  return trimmed.startsWith('#')
    || trimmed.startsWith('//')
    || trimmed.startsWith('/*')
    || trimmed.startsWith('*');
}

function findSafetyBoundaryTerm(line) {
  const lower = line.toLowerCase();
  const terms = [
    'anti-cheat',
    'anticheat',
    'arxan',
    'bypass',
    'cheat menu',
    'trainer',
    'stealth injection',
    'public match',
    'ranked',
    'unlock all',
    'ban evasion',
    'ownership verification',
  ];

  for (const term of terms) {
    if (lower.includes(term)) {
      return term;
    }
  }

  return /\bDRM\b/.test(line) ? 'DRM' : null;
}

function addMissingExpectedPatternEvidence(context) {
  for (const pattern of context.profile.requiredFilePatterns ?? []) {
    const found = context.inventory.files.some(file => pattern.test(file.path));
    if (found) {
      continue;
    }

    const patternText = pattern.toString();
    context.inventory.missing_expected_patterns.push(patternText);
    addEvidence(context, {
      category: 'missing_files',
      severity: 'MEDIUM',
      confidence: 'possible',
      source_file: '.',
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: patternText,
      normalized_claim: `missing_expected_pattern:${patternText}`,
      evidence_type: 'derived_inventory',
      suggested_action: 'Confirm whether this profile expectation is intentionally absent or the scan root is incomplete.',
      rationale: 'The selected profile expects this class of file when enough project context is present.',
    });
  }
}

function addMissingPathEvidence(context) {
  const seen = new Set();
  for (const ref of context.pathReferences) {
    const normalizedRef = cleanPathToken(ref.path);
    if (!shouldCheckPath(normalizedRef, ref.category)) {
      continue;
    }
    if (context.profile.externalCheckoutPathReferences && ref.category !== 'init_rc_services') {
      continue;
    }
    if (!isDerivedPathCheckEligible(ref.source_file)) {
      continue;
    }

    const key = `${ref.category}:${ref.source_file}:${ref.source_line_start}:${normalizedRef}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const candidates = candidateSourcePaths(context.projectRoot, normalizedRef);
    if (candidates.some(candidate => existsSync(candidate))) {
      continue;
    }

    addEvidence(context, {
      category: ref.category === 'init_rc_services' ? 'missing_files' : 'invalid_paths',
      severity: ref.category === 'init_rc_services' ? 'HIGH' : 'MEDIUM',
      confidence: 'likely',
      source_file: ref.source_file,
      source_line_start: ref.source_line_start,
      source_line_end: ref.source_line_start,
      extracted_text: ref.extracted_text,
      normalized_claim: `referenced_path_missing:${normalizedRef}`,
      related_paths: [normalizedRef],
      evidence_type: 'derived_missing_path',
      suggested_action: 'Verify the reference or add the missing source/blob before patching around it.',
      rationale: 'The scanner could not resolve this path inside the project tree or common recovery-root source locations.',
    });
  }
}

function addDuplicateDefinitionEvidence(context) {
  const groups = groupDefinitionEvidence(context.evidence);
  for (const [key, entries] of groups) {
    if (entries.length < 2) {
      continue;
    }

    const values = new Map();
    for (const entry of entries) {
      values.set(extractClaimValue(entry.normalized_claim), true);
    }

    if (values.size === 1) {
      addEvidence(context, {
        category: 'duplicated_definitions',
        severity: 'LOW',
        confidence: 'likely',
        source_file: entries[0].source_file,
        source_line_start: entries[0].source_line_start,
        source_line_end: entries[0].source_line_end,
        extracted_text: entries.map(entry => `${entry.source_file}:${entry.source_line_start}`).join('; '),
        normalized_claim: `duplicated_definition:${key}=${[...values.keys()][0]}`,
        related_symbols: [key],
        related_build_vars: key.startsWith('ro.') ? [] : [key],
        related_device_props: key.startsWith('ro.') ? [key] : [],
        evidence_type: 'derived_definition_group',
        suggested_action: 'Keep duplicate definitions only if ordering is intentional and documented.',
        rationale: 'Duplicate definitions make later override behavior harder for agents and humans to reason about.',
      });
    }
  }
}

function addKnownGoodComparison(context, knownGoodFacts) {
  const comparison = {
    source_file: context.knownGoodPath,
    facts: knownGoodFacts,
    matches: [],
    mismatches: [],
    not_observed: [],
  };

  if (!knownGoodFacts || Object.keys(knownGoodFacts).length === 0) {
    return comparison;
  }

  const observedByKey = new Map();
  for (const evidence of context.evidence) {
    if (evidence.assignment_operator === '+=') {
      continue;
    }
    const claim = parseAssignmentClaim(evidence.normalized_claim);
    if (!claim) {
      continue;
    }

    const canonical = canonicalFactKey(claim.key);
    if (!canonical || knownGoodFacts[canonical] === undefined) {
      continue;
    }

    if (!observedByKey.has(canonical)) {
      observedByKey.set(canonical, []);
    }
    observedByKey.get(canonical).push({ evidence, value: claim.value, variable: claim.key });
  }

  for (const [key, expected] of Object.entries(knownGoodFacts)) {
    const observed = observedByKey.get(key) ?? [];
    if (observed.length === 0) {
      comparison.not_observed.push({
        key,
        expected,
        status: 'not_observed',
      });
      continue;
    }

    for (const item of observed) {
      if (valuesEquivalent(key, expected, item.value)) {
        comparison.matches.push({
          key,
          expected,
          observed: item.value,
          variable: item.variable,
          evidence_id: item.evidence.id,
          file: item.evidence.source_file,
          line: item.evidence.source_line_start,
        });
        continue;
      }

      const groupId = stableId('KG', `${key}:${expected}:${item.variable}:${item.value}`);
      const mismatchEvidence = addEvidence(context, {
        category: 'conflicting_definitions',
        severity: 'HIGH',
        confidence: 'confirmed',
        source_file: item.evidence.source_file,
        source_line_start: item.evidence.source_line_start,
        source_line_end: item.evidence.source_line_end,
        extracted_text: item.evidence.extracted_text,
        normalized_claim: `known_good_mismatch:${key}:expected=${normalizeScalar(String(expected))};observed=${item.variable}=${item.value}`,
        related_paths: item.evidence.related_paths,
        related_symbols: [item.variable],
        related_build_vars: item.evidence.related_build_vars,
        related_device_props: item.evidence.related_device_props,
        evidence_type: 'known_good_mismatch',
        suggested_action: 'Patch only after confirming the known-good fact source is current for this exact device/build.',
        rationale: 'A source-tree declaration conflicts with a known-good fact supplied from real device testing.',
        contradiction_group_id: groupId,
      });

      comparison.mismatches.push({
        key,
        expected,
        observed: item.value,
        variable: item.variable,
        evidence_id: mismatchEvidence.id,
        file: item.evidence.source_file,
        line: item.evidence.source_line_start,
        contradiction_group_id: groupId,
      });
    }
  }

  return comparison;
}

function buildContradictions(context, knownGoodComparison) {
  const contradictions = [];
  const groups = groupDefinitionEvidence(context.evidence);

  for (const [key, entries] of groups) {
    const byValue = new Map();
    for (const entry of entries) {
      const value = extractClaimValue(entry.normalized_claim);
      if (!byValue.has(value)) {
        byValue.set(value, []);
      }
      byValue.get(value).push(entry);
    }

    if (byValue.size < 2) {
      continue;
    }

    const groupId = stableId('CON', `${key}:${[...byValue.keys()].sort().join('|')}`);
    const evidenceIds = entries.map(entry => entry.id);
    const winner = chooseLikelyWinner(key, [...byValue.keys()], knownGoodComparison);
    contradictions.push({
      id: groupId,
      category: contradictionCategoryForKey(key),
      severity: severityForContradictionKey(key),
      confidence: winner ? 'likely' : 'possible',
      title: `Conflicting definitions for ${key}`,
      conflicting_claims: entries.map(entry => claimRef(entry)),
      evidence_ids: evidenceIds,
      likely_winner: winner ?? null,
      likely_winner_reason: winner
        ? 'The likely winner matches supplied known-good facts or a more specific device identity key.'
        : 'No supplied known-good fact selects a winner.',
      rationale: winner
        ? 'The likely winner matches supplied known-good facts or a more specific device identity key.'
        : 'Multiple values are declared and no known-good fact selects a winner.',
      recommended_action: winner
        ? `Normalize lower-confidence definitions to ${winner} after checking build ordering.`
        : 'Inspect build ordering and target device facts before changing definitions.',
      investigation_command: `grep -RIn "${escapeForGrep(key)}" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "${escapeForGrep(key)}" "${context.projectRoot}"`,
      safe_next_action: 'Inspect the referenced files and rerun the scan after any source-only edit.',
    });

    addEvidence(context, {
      category: 'conflicting_definitions',
      severity: severityForContradictionKey(key),
      confidence: winner ? 'likely' : 'possible',
      source_file: entries[0].source_file,
      source_line_start: entries[0].source_line_start,
      source_line_end: entries[0].source_line_end,
      extracted_text: entries.map(entry => `${entry.source_file}:${entry.source_line_start}:${extractClaimValue(entry.normalized_claim)}`).join('; '),
      normalized_claim: `conflicting_definition:${key}=${[...byValue.keys()].join('|')}`,
      related_symbols: [key],
      related_build_vars: key.startsWith('ro.') ? [] : [key],
      related_device_props: key.startsWith('ro.') ? [key] : [],
      evidence_type: 'derived_contradiction',
      suggested_action: winner
        ? `Normalize lower-confidence definitions to ${winner} after checking build ordering.`
        : 'Resolve or document the competing definitions.',
      rationale: 'Contradictory definitions are high-risk because downstream build and runtime behavior depends on which value wins.',
      contradiction_group_id: groupId,
    });
  }

  const canonicalGroups = groupCanonicalDefinitionEvidence(context.evidence);
  for (const [canonical, entries] of canonicalGroups) {
    const variables = new Set(entries.map(entry => parseAssignmentClaim(entry.normalized_claim)?.key).filter(Boolean));
    if (variables.size < 2) {
      continue;
    }

    const byValue = new Map();
    for (const entry of entries) {
      const value = extractClaimValue(entry.normalized_claim);
      if (!byValue.has(value)) {
        byValue.set(value, []);
      }
      byValue.get(value).push(entry);
    }

    if (byValue.size < 2) {
      continue;
    }

    const groupId = stableId('CON', `canonical:${canonical}:${[...byValue.keys()].sort().join('|')}`);
    const winner = chooseKnownGoodWinner(canonical, [...byValue.keys()], knownGoodComparison);
    contradictions.push({
      id: groupId,
      category: canonicalContradictionCategory(canonical),
      severity: canonicalContradictionSeverity(canonical),
      confidence: winner ? 'likely' : 'possible',
      title: `Conflicting ${canonical} claims across variables`,
      conflicting_claims: entries.map(entry => claimRef(entry)),
      evidence_ids: entries.map(entry => entry.id),
      likely_winner: winner ?? null,
      likely_winner_reason: winner
        ? 'The likely winner matches supplied known-good facts.'
        : 'No supplied known-good fact selects a winner.',
      rationale: winner
        ? 'The likely winner matches supplied known-good facts.'
        : 'Different variables describe the same canonical device fact with incompatible values.',
      recommended_action: winner
        ? `Align lower-confidence ${canonical} declarations with ${winner} after checking build ordering.`
        : `Decide which ${canonical} value is authoritative for this target before patching.`,
      investigation_command: `grep -RIn "${[...variables].map(escapeForGrep).join('\\|')}" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "${[...variables].map(escapeForGrep).join('\\|')}" "${context.projectRoot}"`,
      safe_next_action: 'Confirm the winning value from known-good evidence, then make a source-tree-only patch if needed.',
    });

    addEvidence(context, {
      category: 'conflicting_definitions',
      severity: canonicalContradictionSeverity(canonical),
      confidence: winner ? 'likely' : 'possible',
      source_file: entries[0].source_file,
      source_line_start: entries[0].source_line_start,
      source_line_end: entries[0].source_line_end,
      extracted_text: entries.map(entry => `${entry.source_file}:${entry.source_line_start}:${entry.normalized_claim}`).join('; '),
      normalized_claim: `canonical_conflict:${canonical}=${[...byValue.keys()].join('|')}`,
      related_symbols: [...variables],
      related_build_vars: [...variables].filter(variable => !variable.startsWith('ro.')),
      related_device_props: [...variables].filter(variable => variable.startsWith('ro.')),
      evidence_type: 'derived_contradiction',
      suggested_action: winner
        ? `Align lower-confidence ${canonical} declarations with ${winner} after checking build ordering.`
        : `Resolve or document the competing ${canonical} claims.`,
      rationale: 'Canonical contradictions catch equivalent claims that are written through different Android variables.',
      contradiction_group_id: groupId,
    });
  }

  for (const mismatch of knownGoodComparison.mismatches ?? []) {
    contradictions.push({
      id: mismatch.contradiction_group_id,
      category: 'known_good_mismatch',
      severity: 'HIGH',
      confidence: 'confirmed',
      title: `Known-good mismatch for ${mismatch.key}`,
      conflicting_claims: [
        {
          evidence_id: mismatch.evidence_id,
          claim: `${mismatch.variable}=${mismatch.observed}`,
          file: mismatch.file,
          line: mismatch.line,
        },
        {
          evidence_id: null,
          claim: `known_good:${mismatch.key}=${mismatch.expected}`,
          file: knownGoodComparison.source_file,
          line: null,
        },
      ],
      evidence_ids: [mismatch.evidence_id],
      likely_winner: String(mismatch.expected),
      likely_winner_reason: 'Known-good facts supplied from real device testing outrank source-tree leftovers.',
      rationale: 'Known-good facts are treated as stronger evidence when they come from real device testing.',
      recommended_action: 'Patch the source tree toward the known-good value only after confirming the known-good file matches this target.',
      investigation_command: `grep -RIn "${escapeForGrep(mismatch.variable)}" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "${escapeForGrep(mismatch.variable)}" "${context.projectRoot}"`,
      safe_next_action: 'Verify the known-good fact source and inspect all matching declarations before editing.',
    });
  }

  for (const evidence of context.evidence.filter(item => item.category === 'likely_copy_paste_leftovers' && item.severity === 'HIGH')) {
    const token = evidence.related_symbols?.[0] ?? evidence.normalized_claim.replace('risky_leftover:', '');
    const winner = knownGoodWinnerForLeftover(token, knownGoodComparison);
    contradictions.push({
      id: stableId('CON', `leftover:${evidence.id}:${token}`),
      category: 'likely_copy_paste_leftovers',
      severity: 'HIGH',
      confidence: evidence.confidence,
      title: `Suspicious old target leftover: ${token}`,
      conflicting_claims: [claimRef(evidence)],
      evidence_ids: [evidence.id],
      likely_winner: winner,
      likely_winner_reason: winner
        ? 'The supplied known-good facts point to a different current target.'
        : 'The token is marked as risky by the selected profile but no known-good replacement is available.',
      rationale: 'Old device or SoC names in active recovery config are common copy-paste hazards.',
      recommended_action: 'Replace or justify the leftover with direct device-specific evidence before using it as a patch source.',
      investigation_command: `grep -RIn "${escapeForGrep(token)}" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "${escapeForGrep(token)}" "${context.projectRoot}"`,
      safe_next_action: 'Inspect the line context and known-good facts; do not infer a replacement without evidence.',
    });
  }

  for (const evidence of context.evidence.filter(item => item.category === 'invalid_paths' || item.category === 'missing_files')) {
    contradictions.push({
      id: stableId('CON', `${evidence.category}:${evidence.source_file}:${evidence.source_line_start}:${evidence.normalized_claim}`),
      category: evidence.category,
      severity: evidence.severity,
      confidence: evidence.confidence,
      title: `Referenced path is not resolved: ${evidence.related_paths?.[0] ?? evidence.normalized_claim}`,
      conflicting_claims: [claimRef(evidence)],
      evidence_ids: [evidence.id],
      likely_winner: 'tree_inventory',
      likely_winner_reason: 'The file inventory could not resolve the referenced path inside the scanned tree.',
      rationale: 'The source line references a path that the inventory could not resolve in the scanned tree.',
      recommended_action: 'Verify whether the path is generated, device-only, or genuinely stale before editing.',
      investigation_command: `find "${context.projectRoot}" -path "*${escapeForFindBasename(evidence.related_paths?.[0] ?? '')}*"`,
      suggested_validation_command: `find "${context.projectRoot}" -path "*${escapeForFindBasename(evidence.related_paths?.[0] ?? '')}*"`,
      safe_next_action: 'Check whether the missing path is generated, target-only, or expected from a vendor extraction step.',
    });
  }

  contradictions.push(...buildSemanticPolicyContradictions(context));
  contradictions.push(...buildNebulaRuntimeContradictions(context));

  return dedupeById(contradictions);
}

function buildSemanticPolicyContradictions(context) {
  if (!isSemanticPolicyProfile(context.profile)) {
    return [];
  }

  const byCategory = new Map();
  for (const claim of context.semanticPolicyClaims) {
    if (claim.category === 'generated_artifact' || isAuxiliarySourcePath(claim.source_file) || isGeneratedArtifactPath(claim.source_file)) {
      continue;
    }
    if (!byCategory.has(claim.category)) {
      byCategory.set(claim.category, []);
    }
    byCategory.get(claim.category).push(claim);
  }

  const contradictions = [];
  for (const rule of SEMANTIC_POLICY_CONFLICT_RULES) {
    const leftClaims = rule.left.flatMap(category => byCategory.get(category) ?? []);
    const rightClaims = rule.right.flatMap(category => byCategory.get(category) ?? []);
    if (!leftClaims.length || !rightClaims.length) {
      continue;
    }

    const claims = dedupeById([...leftClaims, ...rightClaims]);
    if (claims.length < 2) {
      continue;
    }

    const evidenceIds = claims.map(claim => claim.id);
    const groupId = stableId('CON', `semantic_policy:${rule.id}:${evidenceIds.slice().sort().join('|')}`);
    const sourceTerms = uniq([...rule.left, ...rule.right]);
    contradictions.push({
      id: groupId,
      category: 'semantic_policy_contradiction',
      severity: rule.severity,
      confidence: 'likely',
      title: rule.title,
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: rule.likelyWinner,
      likely_winner_reason: 'Semantic policy contradictions prefer the narrower or safer instruction until the owner clarifies scope.',
      rationale: 'The same policy surface contains incompatible normalized claims, so future agent runs may choose different behavior unless the conflict is resolved or scoped.',
      recommended_action: rule.action,
      investigation_command: `grep -RIn "${sourceTerms.map(escapeForGrep).join('\\|')}" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "${sourceTerms.map(escapeForGrep).join('\\|')}" "${context.projectRoot}"`,
      safe_next_action: 'Resolve the policy wording or document which instruction wins before applying side-effecting automation.',
    });

    addEvidence(context, {
      category: 'semantic_policy_contradiction',
      severity: rule.severity,
      confidence: 'likely',
      source_file: claims[0].source_file,
      source_line_start: claims[0].source_line_start,
      source_line_end: claims[0].source_line_end,
      extracted_text: claims.map(claim => `${claim.source_file}:${claim.source_line_start}:${claim.normalized_claim}`).join('; '),
      normalized_claim: `semantic_policy_conflict.${rule.id}=${sourceTerms.join('|')}`,
      related_symbols: sourceTerms,
      evidence_type: 'derived_contradiction',
      evidence_kind: 'derived',
      semantic_policy_category: 'semantic_policy_contradiction',
      semantic_policy_subject: rule.id,
      semantic_policy_predicate: 'conflict',
      semantic_policy_profile: context.profile.id,
      suggested_action: rule.action,
      rationale: 'Derived from normalized semantic policy claims that point in incompatible directions.',
      contradiction_group_id: groupId,
    });
  }

  return contradictions;
}

function buildNebulaRuntimeContradictions(context) {
  if (!isNebulaRuntimeProfile(context.profile)) {
    return [];
  }

  const contradictions = [];
  for (const laneEvidence of nebulaRuntimeEvidenceGroups(context).values()) {
    const byKey = key => laneEvidence.filter(item => {
      const parsed = parseRuntimeAssignmentClaim(item.normalized_claim);
      return parsed && runtimeAssignmentKeyMatches(parsed.key, key);
    });
    const gamescopeLibpath = byKey('GAMESCOPE_LIBPATH')
      .find(item => isImagefsFirstGamescopeLibpath(runtimeAssignmentValue(item)));
    const kgslEnv = [
      byKey('MESA_LOADER_DRIVER_OVERRIDE').find(item => runtimeAssignmentValue(item).toLowerCase() === 'kgsl'),
      byKey('GALLIUM_DRIVER').find(item => runtimeAssignmentValue(item).toLowerCase() === 'kgsl'),
      byKey('FD_FORCE_KGSL').find(item => runtimeAssignmentValue(item) === '1'),
      byKey('LIBGL_ALWAYS_SOFTWARE').find(item => runtimeAssignmentValue(item).toUpperCase() === 'UNSET'),
    ].filter(Boolean);
    const gamescopeExit = byKey('GAMESCOPE_EXIT')
      .find(item => runtimeAssignmentValue(item) === '135');
    const xwaylandNotInvoked = byKey('FINAL_XWAYLAND_RUNNER_INVOKED')
      .find(item => runtimeAssignmentValue(item) === '0');
    const vulkanDeviceNotFound = byKey('SELECTED_VULKAN_DEVICE')
      .find(item => runtimeAssignmentValue(item).toUpperCase() === 'NOT_FOUND');
    const exportNotReached = byKey('VKGETMEMORYFD_FIRST_LINE')
      .find(item => runtimeAssignmentValue(item).toUpperCase() === 'NOT_FOUND');

    if (!gamescopeLibpath || kgslEnv.length < 2 || !gamescopeExit || !xwaylandNotInvoked || !vulkanDeviceNotFound || !exportNotReached) {
      continue;
    }

    const claims = dedupeById([
      gamescopeLibpath,
      ...kgslEnv,
      gamescopeExit,
      xwaylandNotInvoked,
      vulkanDeviceNotFound,
      exportNotReached,
    ]);
    const evidenceIds = claims.map(claim => claim.id);
    const groupId = stableId('CON', `nebula_a1_multi_variable_early_exit:${evidenceIds.slice().sort().join('|')}`);

    addEvidence(context, {
      category: 'nebula_runtime_regression',
      severity: 'HIGH',
      confidence: 'likely',
      source_file: gamescopeLibpath.source_file,
      source_line_start: gamescopeLibpath.source_line_start,
      source_line_end: gamescopeLibpath.source_line_end,
      extracted_text: claims.map(claim => `${claim.source_file}:${claim.source_line_start}:${claim.normalized_claim}`).join('; '),
      normalized_claim: 'nebula_a1_multi_variable_regression:GAMESCOPE_LIBPATH=imagefs_first;KGSL_ENV=true;GAMESCOPE_EXIT=135;FINAL_XWAYLAND_RUNNER_INVOKED=0;SELECTED_VULKAN_DEVICE=NOT_FOUND;VKGETMEMORYFD_FIRST_LINE=NOT_FOUND',
      related_symbols: [
        'GAMESCOPE_LIBPATH',
        'MESA_LOADER_DRIVER_OVERRIDE',
        'GALLIUM_DRIVER',
        'FD_FORCE_KGSL',
        'LIBGL_ALWAYS_SOFTWARE',
        'GAMESCOPE_EXIT',
        'FINAL_XWAYLAND_RUNNER_INVOKED',
        'SELECTED_VULKAN_DEVICE',
        'VKGETMEMORYFD_FIRST_LINE',
      ],
      evidence_type: 'derived_contradiction',
      suggested_action: 'Do not infer export improvement or source-patch readiness; run A1B with A0 Gamescope libpath restored and only KGSL export env changed.',
      rationale: 'The run changed both Gamescope library resolution and GPU export env, then exited before Xwayland, Vulkan device selection, and vkGetMemoryFdKHR evidence.',
      contradiction_group_id: groupId,
    });

    contradictions.push({
      id: groupId,
      category: 'nebula_runtime_regression',
      severity: 'HIGH',
      confidence: 'likely',
      title: 'A1 changed Gamescope libpath and KGSL env before early exit',
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: 'A1B_KGSL_ENV_ONLY_R6_LIBPATH_RESTORED',
      likely_winner_reason: 'A1 changed more than the intended KGSL export variables, so the next valid proof gate restores the known A0 Gamescope libpath and isolates KGSL env.',
      rationale: 'Gamescope exited before Xwayland and before Vulkan export evidence, while A1 also changed Gamescope library resolution order. This prevents treating vkGetMemoryFdKHR=0 as an improvement or using the run for source patch decisions.',
      recommended_action: 'Run A1B with the A0 sidecar-first GAMESCOPE_LIBPATH restored and only the Fasttest-02 KGSL/Turnip env applied to Gamescope.',
      investigation_command: `grep -RIn "GAMESCOPE_LIBPATH\\|MESA_LOADER_DRIVER_OVERRIDE\\|GALLIUM_DRIVER\\|FD_FORCE_KGSL\\|LIBGL_ALWAYS_SOFTWARE\\|GAMESCOPE_EXIT\\|FINAL_XWAYLAND_RUNNER_INVOKED\\|SELECTED_VULKAN_DEVICE\\|VKGETMEMORYFD_FIRST_LINE" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "GAMESCOPE_LIBPATH\\|GAMESCOPE_EXIT\\|FINAL_XWAYLAND_RUNNER_INVOKED\\|SELECTED_VULKAN_DEVICE\\|VKGETMEMORYFD_FIRST_LINE" "${context.projectRoot}"`,
      safe_next_action: 'Do not patch source from this evidence; stage the isolated A1B runtime test.',
    });
  }

  return contradictions;
}

function nebulaRuntimeEvidenceGroups(context) {
  const keys = [
    'GAMESCOPE_LIBPATH',
    'MESA_LOADER_DRIVER_OVERRIDE',
    'GALLIUM_DRIVER',
    'FD_FORCE_KGSL',
    'LIBGL_ALWAYS_SOFTWARE',
    'GAMESCOPE_EXIT',
    'FINAL_XWAYLAND_RUNNER_INVOKED',
    'SELECTED_VULKAN_DEVICE',
    'VKGETMEMORYFD_FIRST_LINE',
  ];
  const groups = new Map();
  for (const key of keys) {
    for (const item of assignmentEvidence(context, key)) {
      const groupKey = nebulaRuntimeEvidenceGroupKey(item.source_file);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(item);
    }
  }
  return groups;
}

function nebulaRuntimeEvidenceGroupKey(sourceFile) {
  const normalized = normalizePath(sourceFile);
  if (!normalized || !normalized.includes('/')) {
    return '.';
  }
  return normalized.split('/')[0];
}

function assignmentEvidence(context, key) {
  return context.evidence.filter(item => {
    const parsed = parseRuntimeAssignmentClaim(item.normalized_claim);
    return parsed && runtimeAssignmentKeyMatches(parsed.key, key);
  });
}

function runtimeAssignmentKeyMatches(observedKey, key) {
  return observedKey === key || observedKey.endsWith(`.${key}`);
}

function runtimeAssignmentValue(evidence) {
  return parseRuntimeAssignmentClaim(evidence?.normalized_claim)?.value ?? '';
}

function parseRuntimeAssignmentClaim(claim) {
  if (!claim) {
    return null;
  }
  const index = claim.indexOf('=');
  if (index <= 0) {
    return null;
  }
  return {
    key: claim.slice(0, index),
    value: claim.slice(index + 1),
  };
}

function isImagefsFirstGamescopeLibpath(value) {
  const imagefsIndex = value.indexOf('/files/imagefs/');
  const promotedSidecarIndex = value.indexOf('/files/sidecars/xwayland-gamescope-13-promoted');
  const anySidecarIndex = value.indexOf('/files/sidecars/');
  const sidecarIndex = promotedSidecarIndex >= 0 ? promotedSidecarIndex : anySidecarIndex;
  return imagefsIndex >= 0 && sidecarIndex >= 0 && imagefsIndex < sidecarIndex;
}

function buildPatchCandidates(context, contradictions) {
  const candidates = [];

  for (const contradiction of contradictions) {
    if (contradiction.category === 'nebula_runtime_regression') {
      continue;
    }

    const target = firstSourceFile(contradiction.conflicting_claims);
    const category = contradiction.category === 'known_good_mismatch'
      ? 'likely required fix'
      : contradiction.category === 'invalid_paths' || contradiction.category === 'missing_files'
        ? 'needs human review'
        : 'needs human review';

    candidates.push({
      id: stableId('PATCH', `${contradiction.id}:${target}`),
      title: contradiction.title,
      target_file: target,
      proposed_change: contradiction.likely_winner && contradiction.likely_winner !== 'tree_inventory'
        ? `Align the lower-confidence source declaration with ${contradiction.likely_winner}.`
        : 'Resolve the contradictory or missing reference after checking the evidence lines.',
      reason: contradiction.rationale,
      evidence_ids: contradiction.evidence_ids,
      risk_level: contradiction.severity === 'BLOCKER' || contradiction.severity === 'HIGH' ? 'medium' : 'low',
      rollback_plan: 'Revert the target file change and rerun the same scan command to confirm the finding returns.',
      validation_commands: buildCommandsToRun(context.profile, context.projectRoot, [contradiction]).slice(0, 3),
      expected_result: 'The contradiction disappears from contradictions.json and no new HIGH/BLOCKER findings are introduced.',
      failure_signs: 'Build failures, missing generated files, or a new contradiction around the same variable/path.',
      group: category,
    });
  }

  const placeholderFiles = new Map();
  for (const evidence of context.evidence) {
    if (evidence.category !== 'placeholders' && evidence.category !== 'todo_fixme_stub_markers') {
      continue;
    }
    if (!isPlaceholderPatchCandidateEligible(evidence.source_file)) {
      continue;
    }
    if (!placeholderFiles.has(evidence.source_file)) {
      placeholderFiles.set(evidence.source_file, []);
    }
    placeholderFiles.get(evidence.source_file).push(evidence);
  }

  for (const [file, items] of placeholderFiles) {
    candidates.push({
      id: stableId('PATCH', `placeholder:${file}:${items.map(item => item.id).join('|')}`),
      title: `Resolve placeholders in ${file}`,
      target_file: file,
      proposed_change: 'Replace placeholder/stub markers with verified device-specific values or document why they remain intentionally unresolved.',
      reason: 'Placeholders are explicit uncertainty and should not silently survive into a bring-up baseline.',
      evidence_ids: items.map(item => item.id),
      risk_level: items.some(item => item.severity === 'HIGH') ? 'medium' : 'low',
      rollback_plan: 'Restore the original marker lines from version control.',
      validation_commands: [`grep -n "TODO\\|FIXME\\|STUB\\|PLACEHOLDER" "${join(context.projectRoot, denormalizePath(file))}"`],
      expected_result: 'The targeted marker evidence disappears or is downgraded to an intentional risk note.',
      failure_signs: 'A marker is removed without replacement evidence or a matching validation note.',
      group: 'safe cleanup',
    });
  }

  return dedupeById(candidates);
}

function summarize(evidence, contradictions, patchCandidates) {
  const bySeverity = countBy(evidence, item => item.severity);
  const byCategory = countBy(evidence, item => item.category);
  const byConfidence = countBy(evidence, item => item.confidence);
  return {
    total_findings: evidence.length,
    total_contradictions: contradictions.length,
    total_patch_candidates: patchCandidates.length,
    by_severity: bySeverity,
    by_category: byCategory,
    by_confidence: byConfidence,
    highest_severity: highestSeverity(evidence),
  };
}

function buildRiskyAssumptions(evidence, contradictions) {
  return {
    weak_or_possible_findings: evidence
      .filter(item => item.confidence === 'weak' || item.confidence === 'possible')
      .map(item => ({
        evidence_id: item.id,
        category: item.category,
        claim: item.normalized_claim,
        file: item.source_file,
        line: item.source_line_start,
        reason: 'Confidence is below likely; verify before patching.',
      })),
    contradictions_without_winner: contradictions
      .filter(item => !item.likely_winner)
      .map(item => ({
        contradiction_id: item.id,
        title: item.title,
        reason: 'No known-good fact or stronger source selected a winner.',
      })),
  };
}

function buildCommandsToRun(profile, projectRoot, contradictions = []) {
  const commands = new Set();
  for (const command of profile.validationCommands ?? []) {
    addReadOnlyCommand(commands, command.replaceAll('{{projectRoot}}', shellQuote(projectRoot)));
  }
  for (const contradiction of contradictions) {
    addReadOnlyCommand(commands, contradiction.suggested_validation_command ?? contradiction.investigation_command);
  }
  return [...commands];
}

function addReadOnlyCommand(commands, command) {
  if (!command || !isReadOnlyCommand(command)) {
    return;
  }
  commands.add(command);
}

function isReadOnlyCommand(command) {
  const trimmed = String(command).trim();
  if (!trimmed) {
    return false;
  }
  if (/\b(dd|fastboot|flash|mkfs|parted|sgdisk|wipefs|mount|umount|adb\s+(?:push|shell\s+su|reboot)|rm|mv|cp)\b/i.test(trimmed)) {
    return false;
  }
  return /^(grep|find|test|sha256sum|node)\b/.test(trimmed);
}

function buildQuestionsForHuman(knownGoodComparison, contradictions) {
  const questions = [];
  for (const item of knownGoodComparison.not_observed ?? []) {
    questions.push({
      id: stableId('Q', `not_observed:${item.key}`),
      question: `Known-good fact "${item.key}" was supplied as "${item.expected}" but no matching source declaration was observed. Is the source tree incomplete, generated, or intentionally implicit?`,
      evidence_ids: [],
    });
  }
  for (const contradiction of contradictions.filter(item => !item.likely_winner || item.category === 'known_good_mismatch')) {
    questions.push({
      id: stableId('Q', contradiction.id),
      question: contradiction.category === 'known_good_mismatch'
        ? `Confirm that the known-good fact for "${contradiction.title.replace('Known-good mismatch for ', '')}" applies to this exact device/build before patching.`
        : `Which claim should win for "${contradiction.title}"?`,
      evidence_ids: contradiction.evidence_ids,
    });
  }
  return dedupeById(questions);
}

function addEvidence(context, input) {
  const normalizedClaim = input.normalized_claim ?? normalizeScalar(input.extracted_text ?? '');
  const sourceFile = input.source_file ?? '.';
  const lineStart = input.source_line_start ?? 1;
  const lineEnd = input.source_line_end ?? lineStart;
  const id = stableId('EV', [
    input.category,
    sourceFile,
    lineStart,
    lineEnd,
    normalizedClaim,
    input.evidence_type ?? 'source_line',
  ].join('|'));

  if (context.evidenceIds.has(id)) {
    return context.evidence.find(item => item.id === id);
  }
  context.evidenceIds.add(id);

  const evidence = {
    id,
    category: input.category ?? 'risk_notes',
    severity: input.severity ?? 'INFO',
    confidence: input.confidence ?? 'possible',
    source_file: sourceFile,
    source_line_start: lineStart,
    source_line_end: lineEnd,
    extracted_text: input.extracted_text ?? '',
    normalized_claim: normalizedClaim,
    ...(input.assignment_operator ? { assignment_operator: input.assignment_operator } : {}),
    ...(input.evidence_kind ? { evidence_kind: input.evidence_kind } : {}),
    ...(input.raw_evidence ? { raw_evidence: input.raw_evidence } : {}),
    ...(input.semantic_policy_category ? { semantic_policy_category: input.semantic_policy_category } : {}),
    ...(input.semantic_policy_subject ? { semantic_policy_subject: input.semantic_policy_subject } : {}),
    ...(input.semantic_policy_predicate ? { semantic_policy_predicate: input.semantic_policy_predicate } : {}),
    ...(input.semantic_policy_profile ? { semantic_policy_profile: input.semantic_policy_profile } : {}),
    related_paths: uniq(input.related_paths ?? []),
    related_symbols: uniq(input.related_symbols ?? []),
    related_build_vars: uniq(input.related_build_vars ?? []),
    related_device_props: uniq(input.related_device_props ?? []),
    evidence_type: input.evidence_type ?? 'source_line',
    suggested_action: input.suggested_action ?? '',
    rationale: input.rationale ?? '',
    contradiction_group_id: input.contradiction_group_id ?? null,
    patch_candidate_id: input.patch_candidate_id ?? null,
    timestamp: context.scanStartedAt,
  };
  context.evidence.push(evidence);
  return evidence;
}

function rememberPathReference(context, path, sourceFile, lineNo, extractedText, evidenceId, category) {
  const cleaned = cleanPathToken(path);
  if (!cleaned) {
    return;
  }
  context.pathReferences.push({
    path: cleaned,
    source_file: sourceFile,
    source_line_start: lineNo,
    extracted_text: extractedText,
    evidence_id: evidenceId,
    category,
  });
}

function categorizeAssignment(key, value, profile) {
  const upper = key.toUpperCase();
  if (/^(GAMESCOPE|BRIDGE|CHILD|XWAYLAND|FASTTEST02)_LIBPATH$/i.test(key) || upper === 'LD_LIBRARY_PATH') {
    return 'ld_library_path_linker_namespace_issues';
  }
  if (/^(GAMESCOPE_EXIT|FINAL_(GAMESCOPE|BRIDGE|XWAYLAND|CHILD)_.*|SELECTED_VULKAN_DEVICE|SELECTED_RENDER_NODE|PHYSICAL_DEVICE_DRM_LINE|VKGETMEMORYFD_.*|BRIDGE_(REAL_BUFFER|NO_BUFFER|FAILURE)_.*)$/i.test(key)) {
    return 'nebula_runtime_regression';
  }
  if (isWindowsProfile(profile)) {
    if (/^(SERVICENAME|DISPLAYNAME|SERVICETYPE|STARTTYPE|IMAGEPATH|SERVICEACCOUNT)$/i.test(key)
      || /\b(ServiceBase|CreateService|New-Service|sc\.exe|CurrentControlSet\\Services|SERVICE_WIN32)\b/i.test(value)) {
      return 'windows_service_surface';
    }
    if (/^(DRIVERNAME|DRIVERPACKAGE|SERVICEBINARY|CLASSGUID|KMDFFLAGS|WDF_|INF_)/i.test(key)
      || /\b(DriverEntry|KMDF|WDF|WDM|AddService|ServiceBinary|SERVICE_KERNEL_DRIVER|\.sys\b)\b/i.test(value)) {
      return 'windows_driver_surface';
    }
    if (/^(HKLM_|HKCU_|REGISTRY_|REG_)/i.test(key)
      || /\b(HKLM\\|HKCU\\|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|RegistryKey|reg add|reg\.exe)\b/i.test(value)) {
      return 'windows_registry_assumptions';
    }
    if (/^(PLATFORMTOOLSET|WINDOWSTARGETPLATFORMVERSION|TARGETFRAMEWORK|RUNTIMEIDENTIFIER|CONFIGURATIONTYPE|OUTDIR|TARGETPATH|VCTOOLSVERSION)$/i.test(key)
      || /\b(PlatformToolset|WindowsTargetPlatformVersion|TargetFramework|RuntimeIdentifier|Directory\.Build)\b/i.test(value)) {
      return 'windows_msbuild_visualstudio';
    }
    if (/^(PE_|SUBSYSTEM|REQUESTEDEXECUTIONLEVEL|CODESIGN|SIGNTOOL|AUTHENTICODE)/i.test(key)
      || /\b(PE32\+?|IMAGE_FILE_MACHINE|Subsystem|requestedExecutionLevel|signtool|Authenticode|test signing)\b/i.test(value)) {
      return 'windows_pe_metadata';
    }
  }
  if (isPCGamingWikiLikeProfile(profile)) {
    const directPCGWProfile = profile?.pcgamingwikiProfile === true;
    const exePatchProfile = isExePatchProfile(profile);
    if (/^(FLAWLESSWIDESCREEN|WIDESCREENFIX|ASPECTRATIO|FOV|HUDSAFEAREA|HUDFIX|ULTRAWIDE)$/i.test(key)
      || /\b(Flawless Widescreen|WSGF|SUWSF|ultrawide|widescreen|Hor\+|Vert-|aspect ratio|FOV|HUD fix)\b/i.test(value)) {
      return 'widescreen_fix_surface';
    }
    if (/^(FRAMEGENERATION|FRAMEGENERATIONMULTIPLIER|OPTISCALER|OPTIFG|LSFG|DLSSG|FSR_FG|XEFG|REFLEX|ANTILAG)$/i.test(key)
      || /\b(frame generation|DLSSG|DLSS Frame Generation|FSR[-_ ]?(?:FG|Frame Generation)|OptiScaler|OptiFG|Lossless Scaling|LSFG|XeFG|Reflex|Anti-?Lag)\b/i.test(value)) {
      return 'frame_generation_pipeline';
    }
    if (/^(WINDOWSFRAMEGEN|DLSSG|OPTISCALER|OPTIFG|REFLEX|ANTILAG)$/i.test(key)
      || /\b(nvngx_dlssg\.dll|sl\.dlss_g\.dll|sl\.interposer\.dll|dxgi\.dll|winmm\.dll|version\.dll|HUDless|OptiScaler\.ini|Windows Graphics Capture|AFMF)\b/i.test(value)) {
      return 'framegen_windows_runtime';
    }
    if (/^(LINUXFRAMEGEN|ENABLE_LSFG|LSFG|PROTON_|WINE_|DXVK_|VKD3D_)$/i.test(key)
      || /\b(lsfg-vk|ENABLE_LSFG|VK_LAYER|Vulkan layer|Lossless Scaling on Linux|Steam Deck|SteamOS|WINEPREFIX)\b/i.test(value)
      || /\b(?:Proton|Wine|DXVK|VKD3D|Gamescope|MangoHud)\b/i.test(value) && /\b(frame generation|FrameGeneration|LSFG|OptiFG|DLSSG|FSR[-_ ]?FG|XeFG)\b/i.test(value)) {
      return 'framegen_linux_runtime';
    }
    if (exePatchProfile) {
      if (/^(TARGETEXE|TARGETEXEPATH|PATCHID|PATCHSCOPE)$/i.test(key)
        || /\b(executable patch|binary patch|offline patch|private co-?op patch|single-player patch|\.exe\b)\b/i.test(value)) {
        return 'exe_patch_surface';
      }
      if (/^(FILEVERSION|PRODUCTVERSION|STEAMBUILDID|SHA256BEFORE|SHA256AFTER|CRC32BEFORE|CRC32AFTER|PEMACHINE|PETIMESTAMP)$/i.test(key)
        || /\b(FileVersion|ProductVersion|SteamBuildId|SHA256|CRC32|PEMachine|PETimestamp|TimeDateStamp)\b/i.test(value)) {
        return 'exe_version_hash_guard';
      }
      if (/^(RVA|VA|FILEOFFSET|ORIGINALBYTES|PATCHEDBYTES|AOBSIGNATURE)$/i.test(key)
        || /\b(RVA|FileOffset|OriginalBytes|PatchedBytes|AOBSignature|signature scan|pattern scan)\b/i.test(value)) {
        return 'exe_rva_signature_mapping';
      }
      if (/^(DISASSEMBLER|SYMBOL|FUNCTION|CALLSITE)$/i.test(key)
        || /\b(x64dbg|Ghidra|IDA|Binary Ninja|disassembly|symbol|xref|callsite)\b/i.test(value)) {
        return 'exe_disassembly_symbol_notes';
      }
      if (/^(BACKUPPATH|ROLLBACKPLAN)$/i.test(key)
        || /\b(rollback|backup|restore|original bytes|dry run|no-write|no write)\b/i.test(value)) {
        return 'exe_patch_backup_rollback';
      }
      if (/^(LINUXPATCHTARGET|PROTONPATCHTARGET|WINEPATCHTARGET|LINUXVALIDATION|PROTONVALIDATION|DXVKVALIDATION|VKD3DVALIDATION)$/i.test(key)
        || /\b(Proton patch|Wine patch|Steam Deck patch|compatdata\/[0-9]+|WINEPREFIX|PROTON_LOG|DXVK|VKD3D|Gamescope|MangoHud|gamemoderun)\b/i.test(value)) {
        return 'exe_patch_linux_compat';
      }
      if (/^(PATCHSAFETY|SAFETYBOUNDARY)$/i.test(key)
        || /\b(DRM bypass|anti-cheat bypass|anticheat bypass|stealth injection|public match|ranked|ban evasion|ownership verification|license check)\b/i.test(value)) {
        return 'exe_patch_safety_boundary';
      }
    }
    if (/^(CONFIGPATH|SAVEPATH|CLOUDSYNC|XDG_|WINEPREFIX|PROTONPREFIX)$/i.test(key)
      || (directPCGWProfile && /\b(Configuration file|Save game|Steam Cloud|XDG_|AppData|Saved Games|compatdata\/[0-9]+|pfx\/drive_c)\b/i.test(value))) {
      return 'pcgw_game_data_paths';
    }
    if (/^(DRM|STORE|STEAMAPPID|GOGID|EPICID|PRODUCTID|VERSIONDIFFERENCES)$/i.test(key)
      || (directPCGWProfile && /\b(Availability|DRM|Steam|GOG|Epic Games Store|Microsoft Store|DLC|version differences?)\b/i.test(value))) {
      return 'pcgw_availability_drm';
    }
    if (/^(FOV|VSYNC|HDR|DISPLAYMODE|RESOLUTION|ULTRAWIDE|FPSLIMIT|FRAMERATE)$/i.test(key)
      || (directPCGWProfile && /\b(FOV|ultrawide|widescreen|V-?Sync|HDR|DLSS|FSR|XeSS|stutter|frame rate)\b/i.test(value))) {
      return 'pcgw_video_display_fixes';
    }
    if (/^(CONTROLLERSUPPORT|INPUT|AUDIO|NETWORK|PORTS|VR_SUPPORT)$/i.test(key)
      || (directPCGWProfile && /\b(controller|Input|Audio|Network|Multiplayer|Ports|VR support|OpenXR|OpenVR)\b/i.test(value))) {
      return 'pcgw_input_audio_network';
    }
    if (/^(API|MIDDLEWARE|ENGINE)$/i.test(key)
      || (directPCGWProfile && /\b(Direct3D|D3D11|D3D12|OpenGL|Vulkan|Bink|PhysX|Havok|Steamworks|Middleware)\b/i.test(value))) {
      return 'pcgw_api_middleware';
    }
    if (/^(PROTONVERSION|WINEVERSION|LAUNCHOPTIONS|PROTON_|WINE_|DXVK_|VKD3D_)$/i.test(key)
      || (directPCGWProfile && /\b(Linux|Steam Deck|Wine|Proton|Gamescope|gamemoderun|PROTON_LOG|WINEPREFIX)\b/i.test(value))) {
      return 'pcgw_linux_wine_proton';
    }
    if (/^(ISSUE|FIX|WORKAROUND|COMMANDLINEARGUMENTS|INISETTINGS)$/i.test(key)
      || (directPCGWProfile && /\b(Issues fixed|Issues unresolved|crash|stutter|workaround|skip intro|command line arguments|INI settings)\b/i.test(value))) {
      return 'pcgw_issue_fix_notes';
    }
  }
  if (isAgenticGatewayProfile(profile)) {
    if (isSecretBearingKey(key)
      || /\b(redact|redaction|safe_diagnostics|api key|auth token|secret)\b/i.test(value)) {
      return 'secret_redaction_surface';
    }
    if (/^(FCC_SMOKE_|SMOKE_|PYTEST_|FEATURE_INVENTORY|CAPABILITY_CONTRACTS)/i.test(key)) {
      return 'smoke_coverage_surface';
    }
    if (/^(MESSAGING_|TELEGRAM_|DISCORD_|VOICE_)/i.test(key)) {
      return 'messaging_bridge_surface';
    }
    if (/^(MODEL_OPUS|MODEL_SONNET|MODEL_HAIKU|PROVIDER_|SUPPORTED_PROVIDER_IDS|PROVIDER_CATALOG)/i.test(key)) {
      return 'model_routing_surface';
    }
    if (/^(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|OPENAI_BASE_URL|OPENAI_API_BASE|CODEX_API_KEY|FCC_CODEX_API_KEY|CLAUDE_CODE_|CODEX_)/i.test(key)) {
      return 'client_launcher_surface';
    }
  }
  if (/^(MODEL|MODEL_[A-Z0-9_]+|ANTHROPIC_|OPENAI_|NVIDIA_NIM_|BASE_URL|ANTHROPIC_BASE_URL|OPENAI_BASE_URL|FCC_|PROVIDER|.*_API_KEY)$/i.test(key)
    || /\b(Anthropic Messages|OpenAI Responses|NVIDIA_NIM|provider|proxy|gateway)\b/i.test(value)) {
    return 'provider_routing_surface';
  }
  if (/^(MEMORY_|CONTEXT_|TRANSCRIPT_|COMPACTION_|SESSION_MEMORY)/i.test(key)
    || /\b(memory|persistent context|context compact|compaction|transcript|evidence\.jsonl|agent_handoff)\b/i.test(value)) {
    return 'memory_context_injection';
  }
  if (/^(ALLOW_|DENY_|PERMISSION_|SANDBOX|ALLOWEDTOOLS|DISALLOWEDTOOLS|APPROVAL)/i.test(key)
    || /\b(allowlist|denylist|dangerously-skip-permissions|sandbox|read-only|destructive)\b/i.test(value)) {
    return 'permission_safety_policy';
  }
  if (/^(HOOK_|PRETOOLUSE|POSTTOOLUSE|USERPROMPTSUBMIT|SESSIONSTART|STOP_HOOK)/i.test(key)
    || /\b(PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|hooks\.json)\b/i.test(value)) {
    return 'hook_lifecycle_policy';
  }
  if (/^(SUBAGENT_|WORKER_AGENT|EXPLORER_AGENT|AGENT_TEAM)/i.test(key)
    || /\b(subagent|worker agent|explorer agent|agent team|orchestrator)\b/i.test(value)) {
    return 'subagent_orchestration';
  }
  if (/^(WORKTREE_|BRANCH_ISOLATION|TASK_ISOLATION)/i.test(key)
    || /\b(worktree|task isolation|branch isolation)\b/i.test(value)) {
    return 'worktree_isolation';
  }
  if (/^(MCP_|PLUGIN_|CONNECTOR_)/i.test(key)
    || /\b(MCP|mcp server|plugin|connector)\b/i.test(value)) {
    return 'mcp_plugin_surface';
  }
  if (/^(PRESENTHOOK|RESIZEBUFFERSHOOK|SWAPCHAIN|SWAPCHAINFORMAT|DXGI_|D3D11_)/i.test(key)
    || /\b(IDXGISwapChain|Present1?|ResizeBuffers|CreateSwapChain|D3D11CreateDevice|DXGI_SWAP_CHAIN)\b/i.test(value)) {
    return 'render_hook_surface';
  }
  if (/^(TARGETFRAMETIMEMS|FRAMERATELIMIT|WAITABLESWAPCHAIN|LOWLATENCYMODE|MAXFRAMELATENCY|LATENCYLIMITER|PRESENTINTERVAL)$/i.test(key)
    || /\b(frame limiter|frametime|frame pacing|waitable swapchain|present interval)\b/i.test(value)) {
    return 'frame_timing_control';
  }
  if (/^(TEXTUREINJECTION|REPLACEMENTMANIFEST|TEXTUREMANIFEST|TEXTUREHASH|TEXTUREFORMAT)$/i.test(key)
    || /\b(TextureInjection|ReplacementManifest|CreateTexture2D|PSSetShaderResources|DDS|BC7|mipmap|sRGB|texture hash)\b/i.test(value)) {
    return 'texture_injection_pipeline';
  }
  if (/^(HDRMODE|HDRCOLORSPACE|HDRMETADATA|PAPERWHITE|PEAKNITS|TONEMAP)$/i.test(key)
    || /\b(HDR10|scRGB|PQ|Rec\.?2020|DXGI_COLOR_SPACE|SetHDRMetaData|R10G10B10A2|R16G16B16A16_FLOAT)\b/i.test(value)) {
    return 'hdr_pipeline';
  }
  if (/^(APITRANSLATION|GRAPHICSAPI|WRAPPERAPI|RENDERBACKEND)$/i.test(key)
    || /\b(DXVK|VKD3D|D3D11On12|WineD3D|OpenGL|Vulkan|D3D11|D3D12|D3D9)\b/i.test(value)) {
    return 'api_translation_layer';
  }
  if (/^(MESA_|TU_|BOX64_|BOX86_|WINE_|PROOT_|TERMUX_|VK_DRIVER_FILES|VK_ICD_FILENAMES)/i.test(key)
    || /\b(RM11Pro|Red Magic|Adreno|Turnip|Mesa|Freedreno|Termux|proot|box64|Wine|Winlator|Mobox|FEX)\b/i.test(value)) {
    return 'mobile_linux_runtime';
  }
  if (/^(MAXFPS|SMOOTHFRAMERATE|MAXFRAMELATENCY|BACKBUFFERCOUNT|VIDEOMEMORY|STREAMMINRESIDENT|RESTRICTGRAPHICSOPTIONS|COM_MAXFPS|R_|VID_)/i.test(key)) {
    return 'bo3_config';
  }
  if (/^(STEAMAPPID|STEAM_APPID|APPID|GAME_APPID|GAME_EXE|GAME_PATH|TARGET_EXE|EXECUTABLE|NETWORK_PASSWORD|LOBBY_PASSWORD|FRIENDS_ONLY)$/i.test(key)
    || /\b(BlackOps3(?:\.exe)?|Steam AppID\s*311210|steam_appid|311210|T7Patch|t7patch)\b/i.test(value)) {
    return 'game_runtime_identity';
  }
  if (/^(WINEDLLOVERRIDES|DXVK|DXVK_|VKD3D|VKD3D_|PROTON|PROTON_|MESA|MESA_)/i.test(key)
    || /\b(DXVK|VKD3D|d3d11\.dll|dxgi\.dll|dinput8\.dll|winmm\.dll|version\.dll|ReShade|SpecialK|3DMigoto|SUWSF|OptiScaler)\b/i.test(value)) {
    return 'graphics_wrapper_chain';
  }
  if (/^(VK_|VULKAN_|ICD_|VULKAN)/i.test(key)
    || /\b(VK_ICD_FILENAMES|VK_DRIVER_FILES|VK_LOADER_DEBUG|VK_INSTANCE_LAYERS|ERROR_INCOMPATIBLE_DRIVER|vk_icdNegotiateLoaderICDInterfaceVersion|ICD\.library_path)\b/i.test(value)) {
    return 'vulkan_loader';
  }
  if (/^(PRODUCT|TARGET)(_DEVICE|_NAME|_MODEL)|TARGET_OTA_ASSERT_DEVICE|TARGET_BOOTLOADER_BOARD_NAME|RO\.PRODUCT\.|RO\.BUILD\.PRODUCT/i.test(key)) {
    return 'device_identity';
  }
  if (/^(ANLAND_SOCKET|ANLAND_SOCKET_HOST|ANLAND_SOCKET_GUEST|QT_QPA_PLATFORM|WAYLAND_DISPLAY|DISPLAY|XDG_RUNTIME_DIR)$/i.test(key)) {
    return 'display_touch_framebuffer_config';
  }
  if (isSocPlatformKey(key) || /\b(sm\d{4}|qcom|orion|oryon)\b/i.test(value)) {
    return 'soc_platform_identity';
  }
  if (/PARTITION_SIZE|IMAGE_PARTITION_SIZE/i.test(key)) {
    return 'partition_sizes';
  }
  if (/BOOT_HEADER|MKBOOTIMG|KERNEL_(BASE|PAGESIZE|CMDLINE|HEADER)|BOARD_EXCLUDE_KERNEL_FROM_RECOVERY_IMAGE/i.test(key)) {
    return 'kernel_header_assumptions';
  }
  if (/AVB|VBMETA|VERITY/i.test(key)) {
    return 'avb_vbmeta_assumptions';
  }
  if (/LD_LIBRARY_PATH|LINKER|NAMESPACE/i.test(key)) {
    return 'ld_library_path_linker_namespace_issues';
  }
  if (/FSTAB/i.test(key)) {
    return 'fstab_entries';
  }
  if (/KEYMASTER|KEYMINT|GATEKEEPER|CRYPT|DECRYPT/i.test(key)) {
    return 'keymaster_keymint_gatekeeper_decrypt_dependencies';
  }
  if (/DISPLAY|TOUCH|FRAMEBUFFER|SCREEN|THEME|ROTATION|PIXEL_FORMAT/i.test(key) || /OF_SCREEN|TW_THEME/.test(upper)) {
    return 'display_touch_framebuffer_config';
  }
  if (/COPY_FILES|BLOB|VENDOR|PROPRIETARY/i.test(key)) {
    return 'vendor_blobs';
  }
  return 'build_variables';
}

function shouldPreserveLocalAssignmentCategory(category, profile, key, filePath) {
  const envLikeKey = /^[A-Z][A-Z0-9_]*$/.test(key);
  const projectDataAssignment = isProjectLevelAssignment(key, filePath) && !isCodeSourceFile(filePath);
  return isAgenticGatewayProfile(profile)
    && category === 'secret_redaction_surface'
    && isSecretBearingKey(key)
    && (projectDataAssignment || envLikeKey);
}

function isSecretBearingKey(key) {
  const normalized = key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (isTokenAccountingKey(normalized)) {
    return false;
  }

  return /(^|_)(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|BOT_TOKEN|HF_TOKEN|TOKEN|SECRET|WEBHOOK|CREDENTIAL|PASSWORD|PRIVATE_KEY)(_|$)/.test(normalized)
    || /(^|_)AUTH(_|$)/.test(normalized);
}

function isTokenAccountingKey(normalizedKey) {
  return normalizedKey === 'TOKENS'
    || normalizedKey === 'TOKEN_COUNTER'
    || /(^|_)(INPUT|OUTPUT|REASONING|TEXT|TOOL|TOTAL|PROMPT|COMPLETION|CACHE|CACHED|MAX|DEFAULT_MAX)_?TOKENS?$/.test(normalizedKey);
}

function isProjectLevelAssignment(key, filePath) {
  if (key.startsWith('ro.')) {
    return true;
  }

  const name = filePath.split('/').pop() ?? filePath;
  if (/^(BoardConfig.*\.mk|AndroidProducts\.mk|.*\.mk|.*\.env|.*\.prop|.*\.toml|.*\.ya?ml|.*\.json|.*\.ini|.*\.cfg|.*\.conf|Dockerfile|Makefile|Kconfig|.*fstab.*)$/i.test(name)) {
    return true;
  }

  if (/^[A-Z0-9_.-]+$/.test(key) && !isCodeSourceFile(filePath)) {
    return true;
  }

  return /(^|\/)(config|configs?|settings|profiles?)\//i.test(filePath);
}

function isLocalCodeAssignment(key, filePath) {
  if (isCodeSourceFile(filePath)) {
    return !key.startsWith('ro.');
  }

  if (!/^[a-z_][a-z0-9_.-]*$/.test(key)) {
    return false;
  }

  return !isProjectLevelAssignment(key, filePath)
    && /(^|\/)(templates?|examples?|fixtures?|scripts?|bin|sbin)\//i.test(filePath);
}

function isCodeSourceFile(filePath) {
  const name = filePath.split('/').pop() ?? filePath;
  return /\.(py|js|jsx|ts|tsx|mjs|cjs|sh|bash|zsh|fish|rb|go|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|php|swift|lua|pl|ps1)$/i.test(name);
}

function isSectionedConfigFile(filePath) {
  const name = filePath.split('/').pop() ?? filePath;
  return /\.(toml|ini|cfg|conf)$/i.test(name);
}

function severityForAssignment(key, category) {
  if (category === 'local_code_assignments') {
    return 'LOW';
  }
  if (category === 'provider_routing_surface' || category === 'permission_safety_policy') {
    return 'HIGH';
  }
  if (category === 'provider_catalog_surface'
    || category === 'model_routing_surface'
    || category === 'protocol_adapter_surface'
    || category === 'client_launcher_surface'
    || category === 'secret_redaction_surface') {
    return 'HIGH';
  }
  if (category === 'admin_config_surface'
    || category === 'smoke_coverage_surface'
    || category === 'messaging_bridge_surface') {
    return 'MEDIUM';
  }
  if (category === 'hook_lifecycle_policy'
    || category === 'memory_context_injection'
    || category === 'subagent_orchestration'
    || category === 'worktree_isolation'
    || category === 'mcp_plugin_surface') {
    return 'MEDIUM';
  }
  if (category === 'pcgw_game_data_paths'
    || category === 'pcgw_api_middleware'
    || category === 'pcgw_linux_wine_proton'
    || category === 'widescreen_fix_surface'
    || category === 'frame_generation_pipeline'
    || category === 'framegen_windows_runtime'
    || category === 'framegen_linux_runtime'
    || category === 'nebula_runtime_regression'
    || category === 'exe_patch_surface'
    || category === 'exe_version_hash_guard'
    || category === 'exe_rva_signature_mapping'
    || category === 'exe_patch_backup_rollback'
    || category === 'exe_patch_linux_compat'
    || category === 'exe_patch_safety_boundary'
    || category === 'windows_service_surface'
    || category === 'windows_driver_surface'
    || category === 'windows_registry_assumptions') {
    return 'HIGH';
  }
  if (category === 'pcgw_availability_drm'
    || category === 'pcgw_video_display_fixes'
    || category === 'pcgw_input_audio_network'
    || category === 'pcgw_issue_fix_notes'
    || category === 'exe_disassembly_symbol_notes'
    || category === 'windows_msbuild_visualstudio'
    || category === 'windows_pe_metadata'
    || category === 'windows_installer_layout') {
    return 'MEDIUM';
  }
  if (category === 'render_hook_surface' || category === 'frame_timing_control' || category === 'hdr_pipeline' || category === 'mobile_linux_runtime') {
    return 'HIGH';
  }
  if (category === 'texture_injection_pipeline' || category === 'api_translation_layer') {
    return 'MEDIUM';
  }
  if (category === 'vulkan_loader') {
    return 'HIGH';
  }
  if (category === 'nebula_runtime_regression') {
    return 'HIGH';
  }
  if (category === 'game_runtime_identity' || category === 'bo3_config' || category === 'graphics_wrapper_chain') {
    return 'MEDIUM';
  }
  if (category === 'device_identity' || category === 'soc_platform_identity') {
    return 'HIGH';
  }
  if (category === 'partition_sizes' || category === 'kernel_header_assumptions') {
    return 'HIGH';
  }
  if (category === 'avb_vbmeta_assumptions' || category === 'fstab_entries') {
    return 'HIGH';
  }
  if (key.includes('LD_LIBRARY_PATH')) {
    return 'HIGH';
  }
  return 'MEDIUM';
}

function groupDefinitionEvidence(evidence) {
  const groups = new Map();
  for (const item of evidence) {
    if (!isDefinitionGroupingEligible(item)) {
      continue;
    }

    const claim = parseAssignmentClaim(item.normalized_claim);
    if (!claim) {
      continue;
    }

    if (!isDefinitionCategory(item.category)) {
      continue;
    }

    if (!groups.has(claim.key)) {
      groups.set(claim.key, []);
    }
    groups.get(claim.key).push(item);
  }
  return groups;
}

function groupCanonicalDefinitionEvidence(evidence) {
  const groups = new Map();
  for (const item of evidence) {
    if (!isDefinitionGroupingEligible(item)) {
      continue;
    }

    if (!isDefinitionCategory(item.category)) {
      continue;
    }

    const claim = parseAssignmentClaim(item.normalized_claim);
    if (!claim) {
      continue;
    }

    const canonical = canonicalFactKey(claim.key);
    if (!canonical) {
      continue;
    }

    if (!groups.has(canonical)) {
      groups.set(canonical, []);
    }
    groups.get(canonical).push(item);
  }
  return groups;
}

function isDefinitionGroupingEligible(item) {
  if (item.assignment_operator === '+=' || isAuxiliarySourcePath(item.source_file)) {
    return false;
  }

  const claim = parseAssignmentClaim(item.normalized_claim);
  return !claim || !isVolatileRuntimeDefinitionKey(claim.key);
}

function isDerivedPathCheckEligible(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return !isAuxiliarySourcePath(sourceFile)
    && !normalized.startsWith('docs/')
    && !normalized.startsWith('test/');
}

function isAuxiliarySourcePath(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return normalized.startsWith('test/fixtures/')
    || normalized.startsWith('docs/upstreams/')
    || /^agents\/[^/]+\/references\//.test(normalized);
}

function isPlaceholderPatchCandidateEligible(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return !isGeneratedArtifactPath(normalized)
    && !isAuxiliarySourcePath(normalized)
    && !normalized.startsWith('test/');
}

function isDefinitionCategory(category) {
  return [
    'build_variables',
    'device_identity',
    'soc_platform_identity',
    'partition_sizes',
    'kernel_header_assumptions',
    'avb_vbmeta_assumptions',
    'display_touch_framebuffer_config',
    'ld_library_path_linker_namespace_issues',
    'bo3_config',
    'game_runtime_identity',
    'graphics_wrapper_chain',
    'vulkan_loader',
    'nebula_runtime_regression',
    'render_hook_surface',
    'frame_timing_control',
    'texture_injection_pipeline',
    'hdr_pipeline',
    'api_translation_layer',
    'mobile_linux_runtime',
    'provider_routing_surface',
    'provider_catalog_surface',
    'model_routing_surface',
    'protocol_adapter_surface',
    'client_launcher_surface',
    'admin_config_surface',
    'smoke_coverage_surface',
    'messaging_bridge_surface',
    'secret_redaction_surface',
    'permission_safety_policy',
    'hook_lifecycle_policy',
    'memory_context_injection',
    'subagent_orchestration',
    'worktree_isolation',
    'mcp_plugin_surface',
    'pcgw_game_data_paths',
    'pcgw_availability_drm',
    'pcgw_video_display_fixes',
    'pcgw_input_audio_network',
    'pcgw_api_middleware',
    'pcgw_linux_wine_proton',
    'pcgw_issue_fix_notes',
    'widescreen_fix_surface',
    'frame_generation_pipeline',
    'framegen_windows_runtime',
    'framegen_linux_runtime',
    'exe_patch_surface',
    'exe_version_hash_guard',
    'exe_rva_signature_mapping',
    'exe_disassembly_symbol_notes',
    'exe_patch_backup_rollback',
    'exe_patch_linux_compat',
    'exe_patch_safety_boundary',
    'windows_service_surface',
    'windows_driver_surface',
    'windows_registry_assumptions',
    'windows_msbuild_visualstudio',
    'windows_pe_metadata',
    'windows_installer_layout',
  ].includes(category);
}

function parseAssignmentClaim(claim) {
  if (!claim || claim.includes(':')) {
    return null;
  }
  const index = claim.indexOf('=');
  if (index <= 0) {
    return null;
  }
  return {
    key: claim.slice(0, index),
    value: claim.slice(index + 1),
  };
}

function extractClaimValue(claim) {
  const parsed = parseAssignmentClaim(claim);
  return parsed ? parsed.value : claim;
}

function isVolatileRuntimeDefinitionKey(key) {
  const shortKey = String(key).split('.').pop();
  return /^_$/.test(shortKey)
    || /^ARGV_\d+$/.test(shortKey)
    || /^(DATE|HIGHEST_MAP_END|MAPPING_EXCEEDS_39BIT_ASSUMPTION|KERNEL_VA_LIMIT_NOTE|WAYLAND_SOCKET)$/.test(shortKey);
}

function contradictionCategoryForKey(key) {
  if (/(KEY|TOKEN|SECRET|WEBHOOK|AUTH|CREDENTIAL)/i.test(key)) {
    return 'secret_redaction_surface';
  }
  if (/^(MODEL_OPUS|MODEL_SONNET|MODEL_HAIKU|MODEL|PROVIDER_|SUPPORTED_PROVIDER_IDS|PROVIDER_CATALOG)/i.test(key)) {
    return 'model_routing_surface';
  }
  if (/^(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|OPENAI_BASE_URL|OPENAI_API_BASE|CODEX_API_KEY|FCC_CODEX_API_KEY|CLAUDE_CODE_|CODEX_)/i.test(key)) {
    return 'client_launcher_surface';
  }
  if (/^(FCC_SMOKE_|SMOKE_|PYTEST_)/i.test(key)) {
    return 'smoke_coverage_surface';
  }
  if (/^(MESSAGING_|TELEGRAM_|DISCORD_|VOICE_)/i.test(key)) {
    return 'messaging_bridge_surface';
  }
  if (/^(MODEL|MODEL_|ANTHROPIC_|OPENAI_|NVIDIA_NIM_|BASE_URL|ANTHROPIC_BASE_URL|OPENAI_BASE_URL|FCC_|PROVIDER|.*_API_KEY)$/i.test(key)) {
    return 'provider_routing_surface';
  }
  if (/^(ALLOW_|DENY_|PERMISSION_|SANDBOX|ALLOWEDTOOLS|DISALLOWEDTOOLS|APPROVAL)/i.test(key)) {
    return 'permission_safety_policy';
  }
  if (/^(GAMESCOPE|BRIDGE|CHILD|XWAYLAND|FASTTEST02)_LIBPATH$/i.test(key)
    || /^(GAMESCOPE_EXIT|FINAL_(GAMESCOPE|BRIDGE|XWAYLAND|CHILD)_.*|SELECTED_VULKAN_DEVICE|SELECTED_RENDER_NODE|PHYSICAL_DEVICE_DRM_LINE|VKGETMEMORYFD_.*|BRIDGE_(REAL_BUFFER|NO_BUFFER|FAILURE)_.*)$/i.test(key)) {
    return 'nebula_runtime_regression';
  }
  if (/^(HOOK_|PRETOOLUSE|POSTTOOLUSE|USERPROMPTSUBMIT|SESSIONSTART|STOP_HOOK)/i.test(key)) {
    return 'hook_lifecycle_policy';
  }
  if (/^(MEMORY_|CONTEXT_|TRANSCRIPT_|COMPACTION_|SESSION_MEMORY)/i.test(key)) {
    return 'memory_context_injection';
  }
  if (/^(SUBAGENT_|WORKER_AGENT|EXPLORER_AGENT|AGENT_TEAM)/i.test(key)) {
    return 'subagent_orchestration';
  }
  if (/^(WORKTREE_|BRANCH_ISOLATION|TASK_ISOLATION)/i.test(key)) {
    return 'worktree_isolation';
  }
  if (/^(MCP_|PLUGIN_|CONNECTOR_)/i.test(key)) {
    return 'mcp_plugin_surface';
  }
  if (/^(CONFIGPATH|SAVEPATH|CLOUDSYNC|XDG_|WINEPREFIX|PROTONPREFIX)$/i.test(key)) {
    return 'pcgw_game_data_paths';
  }
  if (/^(DRM|STORE|STEAMAPPID|GOGID|EPICID|PRODUCTID|VERSIONDIFFERENCES)$/i.test(key)) {
    return 'pcgw_availability_drm';
  }
  if (/^(FOV|VSYNC|HDR|DISPLAYMODE|RESOLUTION|ULTRAWIDE|FPSLIMIT|FRAMERATE)$/i.test(key)) {
    return 'pcgw_video_display_fixes';
  }
  if (/^(CONTROLLERSUPPORT|INPUT|AUDIO|NETWORK|PORTS|VR_SUPPORT)$/i.test(key)) {
    return 'pcgw_input_audio_network';
  }
  if (/^(API|MIDDLEWARE|ENGINE)$/i.test(key)) {
    return 'pcgw_api_middleware';
  }
  if (/^(PROTONVERSION|WINEVERSION|LAUNCHOPTIONS|PROTON_|WINE_|DXVK_|VKD3D_)$/i.test(key)) {
    return 'pcgw_linux_wine_proton';
  }
  if (/^(FLAWLESSWIDESCREEN|WIDESCREENFIX|ASPECTRATIO|FOV|HUDSAFEAREA|HUDFIX|ULTRAWIDE)$/i.test(key)) {
    return 'widescreen_fix_surface';
  }
  if (/^(FRAMEGENERATION|FRAMEGENERATIONMULTIPLIER|OPTISCALER|OPTIFG|LSFG|DLSSG|FSR_FG|XEFG|REFLEX|ANTILAG)$/i.test(key)) {
    return 'frame_generation_pipeline';
  }
  if (/^(WINDOWSFRAMEGEN|DLSSG|OPTISCALER|OPTIFG|REFLEX|ANTILAG)$/i.test(key)) {
    return 'framegen_windows_runtime';
  }
  if (/^(LINUXFRAMEGEN|ENABLE_LSFG|LSFG|PROTON_|WINE_|DXVK_|VKD3D_)$/i.test(key)) {
    return 'framegen_linux_runtime';
  }
  if (/^(TARGETEXE|TARGETEXEPATH|PATCHID|PATCHSCOPE)$/i.test(key)) {
    return 'exe_patch_surface';
  }
  if (/^(FILEVERSION|PRODUCTVERSION|STEAMBUILDID|SHA256BEFORE|SHA256AFTER|CRC32BEFORE|CRC32AFTER|PEMACHINE|PETIMESTAMP)$/i.test(key)) {
    return 'exe_version_hash_guard';
  }
  if (/^(RVA|VA|FILEOFFSET|ORIGINALBYTES|PATCHEDBYTES|AOBSIGNATURE)$/i.test(key)) {
    return 'exe_rva_signature_mapping';
  }
  if (/^(DISASSEMBLER|SYMBOL|FUNCTION|CALLSITE)$/i.test(key)) {
    return 'exe_disassembly_symbol_notes';
  }
  if (/^(BACKUPPATH|ROLLBACKPLAN)$/i.test(key)) {
    return 'exe_patch_backup_rollback';
  }
  if (/^(LINUXPATCHTARGET|PROTONPATCHTARGET|WINEPATCHTARGET|LINUXVALIDATION|PROTONVALIDATION|DXVKVALIDATION|VKD3DVALIDATION)$/i.test(key)) {
    return 'exe_patch_linux_compat';
  }
  if (/^(PATCHSAFETY|SAFETYBOUNDARY)$/i.test(key)) {
    return 'exe_patch_safety_boundary';
  }
  if (/^(SERVICENAME|DISPLAYNAME|SERVICETYPE|STARTTYPE|IMAGEPATH|SERVICEACCOUNT)$/i.test(key)) {
    return 'windows_service_surface';
  }
  if (/^(DRIVERNAME|DRIVERPACKAGE|SERVICEBINARY|CLASSGUID|KMDFFLAGS|WDF_|INF_)/i.test(key)) {
    return 'windows_driver_surface';
  }
  if (/^(HKLM_|HKCU_|REGISTRY_|REG_)/i.test(key)) {
    return 'windows_registry_assumptions';
  }
  if (/^(PLATFORMTOOLSET|WINDOWSTARGETPLATFORMVERSION|TARGETFRAMEWORK|RUNTIMEIDENTIFIER|CONFIGURATIONTYPE|OUTDIR|TARGETPATH|VCTOOLSVERSION)$/i.test(key)) {
    return 'windows_msbuild_visualstudio';
  }
  if (/^(PE_|SUBSYSTEM|REQUESTEDEXECUTIONLEVEL|CODESIGN|SIGNTOOL|AUTHENTICODE)/i.test(key)) {
    return 'windows_pe_metadata';
  }
  const canonical = canonicalFactKey(key);
  if (canonical === 'device' || canonical === 'model' || canonical === 'product') {
    return 'device_identity';
  }
  if (canonical === 'soc_platform') {
    return 'soc_platform_identity';
  }
  if (NUMERIC_SIZE_KEYS.has(canonical)) {
    return 'partition_sizes';
  }
  if (canonical === 'boot_header_version') {
    return 'kernel_header_assumptions';
  }
  return 'conflicting_definitions';
}

function severityForContradictionKey(key) {
  const category = contradictionCategoryForKey(key);
  return category === 'provider_routing_surface'
    || category === 'provider_catalog_surface'
    || category === 'model_routing_surface'
    || category === 'protocol_adapter_surface'
    || category === 'client_launcher_surface'
    || category === 'secret_redaction_surface'
    || category === 'permission_safety_policy'
    || category === 'pcgw_game_data_paths'
    || category === 'pcgw_api_middleware'
    || category === 'pcgw_linux_wine_proton'
    || category === 'widescreen_fix_surface'
    || category === 'frame_generation_pipeline'
    || category === 'framegen_windows_runtime'
    || category === 'framegen_linux_runtime'
    || category === 'exe_patch_surface'
    || category === 'exe_version_hash_guard'
    || category === 'exe_rva_signature_mapping'
    || category === 'exe_patch_backup_rollback'
    || category === 'exe_patch_linux_compat'
    || category === 'exe_patch_safety_boundary'
    || category === 'windows_service_surface'
    || category === 'windows_driver_surface'
    || category === 'windows_registry_assumptions'
    || category === 'device_identity'
    || category === 'soc_platform_identity'
    || category === 'partition_sizes'
    || category === 'kernel_header_assumptions'
    ? 'HIGH'
    : 'MEDIUM';
}

function chooseLikelyWinner(key, values, knownGoodComparison) {
  const canonical = canonicalFactKey(key);
  if (canonical && knownGoodComparison.facts?.[canonical] !== undefined) {
    return chooseKnownGoodWinner(canonical, values, knownGoodComparison);
  }
  return null;
}

function chooseKnownGoodWinner(canonical, values, knownGoodComparison) {
  if (knownGoodComparison.facts?.[canonical] === undefined) {
    return null;
  }
  const expected = knownGoodComparison.facts[canonical];
  return values.find(value => valuesEquivalent(canonical, expected, value)) ?? null;
}

function knownGoodWinnerForLeftover(token, knownGoodComparison) {
  const value = String(token ?? '').toLowerCase();
  if (/sm\d{4}|kona|kalama|lahaina|taro|pineapple|waipio/.test(value)) {
    return knownGoodComparison.facts?.soc_platform ? String(knownGoodComparison.facts.soc_platform) : null;
  }
  if (/rm\d|nx\d|canoe|device|model/.test(value)) {
    return knownGoodComparison.facts?.device
      ? String(knownGoodComparison.facts.device)
      : knownGoodComparison.facts?.product
        ? String(knownGoodComparison.facts.product)
        : null;
  }
  return null;
}

function canonicalContradictionCategory(canonical) {
  if (canonical === 'device' || canonical === 'model' || canonical === 'product') {
    return 'device_identity';
  }
  if (canonical === 'soc_platform') {
    return 'soc_platform_identity';
  }
  if (NUMERIC_SIZE_KEYS.has(canonical)) {
    return 'partition_sizes';
  }
  if (canonical === 'boot_header_version') {
    return 'kernel_header_assumptions';
  }
  return 'conflicting_definitions';
}

function canonicalContradictionSeverity(canonical) {
  return [
    'device',
    'soc_platform',
    'boot_header_version',
    'recovery_partition_size',
    'recovery_a_size',
    'boot_partition_size',
    'boot_a_size',
    'init_boot_partition_size',
    'init_boot_a_size',
  ].includes(canonical) ? 'HIGH' : 'MEDIUM';
}

function canonicalFactKey(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9.]+/g, '_');

  if (['product', 'product_name'].includes(normalized) || ['product_name', 'target_product', 'ro.build.product'].includes(key.toLowerCase())) {
    return 'product';
  }
  if (['model', 'product_model', 'ro.product.model'].includes(normalized)) {
    return 'model';
  }
  if ([
    'device',
    'product_device',
    'target_device',
    'target_bootloader_board_name',
    'ro.product.device',
    'ro.build.product',
    'target_ota_assert_device',
  ].includes(normalized)) {
    return 'device';
  }
  if (isSocPlatformKey(key)) {
    return 'soc_platform';
  }
  if (normalized.includes('cpu_runtime_variant')) {
    return 'cpu_runtime_variant';
  }
  if (normalized.includes('boot_header') || normalized === 'board_boot_header_version') {
    return 'boot_header_version';
  }
  if (normalized === 'board_recoveryimage_partition_size' || normalized.includes('recovery_partition_size')) {
    return 'recovery_partition_size';
  }
  if (normalized.includes('recovery_a_size')) {
    return 'recovery_a_size';
  }
  if (normalized === 'board_bootimage_partition_size' || normalized.includes('boot_partition_size')) {
    return 'boot_partition_size';
  }
  if (normalized.includes('boot_a_size')) {
    return 'boot_a_size';
  }
  if (normalized === 'board_init_boot_image_partition_size' || normalized.includes('init_boot_partition_size')) {
    return 'init_boot_partition_size';
  }
  if (normalized.includes('init_boot_a_size')) {
    return 'init_boot_a_size';
  }
  if (normalized.includes('slot_suffix')) {
    return 'slot_suffix';
  }
  if (normalized.includes('recovery_a_exists')) {
    return 'recovery_a_exists';
  }
  if (normalized.includes('stock_recovery_backup')) {
    return 'stock_recovery_backup_exists';
  }
  if (normalized === 'ro.boot.hardware') {
    return 'ro.boot.hardware';
  }
  return null;
}

function isSocPlatformKey(key) {
  const normalized = normalizeKeyLabel(key);
  return [
    'board_platform',
    'product_platform',
    'qcom_board_platforms',
    'ro.board.platform',
    'soc',
    'soc_platform',
    'target_board_platform',
  ].includes(normalized);
}

function normalizeKnownGoodFacts(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const facts = {};
  for (const [key, value] of flattenObject(raw)) {
    const canonical = canonicalKnownGoodInputKey(key);
    if (!canonical) {
      facts[normalizeKeyLabel(key)] = value;
      continue;
    }
    facts[canonical] = value;
  }
  return facts;
}

function canonicalKnownGoodInputKey(key) {
  const normalized = normalizeKeyLabel(key);
  if (normalized === 'product') return 'product';
  if (normalized === 'model') return 'model';
  if (normalized === 'device') return 'device';
  if (normalized === 'soc' || normalized === 'soc_platform' || isSocPlatformKey(key)) return 'soc_platform';
  if (normalized.includes('cpu_runtime_variant')) return 'cpu_runtime_variant';
  if (normalized.includes('boot_header_version')) return 'boot_header_version';
  if (normalized.includes('recovery_partition_size')) return 'recovery_partition_size';
  if (normalized.includes('recovery_a_size')) return 'recovery_a_size';
  if (normalized.includes('init_boot_a_size')) return 'init_boot_a_size';
  if (normalized.includes('boot_a_size')) return 'boot_a_size';
  if (normalized.includes('slot_suffix')) return 'slot_suffix';
  if (normalized.includes('recovery_a_exists')) return 'recovery_a_exists';
  if (normalized.includes('stock_recovery_backup')) return 'stock_recovery_backup_exists';
  if (normalized === 'ro.boot.hardware') return 'ro.boot.hardware';
  return null;
}

function flattenObject(input, prefix = '') {
  const entries = [];
  for (const [key, value] of Object.entries(input)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...flattenObject(value, fullKey));
    } else {
      entries.push([fullKey, value]);
    }
  }
  return entries;
}

function normalizeKeyLabel(key) {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function valuesEquivalent(key, expected, observed) {
  const expectedString = normalizeScalar(String(expected));
  const observedString = normalizeScalar(String(observed));

  if (NUMERIC_SIZE_KEYS.has(key) || /version$/.test(key)) {
    const expectedNumber = parseNumeric(expectedString);
    const observedNumber = parseNumeric(observedString);
    if (expectedNumber !== null && observedNumber !== null) {
      return expectedNumber === observedNumber;
    }
  }

  return expectedString.toLowerCase() === observedString.toLowerCase();
}

function parseNumeric(value) {
  const clean = String(value).trim().replace(/^["']|["']$/g, '');
  if (/^0x[0-9a-f]+$/i.test(clean)) {
    return BigInt(clean);
  }
  if (/^[0-9]+$/.test(clean)) {
    return BigInt(clean);
  }
  return null;
}

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
    }
    if (!quote && char === '#') {
      return value.slice(0, index);
    }
  }
  return value;
}

function extractPathTokens(text) {
  const tokens = [];
  PATH_TOKEN_PATTERN.lastIndex = 0;
  let match;
  while ((match = PATH_TOKEN_PATTERN.exec(text)) !== null) {
    const token = cleanPathToken(match[2]);
    if (!token || token.length < 3) {
      continue;
    }
    if (/^https?:\/\//i.test(token)) {
      continue;
    }
    tokens.push(token);
  }
  return uniq(tokens);
}

function cleanPathToken(token) {
  if (!token) {
    return '';
  }
  return token
    .trim()
    .replace(/\\\s*$/, '')
    .replace(/[),;'"`]+$/g, '')
    .replace(/^\$\(LOCAL_PATH\)\//, '')
    .replace(/^\.\//, '');
}

function shouldCheckPath(pathRef, category = 'path_reference') {
  if (!pathRef) {
    return false;
  }
  if (isRelativeOutputArtifactPath(pathRef) || isLikelyProseCompoundPath(pathRef)) {
    return false;
  }
  if (/[*$?{}]|^\$\(|\$\(/.test(pathRef)) {
    return false;
  }
  if (isTargetRuntimeAbsolutePath(pathRef) && category !== 'init_rc_services') {
    return false;
  }
  if (/^\/(dev|proc|sys|data|sdcard|mnt)\b/.test(pathRef)) {
    return false;
  }
  if (pathRef.length < 5) {
    return false;
  }
  return /^(\/(system|vendor|product|odm|recovery|rootfs|apex)\b|device\/|vendor\/|system\/|product\/|odm\/|recovery\/|root\/|kernel\/|prebuilts\/|proprietary\/|firmware\/|hardware\/|packages\/)/.test(pathRef);
}

function isRelativeOutputArtifactPath(pathRef) {
  return /^(host|device|app|process)\/[A-Za-z0-9_.-]+\.txt$/.test(pathRef);
}

function isLikelyProseCompoundPath(pathRef) {
  return PROSE_COMPOUND_PATHS.has(pathRef)
    || /^(kernel|device|proprietary)\/[A-Za-z0-9.-]+$/.test(pathRef)
    && !/\.(mk|json|txt|xml|rc|prop|so|ko|img|bin|conf|cfg|ini|toml|yaml|yml|sh)$/i.test(pathRef);
}

function isTargetRuntimeAbsolutePath(pathRef) {
  return /^\/(system|vendor|product|odm|apex|data|sdcard|dev|proc|sys|mnt|tmp|usr|lib|lib64|etc|rootfs)\b/.test(pathRef);
}

function candidateSourcePaths(projectRoot, pathRef) {
  const clean = cleanPathToken(pathRef);
  const candidates = [];
  if (!clean) {
    return candidates;
  }

  if (clean.startsWith('/')) {
    const withoutRoot = clean.replace(/^\/+/, '');
    candidates.push(join(projectRoot, withoutRoot));
    candidates.push(join(projectRoot, 'root', withoutRoot));
    candidates.push(join(projectRoot, 'recovery', 'root', withoutRoot));
    candidates.push(join(projectRoot, 'ramdisk', withoutRoot));
  } else {
    candidates.push(join(projectRoot, clean));
  }
  return candidates;
}

function looksBinary(buffer) {
  const length = Math.min(buffer.length, 8192);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function normalizeScalar(value) {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeAssignmentValue(value) {
  const normalized = normalizeScalar(value);
  const nextAssignment = normalized.match(/^(.+?)\s+[A-Za-z_][A-Za-z0-9_]*=/);
  return nextAssignment ? nextAssignment[1].trim() : normalized;
}

function normalizePath(path) {
  return path.split(sep).join('/');
}

function denormalizePath(path) {
  return path.split('/').join(sep);
}

function claimRef(evidence) {
  return {
    evidence_id: evidence.id,
    claim: evidence.normalized_claim,
    file: evidence.source_file,
    line: evidence.source_line_start,
    text: evidence.extracted_text,
  };
}

function firstSourceFile(claims) {
  return claims.find(claim => claim.file)?.file ?? null;
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function highestSeverity(evidence) {
  return evidence.reduce((highest, item) => {
    if (!highest || SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[highest]) {
      return item.severity;
    }
    return highest;
  }, null) ?? 'INFO';
}

function stableId(prefix, input) {
  return `${prefix}-${createHash('sha256').update(String(input)).digest('hex').slice(0, 12)}`;
}

function uniq(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
}

function dedupeById(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function escapeForGrep(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

function escapeForFindBasename(pathRef) {
  return basename(String(pathRef)).replace(/["\\*?[\]]/g, '');
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

export { stableId };
