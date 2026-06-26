import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { compareProjects, writeCompareOutputs } from '../lib/scan/compare.js';
import guiCommand from '../lib/commands/gui.js';
import { generateDashboard } from '../lib/gui/dashboard.js';
import { scanProject } from '../lib/scan/scanner.js';
import { validateScanReport } from '../lib/scan/schema.js';
import { writeScanOutputs } from '../lib/scan/writers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const currentFixture = join(repoRoot, 'test/fixtures/android-recovery-current');
const referenceFixture = join(repoRoot, 'test/fixtures/android-recovery-reference');
const bo3Fixture = join(repoRoot, 'test/fixtures/bo3-runtime-diagnostics');
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

test('game runtime profile detects BO3 diagnostics and safety boundaries', async () => {
  const report = await scanProject({
    projectRoot: bo3Fixture,
    profile: 'bo3_zombies_diagnostics',
  });

  assert.equal(report.scan.profile, 'bo3_zombies_diagnostics');
  assertEvidence(report, 'bo3_config', 'MaxFPS=144');
  assertEvidence(report, 'game_runtime_identity', 'BlackOps3.exe');
  assertEvidence(report, 'graphics_wrapper_chain', 'WINEDLLOVERRIDES=dinput8,winmm,version=n,b');
  assertEvidence(report, 'vulkan_loader', 'ERROR_INCOMPATIBLE_DRIVER');
  assertEvidence(report, 'runtime_security_surface', 'remote code execution');
  assertEvidence(report, 'performance_symptoms', 'frame pacing');

  const safety = report.evidence.find(item => item.category === 'safety_boundaries');
  assert(safety, 'expected safety boundary evidence');
  assert.match(safety.extracted_text, /anti-cheat bypass/);
  assert.match(safety.suggested_action, /do not implement bypass/);

  assert(report.commands_to_run.some(command => command.includes('BlackOps3')));
  assert(report.commands_to_run.some(command => command.includes('VK_ICD_FILENAMES')));
  assert(report.commands_to_run.every(command => /^(grep|find|test|sha256sum|node)\b/.test(command)));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('render enhancement profiles detect plugin and RM11Pro runtime surfaces', async () => {
  const renderReport = await scanProject({
    projectRoot: bo3Fixture,
    profile: 'render_enhancement_plugin',
  });

  assertEvidence(renderReport, 'render_hook_surface', 'PresentHook=IDXGISwapChain::Present');
  assertEvidence(renderReport, 'frame_timing_control', 'TargetFrameTimeMs=6.944');
  assertEvidence(renderReport, 'texture_injection_pipeline', 'TextureInjection=enabled');
  assertEvidence(renderReport, 'hdr_pipeline', 'HDRMode=HDR10');
  assertEvidence(renderReport, 'api_translation_layer', 'APITranslation=DXVK');
  assert(renderReport.commands_to_run.some(command => command.includes('IDXGISwapChain')));

  const renderValidation = validateScanReport(renderReport);
  assert.equal(renderValidation.valid, true, renderValidation.errors.join('\n'));

  const mobileReport = await scanProject({
    projectRoot: bo3Fixture,
    profile: 'rm11pro_gaming_runtime',
  });

  assertEvidence(mobileReport, 'mobile_linux_runtime', 'DEVICE=RM11Pro');
  assertEvidence(mobileReport, 'mobile_linux_runtime', 'GPU_STACK=Adreno Turnip Mesa');
  assertEvidence(mobileReport, 'vulkan_loader', 'VK_DRIVER_FILES');
  assert(mobileReport.commands_to_run.some(command => command.includes('RM11Pro')));

  const mobileValidation = validateScanReport(mobileReport);
  assert.equal(mobileValidation.valid, true, mobileValidation.errors.join('\n'));
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

test('gui command help and missing output handling are clear', async () => {
  const help = spawnSync(process.execPath, [join(repoRoot, 'bin/reversa.js'), 'gui', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /reversa gui/);
  assert.match(help.stdout, /dashboard\.html/);

  await assert.rejects(
    () => guiCommand(['--out', join(tmpdir(), 'reversa-missing-output-for-test')]),
    /Output directory does not exist/
  );
});

test('gui dashboard is generated from valid scan output', async () => {
  const report = await scanCurrent();
  const outDir = await mkdtemp(join(tmpdir(), 'reversa-gui-test-'));
  await writeScanOutputs(report, {
    outDir,
    html: true,
    json: true,
    jsonl: true,
    markdown: true,
    agentHandoff: true,
  });

  const result = await generateDashboard({ outDir });
  assert(existsSync(result.dashboardPath));
  assert.equal(result.hasScan, true);
  assert.equal(result.hasCompare, false);

  const html = await readFile(result.dashboardPath, 'utf8');
  assert.match(html, /Reversa-Matrix Dashboard/);
  assert.match(html, /Findings Browser/);
  assert.match(html, /DESTRUCTIVE \/ HUMAN REVIEW REQUIRED \/ BACKUP REQUIRED/);
});

test('README beginner command examples remain smoke-testable', async () => {
  const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');
  assert.match(readme, /git clone https:\/\/github\.com\/Fractal-Echo\/Reversa-Matrix\.git/);
  assert.match(readme, /npm install/);
  assert.match(readme, /npm test/);
  assert.match(readme, /node \.\/bin\/reversa\.js scan --help/);
  assert.match(readme, /node \.\/bin\/reversa\.js gui --out reversa_out/);
});

test('local agent scaffold writes an auditable contradiction run without a model server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-agent-test-'));
  const memoryRoot = join(root, 'memory');
  const runDir = join(root, 'run');
  const evidenceFile = join(root, 'PHONE_REVERSA_CONFLICT_SCAN.md');
  const evidenceDir = join(root, 'raw-evidence');
  await mkdir(evidenceDir);
  await writeFile(evidenceFile, [
    'VK_ICD_FILENAMES=/usr/local/etc/vulkan/icd.d/freedreno_icd.json',
    'VK_DRIVER_FILES=/usr/local/etc/vulkan/icd.d/freedreno_icd.json',
    '/usr/share/vulkan/icd.d/freedreno_icd.json',
    '/usr/local/lib/libvulkan_freedreno.so',
  ].join('\n'), 'utf8');
  await writeFile(join(evidenceDir, 'runtime.txt'), [
    'Qualcomm Adreno UMD candidate belongs to B0',
    'CONFIG_ARM64_VA_BITS=39',
    'glxinfo -B',
    'vulkaninfo --summary returned 0',
    'CHILD_LIBPATH GAMESCOPE_LIBPATH BRIDGE_LIBPATH LD_LIBRARY_PATH',
  ].join('\n'), 'utf8');

  const init = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'init-memory',
    '--memory-root',
    memoryRoot,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'run',
    '--mode',
    'phone-safe',
    '--goal',
    'A1 inspect supplied Nebula evidence for Vulkan loader contradictions. Do not patch.',
    '--memory-root',
    memoryRoot,
    '--evidence-file',
    evidenceFile,
    '--evidence-dir',
    evidenceDir,
    '--out',
    runDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  for (const relPath of [
    'prompt.md',
    'plan.md',
    'tool_calls.jsonl',
    'evidence.jsonl',
    'contradictions.yaml',
    'PHONE_REVERSA_AGENT_REPORT.md',
    'artifacts/policy.json',
    'artifacts/evidence_files.sha256',
    'artifacts/evidence_manifest.json',
  ]) {
    assert(existsSync(join(runDir, relPath)), `${relPath} should exist`);
  }

  const report = await readFile(join(runDir, 'PHONE_REVERSA_AGENT_REPORT.md'), 'utf8');
  assert.match(report, /dual_freedreno_icd_candidates/);
  assert.match(report, /a1_b0_lane_mixing/);
  assert.match(report, /Raw shell tool: disabled/);

  const hashes = await readFile(join(runDir, 'artifacts/evidence_files.sha256'), 'utf8');
  assert.match(hashes, /PHONE_REVERSA_CONFLICT_SCAN\.md/);
  assert.match(hashes, /runtime\.txt/);
});

test('local agent snapshot writes phone-safe adb evidence and hash manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-snapshot-test-'));
  const outDir = join(root, 'snapshot');
  const fakeAdb = join(root, 'adb');
  await writeFile(fakeAdb, `#!/usr/bin/env bash
set -e
case "$*" in
  "version") echo "Android Debug Bridge version 1.0.41" ;;
  "devices -l") echo "List of devices attached"; echo "fake-device device product:rm11 model:RM11" ;;
  "mdns services") echo "fake-device._adb-tls-connect._tcp." ;;
  "shell getprop") echo "[ro.product.device]: [canoe]"; echo "[ro.hardware.vulkan]: [adreno]" ;;
  "shell settings get global adb_enabled") echo "1" ;;
  "shell settings get global adb_wifi_enabled") echo "1" ;;
  "shell pm path io.droidspaces.nebula.waylandie") echo "package:/data/app/nebula/base.apk" ;;
  "shell pm list packages") echo "package:io.droidspaces.nebula.waylandie" ;;
  "shell ls -l /dev/kgsl-3d0 /dev/dri /dev/dma_heap") echo "crw-rw---- /dev/kgsl-3d0"; echo "drwxr-xr-x /dev/dri" ;;
  "shell ps -A") echo "USER PID NAME"; echo "u0_a518 123 io.droidspaces.nebula.waylandie" ;;
  "shell cat /proc/net/unix") echo "Num RefCount Protocol Flags Type St Inode Path"; echo "000 socket wayland" ;;
  "shell run-as io.droidspaces.nebula.waylandie id") echo "uid=10518(u0_a518)" ;;
  "shell run-as io.droidspaces.nebula.waylandie find . -maxdepth 4 -type d") echo "./files"; echo "./files/imagefs" ;;
  "shell run-as io.droidspaces.nebula.waylandie find ./files -maxdepth 9 -type f") echo "./files/imagefs/usr/share/vulkan/icd.d/freedreno_icd.json"; echo "./files/imagefs/usr/local/etc/vulkan/icd.d/freedreno_icd.json"; echo "./files/imagefs/usr/local/lib/libvulkan_freedreno.so" ;;
  "shell run-as io.droidspaces.nebula.waylandie find ./files -maxdepth 9 -type f -name freedreno_icd.json") echo "./files/imagefs/usr/share/vulkan/icd.d/freedreno_icd.json"; echo "./files/imagefs/usr/local/etc/vulkan/icd.d/freedreno_icd.json" ;;
  "shell run-as io.droidspaces.nebula.waylandie find ./files -maxdepth 9 -type f -name *freedreno*") echo "./files/imagefs/usr/share/vulkan/icd.d/freedreno_icd.json"; echo "./files/imagefs/usr/local/etc/vulkan/icd.d/freedreno_icd.json"; echo "./files/imagefs/usr/local/lib/libvulkan_freedreno.so" ;;
  "shell run-as io.droidspaces.nebula.waylandie find ./files -maxdepth 9 -type f -name *vulkan*") echo "./files/imagefs/usr/local/lib/libvulkan_freedreno.so" ;;
  "shell run-as io.droidspaces.nebula.waylandie find ./files -maxdepth 9 -type f -name *freedreno* -exec sha256sum {} +") echo "abc123  ./files/imagefs/usr/local/lib/libvulkan_freedreno.so" ;;
  *) echo "unexpected: $*" >&2; exit 7 ;;
esac
`, 'utf8');
  await chmod(fakeAdb, 0o755);

  const snapshot = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'snapshot',
    '--adb-binary',
    fakeAdb,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(snapshot.status, 0, snapshot.stderr || snapshot.stdout);

  for (const relPath of [
    'manifest.json',
    'manifest.txt',
    'evidence_files.sha256',
    'host/adb-version.txt',
    'device/getprop.txt',
    'app/graphics-file-inventory.txt',
    'app/icd-file-inventory.txt',
    'app/freedreno-file-hashes.txt',
  ]) {
    assert(existsSync(join(outDir, relPath)), `${relPath} should exist`);
  }

  const inventory = await readFile(join(outDir, 'app/graphics-file-inventory.txt'), 'utf8');
  assert.match(inventory, /usr\/share\/vulkan\/icd\.d\/freedreno_icd\.json/);
  assert.match(inventory, /usr\/local\/etc\/vulkan\/icd\.d\/freedreno_icd\.json/);

  const hashes = await readFile(join(outDir, 'evidence_files.sha256'), 'utf8');
  assert.match(hashes, /manifest\.json/);
  assert.match(hashes, /graphics-file-inventory\.txt/);
});

function assertEvidence(report, category, claimIncludes) {
  assert(
    report.evidence.some(item => item.category === category && item.normalized_claim.includes(claimIncludes)),
    `expected ${category} evidence including ${claimIncludes}`
  );
}
