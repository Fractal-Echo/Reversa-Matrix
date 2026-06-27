import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { compareProjects, writeCompareOutputs } from '../lib/scan/compare.js';
import guiCommand from '../lib/commands/gui.js';
import { generateDashboard } from '../lib/gui/dashboard.js';
import { ENGINES } from '../lib/installer/detector.js';
import { Writer } from '../lib/installer/writer.js';
import { scanProject } from '../lib/scan/scanner.js';
import { validateScanReport } from '../lib/scan/schema.js';
import { writeScanOutputs } from '../lib/scan/writers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const currentFixture = join(repoRoot, 'test/fixtures/android-recovery-current');
const referenceFixture = join(repoRoot, 'test/fixtures/android-recovery-reference');
const bo3Fixture = join(repoRoot, 'test/fixtures/bo3-runtime-diagnostics');
const pcgwFixture = join(repoRoot, 'test/fixtures/pcgamingwiki-runtime');
const agenticFixture = join(repoRoot, 'test/fixtures/agentic-toolchain');
const agenticGatewayFixture = join(repoRoot, 'test/fixtures/agentic-gateway');
const semanticPolicyFixture = join(repoRoot, 'test/fixtures/semantic-policy');
const knownGoodFrontierFixture = join(repoRoot, 'test/fixtures/known-good-frontier');
const knownGoodFrontierRegressionFixture = join(repoRoot, 'test/fixtures/known-good-frontier-regression');
const knownGoodFrontierA1InvalidFixture = join(repoRoot, 'test/fixtures/known-good-frontier-a1-invalid');
const knownGoodFrontierStatusOnlyFixture = join(repoRoot, 'test/fixtures/known-good-frontier-status-only');
const knownGoodFrontierRawProofFixture = join(repoRoot, 'test/fixtures/known-good-frontier-raw-proof');
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

function runNode(args, options = {}) {
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('close', status => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

test('scanner detects placeholders, suspicious paths, missing paths, and Android variables', async () => {
  const report = await scanCurrent();

  assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');
  assertEvidence(report, 'suspicious_hardcoded_paths', 'path_reference:/vendor/bin/missingqsee');
  assertEvidence(report, 'suspicious_hardcoded_paths', 'path_reference:/system/bin/su');
  assertEvidence(report, 'missing_files', 'referenced_path_missing:/vendor/bin/missingqsee');
  assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_keymint.so');
  assertNoEvidence(report, ['missing_files', 'invalid_paths'], 'referenced_path_missing:/system/bin/su');
  assertEvidence(report, 'soc_platform_identity', 'TARGET_BOARD_PLATFORM=sm8750');
  assertEvidence(report, 'device_identity', 'TARGET_BOOTLOADER_BOARD_NAME=RM10Pro');
  assertEvidence(report, 'display_touch_framebuffer_config', 'TARGET_RECOVERY_PIXEL_FORMAT=RGBX_8888');
  assertEvidence(report, 'kernel_header_assumptions', 'BOARD_EXCLUDE_KERNEL_FROM_RECOVERY_IMAGE=true');
  assertEvidence(report, 'keymaster_keymint_gatekeeper_decrypt_dependencies', 'qsee');
  assertEvidence(report, 'fstab_entries', 'fstab:/dev/block/sda17->/metadata');
  assertEvidence(report, 'vendor_blobs', 'vendor_blob:vendor/lib64/libmissing_keymint.so');
});

test('scanner keeps real task markers but ignores template placeholder examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-placeholder-examples-'));
  await writeFile(join(root, 'template.md'), [
    '- [ ] Q-010 | Cobertura | Todo Requisito Funcional tem pelo menos um cenario Gherkin',
    '- AMB-XXX: <descricao curta>',
    '- <RISK-XXX: ver risk_register.md>',
    '- TODO: replace this with verified evidence',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'generic_source_tree',
  });

  assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');
  assertNoEvidence(report, ['placeholders', 'todo_fixme_stub_markers'], 'placeholder_marker:XXX');
  assertNoEvidence(report, ['placeholders', 'todo_fixme_stub_markers'], 'placeholder_marker:TODO Requisito');
});

test('scanner keeps live placeholder work but ignores scanner vocabulary and reference examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-placeholder-scope-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'lib', 'scan'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await mkdir(join(root, 'docs', 'upstreams', 'tool'), { recursive: true });
  await mkdir(join(root, 'agents', 'reviewer', 'references'), { recursive: true });
  await writeFile(join(root, 'src', 'live.js'), '// TODO: replace copied device assumption with verified evidence\n', 'utf8');
  await writeFile(join(root, 'src', 'scanner-work.js'), '// TODO: add scanner profile support for live projects\n', 'utf8');
  await writeFile(join(root, 'src', 'migration.py'), '# TODO: Remove after the ~/.tool/.env migration has had a release cycle.\n', 'utf8');
  await writeFile(join(root, 'lib', 'scan', 'profiles.js'), [
    "riskyLeftovers: ['TODO', 'FIXME', 'PLACEHOLDER', 'STUB'],",
    "'grep -RIn \"TODO\\\\|FIXME\\\\|PLACEHOLDER\\\\|STUB\" {{projectRoot}}',",
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'test', 'scan.test.js'), [
    "assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');",
    "'- TODO: fixture marker embedded in a scanner regression',",
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'docs', 'upstreams', 'tool', 'ABSORPTION.md'), '- `entrypoint.py` unresolved TODO marker\n', 'utf8');
  await writeFile(join(root, 'docs', 'summary.md'), 'TODO: replace copied summary assumption\n', 'utf8');
  await writeFile(join(root, 'docs', 'intentional.md'), '- Remaining candidate: the intentional migration TODO in `src/migration.py`\n', 'utf8');
  await writeFile(join(root, 'docs', 'facts.md'), '- Nebula assets and nested WIP repos:\n', 'utf8');
  await writeFile(join(root, 'agents', 'reviewer', 'references', 'confidence.md'), '- Old comment or TODO that may not reflect current state\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');
  assert(report.patch_candidates.some(item => item.target_file === 'src/live.js'));
  assert(report.patch_candidates.some(item => item.target_file === 'src/scanner-work.js'));
  assert(report.patch_candidates.some(item => item.target_file === 'docs/summary.md'));
  assert(!report.patch_candidates.some(item => item.target_file === 'src/migration.py'));
  assert(!report.patch_candidates.some(item => item.target_file === 'docs/intentional.md'));
  assert(!report.patch_candidates.some(item => item.target_file === 'lib/scan/profiles.js'));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('test/')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('docs/upstreams/')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('agents/reviewer/references/')));
  assertNoExtractedText(report, "riskyLeftovers: ['TODO'");
  assertNoExtractedText(report, 'unresolved TODO marker');
  assertNoExtractedText(report, 'nested WIP repos');
});

test('scanner avoids comment and profile false positives for fstab-like code lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-fstab-comments-'));
  await writeFile(join(root, 'script.js'), [
    '// Sanitize path before passing it to the renderer',
    '/* /dev/block/by-name/system /system ext4 ro */',
    '* /dev/block/by-name/vendor /vendor ext4 ro',
    '/dev/block/by-name/system /system ext4 ro',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'fstab.qcom'), [
    '# /dev/block/by-name/metadata /metadata ext4 noatime',
    '/dev/block/by-name/userdata /data f2fs rw',
  ].join('\n'), 'utf8');

  const genericReport = await scanProject({
    projectRoot: root,
    profile: 'generic_source_tree',
  });
  assertNoEvidence(genericReport, ['fstab_entries'], 'fstab:/dev/block/by-name/system->/system');
  assertEvidence(genericReport, 'fstab_entries', 'fstab:/dev/block/by-name/userdata->/data');

  const recoveryReport = await scanProject({
    projectRoot: root,
    profile: 'android_recovery',
  });
  assertEvidence(recoveryReport, 'fstab_entries', 'fstab:/dev/block/by-name/system->/system');
  assertNoEvidence(recoveryReport, ['fstab_entries'], 'fstab://->Sanitize');
  assertNoEvidence(recoveryReport, ['fstab_entries'], 'fstab:/*->/dev/block/by-name/system');
});

test('scanner skips root-level generated scan artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-root-artifacts-'));
  await writeFile(join(root, 'report.json'), '{"tool":"reversa"}\n', 'utf8');
  await writeFile(join(root, 'evidence.jsonl'), 'MODEL=old\nMODEL=new\n', 'utf8');
  await writeFile(join(root, 'summary.md'), 'MODEL=old\nMODEL=new\n', 'utf8');
  await writeFile(join(root, 'notes.md'), 'MODEL=kept\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assert(report.tree_inventory.skipped_files.some(item => item.path === 'report.json' && item.reason === 'generated_scan_artifact'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'evidence.jsonl' && item.reason === 'generated_scan_artifact'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'summary.md' && item.reason === 'generated_scan_artifact'));
  assertEvidence(report, 'provider_routing_surface', 'MODEL=kept');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=old');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=new');
});

