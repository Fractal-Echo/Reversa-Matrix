import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { lstat, readFile, readdir, stat } from 'fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'path';
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
  '.cxx',
  '.externalNativeBuild',
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
  'evals',
]);

const GENERATED_SCAN_COLLECTION_DIR_PATTERNS = [
  /^reversa[_-].+$/i,
  /^reversa[_-]matrix(?:[_-].*)?$/i,
  /^reversa[_-]scan(?:s|[_-].*)?$/i,
  /^reversa[_-](?:extract|before|after|cleanup|audit)(?:[_-].*)?$/i,
  /^reversa[_-]a\d+[a-z]?(?:[_-].*)?$/i,
];

const GENERATED_EVIDENCE_DIR_PATTERNS = [
  /(^|\/)local\/scans(?:\/|$)/i,
  /(^|\/)nebula-assets\/reversa-scans(?:\/|$)/i,
  /(^|\/)nebula-assets\/reversa-datasets(?:\/|$)/i,
  /(^|\/)(?:local\/)?agentic-training-pack[^/]*(?:\/|$)/i,
  /(^|\/)(?:local\/)?(?:evals?|reversa-evals?)(?:\/|$)/i,
  /(^|\/).*training-pack[^/]*(?:\/|$)/i,
  /(^|\/).*policy-classifier[^/]*(?:\/|$)/i,
];

const GENERATED_SCAN_SIGNATURE_FILES = new Set([
  'report.json',
  'compare_report.json',
  'evidence.jsonl',
  'summary.md',
  'compare_summary.md',
  'dashboard.html',
  'eval_report.json',
  'eval_report.md',
  'agentic-training-pack.jsonl',
  'agentic-training-summary.md',
  'agentic-training-labels.json',
  'training-history.jsonl',
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
  'eval_report.json',
  'eval_report.md',
  'agentic-training-pack.jsonl',
  'agentic-training-summary.md',
  'agentic-training-labels.json',
  'training-history.jsonl',
]);

const PROJECT_POLICY_FILES = [
  'reversa.project.json',
  '.reversa/project-policy.json',
];

const ROOT_PROJECT_POLICY_FILES = new Set(PROJECT_POLICY_FILES.filter(path => !path.includes('/')));

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
  '.tsv',
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
  'hardware/runtime',
  'kernel/userland',
  'packages/modules',
  'proprietary/commercial-term',
  'recovery/device',
  'recovery/device-tree',
  'root/child',
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

const SEMANTIC_POLICY_CONTENT_CATEGORIES = new Set([
  'approval_required',
  'approval_bypass',
  'destructive_action',
  'device_action_allowed',
  'device_action_forbidden',
  'network_allowed',
  'network_forbidden',
  'read_only',
  'source_authority',
  'source_patch_allowed',
  'source_patch_forbidden',
  'write_allowed',
  'write_forbidden',
  'commit_allowed',
  'commit_forbidden',
  'push_allowed',
  'push_forbidden',
  'proprietary_reference_only',
  'proprietary_copy_forbidden',
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
      /\b(?:reference-only|reference only|proprietary reference|commercial terms)\b/i,
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
      /\b(?:vendored from|copied from|imported from|restored-src|source authority|authoritative source|cli\.js\.map)\b/i,
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
  const projectPolicy = await loadProjectPolicy(projectRoot);
  const honorGitIgnore = options.honorGitIgnore ?? !options.includeIgnored;
  const ignoredPaths = honorGitIgnore
    ? discoverGitIgnoredPaths(projectRoot)
    : { files: new Set(), dirs: new Set(), source: 'disabled' };
  const profileApplicability = {
    status: 'applicable',
    reason: 'default',
  };
  const context = {
    projectRoot,
    profile,
    profileApplicability,
    scanStartedAt,
    knownGoodPath: options.knownGoodPath ?? null,
    ignoredPaths,
    projectPolicy,
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
      project_policy: projectPolicy
        ? {
            source_file: projectPolicy.source_file,
            project_kind: projectPolicy.project_kind,
            path_policies: projectPolicy.path_policies.length,
            parse_error: projectPolicy.parse_error ?? null,
          }
        : null,
      profile_applicability: profileApplicability,
      counts: {
        files_total: 0,
        files_scanned: 0,
        files_skipped: 0,
        directories_seen: 0,
      },
    },
  };

  addProjectPolicyEvidence(context);
  const outDir = options.outDir ? resolve(options.outDir) : null;
  await walkProject(projectRoot, context, { maxFileSize, outDir });
  addGeneratedArtifactBoundaryEvidence(context);

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

  if (isGeneratedEvidenceDirectoryPath(relPath)) {
    return isTrainingEvalArtifactPath(relPath)
      ? 'training_eval_artifact_directory'
      : 'generated_evidence_directory';
  }

  if (await hasGeneratedScanSignature(absPath)
    && (isGeneratedScanCollectionDir(name) || isGeneratedScanOutputContainerPath(relPath))) {
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

function isGeneratedScanOutputContainerPath(relPath) {
  const normalized = normalizePath(relPath);
  const parts = normalized.split('/');
  return /(^|\/)(?:logs|local)\/.+/i.test(normalized)
    || parts.some(part => isGeneratedScanCollectionDir(part));
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

  if (ROOT_PROJECT_POLICY_FILES.has(relPath)) {
    return 'project_policy_file';
  }

  if (isGeneratedEvidenceFilePath(relPath)) {
    return isTrainingEvalArtifactPath(relPath)
      ? 'training_eval_artifact'
      : 'generated_scan_artifact';
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

function addGeneratedArtifactBoundaryEvidence(context) {
  for (const skipped of context.inventory.skipped_files) {
    const classifications = generatedArtifactClassifications(skipped.path, skipped.reason);
    for (const classification of classifications) {
      addEvidence(context, {
        category: 'generated_evidence_boundary',
        severity: 'INFO',
        confidence: 'confirmed',
        source_file: skipped.path,
        source_line_start: 1,
        source_line_end: 1,
        extracted_text: `${skipped.reason}:${skipped.path}`,
        normalized_claim: `${classification}:${skipped.path}`,
        evidence_type: 'generated_boundary',
        suggested_action: 'Treat generated Reversa scans, dashboards, training packs, and eval outputs as derived evidence, not primary source authority.',
        rationale: 'Generated artifacts can help archaeology, but normal source scans must not recursively promote their contents into active contradictions or patch candidates.',
      });
    }
  }
}

function generatedArtifactClassifications(path, reason) {
  if (!reason || !/generated|training|eval/i.test(reason)) {
    return [];
  }
  const classes = ['NOT_SOURCE_AUTHORITY'];
  if (/training|eval/i.test(reason) || isTrainingEvalArtifactPath(path)) {
    classes.unshift('TRAINING_EVAL_ARTIFACT');
  } else if (/summary|dashboard|report\.html|\.md$/i.test(path)) {
    classes.unshift('DERIVED_SUMMARY');
  } else {
    classes.unshift('GENERATED_EVIDENCE');
  }
  return classes;
}

async function loadProjectPolicy(projectRoot) {
  for (const relPath of PROJECT_POLICY_FILES) {
    const absPath = join(projectRoot, denormalizePath(relPath));
    if (!existsSync(absPath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(await readFile(absPath, 'utf8'));
      return normalizeProjectPolicy(parsed, relPath);
    } catch (err) {
      return {
        source_file: relPath,
        project_kind: null,
        path_policies: [],
        parse_error: String(err.message ?? err),
      };
    }
  }

  return null;
}

function normalizeProjectPolicy(raw, sourceFile) {
  const pathPolicies = Array.isArray(raw?.path_policies)
    ? raw.path_policies
      .map((policy, index) => normalizePathPolicy(policy, index))
      .filter(Boolean)
    : [];

  return {
    source_file: sourceFile,
    project_kind: typeof raw?.project_kind === 'string' ? raw.project_kind : null,
    path_policies: pathPolicies,
    parse_error: null,
  };
}

function normalizePathPolicy(policy, index) {
  if (!policy || typeof policy !== 'object') {
    return null;
  }

  const paths = Array.isArray(policy.paths)
    ? policy.paths.map(item => cleanPathToken(String(item))).filter(Boolean)
    : [];
  if (!paths.length) {
    return null;
  }

  return {
    id: typeof policy.id === 'string' ? policy.id : `path_policy_${index + 1}`,
    classification: typeof policy.classification === 'string'
      ? normalizeKeyLabel(policy.classification)
      : 'project_boundary',
    paths,
    reason: typeof policy.reason === 'string' ? policy.reason : '',
  };
}

function addProjectPolicyEvidence(context) {
  const policy = context.projectPolicy;
  if (!policy) {
    return;
  }

  if (policy.parse_error) {
    addEvidence(context, {
      category: 'project_path_policy',
      severity: 'MEDIUM',
      confidence: 'confirmed',
      source_file: policy.source_file,
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: policy.parse_error,
      normalized_claim: `project_policy_parse_error:${policy.source_file}`,
      evidence_type: 'project_policy',
      suggested_action: 'Fix the Reversa project policy JSON before trusting source-boundary suppressions.',
      rationale: 'A malformed project policy cannot safely classify release-hub, external checkout, or runtime-root paths.',
    });
    return;
  }

  addEvidence(context, {
    category: 'project_path_policy',
    severity: 'INFO',
    confidence: 'confirmed',
    source_file: policy.source_file,
    source_line_start: 1,
    source_line_end: 1,
    extracted_text: `${policy.project_kind ?? 'project'}:${policy.path_policies.length} path policies`,
    normalized_claim: `project_policy_loaded:${policy.project_kind ?? 'unspecified'}`,
    evidence_type: 'project_policy',
    suggested_action: 'Apply declared source-boundary rules when classifying missing path evidence.',
    rationale: 'Some repos are release hubs or public source slices where external checkout paths, local hydrated payloads, and target runtime paths are intentional boundaries.',
  });
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

function isDecodedMediaManifestPath(relPath) {
  return /(^|\/)decoded-media-manifest\.jsonl$/i.test(normalizePath(relPath));
}

function isLikelyTextPath(relPath) {
  const fileName = basename(relPath);
  if (isDecodedMediaManifestPath(relPath)) {
    return true;
  }
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
  scanClaudeCodeModernFileSignals(file, context);
  if (isDecodedMediaEvidenceProfile(context.profile)) {
    scanDecodedMediaManifestJsonl(file, text, context);
    return;
  }
  if (isDockLeaseProofProfile(context.profile) && scanDockLeaseProofJson(file, text, context)) {
    return;
  }
  if (scanStructuredJsonConfig(file, text, context)) {
    return;
  }
  const lines = text.split('\n');
  const lineState = {
    configSection: null,
    markdownFence: false,
    runtimeDumpSection: null,
    yamlRunBlock: false,
    yamlRunBlockIndent: null,
  };
  for (let index = 0; index < lines.length; index += 1) {
    updateLineState(lines[index], file, lineState);
    scanLine(lines[index], index + 1, file, context, lineState);
  }
}

function scanStructuredJsonConfig(file, text, context) {
  if (extname(file.path).toLowerCase() !== '.json') {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }

  if (!isRuntimeStructuredJsonConfig(file.path, parsed)) {
    return false;
  }

  for (const entry of collectStructuredJsonAssignments(parsed)) {
    const category = categorizeStructuredJsonAssignment(entry.key, entry.value, context.profile);
    const normalizedValue = normalizeAssignmentValue(entry.value);
    const claimKey = scopedAssignmentKey(entry.key, file.path, {}, category);
    const extractedText = `${entry.key}=${entry.value}`;
    const evidence = addEvidence(context, {
      category,
      severity: severityForAssignment(entry.key, category),
      confidence: 'likely',
      source_file: file.path,
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: extractedText,
      normalized_claim: `${claimKey}=${normalizedValue}`,
      assignment_operator: '=',
      related_paths: extractPathTokens(entry.value),
      related_symbols: [entry.key],
      related_build_vars: category === 'local_code_assignments' ? [] : [entry.key],
      evidence_type: 'structured_json',
      suggested_action: 'Treat this as structured runtime configuration and compare it against launcher, wrapper, graphics, and device evidence.',
      rationale: 'JSON game/container profiles often store runtime state as nested fields or packed key-value strings that line scanning cannot see reliably.',
    });

    for (const pathRef of extractPathTokens(entry.value)) {
      rememberPathReference(context, pathRef, file.path, 1, extractedText, evidence.id, category);
    }
  }
  return true;
}

function scanDecodedMediaManifestJsonl(file, text, context) {
  if (!isDecodedMediaEvidenceProfile(context.profile) || !isDecodedMediaManifestPath(file.path)) {
    return false;
  }

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const rawLine = lines[index].trim();
    if (!rawLine) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(rawLine);
    } catch (err) {
      addEvidence(context, {
        category: 'decoded_media_parse_error',
        severity: 'MEDIUM',
        confidence: 'confirmed',
        source_file: file.path,
        source_line_start: lineNo,
        source_line_end: lineNo,
        extracted_text: rawLine.slice(0, 240),
        normalized_claim: `decoded_media.parse_error=${String(err.message ?? err).slice(0, 120)}`,
        evidence_type: 'jsonl_parse_error',
        suggested_action: 'Repair the decoded media manifest before using it as corroborating evidence.',
        rationale: 'Decoded media evidence must remain machine-readable so hashes, frame paths, and OCR summaries stay tied together.',
      });
      continue;
    }

    scanDecodedMediaRecord(record, lineNo, file, context);
  }

  return true;
}

function scanDecodedMediaRecord(record, lineNo, file, context) {
  const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
  const summary = String(record.content_summary ?? record.summary ?? record.text ?? '');
  const artifactPath = String(record.path ?? record.file ?? record.source_path ?? '');
  const artifactHash = String(record.sha256 ?? record.hash ?? '');
  const combined = `${tags.join(' ')} ${summary}`;
  const relatedPaths = decodedMediaRelatedPaths(record);
  const extractedText = summary || tags.join(' ') || artifactPath || JSON.stringify(record).slice(0, 240);

  const add = (category, severity, normalizedClaim, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'confirmed',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: extractedText,
    normalized_claim: normalizedClaim,
    related_paths: relatedPaths,
    related_symbols: symbols,
    evidence_type: 'decoded_media_manifest',
    suggested_action: action,
    rationale,
  });

  const artifactSymbols = tags.filter(tag => tag.startsWith('EVIDENCE:') || tag.startsWith('PROJECT:'));
  if (artifactHash || tags.includes('EVIDENCE:VIDEO_DECODED')) {
    add(
      'decoded_media_artifact',
      'INFO',
      artifactHash
        ? `decoded_media.artifact.sha256=${artifactHash}`
        : 'decoded_media.artifact.video_decoded=true',
      'Use this as artifact-backed corroboration, not as source authority by itself.',
      'Decoded media with hashes and extracted text can corroborate Telegram/runtime claims while keeping provenance inspectable.',
      artifactSymbols
    );
  }

  if (artifactPath) {
    add(
      'decoded_media_artifact',
      'INFO',
      `decoded_media.artifact.path=${artifactPath}`,
      'Keep the original media path tied to the decoded manifest for repeatable review.',
      'The video path lets future scans reconnect the OCR/frame summary to the original local evidence file.',
      artifactSymbols
    );
  }

  if (/\bDRM:LEASE\b|\bDRM lease\b|\blease fd received\b|\blease control fd\b/i.test(combined)) {
    add(
      'decoded_media_drm_lease_proof',
      'HIGH',
      'decoded_media.drm_lease=true',
      'Treat DRM lease evidence as corroboration for a future bounded replay plan; rediscover live IDs before any device action.',
      'The decoded media shows a DRM lease path, but object IDs and fds are runtime-volatile.',
      ['DRM:LEASE']
    );
  }

  addDecodedMediaMatch(add, combined, /\bconnector\s*[=:]?\s*([0-9]+)/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.connector', ['connector']);
  addDecodedMediaMatch(add, combined, /\bCRTC\s*[=:]?\s*([0-9]+)/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.crtc', ['CRTC']);
  addDecodedMediaMatch(add, combined, /\bmode\s*[=:]?\s*([0-9]+x[0-9]+@[0-9]+)/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.mode', ['mode']);
  addDecodedMediaMatch(add, combined, /\b(?:(?:lease fd received on|lease control fd visibility|lease fd)\s+(fd[0-9]+)|(fd[0-9]+)\s+lease received)\b/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.fd', ['SCM_RIGHTS']);
  addDecodedMediaMatch(add, combined, /(\/dev\/dri\/card[0-9]+)/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.card', ['/dev/dri']);
  addDecodedMediaMatch(add, combined, /(\/dev\/dri\/renderD[0-9]+)/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.render_node', ['/dev/dri']);
  addDecodedMediaMatch(add, combined, /\bscanout[_ ]plane\s*[=:]?\s*([0-9]+)/i, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.scanout_plane', ['plane']);

  if (/\bwlroots DRM backend\b/i.test(combined)) {
    add(
      'decoded_media_wayland_compositor_proof',
      'HIGH',
      'decoded_media.wlroots_drm_backend=true',
      'Use this as display-stack proof for the planning lane; keep runtime replay blocked until approved.',
      'The decoded frames/OCR show wlroots reached its DRM backend in the recorded session.',
      ['wlroots']
    );
  }

  if (/\bWAYLAND:LABWC\b|\blabwc compositor\b/i.test(combined)) {
    add(
      'decoded_media_wayland_compositor_proof',
      'HIGH',
      'decoded_media.compositor=labwc',
      'Use compositor evidence as corroboration; do not launch a compositor from this scan.',
      'The decoded media indicates labwc was the compositor in the observed runtime path.',
      ['labwc']
    );
  }

  addDecodedMediaMatch(add, combined, /\bwayland=([A-Za-z0-9_.:-]+)/i, 'decoded_media_wayland_compositor_proof', 'decoded_media.wayland.socket', ['Wayland']);

  if (/\bgraphical target reached\b|\bgraphical interface\b/i.test(combined)) {
    add(
      'decoded_media_wayland_compositor_proof',
      'MEDIUM',
      'decoded_media.graphical_target_reached=true',
      'Corroborate with logs/source before promoting this beyond runtime evidence.',
      'The decoded media indicates the graphical target was reached, but replay still needs bounded live proof.',
      ['graphical_target']
    );
  }

  if (/\bMesa KGSL render device\b|\bKGSL\b/i.test(combined)) {
    add(
      'decoded_media_gpu_render_proof',
      'HIGH',
      'decoded_media.kgsl_render_device=true',
      'Keep this as GPU-render evidence and verify driver ownership before runtime changes.',
      'The decoded media shows KGSL/GPU render-device participation in the observed lane.',
      ['KGSL']
    );
  }

  addDecodedMediaMatch(add, combined, /\brenderer\s*[=:]?\s*([A-Za-z0-9_.:-]+)/i, 'decoded_media_gpu_render_proof', 'decoded_media.renderer', ['renderer']);

  const fpsMatch = combined.match(/\bFPS\s+around\s+([0-9]+(?:\/[0-9]+)*)/i);
  if (/\bPERF:FPS\b/i.test(combined) || fpsMatch) {
    add(
      'decoded_media_performance_context',
      'MEDIUM',
      `decoded_media.fps_overlay=${fpsMatch ? fpsMatch[1] : 'present'}`,
      'Treat FPS overlay evidence as context until the app, launch command, and runtime lane are identified.',
      'FPS overlays can be useful, but they are not standalone proof of a Nebula runtime path.',
      ['PERF:FPS']
    );
  }

  const pingMatch = combined.match(/\bping\s+([0-9]+)\s*ms\b/i);
  if (pingMatch) {
    add(
      'decoded_media_performance_context',
      'INFO',
      `decoded_media.ping_ms=${pingMatch[1]}`,
      'Keep ping evidence as context only unless tied to a specific reproducible runtime.',
      'Network overlay values do not identify the graphics/runtime path by themselves.',
      ['ping']
    );
  }

  if (/\bnot standalone\b|\bnot standalone runtime-lane proof\b|\bapp\/config\/launch path unknown\b/i.test(combined)) {
    add(
      'decoded_media_guard',
      'INFO',
      'decoded_media.guard.not_standalone_runtime_proof=true',
      'Require source/log corroboration before using this media record as a runtime-lane decision.',
      'The decoded record explicitly limits its own authority.',
      ['not_standalone']
    );
  }
}

function scanDockLeaseProofJson(file, text, context) {
  if (!isDockLeaseProofProfile(context.profile) || extname(file.path).toLowerCase() !== '.json') {
    return false;
  }

  const normalizedPath = normalizePath(file.path);
  const pathLooksRelevant = /dock[-_ ]?lease|dock_lease|command[-_ ]?plan|drm[-_ ]?lease/i.test(normalizedPath);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    if (!pathLooksRelevant) {
      return false;
    }
    addEvidence(context, {
      category: 'dock_lease_parse_error',
      severity: 'MEDIUM',
      confidence: 'confirmed',
      source_file: file.path,
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: String(err.message ?? err),
      normalized_claim: 'dock_lease.json_parse_error=true',
      evidence_type: 'structured_json',
      suggested_action: 'Fix the Dock lease proof JSON before using it as authority evidence.',
      rationale: 'Dock lease proof files must be parseable before their guard claims can be trusted.',
    });
    return true;
  }

  const relevant = pathLooksRelevant
    || parsed?.command === 'dock lease command-plan report'
    || parsed?.lane === 'dock_drm_lease_external'
    || parsed?.profile_set_dock !== undefined
    || parsed?.command_kind?.startsWith?.('dock_lease_');
  if (!relevant) {
    return false;
  }

  const add = (category, severity, normalizedClaim, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'likely',
    source_file: file.path,
    source_line_start: 1,
    source_line_end: 1,
    extracted_text: JSON.stringify(compactDockLeaseJsonSummary(parsed)).slice(0, 400),
    normalized_claim: normalizedClaim,
    related_paths: extractPathTokens(text),
    related_symbols: symbols,
    evidence_type: 'structured_json',
    suggested_action: action,
    rationale,
  });

  const guardAction = 'Keep this Dock lease proof host-only until receiver smoke, TEST_ONLY, handoff, stop/revoke, rollback, and crash gates are proven in a bounded runtime pass.';
  const blockedAction = 'Do not promote Dock lease fixtures into runtime start commands or allowlists; keep the profile blocked until runtime proof exists.';
  const warnAction = 'Block runtime promotion and keep Dock lease mutation disabled until explicit authority and bounded runtime proof exist.';

  if (normalizedPath.includes('dock-lease-command.schema.json')) {
    add(
      'dock_lease_host_proof',
      'MEDIUM',
      'dock_lease.schema.command_contract=true',
      guardAction,
      'The command schema defines the host-side Dock lease contract before runtime mutation exists.',
      ['dock-lease-command.schema.json']
    );
  }
  if (normalizedPath.includes('dock-lease-result.schema.json')) {
    add(
      'dock_lease_host_proof',
      'MEDIUM',
      'dock_lease.schema.result_contract=true',
      guardAction,
      'The result schema defines the read-only proof fields required before runtime mutation.',
      ['dock-lease-result.schema.json']
    );
  }

  if (parsed.command === 'dock lease command-plan report') {
    addDockLeaseBooleanEvidence(add, 'dock_lease_host_proof', 'host_only', parsed.host_only, guardAction);
    add(
      'dock_lease_host_proof',
      'HIGH',
      `dock_lease.command_plan=${parsed.classification ?? 'present'}`,
      guardAction,
      'A command-plan report is authority-contract evidence, not a runtime launch surface.',
      ['dock lease command-plan report']
    );
  }

  if (parsed.lane === 'dock_drm_lease_external') {
    add(
      'dock_lease_host_proof',
      'MEDIUM',
      'dock_lease.lane=dock_drm_lease_external',
      guardAction,
      'The proof is scoped to the external Dock DRM lease lane.',
      ['dock_drm_lease_external']
    );
  }

  if (parsed.profile_set_dock !== undefined) {
    const blocked = parsed.profile_set_dock === 'BLOCKED_NOT_READY';
    add(
      blocked ? 'dock_lease_blocked_not_ready' : 'dock_lease_runtime_warning',
      'HIGH',
      `dock_lease.status=${parsed.profile_set_dock}`,
      blocked ? blockedAction : warnAction,
      blocked
        ? 'The Dock profile set remains intentionally blocked until runtime gates are proven.'
        : 'A Dock status other than BLOCKED_NOT_READY can imply runtime promotion and must be reviewed.',
      ['profile_set_dock']
    );
  }

  if (parsed.command_kind?.startsWith?.('dock_lease_')) {
    add(
      'dock_lease_host_proof',
      'MEDIUM',
      `dock_lease.command.kind=${parsed.command_kind}`,
      guardAction,
      'Dock lease command fixtures prove command shape only.',
      ['command_kind']
    );
  }

  addDockLeaseBooleanEvidence(add, 'dock_lease_mutation_denied', 'mutation_allowed_by_policy', parsed.mutation_allowed_by_policy, parsed.mutation_allowed_by_policy ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_mutation_denied', 'execute', parsed.execute, parsed.execute ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_mutation_denied', 'executed', parsed.executed, parsed.executed ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_mutation_denied', 'mutation_performed', parsed.mutation_performed, parsed.mutation_performed ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_guard', 'start_command_available', parsed.start_command_available, parsed.start_command_available ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_guard', 'runtime_allowlists_modified', parsed.runtime_allowlists_modified, parsed.runtime_allowlists_modified ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_guard', 'app_allowlists_modified', parsed.app_allowlists_modified, parsed.app_allowlists_modified ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_guard', 'runtime_commands_added', parsed.runtime_commands_added, parsed.runtime_commands_added ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_guard', 'apk_allowlist_changed', parsed.apk_allowlist_changed, parsed.apk_allowlist_changed ? warnAction : blockedAction);
  addDockLeaseBooleanEvidence(add, 'dock_lease_guard', 'module_command_added', parsed.module_command_added, parsed.module_command_added ? warnAction : blockedAction);

  if (parsed.dynamic_discovery_required === true || parsed.dynamic_discovery?.required === true) {
    add(
      'dock_lease_dynamic_discovery_required',
      'HIGH',
      'dock_lease.discovery=dynamic_required',
      guardAction,
      'Dock lease runtime IDs are volatile and must be discovered dynamically.',
      ['dynamic_discovery']
    );
  }

  if (parsed.external_display_only === true || parsed.external_display_only?.required === true) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.external_display_only=true',
      guardAction,
      'Dock leasing must remain external-display-only and must not take over the internal panel or whole card.',
      ['external_display_only']
    );
  }

  const inputs = parsed.inputs ?? {};
  for (const key of [
    'allow_raw_shell',
    'allow_manual_connector_id',
    'allow_manual_crtc_id',
    'allow_manual_plane_id',
    'allow_manual_fd',
    'allow_internal_panel',
    'allow_whole_card_takeover',
  ]) {
    if (inputs[key] === false) {
      add(
        'dock_lease_guard',
        'HIGH',
        `dock_lease.input.${key}=false`,
        guardAction,
        'The Dock lease contract blocks manual or broad runtime ownership inputs.',
        [key]
      );
    } else if (inputs[key] === true) {
      add(
        'dock_lease_runtime_warning',
        'HIGH',
        `dock_lease.input.${key}=true`,
        warnAction,
        'Manual or broad runtime ownership inputs would bypass the Dock lease authority contract.',
        [key]
      );
    }
  }

  const guards = parsed.required_guards ?? {};
  if (parsed.test_only === true || parsed.test_only?.required_before_commit === true || guards.test_only_required_before_commit === true) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.TEST_ONLY=true',
      guardAction,
      'TEST_ONLY must pass before any real Dock lease commit.',
      ['TEST_ONLY']
    );
  }
  if (parsed.handoff?.mechanism === 'SCM_RIGHTS' || guards.handoff_mechanism === 'SCM_RIGHTS') {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.SCM_RIGHTS=true',
      guardAction,
      'Dock lease fd handoff must use SCM_RIGHTS rather than hard-coded fd reuse.',
      ['SCM_RIGHTS']
    );
  }
  if (parsed.stop_revoke?.required === true || guards.stop_revoke_required === true) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.stop_revoke=true',
      guardAction,
      'Dock lease proof requires an explicit stop/revoke path.',
      ['stop_revoke']
    );
  }
  if (parsed.rollback?.required === true || guards.rollback_required === true) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.rollback=true',
      guardAction,
      'Dock lease proof requires rollback before runtime mutation.',
      ['rollback']
    );
  }
  if (parsed.crash_gate?.counter_required === true || guards.crash_counter_required === true) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.crash_gate=true',
      guardAction,
      'Dock lease proof requires crash-counter enforcement.',
      ['crash_gate']
    );
  }
  if (parsed.crash_gate?.auto_retry_allowed === false || guards.auto_retry_allowed === false) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.auto_retry_allowed=false',
      guardAction,
      'Automatic retry is disabled so a broken Dock lease path cannot loop.',
      ['auto_retry_allowed']
    );
  }

  const errors = Array.isArray(parsed.errors) ? parsed.errors
    : Array.isArray(parsed.result_errors) ? parsed.result_errors
      : [];
  for (const error of errors) {
    if (error === 'HOST_ONLY_FIXTURE') {
      add(
        'dock_lease_host_proof',
        'HIGH',
        'dock_lease.fixture=HOST_ONLY_FIXTURE',
        guardAction,
        'This artifact is explicitly a host-only fixture.',
        ['HOST_ONLY_FIXTURE']
      );
    }
  }

  if (Array.isArray(parsed.plans)) {
    add(
      'dock_lease_host_proof',
      'MEDIUM',
      `dock_lease.command_plan.plans=${parsed.plans.length}`,
      guardAction,
      'The command-plan report aggregates host-only Dock lease fixture plans.',
      ['plans']
    );
    for (const plan of parsed.plans) {
      if (plan && typeof plan === 'object') {
        scanDockLeaseProofJson({ path: `${file.path}.plan-${plan.id ?? 'unknown'}.json` }, JSON.stringify(plan), context);
      }
    }
  }

  return true;
}

