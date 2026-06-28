#!/usr/bin/env node

import { createHash } from 'crypto';
import { existsSync, statSync } from 'fs';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { extname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'android', 'before', 'being', 'between',
  'action', 'actionable', 'anything', 'backed', 'claim', 'command', 'could',
  'current', 'evidence', 'every', 'file', 'first', 'from', 'general', 'have',
  'hash', 'hashed', 'hashes', 'hello', 'into', 'just', 'like', 'local', 'need',
  'note', 'only', 'please', 'project', 'proof', 'really', 'reported', 'review',
  'source', 'status', 'should', 'that', 'their', 'there', 'these', 'thing',
  'this', 'through', 'using', 'when', 'where', 'with', 'would', 'you', 'your',
]);

const DOMAIN_ANCHORS = new Set([
  'adb', 'adreno', 'anland', 'bootloader', 'card0', 'cgroups', 'composer',
  'container', 'crtc', 'display', 'dmabuf', 'dock', 'drm', 'droidspaces',
  'fastboot', 'fdshim', 'freedreno', 'gamescope', 'glx', 'kgsl', 'kernelsu',
  'kvm', 'labwc', 'lease', 'lsposed', 'nebula', 'nx809', 'nx809j', 'panel',
  'plane', 'playstore', 'redmagic', 'rezygisk', 'rootfs', 'scm_rights', 'susfs',
  'turnip', 'twrp', 'vbmeta', 'vulkan', 'wayland', 'waylandie', 'widevine',
  'wlroots', 'xwayland', 'zygisk',
]);

const NARROW_ANCHORS = new Set([
  'adb', 'anland', 'bootloader', 'card0', 'cgroups', 'composer', 'crtc',
  'dmabuf', 'dock', 'drm', 'fastboot', 'fdshim', 'freedreno', 'gamescope',
  'glx', 'kgsl', 'kvm', 'labwc', 'lease', 'lsposed', 'plane', 'rezygisk',
  'rootfs', 'scm_rights', 'susfs', 'turnip', 'twrp', 'vbmeta', 'vulkan',
  'wayland', 'waylandie', 'widevine', 'wlroots', 'xwayland', 'zygisk',
]);

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cfg', '.conf', '.cpp', '.env', '.h', '.hpp', '.ini', '.java',
  '.json', '.jsonl', '.kt', '.kts', '.log', '.md', '.mk', '.py', '.rc', '.sh',
  '.toml', '.tsv', '.txt', '.xml', '.yaml', '.yml',
]);

const GENERATED_PATH_RE = /(^|\/)(agent_handoff|reversa-scans|reversa-datasets|telegram-evidence|training-pack|eval_report|report\.json|report\.html|summary\.md|dashboard\.html|contradictions\.json|patch_candidates\.json)(\/|$)/i;
const RAW_PROOF_RE = /(^|\/)(logs|evidence|extract|raw-proof|raw_logs|counts\.tsv)(\/|$)/i;
const REPO_SOURCE_RE = /(^|\/)(docs|app|lib|src|scripts|nebula-core-module|common|android|rootfs)(\/|$)/i;

export async function buildTelegramPromotionDataset(options) {
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });

  const claims = await readJsonl(options.claims);
  const corroborators = [];

  for (const sourcePath of options.corroborators ?? []) {
    corroborators.push(...await collectTextCorroborators(sourcePath));
  }

  for (const manifestPath of options.artifactManifests ?? []) {
    corroborators.push(...await readArtifactManifest(manifestPath));
  }

  const records = [];
  const promoted = [];
  const artifactBacked = [];
  const needed = [];
  const rejected = [];

  for (const claim of claims) {
    const matches = corroborators
      .map(corroborator => matchClaimToCorroborator(claim, corroborator))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    const decision = decidePromotion(claim, matches);
    const record = makePromotionRecord(claim, decision, matches);
    records.push(record);

    if (record.promotion_state === 'promoted') promoted.push(record);
    else if (record.promotion_state === 'artifact_backed') artifactBacked.push(record);
    else if (record.promotion_state.startsWith('rejected')) rejected.push(record);
    else needed.push(record);
  }

  await writeJsonl(join(outDir, 'telegram-promotion-records.jsonl'), records);
  await writeJsonl(join(outDir, 'promoted-evidence.jsonl'), promoted);
  await writeJsonl(join(outDir, 'artifact-backed-evidence.jsonl'), artifactBacked);
  await writeJsonl(join(outDir, 'corroboration-needed.jsonl'), needed);
  await writeJsonl(join(outDir, 'rejected-evidence.jsonl'), rejected);
  await writeFile(join(outDir, 'promotion-summary.tsv'), promotionSummary(records), 'utf8');
  await writeFile(join(outDir, 'result.md'), resultMarkdown({
    outDir,
    claims,
    corroborators,
    records,
    promoted,
    artifactBacked,
    needed,
    rejected,
  }), 'utf8');

  return {
    outDir,
    totalClaims: claims.length,
    totalCorroborators: corroborators.length,
    promoted: promoted.length,
    artifactBacked: artifactBacked.length,
    corroborationNeeded: needed.length,
    rejected: rejected.length,
  };
}