test('scanner skips generated Reversa scan collections without skipping runtime source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-generated-collections-'));
  await mkdir(join(root, 'reversa_matrix_old', 'agent_handoff'), { recursive: true });
  await mkdir(join(root, 'reversa_scan_adapter', 'reversa_scan_core'), { recursive: true });
  await mkdir(join(root, 'reversa-archaeology-frontier'), { recursive: true });
  await mkdir(join(root, 'reversa-known-good-raw-proof'), { recursive: true });
  await mkdir(join(root, 'reversa-runtime'), { recursive: true });
  await writeFile(join(root, 'reversa_matrix_old', 'report.json'), '{"tool":"reversa"}\n', 'utf8');
  await writeFile(join(root, 'reversa_matrix_old', 'agent_handoff', 'evidence.jsonl'), 'MODEL=stale\n', 'utf8');
  await writeFile(join(root, 'reversa_scan_adapter', 'reversa_scan_core', 'live.env'), 'MODEL=adapter\n', 'utf8');
  await writeFile(join(root, 'reversa-archaeology-frontier', 'report.json'), '{"tool":"reversa"}\n', 'utf8');
  await writeFile(join(root, 'reversa-archaeology-frontier', 'summary.md'), 'MODEL=archaeology-loop\n', 'utf8');
  await writeFile(join(root, 'reversa-known-good-raw-proof', 'evidence.jsonl'), 'MODEL=raw-proof-loop\n', 'utf8');
  await writeFile(join(root, 'reversa-runtime', 'runtime.env'), 'MODEL=runtime\n', 'utf8');
  await writeFile(join(root, 'live.env'), 'MODEL=live\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
    includeIgnored: true,
  });

  assert(report.tree_inventory.skipped_files.some(item => item.path === 'reversa_matrix_old' && item.reason === 'generated_scan_output_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'reversa-archaeology-frontier' && item.reason === 'generated_scan_output_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'reversa-known-good-raw-proof' && item.reason === 'generated_scan_output_directory'));
  assert(!report.tree_inventory.skipped_files.some(item => item.path === 'reversa_scan_adapter' && item.reason === 'generated_scan_output_directory'));
  assertEvidence(report, 'provider_routing_surface', 'MODEL=live');
  assertEvidence(report, 'provider_routing_surface', 'MODEL=adapter');
  assertEvidence(report, 'provider_routing_surface', 'MODEL=runtime');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=stale');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=archaeology-loop');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=raw-proof-loop');
});

test('scanner honors git ignored paths unless includeIgnored is set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gitignore-'));
  const init = spawnSync('git', ['init'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  await mkdir(join(root, 'local'));
  await writeFile(join(root, '.gitignore'), 'local/\nreport.json\n', 'utf8');
  await writeFile(join(root, 'local', 'scratch.env'), 'MODEL=ignored\n', 'utf8');
  await writeFile(join(root, 'report.json'), '{"MODEL":"ignored-report"}\n', 'utf8');
  await writeFile(join(root, 'live.env'), 'MODEL=live\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assert.equal(report.tree_inventory.ignore_policy.honor_gitignore, true);
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'local' && item.reason === 'git_ignored_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'report.json' && item.reason === 'git_ignored_file'));
  assertEvidence(report, 'provider_routing_surface', 'MODEL=live');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=ignored');

  const forensicReport = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
    includeIgnored: true,
  });

  assert.equal(forensicReport.tree_inventory.ignore_policy.honor_gitignore, false);
  assertEvidence(forensicReport, 'provider_routing_surface', 'MODEL=ignored');
});

test('scanner scopes fixtures and docs examples out of repo-root contradiction groups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-source-scope-'));
  await mkdir(join(root, 'test', 'fixtures'), { recursive: true });
  await mkdir(join(root, 'agents', 'example', 'references'), { recursive: true });
  await writeFile(join(root, 'live.env'), 'MODEL=live\nADB=/mnt/c/platform-tools/adb.exe NEBULA_ADB_MODEL=NX809J \\\n', 'utf8');
  await writeFile(join(root, 'facts.env'), 'ADB=/mnt/c/platform-tools/adb.exe\n', 'utf8');
  await writeFile(join(root, 'test', 'fixtures', 'fixture.env'), 'MODEL=fixture\nTARGET_BOARD_PLATFORM := sm8750\n', 'utf8');
  await writeFile(join(root, 'agents', 'example', 'references', 'sizing.md'), 'S=0, M=1, L=2\nS=15, M=35\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertEvidence(report, 'provider_routing_surface', 'MODEL=live');
  assertEvidence(report, 'provider_routing_surface', 'MODEL=fixture');
  assertEvidence(report, 'build_variables', 'ADB=/mnt/c/platform-tools/adb.exe');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for MODEL')),
    'fixture definitions should not conflict with live repo-root definitions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for S')),
    'agent reference formulas should not create repo-root definition contradictions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for ADB')),
    'shell-style env prefixes with the same first value should not conflict'
  );

  const fixtureReport = await scanProject({
    projectRoot: join(root, 'test', 'fixtures'),
    profile: 'agentic_toolchain',
  });
  assertEvidence(fixtureReport, 'provider_routing_surface', 'MODEL=fixture');
});

test('scanner keeps output filenames and prose compounds out of missing-path checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-output-paths-'));
  await writeFile(join(root, 'agent.js'), [
    "commandResults.push(await runCapture(options, 'device/getprop.txt', ['adb']));",
    'The kernel/userland boundary matters.',
    'A proprietary/commercial-term source is reference-only.',
    'Keep risky root/module work out of the first app cut.',
    'RedMagic hardware/status references remain future hook/control lanes.',
    'Recovery and device-tree context lives in recovery/device-tree notes.',
    'vendor/lib64/libmissing_keymint.so',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:device/getprop.txt');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:kernel/userland');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:proprietary/commercial-term');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:root/module');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/status');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:recovery/device-tree');
  assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_keymint.so');
});

test('scanner does not derive missing-path contradictions from repo test assertions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-test-paths-'));
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'test', 'scan.test.js'), [
    "assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_keymint.so');",
    "'vendor/lib64/libmissing_keymint.so',",
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/lib64/libmissing_keymint.so');
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

test('child libpath profile catches Nebula A1 multi-variable early exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-nebula-a1-regression-'));
  await mkdir(join(root, 'extract'), { recursive: true });
  await writeFile(join(root, 'extract', 'result.txt'), [
    'GAMESCOPE_LIBPATH=/data/user/0/io.droidspaces.nebula.waylandie/files/imagefs/usr/local/lib:/data/user/0/io.droidspaces.nebula.waylandie/files/imagefs/usr/lib:/data/user/0/io.droidspaces.nebula.waylandie/files/sidecars/xwayland-gamescope-13-promoted-argb-export-nofd-r6-39773bc9/usr/local/lib:/system/lib64',
    'MESA_LOADER_DRIVER_OVERRIDE=kgsl',
    'GALLIUM_DRIVER=kgsl',
    'FD_FORCE_KGSL=1',
    'LIBGL_ALWAYS_SOFTWARE=UNSET',
    'FINAL_XWAYLAND_RUNNER_INVOKED=0',
    'SELECTED_VULKAN_DEVICE=NOT_FOUND',
    'VKGETMEMORYFD_FIRST_LINE=NOT_FOUND',
    'GAMESCOPE_EXIT=135',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'child_libpath',
  });

  assert.equal(report.scan.profile, 'child_libpath');
  assertEvidence(report, 'ld_library_path_linker_namespace_issues', 'GAMESCOPE_LIBPATH=');
  assertEvidence(report, 'nebula_runtime_regression', 'nebula_a1_multi_variable_regression');
  assert(report.contradictions.some(item => item.category === 'nebula_runtime_regression'
    && item.title === 'A1 changed Gamescope libpath and KGSL env before early exit'
    && item.likely_winner === 'A1B_KGSL_ENV_ONLY_R6_LIBPATH_RESTORED'));
  assert(
    !report.patch_candidates.some(item => item.title === 'A1 changed Gamescope libpath and KGSL env before early exit'),
    'runtime gate contradictions should not become source patch candidates'
  );
  assert(report.commands_to_run.some(command => command.includes('GAMESCOPE_LIBPATH')));

  const aliasReport = await scanProject({
    projectRoot: root,
    profile: 'nebula_child_libpath',
  });
  assert.equal(aliasReport.scan.profile, 'nebula_child_libpath');
  assert(aliasReport.contradictions.some(item => item.category === 'nebula_runtime_regression'));

  const restored = await mkdtemp(join(tmpdir(), 'reversa-nebula-a1b-clean-'));
  await mkdir(join(restored, 'extract'), { recursive: true });
  await writeFile(join(restored, 'extract', 'result.txt'), [
    'GAMESCOPE_LIBPATH=/data/user/0/io.droidspaces.nebula.waylandie/files/sidecars/xwayland-gamescope-13-promoted-argb-export-nofd-r6-39773bc9/usr/local/lib:/data/user/0/io.droidspaces.nebula.waylandie/files/imagefs/usr/local/lib:/system/lib64',
    'MESA_LOADER_DRIVER_OVERRIDE=kgsl',
    'GALLIUM_DRIVER=kgsl',
    'FD_FORCE_KGSL=1',
    'LIBGL_ALWAYS_SOFTWARE=UNSET',
    'FINAL_XWAYLAND_RUNNER_INVOKED=0',
    'SELECTED_VULKAN_DEVICE=NOT_FOUND',
    'VKGETMEMORYFD_FIRST_LINE=NOT_FOUND',
    'GAMESCOPE_EXIT=135',
  ].join('\n'), 'utf8');

  const restoredReport = await scanProject({
    projectRoot: restored,
    profile: 'child_libpath',
  });
  assert(
    !restoredReport.contradictions.some(item => item.category === 'nebula_runtime_regression'),
    'sidecar-first Gamescope libpath should not trip the A1 multi-variable regression detector'
  );
});