function compactDockLeaseJsonSummary(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }
  return {
    command: parsed.command,
    lane: parsed.lane,
    command_kind: parsed.command_kind,
    classification: parsed.classification,
    profile_set_dock: parsed.profile_set_dock,
    host_only: parsed.host_only,
    execute: parsed.execute,
    executed: parsed.executed,
    mutation_allowed_by_policy: parsed.mutation_allowed_by_policy,
    mutation_performed: parsed.mutation_performed,
    start_command_available: parsed.start_command_available,
    runtime_allowlists_modified: parsed.runtime_allowlists_modified,
    app_allowlists_modified: parsed.app_allowlists_modified,
  };
}

function addDockLeaseBooleanEvidence(add, baseCategory, key, value, action) {
  if (typeof value !== 'boolean') {
    return;
  }
  const warningKeys = new Set([
    'execute',
    'executed',
    'mutation_performed',
    'mutation_allowed_by_policy',
    'start_command_available',
    'runtime_allowlists_modified',
    'app_allowlists_modified',
    'runtime_commands_added',
    'apk_allowlist_changed',
    'module_command_added',
  ]);
  const category = value === true && warningKeys.has(key)
    ? 'dock_lease_runtime_warning'
    : baseCategory;
  const severity = value === true && warningKeys.has(key) ? 'HIGH' : 'MEDIUM';
  add(
    category,
    severity,
    `dock_lease.${key}=${value}`,
    action,
    value === true && warningKeys.has(key)
      ? 'This positive runtime/mutation flag would promote the Dock lease lane beyond host-only proof.'
      : 'This flag preserves the Dock lease host-only authority boundary.',
    [key]
  );
}

function decodedMediaRelatedPaths(record) {
  const paths = [];
  for (const key of ['path', 'file', 'source_path']) {
    if (record[key]) {
      paths.push(String(record[key]));
    }
  }
  if (Array.isArray(record.frame_paths)) {
    paths.push(...record.frame_paths.map(String));
  }
  return uniq(paths.filter(Boolean));
}

function addDecodedMediaMatch(add, text, pattern, category, key, symbols) {
  const match = text.match(pattern);
  if (!match) {
    return;
  }
  const value = match.slice(1).find(Boolean);
  add(
    category,
    'HIGH',
    `${key}=${value}`,
    'Record this as observed evidence only; rediscover volatile runtime values before replay.',
    'Decoded media can preserve a previous observed value, but device/runtime object IDs and fds are not constants.',
    symbols
  );
}

function isRuntimeStructuredJsonConfig(filePath, parsed) {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    return false;
  }

  const normalizedPath = normalizePath(filePath);
  if (/(^|\/)(?:package-lock|composer.lock|tsconfig|jsconfig|eslint|prettier|manifest)\.json$/i.test(normalizedPath)) {
    return false;
  }

  const keys = new Set(Object.keys(parsed));
  const runtimeKeys = [
    'envVars',
    'graphicsDriver',
    'graphicsDriverConfig',
    'rendererPresentMode',
    'dxwrapper',
    'dxwrapperConfig',
    'wineVersion',
    'emulator',
    'box86Version',
    'box64Version',
    'fexcoreVersion',
    'screenSize',
    'executablePath',
    'steamType',
    'useDRI3',
    'containerVariant',
    'wincomponents',
    'cpuList',
    'extraData',
    'sessionMetadata',
  ];

  return runtimeKeys.some(key => keys.has(key))
    || /(?:gamenative|winlator|wine|proton|steam|blender|container|runtime).*\.json$/i.test(normalizedPath);
}

function collectStructuredJsonAssignments(parsed) {
  const entries = [];

  const push = (key, value) => {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'object') {
      return;
    }
    const stringValue = String(value);
    if (stringValue.trim() === '') {
      return;
    }
    entries.push({ key, value: stringValue });
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        push(`${key}.${nestedKey}`, nestedValue);
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (value.every(item => ['string', 'number', 'boolean'].includes(typeof item))) {
        push(key, value.join(','));
      }
      continue;
    }

    push(key, value);

    if (typeof value !== 'string') {
      continue;
    }

    if (key === 'envVars') {
      for (const token of splitShellLikeTokens(value)) {
        const parsedToken = parsePackedAssignment(token);
        if (parsedToken) {
          push(`env.${parsedToken.key}`, parsedToken.value);
        }
      }
      continue;
    }

    if (isPackedJsonConfigKey(key)) {
      for (const part of value.split(',')) {
        const parsedPart = parsePackedAssignment(part.trim());
        if (parsedPart) {
          push(`${key}.${parsedPart.key}`, parsedPart.value);
        }
      }
      continue;
    }

    if (/^\s*\{/.test(value)) {
      try {
        const nested = JSON.parse(value);
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          for (const [nestedKey, nestedValue] of Object.entries(nested)) {
            push(`${key}.${nestedKey}`, nestedValue);
          }
        }
      } catch {
        // Keep the parent string evidence; malformed nested config is still useful context.
      }
    }
  }

  return entries;
}

function categorizeStructuredJsonAssignment(key, value, profile) {
  const leafKey = assignmentKeyForCategorization(key);

  if (/^dxwrapperConfig\./i.test(key)) {
    if (/^(VIDEOMEMORYSIZE|MAXDEVICEMEMORY|FRAMERATE|STRICT_SHADER_MATH|ASYNC|ASYNCCACHE)$/i.test(leafKey)) {
      return 'gpu_performance_tuning';
    }
    return 'api_translation_layer';
  }

  if (/^graphicsDriverConfig\./i.test(key)) {
    if (/^(MAXDEVICEMEMORY|BCNEMULATION|BCNEMULATIONTYPE|SYNCFRAME|DISABLEPRESENTWAIT)$/i.test(leafKey)) {
      return 'gpu_performance_tuning';
    }
    if (/^(VULKANVERSION|PRESENTMODE|ADRENOTOOLSTURNIP)$/i.test(leafKey)) {
      return 'vulkan_loader';
    }
    return 'mobile_linux_runtime';
  }

  return categorizeAssignment(key, value, profile);
}

