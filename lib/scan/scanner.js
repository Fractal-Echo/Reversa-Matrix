import { createHash } from 'crypto';
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
  '.gradle',
  '.idea',
  '.vscode',
  'build',
  'dist',
  'out',
  'coverage',
  '.reversa',
  '_reversa_sdd',
  '_reversa_forward',
  'reversa_out',
  'agent_handoff',
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
  '.gradle',
  '.h',
  '.hpp',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.kt',
  '.kts',
  '.mk',
  '.md',
  '.patch',
  '.prop',
  '.py',
  '.rc',
  '.sh',
  '.te',
  '.toml',
  '.ts',
  '.txt',
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

const PLACEHOLDER_PATTERN = /\b(TODO|FIXME|XXX|HACK|STUB|PLACEHOLDER|TBD|WIP|DUMMY|FAKE|MOCK|NOT IMPLEMENTED)\b/i;
const ASSIGNMENT_PATTERN = /^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*(?::=|\+=|\?=|=)\s*(.*?)\s*(?:#.*)?$/;
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

export async function scanProject(options) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const profile = getProfile(options.profile ?? 'generic_source_tree');
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const scanStartedAt = new Date().toISOString();
  const knownGoodFacts = normalizeKnownGoodFacts(options.knownGood ?? null);
  const context = {
    projectRoot,
    profile,
    scanStartedAt,
    knownGoodPath: options.knownGoodPath ?? null,
    evidence: [],
    evidenceIds: new Set(),
    pathReferences: [],
    inventory: {
      project_root: projectRoot,
      profile: profile.id,
      scanned_at: scanStartedAt,
      files: [],
      important_files: [],
      skipped_files: [],
      missing_expected_patterns: [],
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

  for (const entry of entries) {
    const relPath = normalizePath(relDir ? `${relDir}/${entry.name}` : entry.name);
    const absPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name, relPath, context.projectRoot, options.outDir)) {
        continue;
      }
      await walkProject(absPath, context, options, relPath);
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    context.inventory.counts.files_total += 1;
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

function shouldSkipDirectory(name, relPath, projectRoot, outDir) {
  if (EXCLUDED_DIRS.has(name)) {
    return true;
  }

  if (!outDir) {
    return false;
  }

  const relOut = normalizePath(relative(projectRoot, outDir));
  return relOut && relOut !== '..' && !relOut.startsWith('../') && relPath === relOut;
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
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    scanLine(lines[index], index + 1, file, context);
  }
}

function scanLine(line, lineNo, file, context) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const placeholder = trimmed.match(PLACEHOLDER_PATTERN);
  if (placeholder) {
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
  scanAssignment(line, lineNo, file, context);
  scanPaths(line, lineNo, file, context);
  scanInitRc(line, lineNo, file, context);
  scanFstab(line, lineNo, file, context);
  scanVendorBlobList(line, lineNo, file, context);
  scanKeywordFamilies(line, lineNo, file, context);
}

function scanRiskyLeftovers(line, lineNo, file, context) {
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

function scanAssignment(line, lineNo, file, context) {
  const match = line.match(ASSIGNMENT_PATTERN);
  if (!match) {
    return;
  }

  const key = match[1].trim();
  const rawValue = stripInlineComment(match[2]).trim();
  if (!rawValue) {
    return;
  }

  const category = categorizeAssignment(key, rawValue);
  const normalizedValue = normalizeScalar(rawValue);
  const evidence = addEvidence(context, {
    category,
    severity: severityForAssignment(key, category),
    confidence: 'likely',
    source_file: file.path,
    source_line_start: lineNo,
    source_line_end: lineNo,
    extracted_text: line.trim(),
    normalized_claim: `${key}=${normalizedValue}`,
    related_paths: extractPathTokens(rawValue),
    related_symbols: [key],
    related_build_vars: key.startsWith('ro.') ? [] : [key],
    related_device_props: key.startsWith('ro.') ? [key] : [],
    evidence_type: 'source_line',
    suggested_action: 'Compare this value against other definitions and known-good device facts.',
    rationale: 'Build variables and device properties define the assumptions that recovery and bring-up outputs inherit.',
  });

  for (const pathRef of extractPathTokens(rawValue)) {
    rememberPathReference(context, pathRef, file.path, lineNo, line.trim(), evidence.id, category);
  }
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
  const fstabLikeLine = /^\s*(\/dev\/block|system|vendor|product|odm|metadata|data|cache|\/)/.test(line)
    && /\s\/[A-Za-z0-9_/.-]+\s/.test(line);
  if (!isFstabFile && !fstabLikeLine) {
    return;
  }

  const fields = line.trim().split(/\s+/);
  if (fields.length < 2 || line.trim().startsWith('#')) {
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
    if (!shouldCheckPath(normalizedRef)) {
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

  return dedupeById(contradictions);
}

function buildPatchCandidates(context, contradictions) {
  const candidates = [];

  for (const contradiction of contradictions) {
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

function categorizeAssignment(key, value) {
  const upper = key.toUpperCase();
  if (/^(PRODUCT|TARGET)(_DEVICE|_NAME|_MODEL)|TARGET_OTA_ASSERT_DEVICE|TARGET_BOOTLOADER_BOARD_NAME|RO\.PRODUCT\.|RO\.BUILD\.PRODUCT/i.test(key)) {
    return 'device_identity';
  }
  if (/PLATFORM|SOC|TARGET_BOARD_PLATFORM|PRODUCT_PLATFORM|RO\.BOARD\.PLATFORM/i.test(key) || /\b(sm\d{4}|qcom|orion|oryon)\b/i.test(value)) {
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

function severityForAssignment(key, category) {
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

function contradictionCategoryForKey(key) {
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
  return category === 'device_identity'
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
  if (normalized.includes('soc') || normalized.includes('platform') || normalized === 'target_board_platform' || normalized === 'product_platform' || normalized === 'ro.board.platform') {
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
  if (normalized.includes('soc') || normalized.includes('platform')) return 'soc_platform';
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

function shouldCheckPath(pathRef) {
  if (!pathRef) {
    return false;
  }
  if (/[*$?{}]|^\$\(|\$\(/.test(pathRef)) {
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