export async function readJsonl(path) {
  const text = await readFile(resolve(path), 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

export async function collectTextCorroborators(inputPath) {
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`Corroborator path does not exist: ${resolved}`);
  }
  const paths = statSync(resolved).isDirectory() ? await walkTextFiles(resolved) : [resolved];
  const rows = [];
  for (const path of paths) {
    const stat = statSync(path);
    if (stat.size > 1024 * 1024) continue;
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const text = await readFile(path, 'utf8');
    rows.push(makeCorroborator({
      kind: classifyPath(path),
      path,
      text,
      hash: sha256(text),
      source_authority: isSourceAuthorityPath(path),
      generated_artifact: isGeneratedEvidencePath(path),
      artifact_hash_authority: false,
      content_authority: isSourceAuthorityPath(path),
    }));
  }
  return rows;
}

export async function readArtifactManifest(manifestPath) {
  const resolved = resolve(manifestPath);
  if (!existsSync(resolved)) {
    throw new Error(`Artifact manifest does not exist: ${resolved}`);
  }
  const text = await readFile(resolved, 'utf8');
  const rows = text.trim().startsWith('[')
    ? JSON.parse(text)
    : text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));

  return rows.map((row, index) => makeCorroborator({
    kind: row.kind ?? artifactKindFromPath(row.path ?? row.source_path ?? ''),
    path: row.path ?? row.source_path ?? `${resolved}#${index + 1}`,
    text: [row.content_summary, row.extracted_text, row.notes, row.path, row.source_path, row.tags?.join(' ')].filter(Boolean).join(' '),
    hash: row.sha256 ?? row.SHA256 ?? row.hash ?? sha256(JSON.stringify(row)),
    source_authority: false,
    generated_artifact: false,
    artifact_hash_authority: Boolean(row.sha256 ?? row.SHA256 ?? row.hash),
    content_authority: Boolean(row.content_summary || row.extracted_text || row.transcript_path || row.ocr_path),
    link: {
      claim_id: row.claim_id ?? null,
      message_hash: row.message_hash ?? null,
      media_id: row.media_id ?? row.id ?? null,
      labels: row.labels ?? row.tags ?? [],
    },
  }));
}

export function matchClaimToCorroborator(claim, corroborator) {
  const explicitScore = explicitLinkScore(claim, corroborator);
  const claimText = `${claim.extracted_text ?? ''} ${claim.normalized_claim ?? ''} ${(claim.labels ?? []).join(' ')}`;
  const claimTerms = terms(claimText);
  const sourceTerms = terms(corroborator.text);
  const shared = [...claimTerms].filter(term => sourceTerms.has(term));
  const sharedAnchors = shared.filter(term => DOMAIN_ANCHORS.has(term) || /[0-9]/.test(term));
  const sharedNarrowAnchors = shared.filter(term => NARROW_ANCHORS.has(term));
  const score = explicitScore + shared.length;

  if (explicitScore === 0 && (shared.length < 4 || sharedAnchors.length < 3 || sharedNarrowAnchors.length < 1)) {
    return null;
  }

  return {
    kind: corroborator.kind,
    path: corroborator.path,
    hash: corroborator.hash,
    source_authority: corroborator.source_authority,
    generated_artifact: corroborator.generated_artifact,
    artifact_hash_authority: corroborator.artifact_hash_authority,
    content_authority: corroborator.content_authority,
    score,
    matched_terms: shared.slice(0, 20).sort(),
    matched_anchors: sharedAnchors.slice(0, 20).sort(),
    matched_narrow_anchors: sharedNarrowAnchors.slice(0, 20).sort(),
  };
}