test('known good frontier profile records raw working frontier without self contradiction', async () => {
  const report = await scanProject({
    projectRoot: knownGoodFrontierFixture,
    profile: 'known_good_frontier',
  });

  assert.equal(report.scan.profile, 'known_good_frontier');
  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.raw.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS');
  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.raw_metric.real_buffer_commits=2');
  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.raw_metric.vkGetMemoryFdKHR_failures=0');
  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.harness.gamescope_sidecar=sidecar-14');
  assert(!report.contradictions.some(item => item.category === 'known_good_frontier_guard'));
});

test('known good frontier profile detects A1E below older raw frontier', async () => {
  const report = await scanProject({
    projectRoot: knownGoodFrontierRegressionFixture,
    profile: 'nebula_frontier_guard',
  });

  assert.equal(report.scan.profile, 'nebula_frontier_guard');
  assertEvidence(report, 'known_good_frontier_guard', 'REGRESSION_BELOW_KNOWN_GOOD_FRONTIER');
  const contradiction = report.contradictions.find(item => item.title === 'REGRESSION_BELOW_KNOWN_GOOD_FRONTIER');
  assert(contradiction, 'expected below-frontier contradiction');
  assert.equal(contradiction.likely_winner, 'R6_WAYLAND_WORKING_03_SIDEcar14_SIDEcar06_REPLAY');
  assert.equal(contradiction.recommended_action, 'RECOVER_EXACT_WORKING_HARNESS');
  assert(
    !report.patch_candidates.some(item => item.title === 'REGRESSION_BELOW_KNOWN_GOOD_FRONTIER'),
    'frontier regressions should not become source patch candidates'
  );
});

test('known good frontier profile ignores historical sidecar-13 notes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-known-good-historical-sidecar-'));
  await writeFile(join(root, 'result.md'), [
    'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS',
    'NONE_WAYLAND_DISPLAY',
    'real_buffer_commits=2',
    'vkGetMemoryFdKHR_failures=0',
    'sidecar-14',
    'sidecar-06',
    '',
    'Sidecar-13 is historical promotion evidence, not default behavior.',
    'Do not treat sidecar-13 as proof that Steam is ready.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'known_good_frontier',
  });

  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.raw.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS');
  assertNoEvidence(report, ['frontier_regression_marker'], 'frontier.lower.gamescope_sidecar=sidecar-13');
  assert(!report.contradictions.some(item => item.category === 'known_good_frontier_guard'));
});

test('known good frontier profile rejects invalid A1 export proof', async () => {
  const report = await scanProject({
    projectRoot: knownGoodFrontierA1InvalidFixture,
    profile: 'frontier_guard',
  });

  assertEvidence(report, 'frontier_regression_marker', 'frontier.invalid_export.GAMESCOPE_EXIT=135');
  assert(report.contradictions.some(item => item.category === 'known_good_frontier_guard'
    && item.title === 'A1 invalid export proof below frontier'
    && item.likely_winner === 'A1B_KGSL_ENV_ONLY_R6_LIBPATH_RESTORED'));
  assert.equal(report.patch_candidates.length, 0);
});

test('known good frontier profile requires raw proof for status-only success', async () => {
  const report = await scanProject({
    projectRoot: knownGoodFrontierStatusOnlyFixture,
    profile: 'known_good_frontier',
  });

  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.status.classification=NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS');
  assertEvidence(report, 'known_good_frontier_guard', 'STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY');
  assert(report.contradictions.some(item => item.title === 'STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY'));
});

test('known good frontier profile promotes raw counts above status-only', async () => {
  const report = await scanProject({
    projectRoot: knownGoodFrontierRawProofFixture,
    profile: 'known_good_frontier',
  });

  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.raw_metric.real_buffer_commits=2');
  assertEvidence(report, 'known_good_frontier', 'known_good_frontier.raw_metric.vkGetMemoryFdKHR_failures=0');
  assertNoEvidence(report, ['known_good_frontier_guard'], 'STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY');
  assert(!report.contradictions.some(item => item.title === 'STATUS_PROOF_REQUIRES_RAW_LOG_RECOVERY'));
});

test('child libpath profile does not mix Nebula runtime evidence across lanes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-nebula-split-lanes-'));
  await mkdir(join(root, 'a0'), { recursive: true });
  await mkdir(join(root, 'b0'), { recursive: true });
  await writeFile(join(root, 'a0', 'result.txt'), [
    'GAMESCOPE_LIBPATH=/data/user/0/io.droidspaces.nebula.waylandie/files/imagefs/usr/local/lib:/data/user/0/io.droidspaces.nebula.waylandie/files/imagefs/usr/lib:/data/user/0/io.droidspaces.nebula.waylandie/files/sidecars/xwayland-gamescope-13-promoted-argb-export-nofd-r6-39773bc9/usr/local/lib:/system/lib64',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'b0', 'result.txt'), [
    'MESA_LOADER_DRIVER_OVERRIDE=kgsl',
    'GALLIUM_DRIVER=kgsl',
    'FD_FORCE_KGSL=1',
    'LIBGL_ALWAYS_SOFTWARE=UNSET',
    'FINAL_XWAYLAND_RUNNER_INVOKED=0',
    'SELECTED_VULKAN_DEVICE=NOT_FOUND',
    'VKGETMEMORYFD_FIRST_LINE=NOT_FOUND',
    'GAMESCOPE_EXIT=135',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'child_libpath',
  });

  assertNoEvidence(report, ['nebula_runtime_regression'], 'nebula_a1_multi_variable_regression');
  assert(!report.contradictions.some(item => item.category === 'nebula_runtime_regression'));
});

test('child libpath profile scopes Nebula runtime layers before contradiction grouping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-nebula-runtime-scope-'));
  await mkdir(join(root, 'extract'), { recursive: true });
  await writeFile(join(root, 'extract', 'result.txt'), [
    'MESA_LOADER_DRIVER_OVERRIDE=kgsl',
    'LIBGL_ALWAYS_SOFTWARE=UNSET',
    'ENVIRONMENT_BEGIN',
    'MESA_LOADER_DRIVER_OVERRIDE=kgsl',
    'LIBGL_ALWAYS_SOFTWARE=UNSET',
    'VK_ICD_FILENAMES=/data/user/0/io.droidspaces.nebula.waylandie/files/imagefs/usr/local/etc/vulkan/icd.d/freedreno_icd.json',
    'ENVIRONMENT_END',
    'CHILD_ENV_BEGIN',
    'MESA_LOADER_DRIVER_OVERRIDE=swrast',
    'LIBGL_ALWAYS_SOFTWARE=1',
    'CHILD_ENV_END',
    'SNAP_snapshots_glxinfo_B_environ_txt_BEGIN',
    'MESA_LOADER_DRIVER_OVERRIDE=swrast',
    'LIBGL_ALWAYS_SOFTWARE=1',
    'SNAP_snapshots_glxinfo_B_environ_txt_END',
    'XWAYLAND_RUNNER_LOG_BEGIN',
    'DATE=20260627-085235',
    'ARGV_1=-listen',
    'WAYLAND_SOCKET=21',
    'XWAYLAND_RUNNER_LOG_END',
    'XWAYLAND_RUNNER_LOG_BEGIN',
    'DATE=20260627-085236',
    'ARGV_1=-wm',
    'WAYLAND_SOCKET=24',
    'XWAYLAND_RUNNER_LOG_END',
    'SNAP_child_high-address.txt_BEGIN',
    'HIGHEST_MAP_END=0x7fe1831000',
    'MAPPING_EXCEEDS_39BIT_ASSUMPTION=no',
    'SNAP_child_high-address.txt_END',
    'SNAP_xwayland_high-address.txt_BEGIN',
    'HIGHEST_MAP_END=0x7fc0010000',
    'MAPPING_EXCEEDS_39BIT_ASSUMPTION=unknown',
    'SNAP_xwayland_high-address.txt_END',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'extract', 'environment.txt'), [
    'MESA_LOADER_DRIVER_OVERRIDE=kgsl',
    'LIBGL_ALWAYS_SOFTWARE=UNSET',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'extract', 'child-env.txt'), [
    'MESA_LOADER_DRIVER_OVERRIDE=swrast',
    'LIBGL_ALWAYS_SOFTWARE=1',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'child_libpath',
  });

  assertEvidence(report, 'mobile_linux_runtime', 'nebula.gamescope.MESA_LOADER_DRIVER_OVERRIDE=kgsl');
  assertEvidence(report, 'mobile_linux_runtime', 'nebula.child.MESA_LOADER_DRIVER_OVERRIDE=swrast');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for MESA_LOADER_DRIVER_OVERRIDE')),
    'Gamescope KGSL and child swrast are different runtime layers, not conflicting definitions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for LIBGL_ALWAYS_SOFTWARE')),
    'Gamescope LIBGL setting and child software GL setting should stay layer-scoped'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for DATE')
      || item.title.includes('Conflicting definitions for ARGV_1')
      || item.title.includes('Conflicting definitions for WAYLAND_SOCKET')
      || item.title.includes('Conflicting definitions for HIGHEST_MAP_END')
      || item.title.includes('Conflicting definitions for MAPPING_EXCEEDS_39BIT_ASSUMPTION')),
    'volatile runtime capture fields should not create patch candidates'
  );
});

