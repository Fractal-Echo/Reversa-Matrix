import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { compareProjects, writeCompareOutputs } from '../lib/scan/compare.js';
import { scanProject } from '../lib/scan/scanner.js';
import { validateScanReport } from '../lib/scan/schema.js';
import { writeScanOutputs } from '../lib/scan/writers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const currentFixture = join(repoRoot, 'test/fixtures/android-recovery-current');
const referenceFixture = join(repoRoot, 'test/fixtures/android-recovery-reference');
const knownGoodPath = join(repoRoot, 'examples/known_good_rm11pro_nx809j.json');

async function loadKnownGood() {
  return JSON.parse(await readFile(knownGoodPath, 'utf8'));
}

async function scanCurrent() {
  return scanProject({
    projectRoot: currentFixture,
    profile: 'android_recovery',
    knownGood: await loadKnownGood(),
    knownGoodPath,
  });
}

test('scanner detects placeholders, suspicious paths, missing paths, and Android variables', async () => {
  const report = await scanCurrent();

  assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');
  assertEvidence(report, 'suspicious_hardcoded_paths', 'path_reference:/vendor/bin/missingqsee');
  assertEvidence(report, 'missing_files', 'referenced_path_missing:/vendor/bin/missingqsee');
  assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_keymint.so');
  assertEvidence(report, 'soc_platform_identity', 'TARGET_BOARD_PLATFORM=sm8750');
  assertEvidence(report, 'device_identity', 'TARGET_BOOTLOADER_BOARD_NAME=RM10Pro');
  assertEvidence(report, 'display_touch_framebuffer_config', 'TARGET_RECOVERY_PIXEL_FORMAT=RGBX_8888');
  assertEvidence(report, 'kernel_header_assumptions', 'BOARD_EXCLUDE_KERNEL_FROM_RECOVERY_IMAGE=true');
  assertEvidence(report, 'keymaster_keymint_gatekeeper_decrypt_dependencies', 'qsee');
  assertEvidence(report, 'fstab_entries', 'fstab:/dev/block/sda17->/metadata');
  assertEvidence(report, 'vendor_blobs', 'vendor_blob:vendor/lib64/libmissing_keymint.so');
});

test('scanner generates known-good mismatches, contradictions, and patch candidates', async () => {
  const report = await scanCurrent();

  assert(report.known_good.mismatches.some(item => item.key === 'device'));
  assert(report.known_good.mismatches.some(item => item.key === 'soc_platform'));
  assert(report.known_good.mismatches.some(item => item.key === 'boot_header_version'));
  assert(report.known_good.mismatches.some(item => item.key === 'recovery_partition_size'));

  assert(report.contradictions.some(item => item.title.includes('Conflicting definitions for PRODUCT_DEVICE')));
  assert(report.contradictions.some(item => item.title.includes('Suspicious old target leftover')));
  assert(report.contradictions.every(item => 'safe_next_action' in item));
  assert(report.contradictions.every(item => 'suggested_validation_command' in item));

  assert(report.patch_candidates.length > 0);
  assert(report.patch_candidates.some(item => item.evidence_ids.length > 0));
});

test('scan report schema is complete and agent handoff files are written', async () => {
  const report = await scanCurrent();
  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(report.schema_validation.valid, true);

  for (const evidence of report.evidence) {
    assert('id' in evidence);
    assert('timestamp' in evidence);
    assert(Array.isArray(evidence.related_paths));
    assert(Array.isArray(evidence.related_symbols));
    assert(Array.isArray(evidence.related_build_vars));
    assert(Array.isArray(evidence.related_device_props));
  }

  const outDir = await mkdtemp(join(tmpdir(), 'reversa-scan-test-'));
  await writeScanOutputs(report, {
    outDir,
    html: true,
    json: true,
    jsonl: true,
    markdown: true,
    agentHandoff: true,
  });

  for (const relPath of [
    'report.json',
    'evidence.jsonl',
    'summary.md',
    'report.html',
    'agent_handoff/findings.json',
    'agent_handoff/evidence.jsonl',
    'agent_handoff/contradictions.json',
    'agent_handoff/patch_candidates.json',
    'agent_handoff/commands_to_run.md',
    'agent_handoff/questions_for_human.md',
    'agent_handoff/known_good_facts.json',
    'agent_handoff/risky_assumptions.json',
    'agent_handoff/tree_inventory.json',
  ]) {
    assert(existsSync(join(outDir, relPath)), `${relPath} should exist`);
  }

  const jsonl = await readFile(join(outDir, 'evidence.jsonl'), 'utf8');
  assert.equal(jsonl.trim().split('\n').length, report.evidence.length);
});

test('compare mode emits classified compare artifacts', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'reversa-compare-test-'));
  const report = await compareProjects({
    left: currentFixture,
    right: referenceFixture,
    profile: 'android_recovery',
    knownGood: await loadKnownGood(),
    knownGoodPath,
    outDir,
  });

  assert(report.findings.some(item => item.category === 'variable_differences'));
  assert(report.findings.some(item => item.category === 'fstab_differences'));
  assert(report.findings.some(item => item.category === 'init_rc_differences'));
  assert(report.findings.some(item => item.category === 'vendor_blob_list_differences'));
  assert(report.risky_import_candidates.length > 0);

  await writeCompareOutputs(report, outDir);
  for (const relPath of [
    'compare_report.json',
    'compare_summary.md',
    'compare.html',
    'agent_handoff/compare_findings.json',
    'agent_handoff/safe_import_candidates.json',
    'agent_handoff/risky_import_candidates.json',
  ]) {
    const file = join(outDir, relPath);
    assert(existsSync(file), `${relPath} should exist`);
    assert((await stat(file)).size > 0, `${relPath} should not be empty`);
  }
});

function assertEvidence(report, category, claimIncludes) {
  assert(
    report.evidence.some(item => item.category === category && item.normalized_claim.includes(claimIncludes)),
    `expected ${category} evidence including ${claimIncludes}`
  );
}