export function decidePromotion(claim, matches) {
  const knownGood = matches.some(match => /NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS|real_buffer_commits[= ]2|vkGetMemoryFdKHR[= ]0/i.test(match.path + ' ' + match.matched_terms.join(' ')));
  const lowerFrontierClaim = /blocked_export|blocked_real_buffer|A1E|SIGBUS|vkGetMemoryFdKHR failures=1199|real_buffer_commits=0/i.test(`${claim.extracted_text ?? ''} ${claim.normalized_claim ?? ''}`);
  if (knownGood && lowerFrontierClaim) {
    return {
      state: 'rejected_frontier_conflict',
      classification: 'TELEGRAM_CLAIM_BELOW_KNOWN_GOOD_FRONTIER',
      sourceAuthority: false,
      artifactAuthority: false,
      reason: 'Claim conflicts with known-good frontier corroborator.',
      requiredProof: ['recover_or_replay_known_good_harness', 'raw_log_that_supersedes_frontier'],
    };
  }

  const primarySource = matches.find(match => match.source_authority && !match.generated_artifact);
  if (primarySource) {
    return {
      state: 'promoted',
      classification: 'TELEGRAM_CLAIM_CORROBORATED_BY_SOURCE',
      sourceAuthority: true,
      artifactAuthority: matches.some(match => match.artifact_hash_authority),
      reason: 'Matched a non-generated source or raw proof corroborator.',
      requiredProof: [],
    };
  }

  const contentMedia = matches.find(match => match.artifact_hash_authority && match.content_authority);
  if (contentMedia) {
    return {
      state: 'artifact_backed',
      classification: 'TELEGRAM_CLAIM_BACKED_BY_HASHED_ARTIFACT',
      sourceAuthority: false,
      artifactAuthority: true,
      reason: 'Matched a hashed file/video artifact with extracted or summarized content.',
      requiredProof: ['repo_source_or_raw_log_for_source_authority'],
    };
  }

  const hashOnlyMedia = matches.find(match => match.artifact_hash_authority);
  if (hashOnlyMedia) {
    return {
      state: 'artifact_backed_needs_content_extraction',
      classification: 'TELEGRAM_ARTIFACT_HASHED_CONTENT_NOT_EXTRACTED',
      sourceAuthority: false,
      artifactAuthority: true,
      reason: 'Matched a hashed file/video artifact, but no transcript, OCR, summary, or decoded content was supplied.',
      requiredProof: ['video_frame_extract_or_transcript', 'repo_source_or_raw_log_for_source_authority'],
    };
  }

  return {
    state: 'corroboration_needed',
    classification: 'TELEGRAM_CLAIM_REQUIRES_INDEPENDENT_EVIDENCE',
    sourceAuthority: false,
    artifactAuthority: false,
    reason: matches.length > 0
      ? 'Only generated or weak corroborators matched.'
      : 'No independent corroborator matched.',
    requiredProof: ['repo_source_line', 'hashed_log', 'hashed_file_or_video', 'test_output', 'human_promotion_decision'],
  };
}

function makePromotionRecord(claim, decision, matches) {
  const claimText = shortText(claim.extracted_text || claim.claim_value || claim.normalized_claim || '');
  const labels = uniq([
    ...(claim.labels ?? []),
    'SOURCE:TELEGRAM',
    decision.classification,
  ]);
  return {
    schema_version: 1,
    record_id: `telegram_promotion_${sha256(`${claim.id}|${decision.classification}|${claimText}`).slice(0, 16)}`,
    claim_id: claim.id,
    message_hash: claim.message_hash ?? null,
    claim_hash: sha256(claimText),
    claim_text: claimText,
    labels,
    promotion_state: decision.state,
    classification: decision.classification,
    source_authority: decision.sourceAuthority,
    telegram_source_authority: false,
    artifact_hash_authority: decision.artifactAuthority,
    patch_authority: false,
    confidence: decision.sourceAuthority ? 'medium' : 'low',
    corroborators: matches.slice(0, 12),
    required_proof: decision.requiredProof,
    recommended_action: decision.requiredProof.length === 0
      ? 'Use as tracked corroborated evidence, with Telegram retained only as supporting provenance.'
      : 'Keep as evidence context until the required proof is attached.',
    rationale: decision.reason,
  };
}

function makeCorroborator(input) {
  return {
    kind: input.kind,
    path: normalizePath(input.path),
    text: shortText(input.text ?? '', 5000),
    hash: input.hash,
    source_authority: Boolean(input.source_authority),
    generated_artifact: Boolean(input.generated_artifact),
    artifact_hash_authority: Boolean(input.artifact_hash_authority),
    content_authority: Boolean(input.content_authority),
    link: input.link ?? {},
  };
}