test('pcgamingwiki runtime profile detects cross-platform game fix taxonomy', async () => {
  const report = await scanProject({
    projectRoot: pcgwFixture,
    profile: 'pcgamingwiki_runtime',
  });

  assert.equal(report.scan.profile, 'pcgamingwiki_runtime');
  assertEvidence(report, 'pcgw_game_data_paths', 'ConfigPath=%USERPROFILE%');
  assertEvidence(report, 'pcgw_availability_drm', 'SteamAppId=311210');
  assertEvidence(report, 'pcgw_video_display_fixes', 'ultrawide');
  assertEvidence(report, 'pcgw_input_audio_network', 'ControllerSupport=XInput');
  assertEvidence(report, 'pcgw_api_middleware', 'Middleware=Steamworks');
  assertEvidence(report, 'pcgw_linux_wine_proton', 'ProtonVersion=GE-Proton');
  assertEvidence(report, 'pcgw_issue_fix_notes', 'Issues fixed');
  assert(report.commands_to_run.some(command => command.includes('Configuration file')));
  assert(report.commands_to_run.some(command => command.includes('Wine')));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('windows system profile detects services, drivers, registry, PE, and MSBuild evidence', async () => {
  const report = await scanProject({
    projectRoot: pcgwFixture,
    profile: 'windows_system',
  });

  assert.equal(report.scan.profile, 'windows_system');
  assertEvidence(report, 'windows_service_surface', 'CurrentControlSet\\Services');
  assertEvidence(report, 'windows_driver_surface', 'AddService=ReversaDriver');
  assertEvidence(report, 'windows_registry_assumptions', 'HKEY_LOCAL_MACHINE');
  assertEvidence(report, 'windows_msbuild_visualstudio', 'PlatformToolset');
  assertEvidence(report, 'windows_pe_metadata', 'requestedExecutionLevel');
  assertEvidence(report, 'windows_installer_layout', 'Program Files');
  assert(report.commands_to_run.some(command => command.includes('PlatformToolset')));
  assert(report.commands_to_run.some(command => command.includes('CurrentControlSet')));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('widescreen framegen profile separates ultrawide and Windows/Linux frame generation evidence', async () => {
  const report = await scanProject({
    projectRoot: pcgwFixture,
    profile: 'widescreen_framegen_runtime',
  });

  assert.equal(report.scan.profile, 'widescreen_framegen_runtime');
  assertEvidence(report, 'widescreen_fix_surface', 'FlawlessWidescreen=enabled');
  assertEvidence(report, 'frame_generation_pipeline', 'FrameGeneration=OptiScaler');
  assertEvidence(report, 'framegen_windows_runtime', 'WindowsFramegen=nvngx_dlssg.dll');
  assertEvidence(report, 'framegen_linux_runtime', 'LinuxFramegen=lsfg-vk');
  assert(report.commands_to_run.some(command => command.includes('Flawless Widescreen')));
  assert(report.commands_to_run.some(command => command.includes('lsfg-vk')));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('game exe patch profile detects Linux-focused executable patch evidence and safety boundaries', async () => {
  const report = await scanProject({
    projectRoot: pcgwFixture,
    profile: 'game_exe_patch_runtime',
  });

  assert.equal(report.scan.profile, 'game_exe_patch_runtime');
  assertEvidence(report, 'exe_patch_surface', 'TargetExe=BlackOps3.exe');
  assertEvidence(report, 'exe_version_hash_guard', 'SHA256Before=aaaaaaaa');
  assertEvidence(report, 'exe_rva_signature_mapping', 'OriginalBytes=75 0A');
  assertEvidence(report, 'exe_disassembly_symbol_notes', 'Disassembler=Ghidra');
  assertEvidence(report, 'exe_patch_backup_rollback', 'RollbackPlan=verify original bytes');
  assertEvidence(report, 'exe_patch_linux_compat', 'ProtonPatchTarget=compatdata/311210');
  assertEvidence(report, 'exe_patch_safety_boundary', 'no DRM bypass');
  assert(report.commands_to_run.some(command => command.includes('SHA256Before')));
  assert(report.commands_to_run.some(command => command.includes('LinuxPatchTarget')));
  assert(report.commands_to_run.some(command => command.includes('DRM')));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('agentic toolchain profile detects skills, hooks, memory, providers, and import risk', async () => {
  const report = await scanProject({
    projectRoot: agenticFixture,
    profile: 'agentic_toolchain',
  });

  assert.equal(report.scan.profile, 'agentic_toolchain');
  assertEvidence(report, 'agent_instruction_surface', 'agent_instruction_file:AGENTS.md');
  assertEvidence(report, 'agent_skill_contracts', 'skill_contract_file:.claude/skills/reversa-audit/SKILL.md');
  assertEvidence(report, 'hook_lifecycle_policy', 'hook_policy_file:.claude/hooks/hooks.json');
  assertEvidence(report, 'permission_safety_policy', 'settings_policy_file:.claude/settings.json');
  assertEvidence(report, 'memory_context_injection', 'MEMORY_ROOT=.reversa/memory');
  assertEvidence(report, 'provider_routing_surface', 'ANTHROPIC_API_KEY=example-redacted');
  assertEvidence(report, 'subagent_orchestration', 'subagent_orchestration:Subagent workers');
  assertEvidence(report, 'worktree_isolation', 'worktree_isolation:Worktree task isolation');
  assertEvidence(report, 'mcp_plugin_surface', 'MCP_SERVER=reversa-local');
  assertEvidence(report, 'proprietary_source_risk', 'proprietary_source_risk:The package includes cli.js.map');
  assertEvidence(report, 'attribution_license_surface', 'attribution_license_surface:Patterns adapted from MIT License');

  assert(report.commands_to_run.some(command => command.includes('SKILL.md')));
  assert(report.commands_to_run.some(command => command.includes('sourcemap')));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('agentic gateway profile detects provider, launcher, protocol, smoke, and secret surfaces', async () => {
  const report = await scanProject({
    projectRoot: agenticGatewayFixture,
    profile: 'agentic_gateway',
  });

  assert.equal(report.scan.profile, 'agentic_gateway');
  assertEvidence(report, 'provider_catalog_surface', 'ProviderDescriptor');
  assertEvidence(report, 'model_routing_surface', 'ModelRouter');
  assertEvidence(report, 'protocol_adapter_surface', '/v1/responses');
  assertEvidence(report, 'client_launcher_surface', 'FCC_CODEX_API_KEY');
  assertEvidence(report, 'admin_config_surface', 'Admin UI');
  assertEvidence(report, 'smoke_coverage_surface', 'FEATURE_INVENTORY');
  assertEvidence(report, 'messaging_bridge_surface', 'MESSAGING_PLATFORM = "discord"');
  assertEvidence(report, 'secret_redaction_surface', 'TELEGRAM_BOT_TOKEN=example-redacted');
  assertEvidence(report, 'local_code_assignments', 'input_tokens=100');
  assertEvidence(report, 'local_code_assignments', 'token_counter=count only');
  assertNoEvidence(report, ['secret_redaction_surface'], 'input_tokens=100');
  assertNoEvidence(report, ['secret_redaction_surface'], 'token_counter=count only');
  assert(
    !report.contradictions.some(item => item.title.includes('credential_env')),
    'provider catalog credential_env entries should be per-provider fields, not global conflicts'
  );
  assert(
    report.commands_to_run.some(command => command.includes('ProviderDescriptor')),
    'gateway profile should include provider catalog validation commands'
  );

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('semantic policy profile emits normalized claims and contradictions', async () => {
  const report = await scanProject({
    projectRoot: semanticPolicyFixture,
    profile: 'semantic_policy',
  });

  assert.equal(report.scan.profile, 'semantic_policy');
  assertEvidence(report, 'read_only', 'semantic_policy.read_only.workspace=read_only');
  assertEvidence(report, 'write_allowed', 'semantic_policy.write_allowed.workspace=writes_allowed');
  assertEvidence(report, 'write_forbidden', 'semantic_policy.write_forbidden.workspace=writes_forbidden');
  assertEvidence(report, 'approval_required', 'semantic_policy.approval_required.approval=required');
  assertEvidence(report, 'approval_bypass', 'semantic_policy.approval_bypass.approval=bypassed');
  assertEvidence(report, 'device_action_forbidden', 'semantic_policy.device_action_forbidden.device=device_actions_forbidden');
  assertEvidence(report, 'device_action_allowed', 'semantic_policy.device_action_allowed.device=device_actions_allowed');
  assertEvidence(report, 'network_forbidden', 'semantic_policy.network_forbidden.network=network_forbidden');
  assertEvidence(report, 'network_allowed', 'semantic_policy.network_allowed.network=network_allowed');
  assertEvidence(report, 'proprietary_reference_only', 'semantic_policy.proprietary_reference_only.proprietary_source=reference_only');
  assertEvidence(report, 'source_authority', 'semantic_policy.source_authority.source=authoritative_or_vendored');
  assertEvidence(report, 'memory_reference_only', 'semantic_policy.memory_reference_only.memory=reference_only');
  assertEvidence(report, 'memory_authoritative', 'semantic_policy.memory_authoritative.memory=authoritative');
  assertEvidence(report, 'sandbox_required', 'semantic_policy.sandbox_required.sandbox=required');
  assertEvidence(report, 'sandbox_bypass', 'semantic_policy.sandbox_bypass.sandbox=bypassed');
  assertEvidence(report, 'attribution_required', 'semantic_policy.attribution_required.attribution=required');
  assertEvidence(report, 'attribution_missing', 'semantic_policy.attribution_missing.attribution=missing');
  assertEvidence(report, 'stale_agent', 'semantic_policy.stale_agent.agent_lifecycle=stale_or_cleanup_required');
  assertEvidence(report, 'active_agent', 'semantic_policy.active_agent.agent_lifecycle=active_or_retained');

  assert(report.contradictions.some(item => item.title.includes('Read-only policy conflicts')));
  assert(report.contradictions.some(item => item.title.includes('Approval-required policy conflicts')));
  assert(report.contradictions.some(item => item.title.includes('Device-action ban conflicts')));
  assert(report.contradictions.some(item => item.title.includes('Network ban conflicts')));
  assert(report.contradictions.some(item => item.title.includes('Reference-only or do-not-copy policy conflicts')));
  assert(report.contradictions.some(item => item.title.includes('Memory-reference-only policy conflicts')));
  assert(report.contradictions.some(item => item.title.includes('Stale-agent cleanup policy conflicts')));
  assert(report.contradictions.every(item => item.category !== 'semantic_policy_contradiction' || ['HIGH', 'MEDIUM'].includes(item.severity)));

  assert(
    report.evidence.some(item => item.category === 'read_only' && item.evidence_kind === 'fixture'),
    'semantic evidence should carry evidence_kind metadata'
  );
  assertNoExtractedText(report, 'fenced-example.git');
  assertNoExtractedText(report, 'fenced-example.apk');
  assertNoExtractedText(report, 'bypassExample');

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('semantic policy profile skips generated root artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-semantic-generated-'));
  await writeFile(join(root, 'report.json'), '{"generated":true,"text":"git clone https://example.invalid/generated.git"}', 'utf8');
  await writeFile(join(root, 'evidence.jsonl'), '{"text":"adb install generated.apk"}\n', 'utf8');
  await writeFile(join(root, 'summary.md'), 'No network. git clone https://example.invalid/generated-summary.git', 'utf8');
  await writeFile(join(root, 'AGENTS.md'), 'No network access is allowed for this pass.', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assert(report.tree_inventory.skipped_files.some(item => item.path === 'report.json' && item.reason === 'generated_scan_artifact'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'evidence.jsonl' && item.reason === 'generated_scan_artifact'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'summary.md' && item.reason === 'generated_scan_artifact'));
  assertNoExtractedText(report, 'generated.git');
  assertNoExtractedText(report, 'generated.apk');
  assertNoExtractedText(report, 'generated-summary.git');

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('semantic policy profile ignores documentation examples without hiding active policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-semantic-examples-'));
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), [
    'Ask for approval before destructive commands.',
    'No phone actions. No adb install or reboot.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'docs', 'examples.md'), [
    'The phrase "ask before destructive" conflicts with "skip approvals".',
    'This profile flags import boundaries such as `NOASSERTION`, restored sourcemap source, and missing attribution lanes.',
    'A past script sends `adb reboot`, but this is historical evidence, not a current instruction.',
    'The wizard does not edit source files, commit, push, reboot, flash, or install modules.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'approval_required', 'semantic_policy.approval_required.approval=required');
  assertEvidence(report, 'device_action_forbidden', 'semantic_policy.device_action_forbidden.device=device_actions_forbidden');
  assertNoEvidence(report, ['approval_bypass'], 'semantic_policy.approval_bypass.approval=bypassed');
  assertNoEvidence(report, ['device_action_allowed'], 'semantic_policy.device_action_allowed.device=device_actions_allowed');
  assertNoEvidence(report, ['source_authority'], 'semantic_policy.source_authority.source=authoritative_or_vendored');
  assertNoEvidence(report, ['attribution_missing'], 'semantic_policy.attribution_missing.attribution=missing');
  assertNoEvidence(report, ['source_patch_allowed'], 'semantic_policy.source_patch_allowed.source=patch_allowed');
  assert(!report.contradictions.some(item => item.category === 'semantic_policy_contradiction'));
});

test('scanner downgrades local code assignments so they do not create contradictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-local-assignments-'));
  await writeFile(join(root, 'script.py'), [
    'events = []',
    'current = None',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'other.js'), [
    'events = {}',
    'current = null',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'config.env'), 'MODEL=example\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertEvidence(report, 'local_code_assignments', 'events=[]');
  assertEvidence(report, 'local_code_assignments', 'current=None');
  assertEvidence(report, 'provider_routing_surface', 'MODEL=example');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for events')),
    'local code variables should not create definition contradictions'
  );
});

test('scanner downgrades lowercase code assignments even when keys look like provider/plugin settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-template-code-'));
  const templateDir = join(root, 'templates');
  await mkdir(templateDir);
  await writeFile(join(templateDir, 'effect.py'), [
    'model = "slack"',
    'provider = "local"',
    'plugin = "gif-maker"',
    'frame_width = 512',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'generic_source_tree',
  });

  assertEvidence(report, 'local_code_assignments', 'model=slack');
  assertEvidence(report, 'local_code_assignments', 'provider=local');
  assertEvidence(report, 'local_code_assignments', 'plugin=gif-maker');
  assertEvidence(report, 'local_code_assignments', 'frame_width=512');
  assertNoEvidence(report, ['provider_routing_surface'], 'model=slack');
  assertNoEvidence(report, ['mcp_plugin_surface'], 'plugin=gif-maker');
});

test('scanner treats code constants and object fields as local implementation state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-code-constants-'));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'config', 'launchers.py'), [
    '_DISPLAY_NAME = "Claude Code"',
    '_DEFAULT_BINARY = "claude"',
    '__all__ = ["Settings"]',
    'self._local.active = True',
    'provider_id="nvidia_nim",',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'config', 'other.py'), [
    '_DISPLAY_NAME = "Codex CLI"',
    '_DEFAULT_BINARY = "codex"',
    '__all__ = ("SUPPORTED_PROVIDER_IDS",)',
    'self._local.active = False',
    'provider_id="open_router",',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'config.env'), [
    '_DEFAULT_BINARY=claude',
    '_DEFAULT_BINARY=codex',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertEvidence(report, 'local_code_assignments', '_DISPLAY_NAME=Claude Code');
  assertEvidence(report, 'local_code_assignments', 'provider_id=nvidia_nim');
  assert(report.contradictions.some(item => item.title.includes('Conflicting definitions for _DEFAULT_BINARY')));
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for _DISPLAY_NAME')),
    'code constants should not create durable definition contradictions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for provider_id')),
    'object fields in code catalogs should not create durable definition contradictions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for self._local.active')),
    'object instance fields should not create durable definition contradictions'
  );
});