function splitShellLikeTokens(value) {
  return String(value).match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g)?.map(token => token.replace(/^["'`]|["'`]$/g, '')) ?? [];
}

function isPackedJsonConfigKey(key) {
  return /(?:Config|components|wincomponents|graphicsDriverConfig|dxwrapperConfig)$/i.test(key);
}

function parsePackedAssignment(token) {
  const index = token.indexOf('=');
  if (index <= 0) {
    return null;
  }
  return {
    key: token.slice(0, index).trim(),
    value: token.slice(index + 1).trim(),
  };
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

  updateYamlRunBlockState(line, file.path, state);

  if (!isSectionedConfigFile(file.path)) {
    return;
  }

  const section = trimmed.match(/^\[([^\]]+)]\s*$/);
  if (section) {
    state.configSection = section[1];
  }
}

function updateYamlRunBlockState(line, filePath, state) {
  if (!isYamlFilePath(filePath)) {
    return;
  }

  const indent = line.match(/^\s*/)?.[0].length ?? 0;
  const trimmed = line.trim();

  if (state.yamlRunBlockIndent !== null && state.yamlRunBlockIndent !== undefined) {
    if (!trimmed) {
      state.yamlRunBlock = true;
      return;
    }
    if (indent > state.yamlRunBlockIndent) {
      state.yamlRunBlock = true;
      return;
    }
    state.yamlRunBlock = false;
    state.yamlRunBlockIndent = null;
  }

  const runBlock = line.match(/^(\s*)run:\s*[|>][+-]?\s*$/);
  if (runBlock) {
    state.yamlRunBlock = false;
    state.yamlRunBlockIndent = runBlock[1].length;
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
  scanGpuUpscaleFramegenKeywordFamilies(line, lineNo, file, context);
  scanPowerTdpRuntimeKeywordFamilies(line, lineNo, file, context);
  scanWindowsKeywordFamilies(line, lineNo, file, context);
  scanAgenticToolchainKeywordFamilies(line, lineNo, file, context);
  scanClaudeCodeModernKeywordFamilies(line, lineNo, file, context, lineState);
  scanSemanticPolicyClaims(line, lineNo, file, context, lineState);
  scanKnownGoodFrontierLine(line, lineNo, file, context);
  scanAnlandXwaylandResponsivenessLine(line, lineNo, file, context);
  scanDockLeaseProofLine(line, lineNo, file, context);
}

function isPlaceholderExample(line, marker, filePath = '') {
  const normalizedMarker = marker.toUpperCase();
  const trimmed = line.trim();
  const normalizedPath = normalizePath(filePath);

  if (isActionablePlaceholderMarker(trimmed, normalizedMarker)) {
    return false;
  }

  if ((normalizedPath === '.gitignore' || normalizedPath.endsWith('/.gitignore'))
    && normalizedMarker === 'FAKE'
    && /^#\s*FAKE\s*-\s*F#\s*Make\b/i.test(trimmed)) {
    return true;
  }

  if (isSourceCodePlaceholderLiteralFalsePositive(trimmed, filePath)) {
    return true;
  }

  if (normalizedMarker === 'WIP' && isDocumentedWipStatusLine(trimmed, filePath)) {
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

function isDocumentedWipStatusLine(line, filePath) {
  if (!isMarkdownLikePath(filePath) && !isYamlFilePath(filePath)) {
    return false;
  }
  if (!/\bWIP\b/i.test(line)) {
    return false;
  }
  if (/^#+\s+.+\bWIP\b/i.test(line) || /^\|.*\bWIP\b.*\|$/.test(line)) {
    return true;
  }
  return /\bWIP\b/i.test(line)
    && /\b(?:status|statuses|reports?|warning|guide|notes?|lane|release|recovery|fallback|baseline|draft|test(?:ing)?|current|classification|publish|flash|usable|only|until|if)\b/i.test(line);
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

function scanClaudeCodeModernFileSignals(file, context) {
  if (!isClaudeCodeModernProfile(context.profile)) {
    return;
  }

  const checks = [
    {
      pattern: /(^|\/)CLAUDE\.md$/i,
      category: 'claude_memory_instruction',
      severity: 'HIGH',
      claim: `CLAUDE_MD_MEMORY:${file.path}`,
      action: 'Treat CLAUDE.md as durable project memory and compare it against local/private overrides before acting.',
      rationale: 'CLAUDE.md is a primary Claude Code instruction and memory surface.',
    },
    {
      pattern: /(^|\/)AGENTS\.md$/i,
      category: 'claude_memory_instruction',
      severity: 'HIGH',
      claim: `AGENT_INSTRUCTION_SURFACE:${file.path}`,
      action: 'Treat AGENTS.md as a durable agent instruction source and compare it against Claude/Codex settings.',
      rationale: 'AGENTS.md often carries cross-agent workflow, approval, and verification rules.',
    },
    {
      pattern: /(^|\/)(?:\.claude\/)?settings\.managed\.json$/i,
      category: 'claude_settings_scope',
      severity: 'HIGH',
      claim: `SETTINGS_SCOPE_MANAGED:${file.path}`,
      action: 'Treat managed settings as the strongest local settings scope until an owner says otherwise.',
      rationale: 'Managed settings can enforce organization-level permissions and tool policy.',
    },
    {
      pattern: /(^|\/)\.claude\/settings\.json$/i,
      category: 'claude_settings_scope',
      severity: 'HIGH',
      claim: `SETTINGS_SCOPE_PROJECT:${file.path}`,
      action: 'Treat project settings as checked-in policy and compare them with local/private overrides.',
      rationale: 'Project settings are reviewable source-controlled policy for Claude Code behavior.',
    },
    {
      pattern: /(^|\/)\.claude\/settings\.local\.json$/i,
      category: 'claude_settings_scope',
      severity: 'MEDIUM',
      claim: `SETTINGS_SCOPE_LOCAL:${file.path}`,
      action: 'Keep local/private settings out of public source authority unless explicitly intended.',
      rationale: 'Local settings may be private overrides and should not become global project policy by accident.',
    },
    {
      pattern: /(^|\/)\.claude\/commands\//i,
      category: 'claude_command_surface',
      severity: 'MEDIUM',
      claim: `SLASH_COMMAND_SURFACE:${file.path}`,
      action: 'Review slash command payloads for shell, network, or mutation before reuse.',
      rationale: 'Slash commands are reusable command surfaces and may encode side effects.',
    },
    {
      pattern: /(^|\/)\.claude\/agents\//i,
      category: 'claude_subagent_surface',
      severity: 'MEDIUM',
      claim: `SUBAGENT_SCOPE_BOUNDARY:${file.path}`,
      action: 'Define subagent ownership, handoff files, and stale-agent cleanup before enabling parallel work.',
      rationale: 'Subagents need scoped boundaries to avoid conflicting edits or stale evidence.',
    },
    {
      pattern: /(^|\/)(?:\.mcp\.json|mcp(?:[-_]?config)?\.(?:json|toml|ya?ml)|\.claude\/mcp\.(?:json|toml|ya?ml))$/i,
      category: 'claude_mcp_surface',
      severity: 'MEDIUM',
      claim: `MCP_TOOL_SURFACE:${file.path}`,
      action: 'Identify MCP server command, credentials, network scope, and trust boundary before enabling it.',
      rationale: 'MCP connects the agent to external or local tools and must be scoped explicitly.',
    },
    {
      pattern: /(^|\/)SKILL\.md$/i,
      category: 'claude_skill_surface',
      severity: 'MEDIUM',
      claim: `SKILL_WORKFLOW:${file.path}`,
      action: 'Check skill trigger scope, references, and assets before importing it.',
      rationale: 'Skills are workflow contracts; broad or stale skill references pollute future agent context.',
    },
    {
      pattern: /(^|\/)(?:sessions?|transcripts?|agent_handoff|handoffs?|background[-_]?agents?)(\/|$|.*\.(?:md|json|jsonl|txt)$)/i,
      category: 'claude_generated_boundary',
      severity: 'INFO',
      claim: `GENERATED_ARTIFACT_NOT_AUTHORITY:${file.path}`,
      action: 'Use generated transcripts and handoffs as evidence, not source authority.',
      rationale: 'Generated agent artifacts can summarize work, but current source and raw evidence remain stronger.',
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
    || isDocumentedLegacyTargetReference(line)
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

function isDocumentedLegacyTargetReference(line) {
  return /\b(?:not compatible|not file-compatible|not interchangeable|do not flash|do not use|do not mix|wrong device|other devices?|older devices?|legacy|inherited from|based on|starting point|upstream|ancestry|provenance|comparison[- ]only|reference only|old inputs|left in place for comparison|not using the old|not permission to mix|port work|ported|adapted for|to rm11|broad .{0,32}claims|evidence lives)\b/i.test(line);
}

function scanAssignment(line, lineNo, file, context, lineState = {}) {
  const match = line.match(ASSIGNMENT_PATTERN);
  if (!match) {
    return;
  }

  const key = match[1].trim();
  const operator = match[2];
  if (operator === '=' && /^\s*=/.test(match[3])) {
    return;
  }
  const rawValue = stripInlineComment(match[3]).trim();
  if (!rawValue) {
    return;
  }

  let category = categorizeAssignment(key, rawValue, context.profile);
  const localCodeAssignment = isLocalCodeAssignment(key, file.path);
  const yamlRunBlockAssignment = isYamlRunBlockAssignment(file.path, lineState);
  const preserveProfileCategory = shouldPreserveLocalAssignmentCategory(category, context.profile, key, file.path);
  if (!preserveProfileCategory
    && (localCodeAssignment || yamlRunBlockAssignment || (category === 'build_variables' && !isProjectLevelAssignment(key, file.path)))) {
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

  const configScope = packageConfigAssignmentScope(filePath);
  if (configScope && isDefinitionCategory(category)) {
    const sectionScope = lineState.configSection && isSectionedConfigFile(filePath)
      ? normalizeConfigSectionName(lineState.configSection)
      : '';
    return sectionScope ? `${configScope}.${sectionScope}.${key}` : `${configScope}.${key}`;
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

function packageConfigAssignmentScope(filePath) {
  const normalizedPath = normalizePath(filePath);
  const name = basename(normalizedPath).toLowerCase();
  const scopedConfigNames = new Set([
    '.editorconfig',
    'cargo.toml',
    'cmakepresets.json',
    'package.json',
    'prefab.json',
    'pyproject.toml',
  ]);
  if (!scopedConfigNames.has(name)) {
    return null;
  }

  const dir = dirname(normalizedPath).replace(/^\.$/, '');
  return `config.${dir || 'root'}`;
}

function normalizeConfigSectionName(section) {
  return String(section ?? '')
    .trim()
    .replace(/^\*\./, 'glob_')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '') || 'section';
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

function scanKnownGoodFrontierLine(line, lineNo, file, context) {
  if (!isKnownGoodFrontierProfile(context.profile)) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (isKnownGoodFrontierScannerExample(file.path)) {
    return;
  }

  const add = (category, severity, normalizedClaim, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: trimmed,
    normalized_claim: normalizedClaim,
    related_paths: extractPathTokens(line),
    related_symbols: symbols,
    evidence_type: 'source_line',
    suggested_action: action,
    rationale,
  });

  const goodAction = 'Preserve this as frontier evidence; replay the exact harness before accepting lower newer runs.';
  const lowerAction = 'Treat this as lower-frontier evidence until it is reconciled against older raw known-good proof.';

  if (/\bNEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS\b/.test(trimmed)) {
    const statusClaim = isStatusOnlyFrontierSource(file.path)
      ? 'known_good_frontier.status.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS'
      : 'known_good_frontier.raw.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS';
    add(
      'known_good_frontier',
      'HIGH',
      statusClaim,
      goodAction,
      'This classification is the current highest Nebula Wayland working frontier when backed by raw counters or harness evidence.',
      ['NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS']
    );
  }

  if (/\bNONE_WAYLAND_DISPLAY\b/.test(trimmed)) {
    add(
      'known_good_frontier',
      'HIGH',
      'known_good_frontier.raw.blocker=NONE_WAYLAND_DISPLAY',
      goodAction,
      'The known-good frontier had no Wayland-display blocker.',
      ['NONE_WAYLAND_DISPLAY']
    );
  }

  const realBufferMatch = trimmed.match(/\breal_buffer_commits\b\s*[:=\t ]+\s*(\d+)/i)
    ?? trimmed.match(/\breal_commit_count\b\s*[:=\t ]+\s*(\d+)/i);
  if (realBufferMatch) {
    add(
      'known_good_frontier',
      Number(realBufferMatch[1]) > 0 ? 'HIGH' : 'MEDIUM',
      `known_good_frontier.raw_metric.real_buffer_commits=${realBufferMatch[1]}`,
      goodAction,
      'Real-buffer commit counters are raw proof and outrank status-only display claims.',
      ['real_buffer_commits']
    );
  }

  const vkFailureMatch = trimmed.match(/\b(?:vkGetMemoryFdKHR(?:_failures)?|VKGETMEMORYFD_FAILURE_COUNT|VKGETMEMORYFD_FAILURES)\b\s*[:=\t ]+\s*(\d+)/i);
  if (vkFailureMatch) {
    add(
      'known_good_frontier',
      Number(vkFailureMatch[1]) === 0 ? 'HIGH' : 'MEDIUM',
      `known_good_frontier.raw_metric.vkGetMemoryFdKHR_failures=${vkFailureMatch[1]}`,
      goodAction,
      'vkGetMemoryFdKHR failure counters are raw export evidence and outrank recency.',
      ['vkGetMemoryFdKHR']
    );
  } else if (/\bzero\s+vkGetMemoryFdKHR\s+failures\b/i.test(trimmed)) {
    add(
      'known_good_frontier',
      'HIGH',
      'known_good_frontier.raw_metric.vkGetMemoryFdKHR_failures=0',
      goodAction,
      'The line states zero vkGetMemoryFdKHR failures as raw runtime proof.',
      ['vkGetMemoryFdKHR']
    );
  }

  if (/\bsidecar-14\b/i.test(trimmed)) {
    add(
      'known_good_frontier',
      'HIGH',
      'known_good_frontier.harness.gamescope_sidecar=sidecar-14',
      goodAction,
      'The known-good harness used the sidecar-14 Gamescope path.',
      ['sidecar-14']
    );
  }

  if (/\bsidecar-06\b/i.test(trimmed)) {
    add(
      'known_good_frontier',
      'HIGH',
      'known_good_frontier.harness.xwayland_sidecar=sidecar-06',
      goodAction,
      'The known-good harness used the sidecar-06 Xwayland path.',
      ['sidecar-06']
    );
  }

  if (/\bforce[-_ ]composition\b/i.test(trimmed)) {
    add(
      'known_good_frontier',
      'HIGH',
      'known_good_frontier.harness.gamescope_trick=force-composition',
      goodAction,
      'The known-good harness forced composition for the real-buffer Wayland path.',
      ['force-composition']
    );
  }

  if (/\bfull[-_ ]size\s+AR24\s+parent\s+xdg\s+dmabuf\b/i.test(trimmed)) {
    add(
      'known_good_frontier',
      'HIGH',
      'known_good_frontier.harness.buffer_path=full-size_AR24_parent_xdg_dmabuf',
      goodAction,
      'The known-good display path was full-size AR24 parent xdg dmabuf, not wl_shm.',
      ['AR24', 'dmabuf']
    );
  }

  if (/\bpinned\b/i.test(trimmed) && /\b(?:local\s+)?ICD\b/i.test(trimmed) && /\bdriver\b/i.test(trimmed)) {
    add(
      'known_good_frontier',
      'MEDIUM',
      'known_good_frontier.vulkan_loader=pinned_local_icd_driver',
      goodAction,
      'The known-good harness pinned the local ICD and driver to avoid dual-ICD ambiguity.',
      ['VK_ICD_FILENAMES', 'VK_DRIVER_FILES']
    );
  } else if (/\bfreedreno_icd\.json\b/i.test(trimmed) && /\/usr\/local\//i.test(trimmed)) {
    add(
      'known_good_frontier',
      'MEDIUM',
      'known_good_frontier.vulkan_loader=pinned_local_icd_driver',
      goodAction,
      'The local freedreno ICD path is evidence for pinned local Vulkan loader selection.',
      ['freedreno_icd.json']
    );
  }

  if (/\b(?:NEBULA_R6_)?A1E_BASELINE_SIGBUS_CONFIRMED\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.lower.classification=NEBULA_R6_A1E_BASELINE_SIGBUS_CONFIRMED',
      lowerAction,
      'A1E SIGBUS confirmation is a lower proof level than a raw real-buffer Wayland pass.',
      ['NEBULA_R6_A1E_BASELINE_SIGBUS_CONFIRMED']
    );
  }

  if (/\bXwayland\s+SIGBUS\s+stayed\s+fatal\b/i.test(trimmed) || /\bSIGBUS\s+stayed\s+fatal\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.lower.xwayland_sigbus=stayed_fatal',
      lowerAction,
      'Fatal SIGBUS means this lane did not reach the older working Xwayland/display frontier.',
      ['SIGBUS']
    );
  }

  if (/\b(?:Xserver\s+ready|xserver_ready)\b\s*[:=]?\s*(?:no|false)\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.lower.xserver_ready=no',
      lowerAction,
      'Xserver not-ready evidence is below a proven Gamescope/Xwayland ready frontier.',
      ['xserver_ready']
    );
  }

  if (/\bglxinfo\s+(?:not\s+run|skipped)\b/i.test(trimmed) || /\bGLX\s+skipped\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'MEDIUM',
      'frontier.lower.glx=skipped',
      lowerAction,
      'Skipped GLX proof cannot supersede an older working display frontier.',
      ['glxinfo']
    );
  }

  if (/\bkeepalive\s+child\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'MEDIUM',
      'frontier.lower.keepalive_child=true',
      lowerAction,
      'A keepalive-only child path is not equivalent to a full working display/runtime harness.',
      ['keepalive child']
    );
  }

  if (/\bsidecar-13\b/i.test(trimmed)
    && isLowerFrontierSidecar13Evidence(trimmed)
    && !isHistoricalLowerFrontierReference(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.lower.gamescope_sidecar=sidecar-13',
      lowerAction,
      'A1E used sidecar-13 instead of the known-good sidecar-14 Gamescope harness.',
      ['sidecar-13']
    );
  }

  if (/\bshm\s+preload\b/i.test(trimmed) || /\blibreversa_shm_memfd\.so\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.lower.shm_preload=true',
      lowerAction,
      'The shm preload path is not the same as the known-good dmabuf real-buffer harness.',
      ['shm preload']
    );
  }

  if (/\bGAMESCOPE_EXIT\b\s*[:=]\s*135\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.invalid_export.GAMESCOPE_EXIT=135',
      lowerAction,
      'Gamescope exit 135 before downstream proof is an invalid export proof marker.',
      ['GAMESCOPE_EXIT']
    );
  }

  if (/\bFINAL_XWAYLAND_RUNNER_INVOKED\b\s*[:=]\s*0\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.invalid_export.FINAL_XWAYLAND_RUNNER_INVOKED=0',
      lowerAction,
      'The run exited before invoking the final Xwayland runner.',
      ['FINAL_XWAYLAND_RUNNER_INVOKED']
    );
  }

  if (/\bSELECTED_VULKAN_DEVICE\b\s*[:=]\s*NOT_FOUND\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.invalid_export.SELECTED_VULKAN_DEVICE=NOT_FOUND',
      lowerAction,
      'No selected Vulkan device means export improvement was not proven.',
      ['SELECTED_VULKAN_DEVICE']
    );
  }

  if (/\bVKGETMEMORYFD_FIRST_LINE\b\s*[:=]\s*NOT_FOUND\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.invalid_export.VKGETMEMORYFD_FIRST_LINE=NOT_FOUND',
      lowerAction,
      'No vkGetMemoryFdKHR line means export behavior was not reached.',
      ['VKGETMEMORYFD_FIRST_LINE']
    );
  }

  if (/\bA1\b.*\bchanged\b.*\bGamescope\s+libpath\b.*\bKGSL\s+env\b/i.test(trimmed)) {
    add(
      'frontier_regression_marker',
      'HIGH',
      'frontier.invalid_export.A1_CHANGED_GAMESCOPE_LIBPATH_AND_KGSL_ENV=true',
      lowerAction,
      'The run changed more than one variable family, so it cannot prove the bounded KGSL export hypothesis.',
      ['GAMESCOPE_LIBPATH', 'KGSL']
    );
  }
}

function scanAnlandXwaylandResponsivenessLine(line, lineNo, file, context) {
  if (!isAnlandXwaylandResponsivenessProfile(context.profile)) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (isAnlandXwaylandScannerExample(file.path)) {
    return;
  }

  const add = (category, severity, normalizedClaim, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: trimmed,
    normalized_claim: normalizedClaim,
    related_paths: extractPathTokens(line),
    related_symbols: symbols,
    evidence_type: 'source_line',
    suggested_action: action,
    rationale,
  });

  const readOnlyAction = 'Keep this as read-only display responsiveness evidence; use bounded timeout probes before any source or runtime mutation.';

  if (/\/usr\/local\/bin\/startanland-kde\.sh\b/i.test(trimmed)
    || /\bdbus-run-session\s+startplasma-wayland\b/i.test(trimmed)
    || /\bstartplasma-wayland\b/i.test(trimmed)
    || /\bplasma_session\b/i.test(trimmed)
    || /\bkwin_wayland(?:_wrapper)?\b/i.test(trimmed)
    || /\bDROIDSPACES_TEST_RC\b\s*[:=]\s*0\b/i.test(trimmed)
    || /\bTIMEOUT_TEST_RC\b\s*[:=]\s*0\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.producer=alive',
      readOnlyAction,
      'Anland/KDE/KWin process evidence shows the producer side is alive.',
      ['anland', 'kwin_wayland', 'startplasma-wayland']
    );
  }

  if (/\bPRODUCER_MISSING\b/i.test(trimmed)
    || /startanland-kde\.sh.*No such file or directory/i.test(trimmed)
    || /\bmissing:anland_producer\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.producer=missing',
      readOnlyAction,
      'The Anland producer entrypoint or process is missing.',
      ['anland', 'producer']
    );
  }

  if (/\/run\/user\/\d+\/wayland-\d+\b/i.test(trimmed)
    || /\/tmp\/\.X11-unix\/X\d+\b/i.test(trimmed)
    || /@\/tmp\/\.X11-unix\/X\d+\b/i.test(trimmed)
    || /\bsocket:\[\d+\]/i.test(trimmed)
    || /\bsrwx\S*\s+.*\b(?:wayland-\d+|X\d+)\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.socket=present',
      readOnlyAction,
      'Wayland or X11 socket ownership/path evidence is present.',
      ['wayland-0', 'X0']
    );
  }

  if (/\bSOCKET_MISSING\b/i.test(trimmed)
    || /\bmissing:display_daemon_socket\b/i.test(trimmed)
    || /(?:wayland-\d+|\/tmp\/\.X11-unix\/X\d+).*No such file or directory/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.socket=missing',
      readOnlyAction,
      'The expected Wayland or X11 display socket is absent.',
      ['display socket']
    );
  }

  if (/\bXAUTHORITY\b\s*[:=]/i.test(trimmed) || /\bMIT-MAGIC-COOKIE\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'MEDIUM',
      'anland_xwayland.xauth=present',
      readOnlyAction,
      'Xauthority evidence exists; client failures should be separated from missing producer failures.',
      ['XAUTHORITY', 'MIT-MAGIC-COOKIE']
    );
  }

  if (/\bNo protocol specified\b/i.test(trimmed)
    || /\bAuthorization required\b/i.test(trimmed)
    || /\bInvalid MIT-MAGIC-COOKIE\b/i.test(trimmed)
    || /\bunable to open display\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.xauth_or_display=bad',
      readOnlyAction,
      'Xauthority or DISPLAY prevented a client connection.',
      ['DISPLAY', 'XAUTHORITY']
    );
  }

  if (/\bDISPLAY\b\s*[:=]\s*:99\b/i.test(trimmed)
    || /\bDISPLAY\b\s*[:=]\s*""\b/i.test(trimmed)
    || /\bWAYLAND_DISPLAY\b\s*[:=]\s*""\b/i.test(trimmed)
    || /\bXDG_RUNTIME_DIR\b\s*[:=]\s*""\b/i.test(trimmed)
    || /\bXDG_RUNTIME_DIR is invalid or not set\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.env=leak_or_bad_display',
      readOnlyAction,
      'Display or runtime-directory environment points at the wrong layer or is unset.',
      ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']
    );
  }

  if (/\b(?:LD_LIBRARY_PATH|VK_ICD_FILENAMES|VK_DRIVER_FILES|MESA_LOADER_DRIVER_OVERRIDE|GALLIUM_DRIVER)\b\s*[:=]/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'MEDIUM',
      'anland_xwayland.env=runtime_variable_present',
      readOnlyAction,
      'Runtime graphics environment evidence is present and should be checked for layer ownership.',
      ['LD_LIBRARY_PATH', 'VK_ICD_FILENAMES', 'VK_DRIVER_FILES']
    );
  }

  if (/\bXDPYINFO_\w*_RC\b\s*[:=]\s*124\b/i.test(trimmed)
    || /\bxdpyinfo\b/i.test(trimmed) && /\b(?:timeout|Session terminated, killing shell)\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.x11_client=timeout',
      readOnlyAction,
      'An X11 metadata client timed out instead of proving responsiveness.',
      ['xdpyinfo']
    );
  }

  if (/\bGLXINFO_\w*_RC\b\s*[:=]\s*124\b/i.test(trimmed)
    || /\bglxinfo\b/i.test(trimmed) && /\b(?:timeout|Session terminated, killing shell)\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.glx_client=timeout',
      readOnlyAction,
      'A GLX client timed out; this is a responsiveness hang, not proof that the producer is missing.',
      ['glxinfo']
    );
  }

  if (/\bGLXINFO_\w*_RC\b\s*[:=]\s*0\b/i.test(trimmed) || /\bOpenGL renderer string\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.glx_client=ok',
      readOnlyAction,
      'GLX client proof completed successfully.',
      ['glxinfo', 'OpenGL renderer']
    );
  }

  if (/\bVULKANINFO_\w*_RC\b\s*[:=]\s*124\b/i.test(trimmed)
    || /\bVK_ERROR_INCOMPATIBLE_DRIVER\b/i.test(trimmed)
    || /\bERROR_INCOMPATIBLE_DRIVER\b/i.test(trimmed)
    || /\bfailed to load driver\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.vulkan=bad_or_timeout',
      readOnlyAction,
      'Vulkan summary did not complete cleanly under the Anland session.',
      ['vulkaninfo', 'Vulkan loader']
    );
  }

  if (/\bVULKANINFO_\w*_RC\b\s*[:=]\s*0\b/i.test(trimmed)
    || /\bVulkan Instance Version\b/i.test(trimmed)
    || /\bGPU id\b/i.test(trimmed)) {
    add(
      'anland_xwayland_probe',
      'HIGH',
      'anland_xwayland.vulkan=ok',
      readOnlyAction,
      'Vulkan summary completed successfully.',
      ['vulkaninfo']
    );
  }

  if (/\bNEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS\b/i.test(trimmed)
    || /\bpreflight_ready\b/i.test(trimmed)
    || /\breal_buffer_commits\b\s*[:=\t ]+\s*2\b/i.test(trimmed)
    || /\bvkGetMemoryFdKHR(?:_failures)?\b\s*[:=\t ]+\s*0\b/i.test(trimmed)) {
    add(
      'anland_xwayland_known_good',
      'HIGH',
      'anland_xwayland.known_good_frontier=present',
      readOnlyAction,
      'Known-good Nebula/WayLandIE frontier markers are present and should be compared before patching.',
      ['NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS', 'real_buffer_commits', 'vkGetMemoryFdKHR']
    );
  }
}