async function walkTextFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'site', '.venv'].includes(entry.name)) continue;
      paths.push(...await walkTextFiles(path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

function classifyPath(path) {
  const normalized = normalizePath(path);
  if (isGeneratedEvidencePath(normalized)) return 'generated_evidence';
  if (RAW_PROOF_RE.test(normalized)) return 'raw_proof';
  if (REPO_SOURCE_RE.test(normalized)) return 'repo_source';
  return 'source_artifact';
}

function artifactKindFromPath(path) {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.webm'].includes(ext)) return 'hashed_video_artifact';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'hashed_image_artifact';
  return 'hashed_file_artifact';
}

function isSourceAuthorityPath(path) {
  const normalized = normalizePath(path);
  if (isGeneratedEvidencePath(normalized)) return false;
  return RAW_PROOF_RE.test(normalized) || REPO_SOURCE_RE.test(normalized);
}

function isGeneratedEvidencePath(path) {
  return GENERATED_PATH_RE.test(normalizePath(path));
}

function explicitLinkScore(claim, corroborator) {
  let score = 0;
  const link = corroborator.link ?? {};
  if (link.claim_id && link.claim_id === claim.id) score += 20;
  if (link.message_hash && link.message_hash === claim.message_hash) score += 18;
  if (link.media_id && (claim.media_ids ?? []).includes(link.media_id)) score += 18;
  const claimLabels = new Set(claim.labels ?? []);
  for (const label of link.labels ?? []) {
    if (claimLabels.has(label)) score += 2;
  }
  return score;
}

function terms(text) {
  return new Set(String(text)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4)
    .filter(token => !STOP_WORDS.has(token))
    .filter(token => !/^\d+$/.test(token)));
}

async function writeJsonl(path, rows) {
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function promotionSummary(records) {
  const counts = countBy(records, record => record.promotion_state);
  return ['promotion_state\tcount', ...Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, count]) => `${state}\t${count}`)].join('\n') + '\n';
}

function resultMarkdown(summary) {
  return [
    '# Telegram Promotion Gate Result',
    '',
    `Output: \`${summary.outDir}\``,
    '',
    '## Summary',
    '',
    `- Claims inspected: ${summary.claims.length}`,
    `- Corroborators indexed: ${summary.corroborators.length}`,
    `- Promoted source-backed claims: ${summary.promoted.length}`,
    `- Artifact-backed claims: ${summary.artifactBacked.length}`,
    `- Corroboration still needed: ${summary.needed.length}`,
    `- Rejected claims: ${summary.rejected.length}`,
    '',
    '## Authority Rule',
    '',
    '- Telegram text is never source authority by itself.',
    '- Hashed files and videos are real evidence artifacts and may back a claim.',
    '- Hash-only media proves artifact identity, not the decoded technical claim.',
    '- Repo source, raw logs, or extracted media content are required before a technical claim becomes source-authoritative.',
    '- Generated Reversa reports are indexes, not primary authority.',
    '',
    '## Safety',
    '',
    '- No Telegram API calls.',
    '- No messages sent.',
    '- No ADB, phone, fastboot, flash, APK, module, runtime, game, DRM, or TDP actions.',
  ].join('\n') + '\n';
}

function countBy(records, fn) {
  const counts = {};
  for (const record of records) {
    const key = fn(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function shortText(text = '', limit = 500) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizePath(path = '') {
  return String(path).replace(/\\/g, '/');
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function parseArgs(args) {
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
        throw new Error(`Unknown telegram-promotion option: ${arg}`);
    }
  }

  if (!options.help && (!options.claims || !options.out)) {
    throw new Error('Missing required --claims or --out');
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
  node scripts/build-telegram-promotion-dataset.js \\
    --claims <normalized-telegram-claims.jsonl> \\
    --corroborator <repo-doc-or-raw-proof-file-or-dir> \\
    --artifact-manifest <hashed-file-video-manifest.jsonl> \\
    --out <output-dir>

The gate is offline and read-only. Telegram text is never promoted by itself.
Hashed files/videos count as artifact evidence, while source authority requires
repo source, raw logs, or extracted media content.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await buildTelegramPromotionDataset(options);
  console.log(`Telegram claims: ${result.totalClaims}`);
  console.log(`Promoted: ${result.promoted}`);
  console.log(`Artifact-backed: ${result.artifactBacked}`);
  console.log(`Corroboration needed: ${result.corroborationNeeded}`);
  console.log(`Rejected: ${result.rejected}`);
  console.log(`Output: ${result.outDir}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