test('scanner scopes sectioned config assignments before contradiction grouping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-sectioned-config-'));
  await writeFile(join(root, 'config.toml'), [
    '[agents]',
    'installed = [',
    '  "reversa-scout"',
    ']',
    '',
    '[engines]',
    'installed = []',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
  });

  assertEvidence(report, 'build_variables', 'agents.installed=[');
  assertEvidence(report, 'build_variables', 'engines.installed=[]');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for installed')),
    'same lowercase key in separate config sections should not conflict globally'
  );
});

test('scanner keeps append assignments out of contradiction grouping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-append-assignments-'));
  await writeFile(join(root, 'BoardConfig.mk'), [
    'BOARD_MKBOOTIMG_ARGS += --header_version $(BOARD_BOOT_HEADER_VERSION)',
    'BOARD_MKBOOTIMG_ARGS += --pagesize $(BOARD_KERNEL_PAGESIZE)',
    'TARGET_RECOVERY_DEVICE_MODULES += debuggerd',
    'TARGET_RECOVERY_DEVICE_MODULES += strace',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'android_recovery',
  });

  assertEvidence(report, 'kernel_header_assumptions', 'BOARD_MKBOOTIMG_ARGS=--header_version $(BOARD_BOOT_HEADER_VERSION)');
  assertEvidence(report, 'build_variables', 'TARGET_RECOVERY_DEVICE_MODULES=debuggerd');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for BOARD_MKBOOTIMG_ARGS')),
    'append-only build lists should not create mutually-exclusive definition contradictions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for TARGET_RECOVERY_DEVICE_MODULES')),
    'append-only recovery module lists should not create mutually-exclusive definition contradictions'
  );
});