function scanDockLeaseProofLine(line, lineNo, file, context) {
  if (!isDockLeaseProofProfile(context.profile)) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (isDockLeaseScannerExample(file.path)) {
    return;
  }

  const add = (category, severity, normalizedClaim, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: trimmed,
    normalized_claim: normalizedClaim,
    related_paths: extractPathTokens(line),
    related_symbols: symbols,
    evidence_type: 'source_line',
    suggested_action: action,
    rationale,
  });

  const guardAction = 'Keep Dock lease proof host-only until bounded runtime gates prove authority, receiver handoff, TEST_ONLY, stop/revoke, rollback, and crash handling.';
  const warnAction = 'Block runtime promotion; a host-only Dock proof must not become a start command, runtime allowlist, or mutation path.';

  if (/\bDOCK_LEASE_COMMAND_PLAN_HOST_ONLY\b|\bhost[-_ ]only\b/i.test(trimmed) && /\bdock\b|\blease\b/i.test(trimmed)) {
    add(
      'dock_lease_host_proof',
      'HIGH',
      'dock_lease.command_plan=DOCK_LEASE_COMMAND_PLAN_HOST_ONLY',
      guardAction,
      'The line identifies Dock lease evidence as host-only planning proof.',
      ['DOCK_LEASE_COMMAND_PLAN_HOST_ONLY']
    );
  }

  if (/\bBLOCKED_NOT_READY\b/i.test(trimmed)) {
    add(
      'dock_lease_blocked_not_ready',
      'HIGH',
      'dock_lease.status=BLOCKED_NOT_READY',
      guardAction,
      'The Dock lane remains intentionally blocked until readiness gates are proven.',
      ['BLOCKED_NOT_READY']
    );
  }

  if (/\bmutation_allowed_by_policy\b\s*[:=]\s*false\b/i.test(trimmed) || /\bmutation\b.*\bdenied\b/i.test(trimmed)) {
    add(
      'dock_lease_mutation_denied',
      'HIGH',
      'dock_lease.mutation_allowed_by_policy=false',
      guardAction,
      'Dock mutation remains denied by policy.',
      ['mutation_allowed_by_policy']
    );
  }

  if (/\bdynamic[_ -]discovery\b/i.test(trimmed) || /\bdynamic\s+external[- ]only\s+discovery\b/i.test(trimmed)) {
    add(
      'dock_lease_dynamic_discovery_required',
      'HIGH',
      'dock_lease.discovery=dynamic_required',
      guardAction,
      'Dock DRM object IDs are runtime-volatile and must be rediscovered dynamically.',
      ['dynamic_discovery']
    );
  }

  if (/\bTEST_ONLY\b/i.test(trimmed)) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.TEST_ONLY=true',
      guardAction,
      'TEST_ONLY is required before any real lease commit.',
      ['TEST_ONLY']
    );
  }
  if (/\bSCM_RIGHTS\b/i.test(trimmed)) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.SCM_RIGHTS=true',
      guardAction,
      'SCM_RIGHTS handoff is required for lease fd transfer.',
      ['SCM_RIGHTS']
    );
  }
  if (/\bstop\/revoke\b|\bstop_revoke\b/i.test(trimmed)) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.stop_revoke=true',
      guardAction,
      'Dock lease control needs a stop/revoke path before runtime mutation.',
      ['stop_revoke']
    );
  }
  if (/\brollback\b/i.test(trimmed)) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.rollback=true',
      guardAction,
      'Dock lease runtime mutation needs rollback evidence.',
      ['rollback']
    );
  }
  if (/\bcrash[_ -]gate\b|\bcrash[_ -]counter\b/i.test(trimmed)) {
    add(
      'dock_lease_guard',
      'HIGH',
      'dock_lease.guard.crash_gate=true',
      guardAction,
      'Dock lease runtime mutation needs crash-counter enforcement.',
      ['crash_gate']
    );
  }

  const warningPatterns = [
    /\b(?:execute|executed|mutation_performed|mutation_allowed_by_policy)\b\s*[:=]\s*true\b/i,
    /\b(?:start_command_available|runtime_allowlists_modified|app_allowlists_modified|runtime_commands_added|apk_allowlist_changed|module_command_added)\b\s*[:=]\s*true\b/i,
    /\b(?:allow_raw_shell|allow_manual_connector_id|allow_manual_crtc_id|allow_manual_plane_id|allow_manual_fd|allow_internal_panel|allow_whole_card_takeover)\b\s*[:=]\s*true\b/i,
  ];
  if (warningPatterns.some(pattern => pattern.test(trimmed))) {
    const key = trimmed.match(/\b([A-Za-z_][A-Za-z0-9_]*)\b\s*[:=]\s*true\b/)?.[1] ?? 'runtime_promotion';
    add(
      'dock_lease_runtime_warning',
      'HIGH',
      `dock_lease.warning.${key}=true`,
      warnAction,
      'A positive runtime/mutation flag would promote the Dock lane beyond host-only proof.',
      [key]
    );
  }
}

function isStatusOnlyFrontierSource(filePath) {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.endsWith('.json') || /\bstatus\b|\bbaseline\b|\blanes\b/.test(normalized);
}

function isDockLeaseScannerExample(filePath) {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('lib/scan/')
    || normalized.startsWith('test/')
    || normalized === 'docs/DROIDSPACES_DOCK_LEASE_PROOF.md';
}

function isAnlandXwaylandScannerExample(filePath) {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('lib/scan/')
    || normalized.startsWith('test/')
    || normalized === 'docs/ANLAND_XWAYLAND_RESPONSIVENESS.md';
}

function isKnownGoodFrontierScannerExample(filePath) {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('lib/scan/')
    || normalized.startsWith('test/')
    || normalized === 'docs/KNOWN_GOOD_FRONTIER_GUARD.md';
}

function isHistoricalLowerFrontierReference(trimmed) {
  return /\b(?:historical|historic|older|old|past|previous|preserve|preserved)\b/i.test(trimmed)
    || /\b(?:not\s+(?:default|promoted|solved|proof)|unpromoted|promotion\s+candidate|rejected\s+interpretations?)\b/i.test(trimmed)
    || /\bdo\s+not\s+treat\b/i.test(trimmed)
    || /\bnext\s+live\s+gate\b/i.test(trimmed);
}

function isLowerFrontierSidecar13Evidence(trimmed) {
  return /\b(?:A1E|newer|lower|regress(?:ed|ion)?|SIGBUS|failed|failure|keepalive|GLX\s+skipped|shm\s+preload)\b/i.test(trimmed)
    || /\bsidecar-13\b.*\b(?:instead\s+of|not\s+the\s+same\s+as)\b.*\bsidecar-14\b/i.test(trimmed)
    || /\bsidecar-14\b.*\b(?:instead\s+of|not\s+the\s+same\s+as)\b.*\bsidecar-13\b/i.test(trimmed);
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

function scanGpuUpscaleFramegenKeywordFamilies(line, lineNo, file, context) {
  if (!isGpuUpscaleFramegenProfile(context.profile)) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const add = (category, normalizedClaim, severity, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: trimmed,
    normalized_claim: normalizedClaim,
    related_paths: extractPathTokens(line),
    related_symbols: symbols,
    evidence_type: 'source_line',
    suggested_action: action,
    rationale,
  });

  const checks = [
    {
      pattern: /\b(Cupscale|Flowframes|Real-?ESRGAN|ESRGAN|SwinIR|EDSR|SRGAN|waifu2x|Anime4K|Real-?CUGAN)\b/i,
      category: 'gpu_upscale_runtime',
      claim: 'UPSCALE_RUNTIME_CANDIDATE',
      action: 'Classify upscaling backend, model provenance, and local runtime proof before recommending use.',
      rationale: 'Upscaling project names identify a candidate lane, not proof that models, licenses, or GPU paths are ready.',
    },
    {
      pattern: /\b(RIFE|DAIN|FLAVR|GMFSS|IFRNet|XVFI|CAIN|EMA-?VFI|AMT|FILM|optical flow|frame interpolation|frame generation|interpolation factor|interpolation multiplier)\b/i,
      category: 'gpu_framegen_runtime',
      claim: 'FRAMEGEN_RUNTIME_CANDIDATE',
      action: 'Classify interpolation/frame-generation backend, input/output timing, model provenance, and runtime proof.',
      rationale: 'Frame interpolation and frame generation are model/runtime pipelines and require backend-specific evidence.',
    },
    {
      pattern: /\b(NCNN|ncnn-vulkan|rife-ncnn-vulkan|dain-ncnn-vulkan|ifrnet-ncnn-vulkan|Vulkan NCNN)\b/i,
      category: 'gpu_backend_surface',
      claim: 'VULKAN_NCNN_BACKEND_PRESENT',
      action: 'Verify Vulkan device selection, NCNN binary provenance, model files, GPU IDs, and command line before reuse.',
      rationale: 'NCNN/Vulkan can be portable, but it still needs backend, model, and GPU selection evidence.',
    },
    {
      pattern: /\b(PyTorch|torch(?:vision)?|torch\.cuda|CUDA_VISIBLE_DEVICES|RIFE_CUDA|FLAVR_CUDA|XVFI_CUDA)\b/i,
      category: 'gpu_backend_surface',
      claim: 'CUDA_BACKEND_PRESENT',
      action: 'Verify Python environment, torch CUDA availability, CUDA runtime, driver, and selected model backend.',
      rationale: 'PyTorch/CUDA references identify an acceleration backend, but host proof is still required.',
    },
    {
      pattern: /\b(ONNX Runtime|onnxruntime|\.onnx\b)\b/i,
      category: 'gpu_backend_surface',
      claim: 'ONNX_BACKEND_PRESENT',
      action: 'Record ONNX runtime provider, model opset, execution provider, and model hash before use.',
      rationale: 'ONNX compatibility depends on runtime providers and model metadata, not filename alone.',
    },
    {
      pattern: /\b(TensorRT|trtexec|\.engine\b)\b/i,
      category: 'gpu_backend_surface',
      claim: 'TENSORRT_BACKEND_PRESENT',
      action: 'Record TensorRT version, engine build hardware, precision, input shapes, and model provenance.',
      rationale: 'TensorRT engines are hardware/runtime sensitive and must be regenerated or verified per target.',
    },
    {
      pattern: /\b(DirectML|DML|Microsoft\.ML\.OnnxRuntime\.DirectML)\b/i,
      category: 'gpu_backend_surface',
      claim: 'DIRECTML_BACKEND_PRESENT',
      action: 'Treat DirectML as Windows-first unless Linux proof exists; record provider and driver evidence.',
      rationale: 'DirectML is usually a Windows execution provider and should not be promoted to Linux without proof.',
    },
    {
      pattern: /\b(FFmpeg|ffmpeg\.exe|ffprobe|VapourSynth|vspipe|Magick\.NET|ImageMagick|Magick\.Native)\b/i,
      category: 'gpu_media_pipeline',
      claim: 'PERFORMANCE_TUNING_HINT',
      action: 'Map media extraction/encoding, image comparison, and pipe stages before diagnosing model performance.',
      rationale: 'Video interpolation speed and quality depend on FFmpeg/VapourSynth/ImageMagick pipeline choices as much as model inference.',
    },
    {
      pattern: /\b(fp16|half precision|half-precision|UHD mode|scene[- ]change|dedup(?:e|lication)|GPU IDs?|NCNN processing threads?|VRAM|tile size)\b/i,
      category: 'gpu_performance_tuning',
      claim: 'PERFORMANCE_TUNING_HINT',
      action: 'Keep precision, UHD, scene-change, dedupe, GPU ID, thread, and VRAM settings tied to backend evidence.',
      rationale: 'These settings can improve performance or quality but may change stability and memory behavior.',
    },
    {
      pattern: /\b(dxgi\.dll|d3d11\.dll|d3d12\.dll|dinput8\.dll|winmm\.dll|version\.dll|proxy DLL|Windows Graphics Capture|cmd\.exe|net8\.0-windows|WinForms)\b/i,
      category: 'gpu_runtime_platform',
      claim: 'WINDOWS_ONLY_RUNTIME',
      action: 'Classify Windows DLL/proxy/WinForms/cmd.exe surfaces separately from Linux/Proton candidates.',
      rationale: 'Windows runtime surfaces do not become Linux-compatible without compatibility-layer proof.',
    },
  ];

  for (const check of checks) {
    const match = trimmed.match(check.pattern);
    if (!match) {
      continue;
    }
    add(check.category, check.claim, 'HIGH', check.action, check.rationale, [match[1] ?? match[0]]);
  }

  if (containsModelAssetReference(trimmed)) {
    add(
      'gpu_model_assets',
      'MODEL_ASSET_PRESENT',
      'HIGH',
      'Record model path, license, provenance URL, hash, backend, and allowed local-use status.',
      'Model files are executable runtime inputs; missing metadata can make results unreproducible or legally unsafe.',
      extractModelAssetSymbols(trimmed)
    );
    if (!/\b(?:sha256|sha-?256|hash|checksum|digest)\b/i.test(trimmed)) {
      add(
        'gpu_model_asset_guard',
        'MODEL_HASH_MISSING',
        'HIGH',
        'Add a model hash before allowing download, cache, or runtime use.',
        'Model weights and converted assets must be hash-guarded to avoid silent drift or replacement.',
        extractModelAssetSymbols(trimmed)
      );
    }
    if (!/\b(?:license|licensed|MIT|Apache|BSD|GPL|AGPL|CC-BY|model card)\b/i.test(trimmed)) {
      add(
        'gpu_model_asset_guard',
        'MODEL_LICENSE_UNKNOWN',
        'HIGH',
        'Record redistribution status before committing artifacts or publishing packages.',
        'Sparse license metadata does not block research classification, but it does block redistribution decisions.',
        extractModelAssetSymbols(trimmed)
      );
    }
    if (!/\b(?:source|provenance|origin|model card|huggingface|github|url|paper|upstream)\b/i.test(trimmed)) {
      add(
        'gpu_model_asset_guard',
        'MODEL_PROVENANCE_MISSING',
        'HIGH',
        'Record upstream provenance for the model asset before treating it as usable evidence.',
        'Model runtime behavior and legal status depend on upstream source, conversion path, and release notes.',
        extractModelAssetSymbols(trimmed)
      );
    }
  }

  if (/\b(?:CUDA|5090|GPU acceleration|accelerated|torch\.cuda|CUDA_VISIBLE_DEVICES)\b/i.test(trimmed)) {
    if (hasCudaProof(trimmed)) {
      add(
        'gpu_cuda_guard',
        '5090_ACCELERATION_CANDIDATE',
        'MEDIUM',
        'Keep CUDA acceleration as a candidate until benchmark/runtime proof is tied to the exact backend.',
        'nvidia-smi, torch CUDA, CUDA runtime, driver, and backend evidence are present enough to form a candidate.',
        ['CUDA']
      );
    } else {
      add(
        'gpu_cuda_guard',
        'CUDA_CLAIM_UNVERIFIED',
        'HIGH',
        'Require nvidia-smi, torch.cuda.is_available(), CUDA runtime version, driver version, and backend evidence.',
        'GPU acceleration claims are not proof without direct host/runtime evidence.',
        ['CUDA']
      );
    }
  }

  if (/\b(?:Linux compatible|Linux support|runs on Linux|Steam Deck|SteamOS|Proton compatible|Proton support|Wine compatible|Wine support)\b/i.test(trimmed)
    && !/\b(?:tested|validated|proof|pass|runtime log|screenshot|artifact)\b/i.test(trimmed)) {
    add(
      'gpu_linux_proton_guard',
      /proton|wine/i.test(trimmed) ? 'PROTON_COMPATIBLE_CANDIDATE' : 'LINUX_RUNTIME_UNKNOWN',
      'HIGH',
      'Require Linux/Proton runtime proof before promoting compatibility.',
      'Compatibility claims must be backed by actual runtime evidence on the target stack.',
      ['Linux', 'Proton']
    );
  }

  if (isExePatchLine(trimmed)) {
    if (hasSafeExePatchDossier(trimmed)) {
      add(
        'gpu_game_patch_guard',
        'GAME_PATCH_REVIEW_SAFE',
        'HIGH',
        'Keep this as a review-safe patch dossier; do not apply without explicit operator approval.',
        'The line contains the required hash, reversibility, backup, version, offset/signature, source, and legal/license evidence.',
        ['EXE patch']
      );
    } else {
      add(
        'gpu_game_patch_guard',
        'GAME_PATCH_UNSAFE',
        'HIGH',
        'Do not call this patch safe until original/patched hashes, reversible patch, backup, game version, offset/signature, patch source, and legal note exist.',
        'Executable patching without a complete dossier is not reproducible or safe to recommend.',
        ['EXE patch']
      );
      if (!/\b(?:SHA256Before|original hash|sha256 before|CRC32Before)\b/i.test(trimmed)
        || !/\b(?:SHA256After|patched hash|sha256 after|CRC32After)\b/i.test(trimmed)) {
        add(
          'gpu_game_patch_guard',
          'EXE_PATCH_HASH_REQUIRED',
          'HIGH',
          'Add original and patched executable hashes before treating this as a patch candidate.',
          'Hash guards prevent applying a patch to the wrong executable build.',
          ['EXE patch']
        );
      }
      if (!/\b(?:reversible|rollback|restore|backup|BackupPath|RollbackPlan)\b/i.test(trimmed)) {
        add(
          'gpu_game_patch_guard',
          'REVERSIBLE_PATCH_REQUIRED',
          'HIGH',
          'Add reversible patch, backup path, and rollback notes before patch review.',
          'A patch that cannot be safely reverted is not review-safe.',
          ['EXE patch']
        );
      }
    }
  }
}

function containsModelAssetReference(trimmed) {
  return /\b(?:model|weights?|checkpoint|Real-?ESRGAN|ESRGAN|SwinIR|EDSR|waifu2x|Real-?CUGAN|RIFE|DAIN|FLAVR)\b/i.test(trimmed)
    && /\.(?:pth|pt|onnx|safetensors|bin|param|weights)\b/i.test(trimmed);
}

function extractModelAssetSymbols(trimmed) {
  return uniq((trimmed.match(/[A-Za-z0-9_.@%+=:-]+\.(?:pth|pt|onnx|safetensors|bin|param|weights)\b/gi) ?? []).slice(0, 8));
}

function hasCudaProof(trimmed) {
  return /\bnvidia-smi\b/i.test(trimmed)
    && /\btorch\.cuda\.is_available\(\)\s*[:=]?\s*(?:true|1|yes)\b/i.test(trimmed)
    && /\b(?:CUDA runtime|CUDA version|cuda_version)\b/i.test(trimmed)
    && /\b(?:driver version|driver)\b/i.test(trimmed)
    && /\b(?:backend|PyTorch|ONNX|TensorRT|NCNN|DirectML)\b/i.test(trimmed);
}

function isExePatchLine(trimmed) {
  return /\b(?:\.exe\b|executable patch|binary patch|EXE patch|TargetExe|FileOffset|RVA|AOBSignature|OriginalBytes|PatchedBytes)\b/i.test(trimmed);
}

function hasSafeExePatchDossier(trimmed) {
  return /\b(?:SHA256Before|original hash|sha256 before|CRC32Before)\b/i.test(trimmed)
    && /\b(?:SHA256After|patched hash|sha256 after|CRC32After)\b/i.test(trimmed)
    && /\b(?:reversible|rollback|RollbackPlan|restore)\b/i.test(trimmed)
    && /\b(?:BackupPath|backup)\b/i.test(trimmed)
    && /\b(?:GameVersion|game version|FileVersion|ProductVersion|SteamBuildId)\b/i.test(trimmed)
    && /\b(?:FileOffset|RVA|AOBSignature|signature|offset)\b/i.test(trimmed)
    && /\b(?:PatchSource|patch source|source)\b/i.test(trimmed)
    && /\b(?:legal|license|offline|single-player|private co-?op)\b/i.test(trimmed);
}