test('scanner keeps display sockets and Qt platform out of soc identity grouping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-display-platform-'));
  await writeFile(join(root, 'README.md'), [
    'ANLAND_SOCKET=/run/display.sock',
    'QT_QPA_PLATFORM=wayland',
    'PLATFORM_VERSION := 14',
    'TARGET_BOARD_PLATFORM := sm8850',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'linux_container',
  });

  assertEvidence(report, 'display_touch_framebuffer_config', 'ANLAND_SOCKET=/run/display.sock');
  assertEvidence(report, 'display_touch_framebuffer_config', 'QT_QPA_PLATFORM=wayland');
  assertNoEvidence(report, ['soc_platform_identity'], 'PLATFORM_VERSION=14');
  assert(
    !report.contradictions.some(item => item.title.includes('soc_platform')
      && item.conflicting_claims.some(claim => /SOCKET|QT_QPA_PLATFORM|PLATFORM_VERSION/.test(claim.claim))),
    'display sockets, Qt UI backend, and Android platform version should not be canonical SoC claims'
  );
});

test('scanner treats lowercase assignments in extensionless bin scripts as local state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-bin-script-'));
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin', 'nebula-core'), [
    '#!/system/bin/sh',
    'proton=$1',
    'proton=$2',
    'wl_display_ready=1',
    'wl_display_ready=0',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'linux_container',
  });

  assertEvidence(report, 'local_code_assignments', 'proton=$1');
  assertEvidence(report, 'local_code_assignments', 'wl_display_ready=1');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for proton')),
    'function parameters in extensionless scripts should not create repo-level conflicts'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for wl_display_ready')),
    'branch-local readiness state in extensionless scripts should not create repo-level conflicts'
  );
});

test('orangefox sync tool profile treats patch targets as external checkout paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-orangefox-sync-'));
  await mkdir(join(root, 'patches'));
  await writeFile(join(root, 'orangefox_sync.sh'), [
    '#!/usr/bin/env bash',
    'TWRP_BRANCH=fox_14.1',
    'echo "-- Patching vendor/twrp ..."',
    'mkfile="vendor/twrp/config/BoardConfigSoong.mk"',
    'echo "-- Patching system/vold ..."',
    'depends="external/guava external/gflags hardware/google/interfaces hardware/google/pixel"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'patches', 'patch-vold-fox_14.1.diff'), 'diff --git a/system/vold/Foo.cpp b/system/vold/Foo.cpp\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'orangefox_sync_tool',
  });

  assert.equal(report.scan.profile, 'orangefox_sync_tool');
  assertNoEvidence(report, ['missing_files'], 'missing_expected_pattern:/(^|\\/)BoardConfig.*\\.mk$/i');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/twrp');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/twrp/config/BoardConfigSoong.mk');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/vold');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/google/interfaces');
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

test('scan --profiles accepts a profile id and positional project root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-scan-profiles-'));
  const projectRoot = join(root, 'project');
  const singleOut = join(root, 'single');
  const multiOut = join(root, 'multi');
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, 'AGENTS.md'), [
    '# Agent Policy',
    'Ask before destructive commands.',
    'Do not reboot, flash, delete, or install modules without approval.',
  ].join('\n'), 'utf8');

  const single = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'scan',
    '--profiles',
    'semantic_policy',
    projectRoot,
    '--out',
    singleOut,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(single.status, 0, single.stderr || single.stdout);
  assert(existsSync(join(singleOut, 'report.json')));
  const singleReport = JSON.parse(await readFile(join(singleOut, 'report.json'), 'utf8'));
  assert.equal(singleReport.scan.profile, 'semantic_policy');

  const multi = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'scan',
    '--profiles',
    'semantic_policy,agentic_gateway',
    projectRoot,
    '--out',
    multiOut,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(multi.status, 0, multi.stderr || multi.stdout);
  assert(existsSync(join(multiOut, 'semantic_policy', 'report.json')));
  assert(existsSync(join(multiOut, 'agentic_gateway', 'report.json')));
});

test('patterns command prints and writes Claude/Codex template', async () => {
  const list = spawnSync(process.execPath, [join(repoRoot, 'bin/reversa.js'), 'patterns', '--list'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  assert.match(list.stdout, /claude-codex/);

  const print = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'patterns',
    '--pattern',
    'claude-codex',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(print.status, 0, print.stderr || print.stdout);
  assert.match(print.stdout, /Claude\/Codex\/Reversa Patterns/);

  const outDir = await mkdtemp(join(tmpdir(), 'reversa-pattern-test-'));
  const outFile = join(outDir, 'patterns.md');
  const write = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'patterns',
    '--pattern',
    'claude-codex',
    '--out',
    outFile,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(write.status, 0, write.stderr || write.stdout);

  const contents = await readFile(outFile, 'utf8');
  assert.match(contents, /Claude\/Codex\/Reversa Patterns/);
});

test('writer installs Claude/Codex support patterns as managed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-support-files-'));
  const writer = new Writer(root);
  const claude = ENGINES.find(engine => engine.id === 'claude-code');
  const codex = ENGINES.find(engine => engine.id === 'codex');
  assert(claude);
  assert(codex);

  const seen = new Set();
  await writer.installSupportFiles(claude, { seen });
  await writer.installSupportFiles(codex, { seen });

  const relPath = '.reversa/patterns/CLAUDE_CODEX_REVERSA_PATTERNS.md';
  const installedPath = join(root, relPath);
  assert(existsSync(installedPath));
  assert(writer.manifestPaths.includes(relPath));
  assert(writer.createdFiles.includes(relPath));

  const contents = await readFile(installedPath, 'utf8');
  assert.match(contents, /Claude\/Codex\/Reversa Patterns/);

  await writeFile(installedPath, 'user edit\n', 'utf8');
  const updateWriter = new Writer(root);
  await updateWriter.installSupportFiles(claude, {
    force: true,
    modifiedSet: new Set([relPath]),
    manifest: { [relPath]: 'old-hash' },
  });
  assert.equal(await readFile(installedPath, 'utf8'), 'user edit\n');
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
  assert.match(html, /Reversa-Matrix Mission Control/);
  assert.match(html, /RM11Pro first/);
  assert.match(html, /Triage/);
  assert.match(html, /Scan Lanes/);
  assert.match(html, /windows_system/);
  assert.match(html, /pcgamingwiki_runtime/);
  assert.match(html, /widescreen_framegen_runtime/);
  assert.match(html, /game_exe_patch_runtime/);
  assert.match(html, /agentic_gateway/);
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
    '# Reversa Scan Summary',
    '- Profile: `linux_container`',
    '- Findings: 42',
    '- Contradictions: 3',
    '- Patch candidates: 2',
    '- Highest severity: HIGH',
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

  const phoneTargets = await readFile(join(memoryRoot, 'phone_targets.yaml'), 'utf8');
  assert.match(phoneTargets, /rm11pro_nx809j/);
  assert.match(phoneTargets, /NX809J/);
  assert.match(phoneTargets, /912607710184/);
  assert.match(phoneTargets, /\/mnt\/c\/platform-tools\/adb\.exe/);
  assert.match(phoneTargets, /_adb-tls-connect\._tcp/);
  assert.match(phoneTargets, /192\.168\.7\.230:37223/);
  assert.match(phoneTargets, /192\.168\.7\.230:33899/);
  assert.match(phoneTargets, /Refreshing is refreshing/);
  assert.match(phoneTargets, /live mDNS discovery, live connect, and fresh PHONE\/ADB_SERIAL evidence/);
  assert.match(phoneTargets, /Do not reuse PHONE=<ip:old-port>/);
  assert.match(phoneTargets, /Do not run reboot tests unless the human explicitly requests a reboot/);

  const workspaceFacts = await readFile(join(memoryRoot, 'workspace_facts.yaml'), 'utf8');
  assert.match(workspaceFacts, /\/home\/richtofen\/\.android\/repositories/);
  assert.match(workspaceFacts, /\/mnt\/e/);
  assert.match(workspaceFacts, /\/mnt\/e\/Android\/RM-11-Pro/);
  assert.match(workspaceFacts, /\/mnt\/e\/WSL\/Ubuntu\/ext4\.vhdx/);
  assert.match(workspaceFacts, /E:\\\\Windows-side storage/);
  assert.match(workspaceFacts, /\/home\/richtofen\/\.android\/sdk\/ndk\/29\.0\.13113456/);
  assert.match(workspaceFacts, /\/home\/richtofen\/\.local\/bin\/sdkmanager/);
  assert.match(workspaceFacts, /shellcheck 0\.11\.0/);
  assert.match(workspaceFacts, /Windows PowerShell 7\.6\.3/);
  assert.match(workspaceFacts, /rm11pro-canoe-dock/);
  assert.match(workspaceFacts, /Rm11Pro-canoe-dock/);
  assert.match(workspaceFacts, /WayLandIE-main/);
  assert.match(workspaceFacts, /Do not run broad git clean -xdf/);
  assert.match(workspaceFacts, /8260a521b2072a835875bd942e99866246a11a9fae0490b268aa4d5a64c28aa0/);

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
  assert.match(report, /scan_profile:linux_container/);
  assert.match(report, /scan_contradictions:3/);
  assert.match(report, /scan_patch_candidates:2/);

  const hashes = await readFile(join(runDir, 'artifacts/evidence_files.sha256'), 'utf8');
  assert.match(hashes, /PHONE_REVERSA_CONFLICT_SCAN\.md/);
  assert.match(hashes, /runtime\.txt/);

  const replayDir = join(root, 'replay');
  const replay = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'replay',
    '--run',
    runDir,
    '--memory-root',
    memoryRoot,
    '--out',
    replayDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(replay.status, 0, replay.stderr || replay.stdout);

  for (const relPath of [
    'prompt.md',
    'PHONE_REVERSA_AGENT_REPORT.md',
    'artifacts/evidence_manifest.json',
    'artifacts/evidence_files.sha256',
    'artifacts/replay_source.json',
  ]) {
    assert(existsSync(join(replayDir, relPath)), `${relPath} should exist in replay`);
  }

  const replayReport = await readFile(join(replayDir, 'PHONE_REVERSA_AGENT_REPORT.md'), 'utf8');
  assert.match(replayReport, /dual_freedreno_icd_candidates/);
  assert.match(replayReport, /a1_b0_lane_mixing/);

  const replaySource = JSON.parse(await readFile(join(replayDir, 'artifacts/replay_source.json'), 'utf8'));
  assert.equal(replaySource.source_run, runDir);
  assert.equal(replaySource.evidence_paths_loaded, 2);
  assert.equal(replaySource.verification.mismatch_count, 0);
  assert.equal(replaySource.verification.checked_count, 2);

  await writeFile(evidenceFile, 'changed after source run\n', 'utf8');
  const staleReplay = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'replay',
    '--run',
    runDir,
    '--memory-root',
    memoryRoot,
    '--out',
    join(root, 'stale-replay'),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(staleReplay.status, 0);
  assert.match(staleReplay.stderr, /Replay evidence verification failed/);
});

test('local agent eval scores advisory model JSON without mutating scanner truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-agent-eval-'));
  const outDir = join(root, 'eval');
  const evidenceFile = join(root, 'nebula-result.md');
  await writeFile(evidenceFile, [
    'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS',
    'active_blocker=NONE_WAYLAND_DISPLAY',
    'vkGetMemoryFdKHR failures=0',
    'real_buffer_commits=2',
  ].join('\n'), 'utf8');

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body);
      assert.equal(payload.model, 'fake-reversa-5090');
      const prompt = payload.messages.map(item => item.content).join('\n');
      const content = prompt.includes('DroidSpaces/Nebula container troubleshooting')
        ? {
            command_plan_ready: true,
            domain: 'droidspaces_container',
            execution_policy: 'propose_only_require_approval',
            mutating_commands_allowed: false,
            validation_commands_count: 4,
            first_command: 'sh /data/adb/modules/nebula_core/bin/nebula-core display lanes --json',
            next_gate: 'droidspaces_container_method_selection',
          }
        : prompt.includes('agent policy conflict')
        ? {
            contradiction_detected: true,
            safe_policy: 'ask_before_destructive',
            destructive_allowed_without_approval: false,
            patch_recommended: true,
          }
        : {
            classification: 'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS',
            active_blocker: 'NONE_WAYLAND_DISPLAY',
            real_buffer_pass: true,
            vk_get_memory_fd_failures: 0,
            real_buffer_commits: 2,
            next_gate: 'bounded_game_client_runtime_before_steam',
            patch_recommended: true,
          };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }));
    });
  });

  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const { port } = server.address();
    const run = await runNode([
      join(repoRoot, 'bin/reversa.js'),
      'agent',
      'eval',
      '--base-url',
      `http://127.0.0.1:${port}/v1`,
      '--model',
      'fake-reversa-5090',
      '--evidence-file',
      evidenceFile,
      '--out',
      outDir,
    ]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }

  const report = JSON.parse(await readFile(join(outDir, 'eval_report.json'), 'utf8'));
  assert.equal(report.command, 'agent eval');
  assert.equal(report.model, 'fake-reversa-5090');
  assert.equal(report.case_count, 3);
  assert.equal(report.passed, 3);
  assert.equal(report.failed, 0);
  assert.equal(report.advisory_only, true);
  assert.equal(report.deterministic_truth_preserved, true);
  assert(existsSync(join(outDir, 'responses', 'nebula_wayland_regression_guard.result.json')));
  assert(existsSync(join(outDir, 'responses', 'droidspaces_container_command_wizard_guard.result.json')));
  assert(existsSync(join(outDir, 'artifacts', 'evidence_manifest.json')));

  const markdown = await readFile(join(outDir, 'eval_report.md'), 'utf8');
  assert.match(markdown, /Reversa Local Model Eval/);
  assert.match(markdown, /nebula_wayland_regression_guard/);
  assert.match(markdown, /agent_policy_destructive_guard/);
  assert.match(markdown, /droidspaces_container_command_wizard_guard/);
  assert.match(markdown, /advisory only/i);
});

test('local agent command-plan writes safe DroidSpaces wizard artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-command-plan-'));
  const outDir = join(root, 'plan');
  const evidenceFile = join(root, 'display-lanes.json');
  await writeFile(evidenceFile, JSON.stringify({
    lanes: [
      { id: 'phone_app_bridge', status: 'wayland_display_pass', active_blocker: 'NONE_WAYLAND_DISPLAY' },
      { id: 'anland_surface', status: 'partial' },
    ],
  }), 'utf8');

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'command-plan',
    '--domain',
    'droidspaces-container',
    '--profile',
    'gaming',
    '--evidence-file',
    evidenceFile,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const plan = JSON.parse(await readFile(join(outDir, 'command_plan.json'), 'utf8'));
  assert.equal(plan.schema_version, 1);
  assert.equal(plan.tool, 'reversa');
  assert.equal(plan.command, 'agent command-plan');
  assert.equal(plan.domain, 'droidspaces-container');
  assert.equal(plan.profile, 'gaming');
  assert.equal(plan.execution_policy, 'propose_only_require_approval');
  assert.equal(plan.mutating_commands_allowed, false);
  assert.deepEqual(plan.disabled_actions, ['reboot', 'flash', 'delete', 'module_mutation', 'package_uninstall', 'partition_write']);
  assert.equal(plan.plan.next_gate, 'droidspaces_container_method_selection');
  assert(plan.plan.validation_commands.length >= 4);
  assert(plan.plan.candidate_actions.length >= 1);
  assert(plan.plan.validation_commands.every(item => item.execute === false));
  assert(plan.plan.validation_commands.every(item => item.read_only === true));
  assert(plan.plan.validation_commands.every(item => item.requires_approval === false));
  assert(plan.plan.validation_commands.every(item => item.expected_signal));
  assert(plan.plan.candidate_actions.every(item => item.execute === false));
  assert(plan.plan.candidate_actions.every(item => item.requires_approval === true));
  assert(plan.plan.candidate_actions.every(item => item.risk === 'requires_approval'));
  assert.equal(plan.plan.validation_commands[0].command, 'sh /data/adb/modules/nebula_core/bin/nebula-core display lanes --json');
  const allCommands = [
    ...plan.plan.validation_commands,
    ...plan.plan.candidate_actions,
  ].map(item => item.command).join('\n');
  assert.doesNotMatch(allCommands, /modules_update\/nebula_core\/bin\/nebula-core/);
  assert.doesNotMatch(allCommands, /\b(reboot|fastboot flash|rm -rf|pm uninstall)\b/);
  assert(existsSync(join(outDir, 'artifacts', 'evidence_manifest.json')));

  const markdown = await readFile(join(outDir, 'command_plan.md'), 'utf8');
  assert.match(markdown, /Reversa Command Plan/);
  assert.match(markdown, /DroidSpaces/);
  assert.match(markdown, /requires_approval/);
});