function scanPowerTdpRuntimeKeywordFamilies(line, lineNo, file, context) {
  if (!isPowerTdpRuntimeProfile(context.profile)) {
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const add = (category, normalizedClaim, severity, action, rationale, symbols = []) => addEvidence(context, {
    category,
    severity,
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: trimmed,
    normalized_claim: normalizedClaim,
    related_paths: extractPathTokens(line),
    related_symbols: symbols,
    evidence_type: 'source_line',
    suggested_action: action,
    rationale,
  });

  const checks = [
    {
      pattern: /\b(ryzenadj|stapm-limit|fast-limit|slow-limit)\b/i,
      category: 'power_tdp_backend',
      claim: 'TDP_BACKEND_RYZENADJ',
      severity: 'HIGH',
      action: 'Classify ryzenadj as a TDP-write backend and keep execution behind explicit approval plus runtime proof.',
      rationale: 'ryzenadj changes hardware power limits; source references are research evidence, not permission to write TDP.',
    },
    {
      pattern: /\b(hhd\.plugins|HHDPlugin|AdjustorInitPlugin|adjustor\.hhd|plugin provider|entry_points?)\b/i,
      category: 'power_tdp_backend',
      claim: 'TDP_BACKEND_HHD_PLUGIN',
      severity: 'HIGH',
      action: 'Map the handheld-daemon plugin lifecycle before importing or wrapping any control surface.',
      rationale: 'HHD plugins are daemon-owned control paths and need lifecycle, provider, and conflict evidence.',
    },
    {
      pattern: /\b(acpi_call|\/proc\/acpi\/call|modprobe\s+acpi_call)\b/i,
      category: 'power_tdp_backend',
      claim: 'TDP_BACKEND_ACPI_CALL',
      severity: 'HIGH',
      action: 'Treat ACPI call use as mutation-capable and require explicit approval before any controlled test.',
      rationale: 'ACPI call writes can change firmware and platform state and must be separated from research scanning.',
    },
    {
      pattern: /\b(SMU|ALIB|SmuDriverPlugin|SmuQamPlugin|stapm_limit|fast_limit|slow_limit)\b/i,
      category: 'power_tdp_backend',
      claim: 'TDP_BACKEND_SMU',
      severity: 'HIGH',
      action: 'Record SMU/ALIB command ownership and target device before considering a controlled test.',
      rationale: 'SMU and ALIB paths are hardware-control backends with device-specific behavior.',
    },
    {
      pattern: /\b(SteamAppId|SteamGameId|STEAM_COMPAT_APP_ID|steam_appids?)\b/i,
      category: 'power_game_profile',
      claim: 'GAME_PROFILE_STEAM_APPID',
      severity: 'MEDIUM',
      action: 'Use Steam AppID as the highest-confidence game-profile key when it is present.',
      rationale: 'AppID-based matching is usually more stable than process-name matching for Steam games.',
    },
    {
      pattern: /\b(executables?|\.exe\b|cmdline|\/proc\/[0-9]+\/comm|detect_executable|process name)\b/i,
      category: 'power_game_profile',
      claim: 'GAME_PROFILE_EXECUTABLE',
      severity: 'MEDIUM',
      action: 'Cross-check executable/process matching against AppID and launcher context before tuning.',
      rationale: 'Executable names drift under launchers, Wine, Proton, and helper processes.',
    },
    {
      pattern: /\b(wine|wine64|wineserver|wine64-preloader|winedevice|proton|STEAM_COMPAT)\b/i,
      category: 'power_game_profile',
      claim: 'GAME_PROFILE_WINE_PROTON',
      severity: 'MEDIUM',
      action: 'Keep Wine/Proton profile detection separate from native executable detection.',
      rationale: 'Compatibility-layer games often expose helper process names that can confuse game-aware tuning.',
    },
    {
      pattern: /\b(silent|battery|balanced|performance|turbo|PERFORMANCE_MODE|POWER_MODE|platform_profile)\b/i,
      category: 'power_mode_profile',
      claim: 'POWER_MODE_PROFILE',
      severity: 'MEDIUM',
      action: 'Map power modes to explicit min/default/max caps before any apply path exists.',
      rationale: 'Mode names are policy labels; they need numeric caps and device context to be meaningful.',
    },
    {
      pattern: /\b(BATTERY_MAX_TDP|battery cap|charge_control|charge_limit|charge_behaviour|charge_behavior|charge_type|\/sys\/class\/power_supply)\b/i,
      category: 'power_battery_profile',
      claim: 'BATTERY_CAP_PRESENT',
      severity: 'MEDIUM',
      action: 'Record battery/AC source and cap ownership before using battery-aware tuning.',
      rationale: 'Battery limits and charge controls are host-mutating policies and must be visible in the evidence model.',
    },
    {
      pattern: /\b(STABLE_SAMPLE_COUNT|stable sample|stable_samples|hysteresis|MONITOR_INTERVAL|RYZENADJ_DELAY|candidate TDP)\b/i,
      category: 'power_sampling_policy',
      claim: 'STABLE_SAMPLE_HYSTERESIS',
      severity: 'MEDIUM',
      action: 'Preserve sample count, interval, and delay as stability guards in any imported profile.',
      rationale: 'Hysteresis prevents oscillation and is core evidence for safe game-aware TDP tuning.',
    },
    {
      pattern: /\b(known_devices\.json|DEVICE_PROFILE|device profile|MIN_TDP|DEFAULT_TDP|MAX_CPU_TDP|STEP_TDP)\b/i,
      category: 'power_device_profile',
      claim: 'DEVICE_PROFILE_PRESENT',
      severity: 'MEDIUM',
      action: 'Keep device profiles provenance-tracked and separate from generated recommendations.',
      rationale: 'Device profiles bind power limits to hardware identity and should not be guessed.',
    },
    {
      pattern: /\b(\/sys\/devices\/virtual\/dmi|\/sys\/class\/dmi|product_name|board_name|sys_vendor|DMI)\b/i,
      category: 'power_device_profile',
      claim: 'DEVICE_AUTODETECT_DMI',
      severity: 'MEDIUM',
      action: 'Use DMI autodetect as host evidence, then verify it against the target device profile.',
      rationale: 'DMI strings are useful but vendor-specific and can be absent or virtualized.',
    },
    {
      pattern: /\b(SimpleDeckyTDP|PowerControl|plugin_loader|Decky|power-profiles-daemon|tuned|PPD conflict)\b/i,
      category: 'power_plugin_conflict',
      claim: 'PLUGIN_CONFLICT_DETECTED',
      severity: 'HIGH',
      action: 'Treat plugin/service conflicts as a controlled-test blocker until ownership is decided.',
      rationale: 'Multiple power daemons can fight over the same TDP, GPU, battery, or platform profile surfaces.',
    },
    {
      pattern: /\b(rm\s+-rf|os\.rename|systemctl\s+(?:start|stop|enable|restart)|tee\s+["']?\$?SERVICE_FILE|install_service|set_tdp|ryzenadj\s+--|\/proc\/acpi\/call|\/sys\/firmware\/acpi\/platform_profile|charge_control_end_threshold|charge_type)\b/i,
      category: 'power_mutation_guard',
      claim: 'MUTATION_REQUIRES_APPROVAL',
      severity: 'HIGH',
      action: 'Do not execute this surface from Reversa; require explicit operator approval and a rollback plan.',
      rationale: 'TDP writes, service changes, ACPI calls, plugin moves, and charge controls are host-mutating actions.',
    },
    {
      pattern: /\b(runtime proof missing|runtime unproven|proof required|not run|deferred|controlled test later|runtime test later)\b/i,
      category: 'power_runtime_proof',
      claim: 'RUNTIME_PROOF_MISSING',
      severity: 'HIGH',
      action: 'Keep this as research metadata until a controlled runtime proof exists.',
      rationale: 'Power-control source evidence is not runtime proof that a backend is safe or effective.',
    },
    {
      pattern: /\b(RESEARCH_READY_FOR_CONTROLLED_TEST|controlled test|profile import|daemon model|research-ready)\b/i,
      category: 'power_research_status',
      claim: 'RESEARCH_READY_FOR_CONTROLLED_TEST',
      severity: 'MEDIUM',
      action: 'Prepare a bounded no-surprises controlled test plan before any mutation-capable command.',
      rationale: 'Research readiness means enough provenance exists to design a test, not that apply actions are approved.',
    },
  ];

  for (const check of checks) {
    const match = trimmed.match(check.pattern);
    if (!match) {
      continue;
    }
    add(check.category, check.claim, check.severity, check.action, check.rationale, [match[1] ?? match[0]]);
  }
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
  if (isSemanticPolicyDocumentationExample(trimmed, file.path)) {
    return;
  }
  const evidenceKind = semanticEvidenceKind(file.path, context);

  for (const rule of SEMANTIC_POLICY_CLAIM_RULES) {
    const match = rule.patterns.find(pattern => pattern.test(line));
    if (!match) {
      continue;
    }
    if (isNegatedSemanticAction(line, rule.category)) {
      continue;
    }
    if (isSemanticPolicyRuleFalsePositive(trimmed, file.path, rule.category, lineState)) {
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
    || isGeneratedEvidenceFilePath(normalized)
    || isGeneratedEvidenceDirectoryPath(normalized)
    || normalized.startsWith('site/')
    || normalized.startsWith('reversa_out/')
    || normalized.startsWith('_reversa_sdd/')
    || normalized.startsWith('_reversa_forward/')
    || normalized.startsWith('agent_handoff/')
    || /(^|\/)(generated|auto-generated|autogenerated)(\/|$)/i.test(normalized);
}

function isGeneratedEvidenceDirectoryPath(filePath) {
  const normalized = normalizePath(filePath);
  return GENERATED_EVIDENCE_DIR_PATTERNS.some(pattern => pattern.test(normalized));
}

function isGeneratedEvidenceFilePath(filePath) {
  const normalized = normalizePath(filePath);
  return ROOT_SCAN_ARTIFACT_FILES.has(normalized)
    || isGeneratedEvidenceDirectoryPath(normalized)
    || /(^|\/)agent_handoff\/(?:contradictions|patch_candidates|findings|known_good_facts|risky_assumptions|tree_inventory)\.json$/i.test(normalized)
    || /(^|\/)(?:agentic-training-pack|training-history|predictions|target-advisory-predictions)\.jsonl$/i.test(normalized)
    || /(^|\/)(?:agentic-training-summary|eval_report|dataset-summary)\.md$/i.test(normalized);
}

function isTrainingEvalArtifactPath(filePath) {
  const normalized = normalizePath(filePath);
  return /(^|\/)(?:agentic-training-pack|agentic-training-summary|agentic-training-labels|training-history|eval_report|predictions|target-advisory-predictions|policy-classifier|metrics|vectorizer|labels)\.(?:json|jsonl|md|pt)$/i.test(normalized)
    || /(^|\/)(?:local\/)?(?:evals?|reversa-evals?|.*training-pack[^/]*|.*policy-classifier[^/]*)(?:\/|$)/i.test(normalized);
}

function isMarkdownLikePath(filePath) {
  return /\.(md|markdown|mdown|txt)$/i.test(filePath);
}

function isYamlFilePath(filePath) {
  return /\.ya?ml$/i.test(filePath);
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

function isSemanticPolicyDocumentationExample(trimmed, filePath) {
  const normalizedPath = normalizePath(filePath);
  if (normalizedPath.endsWith('docs/semantic-policy-contradictions.md')) {
    return true;
  }
  if (/\b(?:example|examples only|for example|such as|flags import boundaries|profile flags|lanes?)\b/i.test(trimmed)
    && /\b(?:read-only|patch away|ask for approval|skip approvals?|adb install|adb reboot|NOASSERTION|missing attribution|sourcemap|copied from|vendored from)\b/i.test(trimmed)) {
    return true;
  }
  if (/\b(?:conflicts? with|become a clear contradiction|contradiction instead of)\b/i.test(trimmed)
    && /\b(?:skip approvals?|patch away|adb install|read-only|ask before|ask for approval)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isSemanticPolicyRuleFalsePositive(trimmed, filePath, category, lineState = {}) {
  if (isSchemaDescriptionPolicyFalsePositive(trimmed, filePath, category)
    || isSampleContentPolicyFalsePositive(filePath, category)
    || isDocDecisionPolicyFalsePositive(filePath, category)
    || isSourceContentPolicyFalsePositive(filePath, category)
    || isRuntimeConfigPolicyFalsePositive(filePath, category)
    || isYamlDocumentationPolicyFalsePositive(filePath, category, lineState)
    || isAnalyzerConfigPolicyFalsePositive(trimmed, filePath, category)) {
    return true;
  }
  if (category === 'active_agent') {
    if (/\b(?:active-first|ACTIVE_FIRST|active module|active known-good|active-first frontier)\b/i.test(trimmed)) {
      return true;
    }
  }
  if (category === 'device_action_forbidden') {
    if (/\b(?:no|without)\s+adb\s+access\b.{0,80}\b(?:remote testers?|users?|testers?|in the wild)\b/i.test(trimmed)
      || /\b(?:remote testers?|users?|testers?|in the wild)\b.{0,80}\b(?:no|without)\s+adb\s+access\b/i.test(trimmed)) {
      return true;
    }
  }
  if (category === 'destructive_action') {
    const normalizedPath = normalizePath(filePath);
    if (/(^|\/)(?:scripts\/package|packaging|package)(\/|$)/i.test(normalizedPath)
      && /^\s*rm\s+-rf\s+(?:[A-Za-z0-9._-]+(?:\s+|$)){1,8}$/i.test(trimmed)) {
      return true;
    }
  }
  if (category === 'source_patch_allowed' || category === 'write_allowed' || category === 'destructive_action' || category === 'device_action_allowed') {
    if (/\b(?:do not|does not|don't|dont|never|no|without|not)\b.{0,160}\b(?:apply patches?|patch source|edit source|edit files?|commit|push|reboot|flash|install modules?|adb|fastboot|run destructive commands)\b/i.test(trimmed)) {
      return true;
    }
  }
  if (category === 'device_action_allowed' || category === 'destructive_action') {
    if (isMarkdownLikePath(filePath) && /^\s*(?:reboot|flash|install|push|commit|delete)\.\s*$/i.test(trimmed)) {
      return true;
    }
    if (isHistoricalDeviceActionEvidenceLine(trimmed)) {
      return true;
    }
    if (/\b(?:sends?|sent|used|uses|proof|evidence|captured|recorded|script)\b.{0,80}\b(?:adb\s+reboot|adb\s+install|fastboot|reboot|flash)\b/i.test(trimmed)
      || /\b(?:adb\s+reboot|adb\s+install|fastboot|reboot|flash)\b.{0,80}\b(?:was not run|not run|not executed|without running)\b/i.test(trimmed)) {
      return true;
    }
    if (/^\s*(?:[-*]\s*)?(?:Device-mutating actions|source-mutating actions|reboot\/flash\/delete flows|commit, push, reboot, flash, or install modules|flash devices, reboot, or run destructive commands)\b/i.test(trimmed)) {
      return true;
    }
  }
  if (category === 'source_authority') {
    if (/\b(?:reference-only|reference only|classifier\/reference|no code or docs copied|does not vendor|do not vendor|unless a future|license review|decompiled|no-license|custom-commercial-terms)\b/i.test(trimmed)) {
      return true;
    }
  }
  if (category === 'attribution_missing') {
    if (/\b(?:profile flags|flags import boundaries|lanes?)\b/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function isSchemaDescriptionPolicyFalsePositive(trimmed, filePath, category) {
  if (!SEMANTIC_POLICY_CONTENT_CATEGORIES.has(category)) {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  if (!/\.(?:json|ya?ml)$/i.test(normalizedPath)) {
    return false;
  }
  if (!/(?:openapi|swagger|plugin|plugins|sample|samples|testplugins)/i.test(normalizedPath)) {
    return false;
  }
  return /^\s*["']?description["']?\s*:/.test(trimmed);
}

function isSampleContentPolicyFalsePositive(filePath, category) {
  if (!SEMANTIC_POLICY_CONTENT_CATEGORIES.has(category)) {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  if (isPolicyAuthorityPath(normalizedPath)) {
    return false;
  }
  return /(^|\/)(?:samples?|[^/]*_samples?|demos?|examples?|tests?|fixtures?)\//i.test(normalizedPath);
}

function isDocDecisionPolicyFalsePositive(filePath, category) {
  if (!SEMANTIC_POLICY_CONTENT_CATEGORIES.has(category)) {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  if (isPolicyAuthorityPath(normalizedPath)) {
    return false;
  }
  return /(^|\/)docs\/decisions\//i.test(normalizedPath);
}

function isSourceContentPolicyFalsePositive(filePath, category) {
  if (!SEMANTIC_POLICY_CONTENT_CATEGORIES.has(category)) {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  if (isPolicyAuthorityPath(normalizedPath)) {
    return false;
  }
  return isCodeSourceFile(normalizedPath);
}

function isRuntimeConfigPolicyFalsePositive(filePath, category) {
  if (!SEMANTIC_POLICY_CONTENT_CATEGORIES.has(category)) {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  if (isPolicyAuthorityPath(normalizedPath)) {
    return false;
  }
  return /(^|\/)(?:recovery\/root|root|system|vendor|product|odm)\/.*\.(?:rc|xml|manifest)$/i.test(normalizedPath);
}

function isYamlDocumentationPolicyFalsePositive(filePath, category, lineState = {}) {
  if (!SEMANTIC_POLICY_CONTENT_CATEGORIES.has(category) || !isYamlFilePath(filePath)) {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  if (isPolicyAuthorityPath(normalizedPath)) {
    return false;
  }
  return !lineState.yamlRunBlock;
}

function isAnalyzerConfigPolicyFalsePositive(trimmed, filePath, category) {
  if (category !== 'read_only') {
    return false;
  }
  const normalizedPath = normalizePath(filePath);
  return /(^|\/)\.editorconfig$/i.test(normalizedPath)
    && /\bdotnet_diagnostic\.[A-Z0-9]+\.severity\b/i.test(trimmed);
}

function isPolicyAuthorityPath(normalizedPath) {
  const name = basename(normalizedPath);
  return /^(AGENTS|CLAUDE|WARP)\.md$/i.test(name)
    || /(^|\/)SKILL\.md$/i.test(normalizedPath)
    || /(^|\/)(?:policy|policies|instructions|directives|security|governance)(?:\/|$)/i.test(normalizedPath);
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

function isHistoricalDeviceActionEvidenceLine(trimmed) {
  if (!/\b(?:adb|fastboot|reboot|flash(?:ed|ing)?|booted|recovery_[ab]|chmod\s+(?:777|666)|dd\s+if=)\b/i.test(trimmed)) {
    return false;
  }

  return /\b(?:PASS|FAIL|failed|failure|error|attempt|observed|captured|recorded|evidence|proof|forensics?|baseline|readback|matched|available|status|result|ready|checked|validated|not validated|not useful|poor validation|non-diagnostic|unknown|booted|flashed|rebooted)\b/i.test(trimmed)
    || /^\s*[-*|]?\s*`?(?:adb|fastboot)\b.*`?\s*(?::|\|)\s*(?:PASS|FAIL|failed|error|unknown|not validated)/i.test(trimmed);
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

function scanClaudeCodeModernKeywordFamilies(line, lineNo, file, context, lineState = {}) {
  if (!isClaudeCodeModernProfile(context.profile)) {
    return;
  }
  if (lineState.markdownFence
    || isSourceImplementationPolicyFalsePositive(line, file.path)
    || isSourceCodePolicyLiteralFalsePositive(line, file.path)) {
    return;
  }

  const trimmed = line.trim();
  const checks = [];

  if (/\b(?:read-only|research-only|analysis-only|inspect only|do not edit|no source changes|no patch(?:ing)?|no writes?)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_task_scope',
      severity: 'HIGH',
      claim: 'READ_ONLY_TASK',
      symbols: ['read_only'],
      action: 'Keep the current task read-only unless a newer explicit instruction widens scope.',
      rationale: 'Read-only task scope is a strong guard against accidental source or runtime mutation.',
    });
  }

  if (/\b(?:apply_patch|patch source|patch files?|edit files?|write changes|commit\b|push\b|publish\b|install APK|stage module|adb install|adb reboot|fastboot flash)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_patch_plan_guard',
      severity: 'HIGH',
      claim: 'PATCH_PLAN_REVIEW_REQUIRED',
      symbols: ['patch', 'commit', 'push'],
      action: 'Require an explicit pass-level patch/commit/push/install permission before acting.',
      rationale: 'Patch, publish, install, and device-mutating commands must not inherit permission from unrelated docs or stale runs.',
    });
  }

  if (/\b(?:dangerously-skip-permissions|skip approvals?|auto[- ]?approve|allow all|approval[_ -]?policy\s*[:=]\s*(?:never|none|auto|always))\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_permission_policy',
      severity: 'HIGH',
      claim: 'AUTO_APPROVE_POLICY',
      symbols: ['approval', 'auto_approve'],
      action: 'Do not pair auto-approval with destructive, device, network, or publish commands without explicit owner confirmation.',
      rationale: 'Auto-approval weakens the human gate that prevents destructive or stale automation.',
    });
  }

  if (/\b(?:rm\s+-rf|git\s+reset\s+--hard|git\s+checkout\s+--|adb\s+install|adb\s+reboot|fastboot\s+flash|reboot\b|mkfs(?:\.\w+)?\b|dd\s+if=|chmod\s+(?:777|666)\b|setenforce\s+0)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_command_plan_guard',
      severity: 'HIGH',
      claim: 'COMMAND_PLAN_UNSAFE',
      symbols: ['destructive_command'],
      action: 'Stop and require explicit operator approval plus rollback/evidence plan before running this command.',
      rationale: 'Destructive commands can mutate source, devices, or host state and need a hard review gate.',
    });
  }

  if (/\b(?:sandbox|required sandbox|read-only sandbox|approval gate|ask before destructive|permission gate)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_permission_policy',
      severity: 'MEDIUM',
      claim: 'SANDBOX_REQUIRED',
      symbols: ['sandbox', 'approval'],
      action: 'Preserve sandbox and approval gates when translating this workflow into commands.',
      rationale: 'Sandbox policy controls whether a plan is safe to execute unattended.',
    });
  }

  if (/\b(?:PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|Stop|Notification|hooks?\.json|hook)\b/i.test(trimmed)) {
    const safeFormatter = /\b(?:ruff format|ruff check --fix|prettier|eslint --fix|gofmt|cargo fmt|ktlint|black|isort)\b/i.test(trimmed);
    const mutating = /\b(?:rm\s+-rf|adb\s+install|adb\s+reboot|fastboot|git\s+push|curl\s+.+\|\s*sh|chmod\s+(?:777|666)|setenforce\s+0)\b/i.test(trimmed);
    checks.push({
      category: 'claude_hook_policy',
      severity: mutating ? 'HIGH' : 'MEDIUM',
      claim: safeFormatter && !mutating ? 'HOOK_SAFE_FORMATTER' : 'HOOK_MUTATION_RISK',
      symbols: ['hook'],
      action: safeFormatter && !mutating
        ? 'Treat this as a lower-risk formatter hook, but still verify trigger scope and changed files.'
        : 'Review hook side effects and block destructive/device/network mutations without explicit approval.',
      rationale: 'Hooks run around agent tool calls and can mutate state before a human sees the command.',
    });
  }

  if (/\b(?:subagent|sub-agent|background agent|parallel agent|worker agent|agent team|handoff)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_subagent_surface',
      severity: 'MEDIUM',
      claim: 'SUBAGENT_SCOPE_BOUNDARY',
      symbols: ['subagent'],
      action: 'Require ownership, stale-agent cleanup, and result artifact boundaries for parallel agent work.',
      rationale: 'Subagents are useful only when their outputs cannot silently override current source authority.',
    });
  }

  if (/\b(?:stale agent|stale subagent|remove stale agents?|cleanup stale agents?)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_subagent_surface',
      severity: 'MEDIUM',
      claim: 'STALE_AGENT_REFERENCE',
      symbols: ['stale_agent'],
      action: 'Clean or explicitly retire stale agent references before using their outputs.',
      rationale: 'Stale agents and old handoffs are a common source of regression loops.',
    });
  }

  if (/\b(?:MCP|mcp server|tool server)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_mcp_surface',
      severity: 'MEDIUM',
      claim: 'MCP_TOOL_SURFACE',
      symbols: ['mcp'],
      action: 'Map MCP command, credentials, filesystem/network scope, and trust boundary before enabling it.',
      rationale: 'MCP expands the agent tool surface and can cross local/external service boundaries.',
    });
  }

  if (/\b(?:plugin|plugins|connector|marketplace)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_plugin_surface',
      severity: 'MEDIUM',
      claim: 'PLUGIN_TOOL_SURFACE',
      symbols: ['plugin'],
      action: 'Confirm plugin provenance, install scope, and credential boundary before relying on it.',
      rationale: 'Plugins can install reusable capabilities and should be treated as tool-surface changes.',
    });
  }

  if (/\b(?:SKILL\.md|skill workflow|skill loading|progressive disclosure)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_skill_surface',
      severity: 'MEDIUM',
      claim: 'SKILL_WORKFLOW',
      symbols: ['skill'],
      action: 'Review skill trigger scope and referenced files before adding it to a default workflow.',
      rationale: 'Skills should pull relevant context, not broad stale corpora.',
    });
  }

  if (/\b(?:slash command|\/[A-Za-z][A-Za-z0-9_-]+|\.claude\/commands)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_command_surface',
      severity: 'MEDIUM',
      claim: 'SLASH_COMMAND_SURFACE',
      symbols: ['slash_command'],
      action: 'Review slash-command payload and permissions before promoting it into common workflows.',
      rationale: 'Slash commands can package repeated shell or patch workflows behind a short name.',
    });
  }

  if (/\b(?:Agent SDK|agents sdk|OpenAI Agents SDK|Anthropic SDK|automation agent|code review automation|GitHub Actions|pull request review)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_remote_ci_surface',
      severity: 'MEDIUM',
      claim: 'CI_CODE_REVIEW_AUTOMATION',
      symbols: ['ci', 'agent_sdk'],
      action: 'Classify automated review/agent runs as generated evidence unless a human commits the result.',
      rationale: 'Remote and CI agents produce useful artifacts but should not silently become source authority.',
    });
  }

  const activeIndex = trimmed.indexOf('/data/adb/modules/nebula_core/bin/nebula-core');
  const pendingIndex = trimmed.indexOf('/data/adb/modules_update/nebula_core/bin/nebula-core');
  const explicitlyGuardedPending = /\b(?:explicit guarded dry-check|guarded dry-check|debug\/dry-check|debug mode|probe mode|anti-regression comparison|only after explicit)\b/i.test(trimmed);
  if (pendingIndex >= 0 && !explicitlyGuardedPending && (activeIndex < 0 || pendingIndex < activeIndex)) {
    checks.push({
      category: 'claude_frontier_guard',
      severity: 'HIGH',
      claim: 'FRONTIER_REGRESSION_RISK',
      symbols: ['modules_update', 'active_first'],
      action: 'Reject pending-module-first plans unless this is an explicit guarded dry-check.',
      rationale: 'Pending modules_update output can be stale and must not override active known-good module proof.',
    });
    checks.push({
      category: 'claude_command_plan_guard',
      severity: 'HIGH',
      claim: 'COMMAND_PLAN_UNSAFE',
      symbols: ['modules_update'],
      action: 'Use active module first; pending module is debug/dry-check only after anti-regression comparison.',
      rationale: 'The known Nebula regression path came from letting a stale pending module override active proof.',
    });
  } else if (activeIndex >= 0 || /\bactive module (?:is |stays |remains )?(?:authoritative|first)|active-first|ACTIVE_FIRST/i.test(trimmed)) {
    checks.push({
      category: 'claude_frontier_guard',
      severity: 'HIGH',
      claim: 'ACTIVE_FIRST_AUTHORITY',
      symbols: ['active_first'],
      action: 'Keep active module dispatch authoritative unless an explicit guarded dry-check says otherwise.',
      rationale: 'Active-first authority preserves known-good frontier proof against stale staged updates.',
    });
  }

  if (/\b(?:generated artifact|generated transcript|generated scan|source_authority=false|not source authority)\b/i.test(trimmed)) {
    checks.push({
      category: 'claude_generated_boundary',
      severity: 'INFO',
      claim: 'GENERATED_ARTIFACT_NOT_AUTHORITY',
      symbols: ['generated_artifact'],
      action: 'Use generated artifacts as evidence and require raw/current source before patch decisions.',
      rationale: 'Generated outputs are useful memory, but they can recurse into stale authority if not labeled.',
    });
  }

  for (const check of checks) {
    addEvidence(context, {
      category: check.category,
      severity: check.severity,
      confidence: 'likely',
      source_file: file.path,
      source_line_start: lineNo,
      source_line_end: lineNo,
      extracted_text: trimmed,
      normalized_claim: check.claim,
      related_paths: extractPathTokens(line),
      related_symbols: check.symbols,
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
    'known_good_frontier',
	    'nebula_frontier_guard',
	    'frontier_guard',
	    'anland_xwayland_responsiveness',
	    'nebula_anland_xwayland',
	    'anland_responsiveness',
	    'decoded_media_evidence',
	    'nebula_media_evidence',
	    'telegram_media_evidence',
	    'linux_container',
	    'power_tdp_runtime',
	    'autotdp',
    'hhd_autotdp',
    'tdp_control',
    'handheld_daemon',
    'game_power_profile',
    'battery_perf_profile',
  ].includes(profile?.id);
}

function isNebulaRuntimeProfile(profile) {
  return profile?.nebulaRuntimeProfile === true || [
    'child_libpath',
    'nebula_child_libpath',
    'nebula_gamescope',
    'nebula_vulkan_loader',
	    'known_good_frontier',
	    'nebula_frontier_guard',
	    'frontier_guard',
	    'anland_xwayland_responsiveness',
	    'nebula_anland_xwayland',
	    'anland_responsiveness',
	    'decoded_media_evidence',
	    'nebula_media_evidence',
	    'telegram_media_evidence',
	    'gamescope',
	    'userspace_graphics',
    'vulkan_loader',
    'rm11pro_gaming_runtime',
  ].includes(profile?.id);
}

function isKnownGoodFrontierProfile(profile) {
  return profile?.knownGoodFrontierProfile === true || [
    'known_good_frontier',
    'nebula_frontier_guard',
    'frontier_guard',
  ].includes(profile?.id);
}

function isAnlandXwaylandResponsivenessProfile(profile) {
  return profile?.anlandXwaylandResponsivenessProfile === true || [
    'anland_xwayland_responsiveness',
    'nebula_anland_xwayland',
    'anland_responsiveness',
  ].includes(profile?.id);
}

function isDecodedMediaEvidenceProfile(profile) {
  return profile?.decodedMediaEvidenceProfile === true || [
    'decoded_media_evidence',
    'nebula_media_evidence',
    'telegram_media_evidence',
  ].includes(profile?.id);
}

function isDockLeaseProofProfile(profile) {
  return profile?.dockLeaseProofProfile === true || [
    'droidspaces_dock_lease',
    'nebula_dock_schema',
    'dock_command_plan',
  ].includes(profile?.id);
}

function isPCGamingWikiLikeProfile(profile) {
  return profile?.pcgamingwikiProfile === true || [
    'game_modding',
    'graphics_wrapper',
    'vulkan_loader',
    'gpu_upscale_framegen',
    'widescreen_framegen_runtime',
    'game_exe_patch_runtime',
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

function isGpuUpscaleFramegenProfile(profile) {
  return profile?.gpuUpscaleFramegenProfile === true;
}

function isPowerTdpRuntimeProfile(profile) {
  return profile?.powerTdpRuntimeProfile === true || [
    'power_tdp_runtime',
    'autotdp',
    'hhd_autotdp',
    'tdp_control',
    'handheld_daemon',
    'game_power_profile',
    'battery_perf_profile',
  ].includes(profile?.id);
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

function isClaudeCodeModernProfile(profile) {
  return profile?.claudeCodeModernProfile === true || [
    'claude_code_modern',
    'claude_code',
    'codex_agent',
    'agent_workflow',
    'ai_coding_surface',
    'claude_matrix',
  ].includes(profile?.id);
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
  const requiredPatterns = context.profile.requiredFilePatterns ?? [];
  if (!shouldEnforceRequiredFilePatterns(context, requiredPatterns)) {
    setProfileApplicability(
      context,
      'not_applicable',
      'no strong Android recovery/device-tree anchors found'
    );
    addEvidence(context, {
      category: 'profile_fit',
      severity: 'INFO',
      confidence: 'confirmed',
      source_file: '.',
      source_line_start: 1,
      source_line_end: 1,
      extracted_text: `${context.profile.id} required-file checks skipped because no matching profile anchors were found.`,
      normalized_claim: `profile_fit:${context.profile.id}=not_applicable`,
      evidence_type: 'derived_inventory',
      suggested_action: 'Run a profile that matches this project root, or point the recovery profile at an Android recovery/device tree checkout.',
      rationale: 'Required-file checks are only useful after the scanned root matches the selected profile family.',
    });
    return;
  }

  if (requiredPatterns.length) {
    setProfileApplicability(context, 'applicable', 'profile anchors found or profile has no domain gate');
  }

  for (const pattern of requiredPatterns) {
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

function shouldEnforceRequiredFilePatterns(context, requiredPatterns) {
  if (!requiredPatterns.length) return true;
  if (!isAndroidRecoveryLikeProfile(context.profile)) return true;
  if (context.profile.externalCheckoutPathReferences) return false;

  return context.inventory.files.some(file => isAndroidRecoveryTreeAnchor(file.path));
}

function isAndroidRecoveryTreeAnchor(filePath) {
  const normalized = normalizePath(filePath);
  if (/(^|\/)(?:test|tests|fixtures|examples?|docs?|external|third[_-]?party|thirdparty|vendor\/bundled|node_modules)\//i.test(normalized)) {
    return false;
  }
  return /(^|\/)(BoardConfig.*\.mk|AndroidProducts\.mk|device[^/]*\.mk|product[^/]*\.mk|orangefox_.*\.mk|twrp_.*\.mk|vendorsetup\.sh|vendor-files.*\.txt|proprietary-files.*\.txt|extract-files.*\.sh)$/i.test(normalized)
    || /(^|\/)(recovery\/root|root\/(?:etc|sbin|system))(\/|$)/i.test(normalized);
}

function setProfileApplicability(context, status, reason) {
  context.profileApplicability.status = status;
  context.profileApplicability.reason = reason;
}

function isProfileApplicable(context) {
  return context.profileApplicability?.status !== 'not_applicable';
}

function addMissingPathEvidence(context) {
  const seen = new Set();
  for (const ref of context.pathReferences) {
    const normalizedRef = cleanPathToken(ref.path);
    if (!shouldCheckPath(normalizedRef, ref.category, context.profile)) {
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

    const candidates = candidateSourcePaths(context.projectRoot, normalizedRef, ref.source_file);
    if (candidates.some(candidate => existsSync(candidate))) {
      continue;
    }

    const projectPolicy = findProjectPathPolicy(context.projectPolicy, normalizedRef);
    if (projectPolicy) {
      addEvidence(context, {
        category: 'project_path_policy',
        severity: 'INFO',
        confidence: 'confirmed',
        source_file: ref.source_file,
        source_line_start: ref.source_line_start,
        source_line_end: ref.source_line_start,
        extracted_text: ref.extracted_text,
        normalized_claim: `path_policy:${projectPolicy.classification}:${normalizedRef}`,
        related_paths: [normalizedRef],
        related_symbols: [projectPolicy.id],
        evidence_type: 'derived_path_policy',
        suggested_action: projectPolicy.reason || 'Treat this path as an explicitly declared project boundary instead of a missing source file.',
        rationale: 'The project policy declares this reference as a source-boundary path rather than an unresolved in-tree dependency.',
      });
      continue;
    }

    if (isBareTargetRuntimeDirectory(normalizedRef)) {
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
  if (!isProfileApplicable(context)) {
    return [];
  }

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
  contradictions.push(...buildClaudeCodeModernContradictions(context));
  contradictions.push(...buildNebulaRuntimeContradictions(context));
  contradictions.push(...buildKnownGoodFrontierContradictions(context));
  contradictions.push(...buildAnlandXwaylandResponsivenessClassifications(context));
  contradictions.push(...buildDockLeaseProofContradictions(context));

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
    if (!isSemanticPolicyConflictEligibleClaim(claim)) {
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

function isSemanticPolicyConflictEligibleClaim(claim) {
  const normalizedPath = normalizePath(claim.source_file);
  return isPolicyAuthorityPath(normalizedPath);
}

function buildClaudeCodeModernContradictions(context) {
  if (!isClaudeCodeModernProfile(context.profile)) {
    return [];
  }

  const activeEvidence = context.evidence.filter(item => isActiveClaudeCodeModernEvidence(item));
  const byClaim = claim => activeEvidence.filter(item => item.normalized_claim === claim);
  const contradictions = [];

  const groups = [
    {
      id: 'read_only_with_patch_plan',
      title: 'Read-only Claude/Codex task conflicts with patch or publish plan',
      left: byClaim('READ_ONLY_TASK'),
      right: [
        ...byClaim('PATCH_PLAN_REVIEW_REQUIRED'),
      ],
      severity: 'HIGH',
      winner: 'READ_ONLY_TASK',
      action: 'Keep this pass read-only until the owner explicitly grants patch, commit, push, install, or stage permission.',
      claim: 'PERMISSION_POLICY_CONFLICT:read_only_vs_patch_plan',
    },
    {
      id: 'auto_approve_with_unsafe_command',
      title: 'Auto-approval policy conflicts with unsafe command plan',
      left: byClaim('AUTO_APPROVE_POLICY'),
      right: byClaim('COMMAND_PLAN_UNSAFE'),
      severity: 'HIGH',
      winner: 'COMMAND_PLAN_UNSAFE_REQUIRES_APPROVAL',
      action: 'Disable auto-approval for this action and require explicit operator approval plus rollback/evidence plan.',
      claim: 'PERMISSION_POLICY_CONFLICT:auto_approve_vs_unsafe_command',
    },
    {
      id: 'pending_module_first_frontier_regression',
      title: 'Pending modules_update plan risks known-good frontier regression',
      left: byClaim('FRONTIER_REGRESSION_RISK'),
      right: byClaim('COMMAND_PLAN_UNSAFE'),
      severity: 'HIGH',
      winner: 'ACTIVE_FIRST_AUTHORITY',
      action: 'Use active module first; pending modules_update is explicit guarded dry-check only.',
      claim: 'FRONTIER_REGRESSION_RISK:modules_update_first',
    },
  ];

  for (const group of groups) {
    if (!group.left.length || !group.right.length) {
      continue;
    }
    const claims = dedupeById([...group.left, ...group.right]);
    if (claims.length < 2) {
      continue;
    }
    const evidenceIds = claims.map(claim => claim.id);
    const groupId = stableId('CON', `claude_code_modern:${group.id}:${evidenceIds.slice().sort().join('|')}`);
    contradictions.push({
      id: groupId,
      category: 'claude_code_modern_guard',
      severity: group.severity,
      confidence: 'likely',
      title: group.title,
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: group.winner,
      likely_winner_reason: 'Modern Claude/Codex workflow guards prefer the narrower, active-first, or human-reviewed instruction until scope is explicitly widened.',
      rationale: 'The same active workflow surface contains a guarded action and an unsafe or wider-scope plan.',
      recommended_action: group.action,
      investigation_command: `grep -RIn "${claims.map(claim => escapeForGrep(claim.extracted_text.slice(0, 80))).join('\\|')}" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "read-only\\|apply_patch\\|auto-approve\\|modules_update\\|active module" "${context.projectRoot}"`,
      safe_next_action: group.action,
    });

    addEvidence(context, {
      category: 'claude_code_modern_guard',
      severity: group.severity,
      confidence: 'likely',
      source_file: claims[0].source_file,
      source_line_start: claims[0].source_line_start,
      source_line_end: claims[0].source_line_end,
      extracted_text: claims.map(claim => `${claim.source_file}:${claim.source_line_start}:${claim.normalized_claim}`).join('; '),
      normalized_claim: group.claim,
      related_symbols: [group.id],
      evidence_type: 'derived_contradiction',
      suggested_action: group.action,
      rationale: 'Derived from modern Claude/Codex workflow evidence that points in unsafe or incompatible directions.',
      contradiction_group_id: groupId,
    });
  }

  return contradictions;
}

function isActiveClaudeCodeModernEvidence(evidence) {
  const normalized = normalizePath(evidence.source_file ?? '');
  return isClaudeCodeModernAuthorityPath(normalized)
    && !isGeneratedArtifactPath(normalized)
    && !isAuxiliarySourcePath(normalized)
    && evidence.evidence_kind !== 'fixture';
}

function isClaudeCodeModernAuthorityPath(sourceFile) {
  const normalized = normalizePath(sourceFile);
  const name = basename(normalized);

  if (!normalized || normalized === '.') {
    return false;
  }
  if (normalized.startsWith('agents/')
    || normalized.startsWith('docs/')
    || normalized.startsWith('test/')
    || normalized.startsWith('lib/')
    || normalized.startsWith('bin/')
    || normalized.startsWith('scripts/')) {
    return false;
  }
  if (/^(AGENTS|CLAUDE|PLAN|TASK|TASKS|HANDOFF|RUNBOOK|PLAYBOOK|CHECKLIST|POLICY)\.md$/i.test(name)) {
    return true;
  }
  if (/^\.claude\//.test(normalized)) {
    return true;
  }
  if (/^\.codex\//.test(normalized)) {
    return true;
  }
  if (/^\.mcp\.json$/i.test(normalized) || /^mcp\.(?:json|ya?ml|toml)$/i.test(name)) {
    return true;
  }
  if (/^skills\/[^/]+\/SKILL\.md$/i.test(normalized)
    || /^\.claude\/skills\/[^/]+\/SKILL\.md$/i.test(normalized)) {
    return true;
  }
  if (/^\.github\/workflows\/[^/]+\.(?:ya?ml)$/i.test(normalized)) {
    return true;
  }
  return false;
}

function buildKnownGoodFrontierContradictions(context) {
  if (!isKnownGoodFrontierProfile(context.profile)) {
    return [];
  }

  const frontierEvidence = context.evidence.filter(item => item.category === 'known_good_frontier');
  const lowerEvidence = context.evidence.filter(item => item.category === 'frontier_regression_marker');
  const hasClaim = claim => frontierEvidence.some(item => item.normalized_claim === claim)
    || lowerEvidence.some(item => item.normalized_claim === claim);
  const hasClaimPrefix = prefix => frontierEvidence.some(item => item.normalized_claim.startsWith(prefix))
    || lowerEvidence.some(item => item.normalized_claim.startsWith(prefix));

  const rawRealBuffer = frontierEvidence.find(item => item.normalized_claim.startsWith('known_good_frontier.raw_metric.real_buffer_commits=')
    && Number(extractClaimValue(item.normalized_claim)) > 0);
  const rawVkZero = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.raw_metric.vkGetMemoryFdKHR_failures=0');
  const rawClassification = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.raw.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS');
  const statusClassification = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.status.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS');
  const noDisplayBlocker = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.raw.blocker=NONE_WAYLAND_DISPLAY');
  const sidecar14 = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.harness.gamescope_sidecar=sidecar-14');
  const sidecar06 = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.harness.xwayland_sidecar=sidecar-06');
  const forceComposition = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.harness.gamescope_trick=force-composition');
  const dmabufHarness = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.harness.buffer_path=full-size_AR24_parent_xdg_dmabuf');
  const pinnedLocalIcd = frontierEvidence.find(item => item.normalized_claim === 'known_good_frontier.vulkan_loader=pinned_local_icd_driver');
  const hasRawCounters = Boolean(rawRealBuffer && rawVkZero);
  const hasWorkingHarness = Boolean(sidecar14 && sidecar06 && forceComposition && dmabufHarness);
  const hasKnownGoodFrontier = Boolean(
    (rawClassification || statusClassification)
    && noDisplayBlocker
    && (hasRawCounters || hasWorkingHarness)
  );
  const hasStatusOnlyFrontier = Boolean(statusClassification && !hasRawCounters && !hasWorkingHarness);
  const contradictions = [];

  if (hasKnownGoodFrontier && lowerEvidence.length > 0) {
    const claims = dedupeById([
      rawClassification,
      statusClassification,
      noDisplayBlocker,
      rawRealBuffer,
      rawVkZero,
      sidecar14,
      sidecar06,
      forceComposition,
      dmabufHarness,
      pinnedLocalIcd,
      ...lowerEvidence,
    ].filter(Boolean));
    const evidenceIds = claims.map(claim => claim.id);
    const groupId = stableId('CON', `known_good_frontier:below_frontier:${evidenceIds.slice().sort().join('|')}`);

    addEvidence(context, {
      category: 'known_good_frontier_guard',
      severity: 'HIGH',
      confidence: 'likely',
      source_file: lowerEvidence[0].source_file,
      source_line_start: lowerEvidence[0].source_line_start,
      source_line_end: lowerEvidence[0].source_line_end,
      extracted_text: claims.map(claim => `${claim.source_file}:${claim.source_line_start}:${claim.normalized_claim}`).join('; '),
      normalized_claim: 'REGRESSION_BELOW_KNOWN_GOOD_FRONTIER',
      related_symbols: ['NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS', 'A1E', 'sidecar-14', 'sidecar-06'],
      evidence_type: 'derived_contradiction',
      suggested_action: 'Recover/replay the exact R6 Wayland working 03 sidecar-14/sidecar-06 harness before patching source or continuing lower lanes.',
      rationale: 'A newer failed run is below older raw known-good frontier proof; recency alone must not promote the broken run.',
      contradiction_group_id: groupId,
    });

    contradictions.push({
      id: groupId,
      category: 'known_good_frontier_guard',
      severity: 'HIGH',
      confidence: 'likely',
      title: 'REGRESSION_BELOW_KNOWN_GOOD_FRONTIER',
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: 'R6_WAYLAND_WORKING_03_SIDEcar14_SIDEcar06_REPLAY',
      likely_winner_reason: 'Older raw proof reached NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS with real-buffer commits and zero vkGetMemoryFdKHR failures; the newer A1/A1E path is lower and changed the harness.',
      rationale: 'Newer is not stronger. A run that exits at SIGBUS, skipped GLX, sidecar-13, shm preload, or invalid export proof cannot replace the older sidecar-14/sidecar-06 real-buffer pass.',
      recommended_action: 'RECOVER_EXACT_WORKING_HARNESS',
      investigation_command: `grep -RIn "NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS\\|real_buffer_commits\\|vkGetMemoryFdKHR\\|sidecar-14\\|sidecar-06\\|A1E\\|SIGBUS\\|sidecar-13\\|shm preload" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS\\|real_buffer_commits\\|vkGetMemoryFdKHR\\|sidecar-14\\|sidecar-06" "${context.projectRoot}"`,
      safe_next_action: 'Replay the exact R6 Wayland working 03 harness before source patches, new lanes, broad archaeology, runtime integration, Proton/Wine/Steam jumps, or graphics-source changes.',
    });
  }

  if (hasStatusOnlyFrontier) {
    const claims = dedupeById([statusClassification, noDisplayBlocker].filter(Boolean));
    const evidenceIds = claims.map(claim => claim.id);
    const groupId = stableId('CON', `known_good_frontier:status_only:${evidenceIds.slice().sort().join('|')}`);

    addEvidence(context, {
      category: 'known_good_frontier_guard',
      severity: 'MEDIUM',
      confidence: 'likely',
      source_file: statusClassification.source_file,
      source_line_start: statusClassification.source_line_start,
      source_line_end: statusClassification.source_line_end,
      extracted_text: claims.map(claim => `${claim.source_file}:${claim.source_line_start}:${claim.normalized_claim}`).join('; '),
      normalized_claim: 'STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY',
      related_symbols: ['NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS', 'real_buffer_commits', 'vkGetMemoryFdKHR'],
      evidence_type: 'derived_contradiction',
      suggested_action: 'Recover raw logs, counters, or the exact harness script before promoting this status claim to known-good frontier.',
      rationale: 'Status JSON is useful, but raw counters/logs/scripts are stronger and required for frontier promotion.',
      contradiction_group_id: groupId,
    });

    contradictions.push({
      id: groupId,
      category: 'known_good_frontier_guard',
      severity: 'MEDIUM',
      confidence: 'likely',
      title: 'STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY',
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: 'RAW_LOG_COUNTER_RECOVERY',
      likely_winner_reason: 'Raw logs, counters, and harness scripts outrank status-only JSON for frontier promotion.',
      rationale: 'Status-only output can be stale, summarized, or generated from the wrong module path. It must be backed by raw proof before it becomes the known-good frontier.',
      recommended_action: 'Recover raw counts/logs or replay the exact working harness before changing source.',
      investigation_command: `grep -RIn "real_buffer_commits\\|real_commit_count\\|vkGetMemoryFdKHR\\|VKGETMEMORYFD\\|sidecar-14\\|sidecar-06" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "real_buffer_commits\\|vkGetMemoryFdKHR\\|sidecar-14\\|sidecar-06" "${context.projectRoot}"`,
      safe_next_action: 'Do not treat status-only success as frontier until raw proof is recovered.',
    });
  }

  if (hasClaim('frontier.invalid_export.GAMESCOPE_EXIT=135')
    && hasClaim('frontier.invalid_export.FINAL_XWAYLAND_RUNNER_INVOKED=0')
    && hasClaim('frontier.invalid_export.SELECTED_VULKAN_DEVICE=NOT_FOUND')
    && hasClaimPrefix('frontier.invalid_export.VKGETMEMORYFD_FIRST_LINE=NOT_FOUND')
    && hasClaim('frontier.invalid_export.A1_CHANGED_GAMESCOPE_LIBPATH_AND_KGSL_ENV=true')) {
    const claims = lowerEvidence.filter(item => item.normalized_claim.startsWith('frontier.invalid_export.'));
    const evidenceIds = claims.map(claim => claim.id);
    const groupId = stableId('CON', `known_good_frontier:invalid_export:${evidenceIds.slice().sort().join('|')}`);

    contradictions.push({
      id: groupId,
      category: 'known_good_frontier_guard',
      severity: 'HIGH',
      confidence: 'likely',
      title: 'A1 invalid export proof below frontier',
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: 'A1B_KGSL_ENV_ONLY_R6_LIBPATH_RESTORED',
      likely_winner_reason: 'The A1 run changed Gamescope libpath and KGSL env, then exited before Xwayland, Vulkan device selection, and vkGetMemoryFdKHR proof.',
      rationale: 'This evidence cannot prove Fasttest-02 KGSL export improvement because the test did not reach the export point and changed too many variables.',
      recommended_action: 'Run the bounded A1B KGSL-env-only test with R6/A0 Gamescope libpath restored.',
      investigation_command: `grep -RIn "GAMESCOPE_EXIT\\|FINAL_XWAYLAND_RUNNER_INVOKED\\|SELECTED_VULKAN_DEVICE\\|VKGETMEMORYFD_FIRST_LINE\\|GAMESCOPE_LIBPATH\\|KGSL" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "GAMESCOPE_EXIT\\|FINAL_XWAYLAND_RUNNER_INVOKED\\|SELECTED_VULKAN_DEVICE\\|VKGETMEMORYFD_FIRST_LINE" "${context.projectRoot}"`,
      safe_next_action: 'Do not patch source from this evidence; isolate the A1B runtime variables first.',
    });
  }

  return contradictions;
}

function buildAnlandXwaylandResponsivenessClassifications(context) {
  if (!isAnlandXwaylandResponsivenessProfile(context.profile)) {
    return [];
  }

  const evidence = context.evidence.filter(item => [
    'anland_xwayland_probe',
    'anland_xwayland_known_good',
  ].includes(item.category));
  const has = claim => evidence.some(item => item.normalized_claim === claim);
  const hasAny = claims => claims.some(claim => has(claim));
  const byClaims = claims => evidence.filter(item => claims.includes(item.normalized_claim));
  const added = new Set();

  const addClassification = (claim, severity, sourceEvidence, action, rationale, symbols = []) => {
    if (added.has(claim) || !sourceEvidence.length) {
      return;
    }
    added.add(claim);
    const claims = dedupeById(sourceEvidence);
    addEvidence(context, {
      category: 'anland_xwayland_classification',
      severity,
      confidence: 'likely',
      source_file: claims[0].source_file,
      source_line_start: claims[0].source_line_start,
      source_line_end: claims[0].source_line_end,
      extracted_text: claims.map(item => `${item.source_file}:${item.source_line_start}:${item.normalized_claim}`).join('; '),
      normalized_claim: claim,
      related_paths: uniq(claims.flatMap(item => item.related_paths ?? [])),
      related_symbols: symbols,
      evidence_type: 'derived_runtime_classification',
      suggested_action: action,
      rationale,
    });
  };

  const producerAlive = has('anland_xwayland.producer=alive');
  const producerMissing = has('anland_xwayland.producer=missing');
  const socketPresent = has('anland_xwayland.socket=present');
  const socketMissing = has('anland_xwayland.socket=missing');
  const xauthBad = has('anland_xwayland.xauth_or_display=bad');
  const envBad = has('anland_xwayland.env=leak_or_bad_display');
  const x11Hang = has('anland_xwayland.x11_client=timeout');
  const glxHang = has('anland_xwayland.glx_client=timeout');
  const glxOk = has('anland_xwayland.glx_client=ok');
  const vulkanBad = has('anland_xwayland.vulkan=bad_or_timeout');
  const vulkanOk = has('anland_xwayland.vulkan=ok');
  const knownGood = has('anland_xwayland.known_good_frontier=present');
  const clientBad = xauthBad || envBad || x11Hang || glxHang || vulkanBad;
  const readOnlyAction = 'Run only bounded read-only display probes with hard timeouts; do not patch source, stage modules, or mutate display/runtime state from this classification.';

  if (producerMissing) {
    addClassification(
      'anland_xwayland.classification=producer_absent',
      'HIGH',
      byClaims(['anland_xwayland.producer=missing']),
      readOnlyAction,
      'The producer entrypoint/process is absent, so client probes cannot prove display responsiveness.',
      ['anland producer']
    );
  }

  if (socketMissing) {
    addClassification(
      'anland_xwayland.classification=socket_missing',
      'HIGH',
      byClaims(['anland_xwayland.socket=missing', 'anland_xwayland.producer=alive']),
      readOnlyAction,
      'The producer may be present, but expected Wayland/X11 sockets are missing.',
      ['wayland socket', 'X11 socket']
    );
  }

  if (socketPresent && xauthBad) {
    addClassification(
      'anland_xwayland.classification=socket_present_auth_bad',
      'HIGH',
      byClaims(['anland_xwayland.socket=present', 'anland_xwayland.xauth_or_display=bad', 'anland_xwayland.xauth=present']),
      readOnlyAction,
      'Socket evidence exists, but Xauthority or DISPLAY prevents client access.',
      ['DISPLAY', 'XAUTHORITY']
    );
  }

  if (envBad) {
    addClassification(
      'anland_xwayland.classification=env_leakage',
      'HIGH',
      byClaims(['anland_xwayland.env=leak_or_bad_display', 'anland_xwayland.env=runtime_variable_present']),
      readOnlyAction,
      'Display or graphics environment points at a wrong or incomplete runtime layer.',
      ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'VK_ICD_FILENAMES']
    );
  }

  if (x11Hang) {
    addClassification(
      'anland_xwayland.classification=x11_client_hang',
      'HIGH',
      byClaims(['anland_xwayland.x11_client=timeout', 'anland_xwayland.socket=present']),
      readOnlyAction,
      'The X11 metadata client reached a hang/timeout boundary.',
      ['xdpyinfo']
    );
  }

  if (glxHang) {
    addClassification(
      'anland_xwayland.classification=glx_hang',
      'HIGH',
      byClaims(['anland_xwayland.glx_client=timeout', 'anland_xwayland.socket=present']),
      readOnlyAction,
      'The GLX client timed out and must be separated from missing-producer failures.',
      ['glxinfo']
    );
  }

  if (vulkanBad) {
    addClassification(
      'anland_xwayland.classification=vulkan_loader_bad',
      'HIGH',
      byClaims(['anland_xwayland.vulkan=bad_or_timeout', 'anland_xwayland.env=runtime_variable_present']),
      readOnlyAction,
      'The Vulkan summary path failed or hung under the current Anland runtime environment.',
      ['vulkaninfo', 'Vulkan loader']
    );
  }

  if (producerAlive && socketPresent && clientBad) {
    addClassification(
      'anland_xwayland.classification=producer_alive_client_dead',
      'HIGH',
      evidence.filter(item => [
        'anland_xwayland.producer=alive',
        'anland_xwayland.socket=present',
        'anland_xwayland.xauth_or_display=bad',
        'anland_xwayland.env=leak_or_bad_display',
        'anland_xwayland.x11_client=timeout',
        'anland_xwayland.glx_client=timeout',
        'anland_xwayland.vulkan=bad_or_timeout',
      ].includes(item.normalized_claim)),
      readOnlyAction,
      'The display producer and sockets are alive, but one or more clients hang or fail, so the next proof belongs at the client responsiveness boundary.',
      ['producer_alive', 'client_timeout']
    );
  }

  if (producerAlive && socketPresent && glxOk && vulkanOk && knownGood) {
    addClassification(
      'anland_xwayland.classification=known_good_match',
      'HIGH',
      evidence.filter(item => [
        'anland_xwayland.producer=alive',
        'anland_xwayland.socket=present',
        'anland_xwayland.glx_client=ok',
        'anland_xwayland.vulkan=ok',
        'anland_xwayland.known_good_frontier=present',
      ].includes(item.normalized_claim)),
      'Preserve this as known-good display responsiveness proof and compare newer runs against it before patching.',
      'Producer, socket, GLX, Vulkan, and frontier evidence all match a working Anland/Nebula display path.',
      ['known_good_frontier']
    );
  }

  if (!added.size && evidence.length) {
    addClassification(
      'anland_xwayland.classification=unknown_needs_manual_probe',
      'MEDIUM',
      evidence,
      readOnlyAction,
      'Evidence mentions Anland/Xwayland but lacks enough bounded probe results to classify the responsiveness boundary.',
      ['anland', 'xwayland']
    );
  }

  return [];
}

function buildDockLeaseProofContradictions(context) {
  if (!isDockLeaseProofProfile(context.profile)) {
    return [];
  }

  const warnings = context.evidence.filter(item => item.category === 'dock_lease_runtime_warning');
  if (!warnings.length) {
    return [];
  }

  const hostProof = context.evidence.filter(item => [
    'dock_lease_host_proof',
    'dock_lease_mutation_denied',
    'dock_lease_blocked_not_ready',
    'dock_lease_dynamic_discovery_required',
    'dock_lease_guard',
  ].includes(item.category));
  const claims = dedupeById([...hostProof, ...warnings]);
  const evidenceIds = claims.map(claim => claim.id);
  const groupId = stableId('CON', `dock_lease:runtime_promotion:${evidenceIds.slice().sort().join('|')}`);

  addEvidence(context, {
    category: 'dock_lease_guard',
    severity: 'HIGH',
    confidence: 'likely',
    source_file: warnings[0].source_file,
    source_line_start: warnings[0].source_line_start,
    source_line_end: warnings[0].source_line_end,
    extracted_text: warnings.map(item => `${item.source_file}:${item.source_line_start}:${item.normalized_claim}`).join('; '),
    normalized_claim: 'dock_lease.guard.RUNTIME_PROMOTION_BLOCKED=true',
    related_symbols: ['Dock lease', 'runtime promotion', 'allowlist', 'start command'],
    evidence_type: 'derived_contradiction',
    suggested_action: 'Keep Dock lease host-only; require bounded runtime proof and explicit authority before adding start commands, allowlists, or mutation.',
    rationale: 'Dock lease authority proof must prevent accidental runtime promotion before TEST_ONLY, SCM_RIGHTS, stop/revoke, rollback, and crash gates are proven.',
    contradiction_group_id: groupId,
  });

  return [
    {
      id: groupId,
      category: 'dock_lease_guard',
      severity: 'HIGH',
      confidence: 'likely',
      title: 'Dock lease runtime promotion blocked by host-only proof',
      conflicting_claims: claims.map(claim => claimRef(claim)),
      evidence_ids: evidenceIds,
      likely_winner: 'HOST_ONLY_DOCK_SCHEMA_BOUNDARY',
      likely_winner_reason: 'Host-only Dock schema and command-plan evidence is intentionally blocked until bounded runtime proof exists.',
      rationale: 'A positive execute/mutation/start-command/allowlist/manual-input flag contradicts the Dock lease authority boundary.',
      recommended_action: 'Keep profile_set_dock BLOCKED_NOT_READY and do not add runtime allowlists or start commands until receiver smoke, TEST_ONLY, SCM_RIGHTS handoff, stop/revoke, rollback, crash gate, and explicit approval are proven.',
      investigation_command: `grep -RIn "dock_lease\\|dock lease\\|start_command_available\\|runtime_allowlists_modified\\|app_allowlists_modified\\|mutation_allowed_by_policy\\|execute" "${context.projectRoot}"`,
      suggested_validation_command: `grep -RIn "BLOCKED_NOT_READY\\|mutation_allowed_by_policy\\|start_command_available\\|runtime_allowlists_modified\\|app_allowlists_modified" "${context.projectRoot}"`,
      safe_next_action: 'Treat this as a guard violation, not a source patch candidate. Repair the authority model or fixture before any runtime work.',
    },
  ];
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
  if (isKnownGoodFrontierProfile(context.profile)
    || isAnlandXwaylandResponsivenessProfile(context.profile)
    || isDecodedMediaEvidenceProfile(context.profile)
    || isDockLeaseProofProfile(context.profile)) {
    return [];
  }
  if (!isProfileApplicable(context)) {
    return [];
  }

  const candidates = [];

  for (const contradiction of contradictions) {
    if (contradiction.category === 'nebula_runtime_regression'
      || contradiction.category === 'known_good_frontier_guard') {
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
    if (!isPlaceholderPatchCandidateEligible(evidence.source_file, context)) {
      continue;
    }
    if (!isActionablePlaceholderPatchEvidence(evidence)) {
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
  key = assignmentKeyForCategorization(key);
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
  if (/^(GRAPHICSDRIVER|DXWRAPPER|RENDERER)$/i.test(key)) {
    return 'api_translation_layer';
  }
  if (/^(ID|STEAM_APPID|APPID|GAME_APPID|EXECUTABLEPATH|INSTALLPATH)$/i.test(key)
    || /^STEAM_\d+$/i.test(value)) {
    return 'game_runtime_identity';
  }
	  if (isPCGamingWikiLikeProfile(profile)) {
    const directPCGWProfile = profile?.pcgamingwikiProfile === true;
    const exePatchProfile = isExePatchProfile(profile);
    if (/^(FLAWLESSWIDESCREEN|WIDESCREENFIX|ASPECTRATIO|FOV|HUDSAFEAREA|HUDFIX|ULTRAWIDE)$/i.test(key)
      || /\b(Flawless Widescreen|WSGF|SUWSF|ultrawide|widescreen|Hor\+|Vert-|aspect ratio|FOV|HUD fix)\b/i.test(value)) {
      return 'widescreen_fix_surface';
    }
    if (/^(FRAMEGENERATION|FRAMEGENERATIONMULTIPLIER|OPTISCALER|OPTIFG|LSFG|LSFGENABLED|DLSSG|FSR_FG|XEFG|REFLEX|ANTILAG)$/i.test(key)
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
    if (/^(DRM|STORE|STEAMAPPID|STEAMTYPE|STEAMOFFLINEMODE|EPICOFFLINEMODE|LAUNCHREALSTEAM|LAUNCHBIONICSTEAM|ALLOWSTEAMUPDATES|GOGID|EPICID|PRODUCTID|VERSIONDIFFERENCES)$/i.test(key)
      || (directPCGWProfile && /\b(Availability|DRM|Steam|GOG|Epic Games Store|Microsoft Store|DLC|version differences?)\b/i.test(value))) {
      return 'pcgw_availability_drm';
    }
    if (/^(FOV|VSYNC|HDR|DISPLAYMODE|RESOLUTION|SCREENSIZE|RENDERERPRESENTMODE|PRESENTMODE|ULTRAWIDE|FPSLIMIT|FRAMERATE|FPSLIMITERENABLED|FPSLIMITERTARGET|SHOWFPS|EXTERNALDISPLAYMODE|USEDRI3|PORTRAITMODE)$/i.test(key)
      || (directPCGWProfile && /\b(FOV|ultrawide|widescreen|V-?Sync|HDR|DLSS|FSR|XeSS|stutter|frame rate)\b/i.test(value))) {
      return 'pcgw_video_display_fixes';
    }
    if (/^(CONTROLLERSUPPORT|INPUT|INPUTTYPE|AUDIO|AUDIODRIVER|PULSEAUDIOLOWLATENCY|PULSEAUDIOSUSPENDBEHAVIOR|NETWORK|PORTS|VR_SUPPORT)$/i.test(key)
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
  if (/^(APITRANSLATION|GRAPHICSAPI|GRAPHICSDRIVER|WRAPPERAPI|RENDERBACKEND|DXWRAPPER|RENDERER)$/i.test(key)
    || /\b(DXVK|VKD3D|D3D11On12|WineD3D|OpenGL|Vulkan|D3D11|D3D12|D3D9)\b/i.test(value)) {
    return 'api_translation_layer';
  }
  if (/^(MESA_|TU_|ZINK_|WRAPPER_|BOX64_|BOX86_|FEXCORE|EMULATOR|WINE_|WINEVERSION|WOW64MODE|PROOT_|TERMUX_|CONTAINERVARIANT|ADRENOTOOLSTURNIP|VK_DRIVER_FILES|VK_ICD_FILENAMES)/i.test(key)
    || /\b(RM11Pro|Red Magic|Adreno|Turnip|Mesa|Freedreno|Termux|proot|box64|Wine|Winlator|Mobox|FEX)\b/i.test(value)) {
    return 'mobile_linux_runtime';
  }
  if (/^(CPULIST|CPULISTWOW64|SUSPENDPOLICY)$/i.test(key)) {
    return 'power_game_profile';
  }
  if (/^(MAXDEVICEMEMORY|VIDEOMEMORYSIZE|BCNEMULATION|BCNEMULATIONTYPE|SYNCFRAME|DISABLEPRESENTWAIT|STRICT_SHADER_MATH|MESAGLTHREAD|MESA_SHADER_CACHE|MESA_SHADER_CACHE_DISABLE|MESA_SHADER_CACHE_MAX_SIZE|WRAPPER_MAX_IMAGE_COUNT)$/i.test(key)) {
    return 'gpu_performance_tuning';
  }
  if (/^(MAXFPS|SMOOTHFRAMERATE|MAXFRAMELATENCY|BACKBUFFERCOUNT|VIDEOMEMORY|STREAMMINRESIDENT|RESTRICTGRAPHICSOPTIONS|COM_MAXFPS|R_|VID_)/i.test(key)) {
    return 'bo3_config';
  }
  if (/^(ID|STEAMAPPID|STEAM_APPID|APPID|GAME_APPID|GAME_EXE|GAME_PATH|TARGET_EXE|EXECUTABLE|EXECUTABLEPATH|INSTALLPATH|NETWORK_PASSWORD|LOBBY_PASSWORD|FRIENDS_ONLY)$/i.test(key)
    || /^STEAM_\d+$/i.test(value)
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
  if (isAvbVbmetaAssignmentKey(key)) {
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

function assignmentKeyForCategorization(key) {
  const raw = String(key ?? '');
  const suffix = raw.split('.').pop() ?? raw;
  return suffix.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || raw;
}

function isAvbVbmetaAssignmentKey(key) {
  const normalized = String(key ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /(^|_)(AVB|VBMETA|VERITY|VERITYMODE|VERIFIEDBOOT|HASHTREE_VERITY)(_|$)/.test(normalized);
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
  if (/^(BoardConfig.*\.mk|AndroidProducts\.mk|.*\.mk|.*\.env|.*\.prop|.*\.toml|.*\.ya?ml|.*\.json|.*\.ini|.*\.cfg|.*\.conf|\.editorconfig|Dockerfile|Makefile|Kconfig|.*fstab.*)$/i.test(name)) {
    return true;
  }

  if (/^[A-Z0-9_.-]+$/.test(key) && !isCodeSourceFile(filePath)) {
    return true;
  }

  return /(^|\/)(config|configs?|settings|profiles?)\//i.test(filePath);
}

function isYamlRunBlockAssignment(filePath, lineState) {
  return Boolean(lineState?.yamlRunBlock && isYamlFilePath(filePath));
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
  if (/^(gradlew|configure|autogen|bootstrap)$/i.test(name)) {
    return true;
  }
  return /\.(py|js|jsx|ts|tsx|mjs|cjs|sh|bash|zsh|fish|rb|go|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|php|swift|lua|pl|ps1)$/i.test(name);
}

function isSectionedConfigFile(filePath) {
  const name = filePath.split('/').pop() ?? filePath;
  if (name === '.gitmodules' || name === '.editorconfig') {
    return true;
  }
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
  if (claim && isSelfReferentialAssignmentValue(claim.key, claim.value)) {
    return false;
  }
  if (claim && isTargetMatrixDefinition(item, claim.key)) {
    return false;
  }
  if (claim && isScopedImplementationDefinition(item, claim.key)) {
    return false;
  }
  if (claim && isGitModulesLocalAssignment(item.source_file, claim.key)) {
    return false;
  }
  if (claim && isCommandLineArgumentDefinitionKey(claim.key)) {
    return false;
  }
  return !claim || !isVolatileRuntimeDefinitionKey(claim.key);
}

function isTargetMatrixDefinition(item, key) {
  const normalizedPath = normalizePath(item.source_file);
  const name = basename(normalizedPath);
  const localKey = assignmentKeyForCategorization(key).toUpperCase();
  if (![
    'NATIVE_TARGET',
    'HOST_TARGET',
    'BUILD_TARGET',
    'CROSS_TARGET',
    'TOOLCHAIN_TARGET',
  ].includes(localKey)) {
    return false;
  }
  return isGenericBuildRecipePath(normalizedPath, name) || isCiMatrixDefinitionPath(normalizedPath);
}

function isScopedImplementationDefinition(item, key) {
  const normalizedPath = normalizePath(item.source_file);
  const name = basename(normalizedPath);
  const category = item.category;

  if (isScriptLocalStateDefinitionPath(normalizedPath, key)) {
    return true;
  }

  if (isGenericBuildRecipePath(normalizedPath, name) && isRecipeLocalDefinitionCategory(category)) {
    return true;
  }

  if (isCiMatrixDefinitionPath(normalizedPath)) {
    return true;
  }

  if (isDocumentationDefinitionPath(normalizedPath) || isMarkupDataDefinitionPath(normalizedPath)) {
    return true;
  }

  if (isAndroidMakeModuleDefinition(normalizedPath, name, key, category)) {
    return true;
  }

  return false;
}

function isSelfReferentialAssignmentValue(key, value) {
  const localKey = String(key ?? '').split('.').pop() ?? '';
  const normalizedValue = normalizeScalar(value);
  return normalizedValue === `$${localKey}` || normalizedValue === `\${${localKey}}`;
}

function isScriptLocalStateDefinitionPath(normalizedPath, key) {
  if (!/(^|\/)(?:scripts?|bin|sbin)\//i.test(normalizedPath)) {
    return false;
  }
  if (key.startsWith('ro.') || isNebulaLayeredRuntimeKey(key, 'ld_library_path_linker_namespace_issues')) {
    return false;
  }
  if (isCommandLineArgumentDefinitionKey(key)) {
    return false;
  }
  return true;
}

function isGenericBuildRecipePath(normalizedPath, name) {
  return name === 'Makefile'
    || /^PKGBUILD(?:[-.]|$)/i.test(name)
    || /(^|\/)(?:pkgbuilds?|packaging|ports?)\//i.test(normalizedPath);
}

function isRecipeLocalDefinitionCategory(category) {
  return [
    'build_variables',
    'mobile_linux_runtime',
    'api_translation_layer',
    'graphics_wrapper_chain',
    'gpu_performance_tuning',
    'vulkan_loader',
  ].includes(category);
}

function isCiMatrixDefinitionPath(normalizedPath) {
  return /(^|\/)(?:ci|\.ci|test|tests|deqp|piglit)(?:\/|$)/i.test(normalizedPath)
    && /\.(?:toml|ya?ml|ini|cfg|conf)$/i.test(normalizedPath);
}

function isDocumentationDefinitionPath(normalizedPath) {
  return isMarkdownLikePath(normalizedPath)
    || /(^|\/)README(?:\.[A-Za-z0-9]+)?$/i.test(normalizedPath)
    || /(^|\/)docs?\//i.test(normalizedPath);
}

function isMarkupDataDefinitionPath(normalizedPath) {
  return /\.(?:xml|html?)$/i.test(normalizedPath);
}

function isAndroidMakeModuleDefinition(normalizedPath, name, key, category) {
  if (!/\.mk$/i.test(name)) {
    return false;
  }
  if (/BoardConfig/i.test(name) || name === 'AndroidProducts.mk') {
    return false;
  }
  if (!/(^|\/)(?:Android\.mk|android\/.*\.mk)$/i.test(normalizedPath)) {
    return false;
  }
  if ([
    'device_identity',
    'soc_platform_identity',
    'partition_sizes',
    'kernel_header_assumptions',
    'avb_vbmeta_assumptions',
    'fstab_entries',
  ].includes(category)) {
    return false;
  }
  return /^LOCAL_/i.test(key)
    || /^PRIVATE_/i.test(key)
    || /^__/.test(key)
    || /^(?:MESA_LIBGBM_NAME|MESON_GEN_PKGCONFIGS|TARGET_IS_64_BIT)$/i.test(key);
}

function isGitModulesLocalAssignment(sourceFile, key) {
  const name = normalizePath(sourceFile).split('/').pop() ?? '';
  return name === '.gitmodules'
    && /^(path|url|branch|update|shallow|ignore)$/i.test(String(key ?? '').split('.').pop() ?? '');
}

function isCommandLineArgumentDefinitionKey(key) {
  return /^-D[A-Za-z0-9_.-]+$/.test(String(key ?? ''))
    || /^--[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(String(key ?? ''));
}

function isDerivedPathCheckEligible(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return !isAuxiliarySourcePath(sourceFile)
    && !normalized.startsWith('docs/')
    && !normalized.includes('/docs/')
    && !/\.md$/i.test(normalized)
    && !/\.(?:patch|diff)$/i.test(normalized)
    && !normalized.startsWith('test/');
}

function isAuxiliarySourcePath(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return normalized.startsWith('test/fixtures/')
    || normalized.startsWith('docs/upstreams/')
    || /^agents\/[^/]+\/references\//.test(normalized)
    || /(^|\/)agents\/[^/]+\/references\//.test(normalized)
    || /(^|\/)\.agents\/(?:skills\/)?[^/]+\/references\//.test(normalized)
    || /(^|\/)(?:thirdparty|third_party|external|deps|submodules)(\/|$)/i.test(normalized)
    || /(^|\/)tests\/extlib(\/|$)/i.test(normalized)
    || /(^|\/)include\/imgui(\/|$)/i.test(normalized)
    || /(^|\/)(?:archive-dead-ends|dead-ends|dead_ends|candidate-diffs)(\/|$)/i.test(normalized);
}

function isPlaceholderPatchCandidateEligible(sourceFile, context = null) {
  const normalized = normalizePath(sourceFile);
  return !isGeneratedArtifactPath(normalized)
    && !isAuxiliarySourcePath(normalized)
    && !isVendoredDependencyPath(normalized)
    && !isUpstreamPayloadPath(normalized)
    && !isKnownThirdPartyRuntimeSourceRoot(context?.projectRoot)
    && !normalized.startsWith('test/');
}

function isVendoredDependencyPath(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return /(^|\/)(?:site-packages|dist-packages|node_modules|vendor\/bundle|Pods|Carthage\/Checkouts)(\/|$)/i.test(normalized)
    || /^Pkgs\/[^/]+(\/|$)/i.test(normalized)
    || /(^|\/)Pkgs\/[^/]+\/(?:Lib|lib)\/(?:site-packages|dist-packages)(\/|$)/i.test(normalized)
    || /(^|\/)app\/src\/main\/cpp\/(?:adrenotools|OpenXR-SDK|patchelf|virglrenderer)(\/|$)/i.test(normalized)
    || /(^|\/)src\/main\/cpp\/(?:adrenotools|OpenXR-SDK|patchelf|virglrenderer)(\/|$)/i.test(normalized)
    || /(^|\/)(?:thirdparty|third_party|external|deps|submodules)(\/|$)/i.test(normalized)
    || /(^|\/)tests\/extlib(\/|$)/i.test(normalized)
    || /(^|\/)include\/imgui(\/|$)/i.test(normalized);
}

function isUpstreamPayloadPath(sourceFile) {
  const normalized = normalizePath(sourceFile);
  return /(^|\/)producers\/(?:weston|kde|gnome|wlroots|xwayland|ubuntu|debian|fedora|alpine)[^/]*(?:\/|$)/i.test(normalized)
    || /\.(?:patch|diff)$/i.test(normalized);
}

function isKnownThirdPartyRuntimeSourceRoot(projectRoot = '') {
  const name = basename(normalizePath(projectRoot)).toLowerCase();
  return [
    'box64',
    'dxvk',
    'gamescope',
    'mesa-for-android-container-rm11pro',
    'mesa',
  ].includes(name);
}

function isActionablePlaceholderPatchEvidence(evidence) {
  const text = String(evidence.extracted_text ?? '');
  if (/\bintentional\b.{0,48}\b(?:TODO|FIXME|STUB|PLACEHOLDER|WIP)\b/i.test(text)
    || /\b(?:TODO|FIXME|STUB|PLACEHOLDER|WIP)\b.{0,48}\bintentional\b/i.test(text)) {
    return false;
  }
  if (/\bTODO:\s*Remove after\b.{0,80}\brelease cycle\b/i.test(text)) {
    return false;
  }
  if (/\b(?:migration|compatibility|legacy)\b.{0,48}\b(?:release cycle|deprecation window)\b/i.test(text)
    && /\bTODO\b/i.test(text)) {
    return false;
  }
  return true;
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
    || /^(DATE|HIGHEST_MAP_END|MAPPING_EXCEEDS_39BIT_ASSUMPTION|KERNEL_VA_LIMIT_NOTE|WAYLAND_SOCKET)$/.test(shortKey)
    || /^(RUN_ID|LANE|RUNDIR|TMPDIR|DEVICE_RUN_DIR|XAUTHORITY|XAUTHORITY_SHA256|XDG_RUNTIME_DIR)$/.test(shortKey)
    || /^WLR_XWAYLAND(?:_.*)?$/.test(shortKey)
    || /(?:^|_)(PID|EXIT|XKBCOMP|KEEPALIVE_MISSING)$/.test(shortKey);
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
  if (['target_bootloader_board_name'].includes(normalized)) {
    return 'bootloader_board';
  }
  if (['target_ota_assert_device'].includes(normalized)) {
    return 'ota_assert_device';
  }
  if (['product_platform'].includes(normalized)) {
    return 'product_platform';
  }
  if (['ro.board.platform'].includes(normalized)) {
    return 'board_platform_property';
  }
  if ([
    'device',
    'product_device',
    'target_device',
    'ro.product.device',
    'ro.build.product',
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
    .replace(/[)\].,;:'"`]+$/g, '')
    .replace(/^\$\(LOCAL_PATH\)\//, '')
    .replace(/^\.\//, '');
}

function shouldCheckPath(pathRef, category = 'path_reference', profile = null) {
  if (!pathRef) {
    return false;
  }
  if (isRelativeOutputArtifactPath(pathRef)
    || isLikelyProseCompoundPath(pathRef)
    || isExternalPlatformReferencePath(pathRef)
    || isPromptRolePathSyntax(pathRef)) {
    return false;
  }
  if (isPowerRuntimeTargetPath(pathRef) || (isPowerTdpRuntimeProfile(profile) && isPowerRuntimeTargetPath(pathRef))) {
    return false;
  }
  if (category === 'init_rc_services' && !isAndroidRecoveryLikeProfile(profile)) {
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

function isPromptRolePathSyntax(pathRef) {
  return /^(?:system|developer|user|assistant)(?:\/(?:system|developer|user|assistant))+$/.test(String(pathRef ?? ''));
}

function isBareTargetRuntimeDirectory(pathRef) {
  return /^(?:system|vendor|product|odm|recovery|rootfs|apex)\/(?:bin|xbin|sbin|lib|lib64|etc)\/?$/i.test(String(pathRef ?? ''));
}

function isExternalPlatformReferencePath(pathRef) {
  const normalized = String(pathRef ?? '');
  return /^hardware\/interfaces(?:\/[A-Za-z0-9_.-]+)?(?:\/common(?:\/[A-Za-z0-9_.-]+)?\/?)?$/i.test(normalized)
    || /^(?:system\/(?:core|window\.h|graphics(?:-base)?\.h|radio_metadata\.h)|kernel\/trace\/trace\.h|hardware\/(?:drivers|gralloc\.h|libhardware\/include\/gralloc\.h))$/i.test(normalized);
}

function findProjectPathPolicy(projectPolicy, pathRef) {
  if (!projectPolicy?.path_policies?.length || projectPolicy.parse_error) {
    return null;
  }

  const clean = cleanPathToken(pathRef);
  if (!clean) {
    return null;
  }

  let best = null;
  for (const policy of projectPolicy.path_policies) {
    for (const pattern of policy.paths) {
      if (!pathPolicyMatches(pattern, clean)) {
        continue;
      }
      const score = cleanPathToken(pattern).replace(/\*/g, '').length;
      if (!best || score > best.score) {
        best = { policy, score };
      }
    }
  }

  return best?.policy ?? null;
}

function pathPolicyMatches(pattern, pathRef) {
  const cleanPattern = cleanPathToken(pattern);
  if (!cleanPattern) {
    return false;
  }

  if (cleanPattern.includes('*')) {
    return globishToRegExp(cleanPattern).test(pathRef);
  }

  const directoryPattern = cleanPattern.replace(/\/$/, '');
  return pathRef === cleanPattern
    || pathRef === directoryPattern
    || pathRef.startsWith(`${directoryPattern}/`)
    || cleanPattern.endsWith('/') && pathRef.startsWith(cleanPattern);
}

function globishToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isPowerRuntimeTargetPath(pathRef) {
  return /^device\/(?:pp_od_clk_voltage|power_dpm_force_performance_level|gt_[A-Za-z0-9_]+_freq_mhz|tile\d+\/gt\d+\/freq\d+\/[A-Za-z0-9_]+_freq|led_mode|power\/wakeup)$/i.test(pathRef);
}

function isRelativeOutputArtifactPath(pathRef) {
  return /^(host|device|app|process)\/[A-Za-z0-9_.-]+\.txt$/.test(pathRef);
}

function isLikelyProseCompoundPath(pathRef) {
  return PROSE_COMPOUND_PATHS.has(pathRef)
    || /^hardware\/GPU$/i.test(pathRef)
    || /^(?:firmware\/hardware|vendor\/(?:tool|manufacturer)|hardware\/rasterization)$/i.test(pathRef)
    || /^(?:kernel\/?|recovery\/desktop)$/i.test(pathRef)
    || /^(kernel|device|proprietary)\/[A-Za-z0-9.-]+$/.test(pathRef)
    && !/\.(mk|json|txt|xml|rc|prop|so|ko|img|bin|conf|cfg|ini|toml|yaml|yml|sh)$/i.test(pathRef);
}

function isTargetRuntimeAbsolutePath(pathRef) {
  return /^\/(system|vendor|product|odm|apex|data|sdcard|dev|proc|sys|mnt|tmp|usr|lib|lib64|etc|rootfs)\b/.test(pathRef);
}

function candidateSourcePaths(projectRoot, pathRef, sourceFile = '') {
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
    if (sourceFile) {
      candidates.push(join(projectRoot, dirname(normalizePath(sourceFile)), clean));
    }
  }
  for (const suffix of ['.cmake', '.in', '.template', '.tmpl']) {
    candidates.push(join(projectRoot, `${clean}${suffix}`));
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