test('local agent command-plan keeps Nebula active module first across domains', async () => {
  const domains = [
    'droidspaces-container',
    'nebula-wayland',
    'gaming-performance',
    'battery-optimization',
    'stability',
  ];

  for (const domain of domains) {
    const root = await mkdtemp(join(tmpdir(), `reversa-command-plan-${domain}-`));
    const outDir = join(root, 'plan');
    const run = spawnSync(process.execPath, [
      join(repoRoot, 'bin/reversa.js'),
      'agent',
      'command-plan',
      '--domain',
      domain,
      '--out',
      outDir,
      '--no-network',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const plan = JSON.parse(await readFile(join(outDir, 'command_plan.json'), 'utf8'));
    const commands = [
      ...plan.plan.validation_commands,
      ...plan.plan.candidate_actions,
    ].map(item => item.command);

    assert(
      !commands.some(command => command.includes('/data/adb/modules_update/nebula_core/bin/nebula-core')),
      `${domain} should not invoke pending Nebula CLI by default`
    );

    for (const command of commands) {
      const activeIndex = command.indexOf('/data/adb/modules/nebula_core');
      const pendingIndex = command.indexOf('/data/adb/modules_update/nebula_core');
      if (activeIndex >= 0 && pendingIndex >= 0) {
        assert(
          activeIndex < pendingIndex,
          `${domain} should list active module before pending module in: ${command}`
        );
      }
    }
  }
});

test('local agent patch-wizard turns patch candidates into guarded review artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-patch-wizard-'));
  const projectRoot = join(root, 'project');
  const scanOut = join(root, 'scan');
  const handoffDir = join(scanOut, 'agent_handoff');
  const outDir = join(root, 'wizard');
  const targetFile = join(projectRoot, 'src', 'config.js');
  await mkdir(dirname(targetFile), { recursive: true });
  await mkdir(handoffDir, { recursive: true });
  await writeFile(targetFile, 'export const mode = "stale";\n', 'utf8');
  await writeFile(join(handoffDir, 'patch_candidates.json'), JSON.stringify([
    {
      id: 'PATCH_CONFIG_MODE',
      title: 'Normalize config mode',
      target_file: 'src/config.js',
      proposed_change: 'Change mode from stale to proven.',
      reason: 'Known-good evidence shows the current mode is stale.',
      evidence_ids: ['EV_CONFIG_MODE'],
      risk_level: 'LOW',
      rollback_plan: 'Restore src/config.js to the recorded SHA-256.',
      validation_commands: [
        'npm test',
        'find . -delete',
        'node -e "require(\\"fs\\").writeFileSync(\\"owned\\", \\"x\\")"',
        'python -c "open(\\"owned\\", \\"w\\").write(\\"x\\")"',
        'grep -R stale . > out.txt',
        'printf x | tee out.txt',
      ],
      expected_result: 'Tests pass and config mode reflects proven evidence.',
      failure_signs: ['unexpected files changed', 'npm test fails'],
      group: 'known_good_mismatch',
    },
  ], null, 2) + '\n', 'utf8');

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'patch-wizard',
    '--scan-out',
    scanOut,
    '--candidate',
    'PATCH_CONFIG_MODE',
    '--project-root',
    projectRoot,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const wizard = JSON.parse(await readFile(join(outDir, 'patch_plan.json'), 'utf8'));
  assert.equal(wizard.schema_version, 1);
  assert.equal(wizard.tool, 'reversa');
  assert.equal(wizard.command, 'agent patch-plan');
  assert.equal(wizard.execution_policy, 'plan_first_apply_requires_explicit_approval');
  assert.equal(wizard.mutating_commands_allowed, false);
  assert.equal(wizard.apply_allowed, false);
  assert.equal(wizard.patch_plan.source.type, 'scan_out');
  assert.equal(wizard.patch_plan.candidate.id, 'PATCH_CONFIG_MODE');
  assert.equal(wizard.patch_plan.candidate.target_file, 'src/config.js');
  assert.deepEqual(wizard.patch_plan.candidate.evidence_ids, ['EV_CONFIG_MODE']);
  assert.equal(wizard.patch_plan.patch_proposal.target_exists, true);
  assert.equal(wizard.patch_plan.patch_proposal.target_is_file, true);
  assert.match(wizard.patch_plan.patch_proposal.target_sha256_before, /^[a-f0-9]{64}$/);
  assert.equal(wizard.patch_plan.patch_proposal.diff_status, 'not_generated');
  assert.equal(wizard.patch_plan.guardrails.requires_human_review, true);
  assert.equal(wizard.patch_plan.guardrails.requires_clean_target_hash, true);
  assert.equal(wizard.patch_plan.verification_commands[0].execute, false);
  assert.equal(wizard.patch_plan.verification_commands[0].read_only, true);
  const verificationByCommand = new Map(wizard.patch_plan.verification_commands.map(item => [item.command, item]));
  assert.equal(verificationByCommand.get('npm test').risk, 'read_only');
  assert.equal(verificationByCommand.get('find . -delete').risk, 'requires_approval');
  assert.equal(verificationByCommand.get('node -e "require(\\"fs\\").writeFileSync(\\"owned\\", \\"x\\")"').risk, 'requires_approval');
  assert.equal(verificationByCommand.get('python -c "open(\\"owned\\", \\"w\\").write(\\"x\\")"').risk, 'requires_approval');
  assert.equal(verificationByCommand.get('grep -R stale . > out.txt').risk, 'requires_approval');
  assert.equal(verificationByCommand.get('printf x | tee out.txt').risk, 'requires_approval');
  assert(existsSync(join(outDir, 'artifacts', 'evidence_manifest.json')));
  assert(existsSync(join(outDir, 'artifacts', 'evidence_files.sha256')));

  const markdown = await readFile(join(outDir, 'patch_plan.md'), 'utf8');
  assert.match(markdown, /Reversa Patch Wizard/);
  assert.match(markdown, /PATCH_CONFIG_MODE/);
  assert.match(markdown, /SHA-256 before/);

  const outsideRoot = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'patch-plan',
    '--project-root',
    projectRoot,
    '--target-file',
    '../outside.js',
    '--proposed-change',
    'Do not allow traversal.',
    '--out',
    join(root, 'outside'),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(outsideRoot.status, 0);
  assert.match(outsideRoot.stderr, /outside project root/i);
});

test('local agent patch-plan help lists review-only diff options', async () => {
  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'patch-plan',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /--find-text/);
  assert.match(run.stdout, /--replace-text/);
  assert.match(run.stdout, /--out <path>/);
});

test('local agent patch-wizard drafts literal replacement diffs without applying them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-patch-diff-'));
  const projectRoot = join(root, 'project');
  const outDir = join(root, 'wizard');
  const targetFile = join(projectRoot, 'src', 'config.js');
  await mkdir(dirname(targetFile), { recursive: true });
  await writeFile(targetFile, 'export const mode = "stale";\n', 'utf8');

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'agent',
    'patch-wizard',
    '--project-root',
    projectRoot,
    '--target-file',
    'src/config.js',
    '--proposed-change',
    'Replace stale mode with proven mode.',
    '--find-text',
    'mode = "stale"',
    '--replace-text',
    'mode = "proven"',
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const wizard = JSON.parse(await readFile(join(outDir, 'patch_plan.json'), 'utf8'));
  assert.equal(wizard.patch_plan.patch_proposal.diff_status, 'generated');
  assert.equal(wizard.patch_plan.patch_proposal.draft_mode, 'literal_first_match');
  assert.equal(wizard.patch_plan.patch_proposal.replacement_count, 1);
  assert.match(wizard.patch_plan.patch_proposal.proposed_diff, /--- a\/src\/config\.js/);
  assert.match(wizard.patch_plan.patch_proposal.proposed_diff, /-export const mode = "stale";/);
  assert.match(wizard.patch_plan.patch_proposal.proposed_diff, /\+export const mode = "proven";/);
  assert(existsSync(join(outDir, 'patch.diff')));

  const patchText = await readFile(join(outDir, 'patch.diff'), 'utf8');
  assert.equal(patchText, wizard.patch_plan.patch_proposal.proposed_diff);

  const targetText = await readFile(targetFile, 'utf8');
  assert.equal(targetText, 'export const mode = "stale";\n');
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

  const mdns = await readFile(join(outDir, 'host/adb-mdns-services.txt'), 'utf8');
  assert.match(mdns, /_adb-tls-connect\._tcp/);

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

function assertNoEvidence(report, categories, claimIncludes) {
  assert(
    !report.evidence.some(item => categories.includes(item.category) && item.normalized_claim.includes(claimIncludes)),
    `expected no ${categories.join('/')} evidence including ${claimIncludes}`
  );
}

function assertNoExtractedText(report, textIncludes) {
  assert(
    !report.evidence.some(item => item.extracted_text.includes(textIncludes)),
    `expected no evidence extracted text including ${textIncludes}`
  );
}
