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
  await writeFile(join(root, 'docs', 'release-status.md'), [
    '# OrangeFox Recovery WIP',
    'This recovery lane is WIP only. Do not flash it as a usable recovery release.',
    '| GSI / ROM flow | WIP / reports |',
    '- Clear warning if WIP.',
  ].join('\n'), 'utf8');
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
  assert(!report.patch_candidates.some(item => item.target_file === 'docs/release-status.md'));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('agents/reviewer/references/')));
  assertNoExtractedText(report, "riskyLeftovers: ['TODO'");
  assertNoExtractedText(report, 'unresolved TODO marker');
  assertNoExtractedText(report, 'nested WIP repos');
  assertNoExtractedText(report, 'This recovery lane is WIP only');
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
  await mkdir(join(root, 'logs', '2026-06-28-run', 'BO3-Transformed', 'game_modding', 'agent_handoff'), { recursive: true });
  await writeFile(join(root, 'reversa_matrix_old', 'report.json'), '{"tool":"reversa"}\n', 'utf8');
  await writeFile(join(root, 'reversa_matrix_old', 'agent_handoff', 'evidence.jsonl'), 'MODEL=stale\n', 'utf8');
  await writeFile(join(root, 'reversa_scan_adapter', 'reversa_scan_core', 'live.env'), 'MODEL=adapter\n', 'utf8');
  await writeFile(join(root, 'reversa-archaeology-frontier', 'report.json'), '{"tool":"reversa"}\n', 'utf8');
  await writeFile(join(root, 'reversa-archaeology-frontier', 'summary.md'), 'MODEL=archaeology-loop\n', 'utf8');
  await writeFile(join(root, 'reversa-known-good-raw-proof', 'evidence.jsonl'), 'MODEL=raw-proof-loop\n', 'utf8');
  await writeFile(join(root, 'reversa-runtime', 'runtime.env'), 'MODEL=runtime\n', 'utf8');
  await writeFile(join(root, 'logs', '2026-06-28-run', 'BO3-Transformed', 'game_modding', 'report.json'), '{"tool":"reversa"}\n', 'utf8');
  await writeFile(join(root, 'logs', '2026-06-28-run', 'BO3-Transformed', 'game_modding', 'evidence.jsonl'), 'MODEL=nested-log-loop\n', 'utf8');
  await writeFile(join(root, 'logs', '2026-06-28-run', 'BO3-Transformed', 'game_modding', 'agent_handoff', 'summary.md'), 'MODEL=nested-handoff-loop\n', 'utf8');
  await writeFile(join(root, 'live.env'), 'MODEL=live\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'agentic_toolchain',
    includeIgnored: true,
  });

  assert(report.tree_inventory.skipped_files.some(item => item.path === 'reversa_matrix_old' && item.reason === 'generated_scan_output_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'reversa-archaeology-frontier' && item.reason === 'generated_scan_output_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'reversa-known-good-raw-proof' && item.reason === 'generated_scan_output_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'logs/2026-06-28-run/BO3-Transformed/game_modding' && item.reason === 'generated_scan_output_directory'));
  assert(!report.tree_inventory.skipped_files.some(item => item.path === 'reversa_scan_adapter' && item.reason === 'generated_scan_output_directory'));
  assertEvidence(report, 'provider_routing_surface', 'MODEL=live');
  assertEvidence(report, 'provider_routing_surface', 'MODEL=adapter');
  assertEvidence(report, 'provider_routing_surface', 'MODEL=runtime');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=stale');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=archaeology-loop');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=raw-proof-loop');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=nested-log-loop');
  assertNoEvidence(report, ['provider_routing_surface'], 'MODEL=nested-handoff-loop');
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

test('scanner skips Android native build intermediates even in forensic scans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-android-native-build-'));
  await mkdir(join(root, 'app', '.cxx', 'Debug', 'arm64-v8a', '.cmake', 'api', 'v1', 'reply'), { recursive: true });
  await mkdir(join(root, 'app', '.externalNativeBuild', 'cmake', 'debug'), { recursive: true });
  await mkdir(join(root, 'app', 'src', 'main', 'cpp'), { recursive: true });
  await writeFile(join(root, 'app', '.cxx', 'Debug', 'arm64-v8a', '.cmake', 'api', 'v1', 'reply', 'codemodel-v2.json'), [
    '{"kind":"codemodel","paths":{"build":"app/.cxx/Debug/arm64-v8a","source":"app/src/main/cpp"},"version":{"major":2,"minor":3}}',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'app', '.externalNativeBuild', 'cmake', 'debug', 'build.json'), [
    '{"MODEL":"native-build-cache"}',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'app', 'src', 'main', 'cpp', 'wrapper.cpp'), [
    'MODEL=owned-source',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'pcgamingwiki_runtime',
    includeIgnored: true,
  });

  assert(report.tree_inventory.skipped_files.some(item => item.path === 'app/.cxx' && item.reason === 'excluded_directory'));
  assert(report.tree_inventory.skipped_files.some(item => item.path === 'app/.externalNativeBuild' && item.reason === 'excluded_directory'));
  assertNoEvidence(report, ['build_variables', 'provider_routing_surface'], 'kind=codemodel');
  assertNoEvidence(report, ['build_variables', 'provider_routing_surface'], 'MODEL=native-build-cache');
  assert(report.tree_inventory.files.some(item => item.path === 'app/src/main/cpp/wrapper.cpp' && item.scanned));
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
  await mkdir(join(root, 'recovery'), { recursive: true });
  await mkdir(join(root, 'recovery', 'device', 'docs'), { recursive: true });
  await writeFile(join(root, 'recovery', 'README.md'), '# Recovery notes\n', 'utf8');
  await writeFile(join(root, 'recovery', 'device', 'docs', 'notes.md'), [
    'OrangeFox carries vendor/odm runtime services.',
    'The release artifact mentions product/slot/size evidence.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'agent.js'), [
    "commandResults.push(await runCapture(options, 'device/getprop.txt', ['adb']));",
    'The kernel/userland boundary matters.',
    'A proprietary/commercial-term source is reference-only.',
    'Keep risky root/module work out of the first app cut.',
    'Root and child compositor notes use root/child as prose.',
    'RedMagic hardware/status references remain future hook/control lanes.',
    'TensorRT engines are hardware/runtime sensitive.',
    'The setup help prints the list of packages/modules required.',
    'Run a profile that matches this project root, or point the recovery profile at an Android recovery/device tree checkout.',
    'Recovery and device-tree context lives in recovery/device-tree notes.',
    'Read [recovery notes](recovery/README.md).',
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
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:root/child');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/status');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/runtime');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:packages/modules');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:recovery/device');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:recovery/device-tree');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:recovery/README.md');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:recovery/README.md).');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/odm');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:product/slot/size');
  assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_keymint.so');
});

test('scanner applies explicit project path policy for release-hub recovery docks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-release-hub-policy-'));
  await mkdir(join(root, 'recovery', 'root'), { recursive: true });
  await writeFile(join(root, 'reversa.project.json'), JSON.stringify({
    schema_version: 1,
    project_kind: 'release_hub',
    path_policies: [
      {
        id: 'orangefox_checkout',
        classification: 'external_checkout_path',
        paths: [
          'device/nubia/NX809J',
          'vendor/twrp/config/common.mk',
        ],
        reason: 'Hydrated only inside the OrangeFox source checkout.',
      },
      {
        id: 'private_hydration',
        classification: 'local_hydration_required',
        paths: [
          'device/nubia/NX809J/keys/',
          'device/nubia/NX809J/prebuilt/',
        ],
        reason: 'Private keys and prebuilts are intentionally excluded from the public dock.',
      },
      {
        id: 'recovery_runtime_root',
        classification: 'recovery_root_runtime_path',
        paths: [
          '/vendor/bin/',
          'vendor/bin/',
        ],
        reason: 'Runtime recovery-root service path, not a host source checkout path.',
      },
    ],
  }, null, 2), 'utf8');
  await writeFile(join(root, 'BoardConfig.mk'), [
    'DEVICE_PATH := device/nubia/NX809J',
    'BOARD_AVB_RECOVERY_KEY_PATH := device/nubia/NX809J/keys/avb-test/test.pem',
    'TARGET_PREBUILT_KERNEL := device/nubia/NX809J/prebuilt/kernel',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'device.mk'), [
    '$(call inherit-product, vendor/twrp/config/common.mk)',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'recovery', 'root', 'init.recovery.wifi.rc'), [
    'service vendor.qrtr-ns /vendor/bin/qrtr-ns -f',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'compare.sh'), [
    'diff -ru stock/vendor/bin orangefox/vendor/bin',
    'echo vendor/bin',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'android_recovery',
  });

  assertEvidence(report, 'project_path_policy', 'project_policy_loaded:release_hub');
  assertEvidence(report, 'project_path_policy', 'path_policy:external_checkout_path:device/nubia/NX809J');
  assertEvidence(report, 'project_path_policy', 'path_policy:local_hydration_required:device/nubia/NX809J/keys/avb-test/test.pem');
  assertEvidence(report, 'project_path_policy', 'path_policy:recovery_root_runtime_path:/vendor/bin/qrtr-ns');
  assertEvidence(report, 'project_path_policy', 'path_policy:recovery_root_runtime_path:vendor/bin');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:device/nubia/NX809J');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:device/nubia/NX809J/keys/avb-test/test.pem');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:/vendor/bin/qrtr-ns');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:vendor/bin');
});

test('scanner keeps Android product, board, bootloader, and OTA identity scopes separate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-identity-scopes-'));
  await writeFile(join(root, 'BoardConfig.mk'), [
    'PRODUCT_PLATFORM := canoe',
    'TARGET_BOARD_PLATFORM := sm8850',
    'TARGET_BOOTLOADER_BOARD_NAME := canoe',
    'PRODUCT_DEVICE := NX809J',
    'TARGET_OTA_ASSERT_DEVICE := NX809J',
    'ro.board.platform=canoe',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'android_recovery',
  });

  assertEvidence(report, 'soc_platform_identity', 'TARGET_BOARD_PLATFORM=sm8850');
  assertEvidence(report, 'device_identity', 'TARGET_BOOTLOADER_BOARD_NAME=canoe');
  assertEvidence(report, 'device_identity', 'PRODUCT_DEVICE=NX809J');
  assert(!report.contradictions.some(item => item.title === 'Conflicting soc_platform claims across variables'));
  assert(!report.contradictions.some(item => item.title === 'Conflicting device claims across variables'));
});

test('scanner ignores legacy target names in explicit warning and provenance docs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-legacy-warning-scope-'));
  await writeFile(join(root, 'README.md'), [
    'Do not flash RM10 builds on RM11 Pro; they are not file-compatible.',
    'RM10 appears here as upstream ancestry and comparison only.',
    'Do not mix files across RM11 Pro and RM10 devices.',
    'OrangeFox RM10 Pro to RM11 Pro port evidence lives in tracked notes.',
    'This lane is not using the old RM10 Pro SoC identity.',
    'RM11 / RM10 style boot chains are comparison-only context, not permission to mix device files.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'BoardConfig.mk'), [
    'TARGET_DEVICE := RM10Pro',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'android_recovery',
  });

  assertNoExtractedText(report, 'Do not flash RM10');
  assertNoExtractedText(report, 'upstream ancestry and comparison only');
  assertNoExtractedText(report, 'Do not mix files across RM11 Pro and RM10 devices');
  assertNoExtractedText(report, 'RM10 Pro to RM11 Pro port evidence');
  assertNoExtractedText(report, 'not using the old RM10 Pro');
  assertNoExtractedText(report, 'comparison-only context');
  assertEvidence(report, 'likely_copy_paste_leftovers', 'risky_leftover:RM10');
});

test('scanner gates recovery patch advice when the scanned root is not a recovery tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-non-recovery-root-'));
  await mkdir(join(root, 'app', 'src', 'main', 'cpp'), { recursive: true });
  await mkdir(join(root, 'external', 'busybox', 'examples', 'bootfloppy', 'etc'), { recursive: true });
  await writeFile(join(root, 'app', 'src', 'main', 'cpp', 'nnapi_npu.cpp'), [
    '// TODO: tune the runtime probe once evidence exists',
    'const char *soc_names[] = { "sm8750", "sm8850", "kalama", "taro", "kona" };',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'external', 'busybox', 'examples', 'bootfloppy', 'etc', 'fstab'), [
    '/dev/fd0 / auto defaults 0 0',
  ].join('\n'), 'utf8');

  for (const profile of ['android_recovery', 'orangefox', 'twrp']) {
    const report = await scanProject({ projectRoot: root, profile });

    assertEvidence(report, 'profile_fit', `profile_fit:${profile}=not_applicable`);
    assert.equal(report.tree_inventory.profile_applicability.status, 'not_applicable');
    assert.equal(report.contradictions.length, 0);
    assert.equal(report.patch_candidates.length, 0);
  }
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

test('scanner treats native target Makefile matrices as build arms, not contradictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-native-target-matrix-'));
  await writeFile(join(root, 'Makefile'), [
    'NATIVE_TARGET := x86_64-linux-musl',
    'NATIVE_TARGET := aarch64-linux-musl',
    'NATIVE_TARGET := i686-linux-musl',
    'NATIVE_TARGET := riscv64-linux-musl',
    'NATIVE_CC := $(call find-cc,$(NATIVE_TARGET))',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assert(!report.contradictions.some(item => item.title.includes('NATIVE_TARGET')));
  assert(!report.patch_candidates.some(item => item.title.includes('NATIVE_TARGET')));
});

test('scanner keeps vendored dependency placeholders out of patch candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-vendored-placeholders-'));
  await mkdir(join(root, 'BO3-Transformed', '.agents', 'skills', 'reversa-reviewer', 'references'), { recursive: true });
  await mkdir(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'adrenotools', 'src', 'hook'), { recursive: true });
  await mkdir(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'OpenXR-SDK', 'src', 'loader'), { recursive: true });
  await mkdir(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'patchelf', 'src'), { recursive: true });
  await mkdir(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'virglrenderer', 'src'), { recursive: true });
  await mkdir(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'winlator'), { recursive: true });
  await mkdir(join(root, 'Pkgs', 'rife-ncnn-vs', 'Lib', 'site-packages', 'pip', '_internal'), { recursive: true });
  await mkdir(join(root, 'Pkgs', 'dain-ncnn'), { recursive: true });
  await mkdir(join(root, 'include', 'imgui'), { recursive: true });
  await mkdir(join(root, '.agents', 'skills', 'reversa-reviewer', 'references'), { recursive: true });
  await mkdir(join(root, 'thirdparty', 'toml11', 'docs'), { recursive: true });
  await mkdir(join(root, 'producers', 'weston_v1', 'weston', 'clients'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '# FAKE - F# Make\n', 'utf8');
  await writeFile(join(root, 'BO3-Transformed', '.agents', 'skills', 'reversa-reviewer', 'references', 'confidence-rules.md'), [
    '- TODO: reviewer reference note',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'adrenotools', 'src', 'hook', 'hook_impl.cpp'), [
    '// TODO: upstream driver hook caveat',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'OpenXR-SDK', 'src', 'loader', 'loader_core.cpp'), [
    '// TODO: upstream OpenXR loader note',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'patchelf', 'src', 'patchelf.cc'), [
    '// FIXME: upstream patchelf note',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'virglrenderer', 'src', 'iov.c'), [
    '/* TODO: upstream virgl note */',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Winlator', 'app', 'src', 'main', 'cpp', 'winlator', 'patchelf_wrapper.cpp'), [
    '// TODO: owned wrapper behavior still needs evidence',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Pkgs', 'rife-ncnn-vs', 'Lib', 'site-packages', 'pip', '_internal', 'build_env.py'), [
    '# TODO: upstream pip compatibility note',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Pkgs', 'dain-ncnn', 'README.md'), [
    '### TODO',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'include', 'imgui', 'imgui.cpp'), '// TODO: upstream docking note\n', 'utf8');
  await writeFile(join(root, '.agents', 'skills', 'reversa-reviewer', 'references', 'confidence-rules.md'), '- TODO: reviewer reference note\n', 'utf8');
  await writeFile(join(root, 'thirdparty', 'toml11', 'docs', 'config.toml'), '# TODO: upstream parser docs\n', 'utf8');
  await writeFile(join(root, 'producers', 'weston_v1', 'weston', 'clients', 'simple-egl.c'), [
    '/* TODO: upstream Weston sample note */',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'owned.js'), '// TODO: replace copied runtime assumption with verified evidence\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assertNoEvidence(report, ['placeholders'], 'placeholder_marker:FAKE');
  assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');
  assert(report.patch_candidates.some(item => item.target_file === 'src/owned.js'));
  assert(report.patch_candidates.some(item => item.target_file === 'Winlator/app/src/main/cpp/winlator/patchelf_wrapper.cpp'));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('BO3-Transformed/.agents/')));
  assert(!report.patch_candidates.some(item => item.target_file.includes('/app/src/main/cpp/adrenotools/')));
  assert(!report.patch_candidates.some(item => item.target_file.includes('/app/src/main/cpp/OpenXR-SDK/')));
  assert(!report.patch_candidates.some(item => item.target_file.includes('/app/src/main/cpp/patchelf/')));
  assert(!report.patch_candidates.some(item => item.target_file.includes('/app/src/main/cpp/virglrenderer/')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('Pkgs/')));
  assert(!report.patch_candidates.some(item => item.target_file.includes('site-packages')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('include/imgui/')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('.agents/')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('thirdparty/')));
  assert(!report.patch_candidates.some(item => item.target_file.startsWith('producers/weston_v1/')));
});

test('scanner keeps third-party runtime engine TODO evidence out of patch candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-third-party-runtime-'));
  const box64Root = join(root, 'box64');
  await mkdir(join(box64Root, 'src'), { recursive: true });
  await writeFile(join(box64Root, 'src', 'core.c'), [
    '// TODO: upstream dynarec improvement note',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: box64Root,
    profile: 'child_libpath',
  });

  assertEvidence(report, 'todo_fixme_stub_markers', 'placeholder_marker:TODO');
  assert(!report.patch_candidates.some(item => item.target_file === 'src/core.c'));
});

test('scanner scopes submodule paths, wrapper locals, and command-line definitions out of contradictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-assignment-scope-'));
  await mkdir(join(root, 'LSFG-Android-Application'), { recursive: true });
  await mkdir(join(root, '.github', 'workflows'), { recursive: true });

  await writeFile(join(root, '.gitmodules'), [
    '[submodule "lsfg-vk-android"]',
    '\tpath = lsfg-vk-android',
    '\turl = https://example.invalid/lsfg-vk-android.git',
    '[submodule "app"]',
    '\tpath = LSFG-Android-Application',
    '\turl = https://example.invalid/app.git',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'LSFG-Android-Application', 'gradlew'), [
    'APP_HOME=$( cd "${APP_HOME:-./}" && pwd -P ) || exit',
    'APP_HOME=$( cd "$APP_HOME/.." && pwd -P ) || exit',
    'MAX_FD=maximum',
    'MAX_FD=$( ulimit -H -n )',
    'CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar',
  ].join('\n'), 'utf8');
  await writeFile(join(root, '.github', 'workflows', 'build.yml'), [
    'run: cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON',
    'run: cmake -B build-debug -DCMAKE_BUILD_TYPE=Debug -DBUILD_SHARED_LIBS=OFF --style=file',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  const contradictionText = report.contradictions.map(item => item.title).join('\n');
  assert.doesNotMatch(contradictionText, /\bpath\b/);
  assert.doesNotMatch(contradictionText, /\bAPP_HOME\b/);
  assert.doesNotMatch(contradictionText, /\bMAX_FD\b/);
  assert.doesNotMatch(contradictionText, /\bCLASSPATH\b/);
  assert.doesNotMatch(contradictionText, /-DCMAKE_BUILD_TYPE/);
  assert.doesNotMatch(contradictionText, /-DBUILD_SHARED_LIBS/);
  assert.doesNotMatch(contradictionText, /--style/);
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

test('anland xwayland profile classifies producer alive with hung clients', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-anland-client-hang-'));
  await writeFile(join(root, 'stage19-forensics-output.txt'), [
    '160 /bin/bash /usr/local/bin/startanland-kde.sh',
    '247 dbus-run-session startplasma-wayland',
    '276 /usr/bin/kwin_wayland_wrapper --xwayland',
    '277 /usr/bin/kwin_wayland --socket wayland-0 --xwayland-display :0',
    'Gold Gold /run/user/1000/wayland-0 socket:[123]',
    'Gold Gold /tmp/.X11-unix/X0 socket:[124]',
    'XAUTHORITY=/run/user/1000/xauth_ycUGEE',
    'MIT-MAGIC-COOKIE-1',
    'XDPYINFO_GOLD_RC=124',
    'GLXINFO_GOLD_RC=124',
    'VULKANINFO_SUMMARY_RC=124',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'anland_xwayland_responsiveness',
  });

  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=producer_alive_client_dead');
  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=x11_client_hang');
  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=glx_hang');
  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=vulkan_loader_bad');
  assert.equal(report.patch_candidates.length, 0);
});

test('anland xwayland profile classifies missing display socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-anland-socket-missing-'));
  await writeFile(join(root, 'result.md'), [
    '/usr/local/bin/startanland-kde.sh running',
    'kwin_wayland --xwayland',
    '/run/user/1000/wayland-0: No such file or directory',
    '/tmp/.X11-unix/X0: No such file or directory',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'anland_xwayland_responsiveness',
  });

  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=socket_missing');
  assertNoEvidence(report, ['anland_xwayland_classification'], 'anland_xwayland.classification=producer_alive_client_dead');
  assert.equal(report.patch_candidates.length, 0);
});

test('anland xwayland profile classifies bad display authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-anland-display-bad-'));
  await writeFile(join(root, 'display.log'), [
    'kwin_wayland --socket wayland-0 --xwayland-display :0',
    '/run/user/1000/wayland-0 socket:[123]',
    '/tmp/.X11-unix/X0 socket:[124]',
    'DISPLAY=:99',
    'Error: unable to open display :99',
    'No protocol specified',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'anland_xwayland_responsiveness',
  });

  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=env_leakage');
  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=socket_present_auth_bad');
  assert.equal(report.patch_candidates.length, 0);
});

test('anland xwayland profile classifies bad Vulkan loader separately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-anland-vulkan-bad-'));
  await writeFile(join(root, 'vulkan.log'), [
    'kwin_wayland --socket wayland-0 --xwayland-display :0',
    '/tmp/.X11-unix/X0 socket:[124]',
    'VK_ICD_FILENAMES=/bad/freedreno_icd.json',
    'ERROR_INCOMPATIBLE_DRIVER',
    'VULKANINFO_SUMMARY_RC=1',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'anland_xwayland_responsiveness',
  });

  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=vulkan_loader_bad');
  assertNoEvidence(report, ['anland_xwayland_classification'], 'anland_xwayland.classification=socket_missing');
  assert.equal(report.patch_candidates.length, 0);
});

test('anland xwayland profile recognizes known-good responsive pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-anland-known-good-'));
  await writeFile(join(root, 'known-good.md'), [
    '/usr/local/bin/startanland-kde.sh running',
    'kwin_wayland --socket wayland-0 --xwayland-display :0',
    '/run/user/1000/wayland-0 socket:[123]',
    '/tmp/.X11-unix/X0 socket:[124]',
    'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS',
    'preflight_ready',
    'real_buffer_commits=2',
    'vkGetMemoryFdKHR_failures=0',
    'GLXINFO_GOLD_RC=0',
    'OpenGL renderer string: Adreno KGSL',
    'VULKANINFO_SUMMARY_RC=0',
    'Vulkan Instance Version: 1.3',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'anland_xwayland_responsiveness',
  });

  assertEvidence(report, 'anland_xwayland_classification', 'anland_xwayland.classification=known_good_match');
  assertNoEvidence(report, ['anland_xwayland_classification'], 'anland_xwayland.classification=producer_alive_client_dead');
  assert.equal(report.patch_candidates.length, 0);
});

test('decoded media evidence profile reads JSONL proof without patch candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-decoded-media-'));
  await writeFile(join(root, 'decoded-media-manifest.jsonl'), [
    JSON.stringify({
      kind: 'hashed_video_artifact',
      path: 'D:/Downloads/dock-proof.mp4',
      sha256: 'a'.repeat(64),
      tags: ['EVIDENCE:VIDEO_DECODED', 'PROJECT:DROIDSPACES_NEBULA', 'DRM:LEASE', 'WAYLAND:LABWC'],
      frame_paths: ['frames/dock-proof.frame1.png'],
      content_summary: 'AnLandKDE userspace boot in DRM lease mode; connector 89; CRTC 285; mode 1920x1080@75; fd3 lease received; /dev/dri/card0; /dev/dri/renderD128; scanout plane 133; Mesa KGSL render device; renderer gles2; wayland=wayland-0; wlroots DRM backend; labwc compositor; graphical target reached.',
    }),
    JSON.stringify({
      kind: 'hashed_video_artifact',
      path: 'D:/Downloads/fps-context.mp4',
      sha256: 'b'.repeat(64),
      tags: ['EVIDENCE:VIDEO_DECODED', 'RUNTIME:GAME_COMPAT', 'PERF:FPS'],
      content_summary: 'FPS around 75/75/76 with ping 0ms; app/config/launch path unknown; not standalone runtime-lane proof.',
    }),
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'decoded_media_evidence',
  });

  assert.equal(report.scan.profile, 'decoded_media_evidence');
  assertEvidence(report, 'decoded_media_artifact', 'decoded_media.artifact.sha256=');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease=true');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.connector=89');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.crtc=285');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.mode=1920x1080@75');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.fd=fd3');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.render_node=/dev/dri/renderD128');
  assertEvidence(report, 'decoded_media_drm_lease_proof', 'decoded_media.drm_lease.scanout_plane=133');
  assertEvidence(report, 'decoded_media_wayland_compositor_proof', 'decoded_media.wlroots_drm_backend=true');
  assertEvidence(report, 'decoded_media_wayland_compositor_proof', 'decoded_media.compositor=labwc');
  assertEvidence(report, 'decoded_media_wayland_compositor_proof', 'decoded_media.wayland.socket=wayland-0');
  assertEvidence(report, 'decoded_media_gpu_render_proof', 'decoded_media.kgsl_render_device=true');
  assertEvidence(report, 'decoded_media_gpu_render_proof', 'decoded_media.renderer=gles2');
  assertEvidence(report, 'decoded_media_performance_context', 'decoded_media.fps_overlay=75/75/76');
  assertEvidence(report, 'decoded_media_performance_context', 'decoded_media.ping_ms=0');
  assertEvidence(report, 'decoded_media_guard', 'decoded_media.guard.not_standalone_runtime_proof=true');
  assert.equal(report.patch_candidates.length, 0);
  assert.equal(validateScanReport(report).valid, true);
});

test('droidspaces dock lease profile records host-only schema and command-plan proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-dock-lease-'));
  await mkdir(join(root, 'docs/integration/schemas'), { recursive: true });
  await writeFile(join(root, 'docs/integration/schemas/dock-lease-command.schema.json'), JSON.stringify({
    title: 'Dock lease command schema',
    type: 'object',
  }), 'utf8');
  await writeFile(join(root, 'docs/integration/schemas/dock-lease-result.schema.json'), JSON.stringify({
    title: 'Dock lease result schema',
    type: 'object',
  }), 'utf8');
  await writeFile(join(root, 'dock-lease-command-plan.json'), JSON.stringify({
    protocol_version: 1,
    command: 'dock lease command-plan report',
    host_only: true,
    lane: 'dock_drm_lease_external',
    profile_set_dock: 'BLOCKED_NOT_READY',
    start_command_available: false,
    runtime_allowlists_modified: false,
    app_allowlists_modified: false,
    classification: 'DOCK_LEASE_COMMAND_PLAN_HOST_ONLY',
    mutation_allowed_by_policy: false,
    plans: [
      {
        id: 'lease-test-only',
        command_kind: 'dock_lease_test_only',
        execute: false,
        mutation_allowed_by_policy: false,
        external_display_only: true,
        dynamic_discovery_required: true,
        test_only: true,
        inputs: {
          allow_raw_shell: false,
          allow_manual_connector_id: false,
          allow_manual_crtc_id: false,
          allow_manual_plane_id: false,
          allow_manual_fd: false,
          allow_internal_panel: false,
          allow_whole_card_takeover: false,
        },
        required_guards: {
          test_only_required_before_commit: true,
          handoff_mechanism: 'SCM_RIGHTS',
          stop_revoke_required: true,
          rollback_required: true,
          crash_counter_required: true,
          auto_retry_allowed: false,
        },
        result_errors: ['HOST_ONLY_FIXTURE'],
      },
    ],
  }), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'droidspaces_dock_lease',
  });

  assert.equal(report.scan.profile, 'droidspaces_dock_lease');
  assertEvidence(report, 'dock_lease_host_proof', 'dock_lease.schema.command_contract=true');
  assertEvidence(report, 'dock_lease_host_proof', 'dock_lease.schema.result_contract=true');
  assertEvidence(report, 'dock_lease_host_proof', 'dock_lease.command_plan=DOCK_LEASE_COMMAND_PLAN_HOST_ONLY');
  assertEvidence(report, 'dock_lease_blocked_not_ready', 'dock_lease.status=BLOCKED_NOT_READY');
  assertEvidence(report, 'dock_lease_mutation_denied', 'dock_lease.mutation_allowed_by_policy=false');
  assertEvidence(report, 'dock_lease_dynamic_discovery_required', 'dock_lease.discovery=dynamic_required');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.TEST_ONLY=true');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.SCM_RIGHTS=true');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.stop_revoke=true');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.rollback=true');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.crash_gate=true');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.start_command_available=false');
  assertNoEvidence(report, ['dock_lease_runtime_warning'], 'dock_lease.warning');
  assert(!report.contradictions.some(item => item.category === 'dock_lease_guard'));
  assert.equal(report.patch_candidates.length, 0);
  assert.equal(validateScanReport(report).valid, true);
});

test('droidspaces dock lease profile does not warn on guarded wording alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-dock-lease-wording-'));
  await writeFile(join(root, 'dock-lease-notes.md'), [
    'Dock lease stays host-only.',
    'Runtime allowlists remain unmodified.',
    'Start command stays unavailable.',
    'Dynamic discovery, TEST_ONLY, SCM_RIGHTS, stop/revoke, rollback, and crash gate are required.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'dock_command_plan',
  });

  assertEvidence(report, 'dock_lease_dynamic_discovery_required', 'dock_lease.discovery=dynamic_required');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.TEST_ONLY=true');
  assertNoEvidence(report, ['dock_lease_runtime_warning'], 'dock_lease.warning');
  assert(!report.contradictions.some(item => item.category === 'dock_lease_guard'));
  assert.equal(report.patch_candidates.length, 0);
});

test('droidspaces dock lease profile blocks runtime promotion flags without patch candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-dock-lease-runtime-promotion-'));
  await writeFile(join(root, 'dock-lease-command-plan.json'), JSON.stringify({
    protocol_version: 1,
    command: 'dock lease command-plan report',
    host_only: true,
    lane: 'dock_drm_lease_external',
    profile_set_dock: 'BLOCKED_NOT_READY',
    start_command_available: true,
    runtime_allowlists_modified: true,
    app_allowlists_modified: false,
    classification: 'DOCK_LEASE_COMMAND_PLAN_HOST_ONLY',
    mutation_allowed_by_policy: true,
    plans: [
      {
        id: 'lease-discovery',
        command_kind: 'dock_lease_preflight',
        execute: true,
        mutation_allowed_by_policy: true,
        dynamic_discovery_required: true,
        inputs: {
          allow_manual_connector_id: true,
        },
      },
    ],
  }), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'nebula_dock_schema',
  });

  assertEvidence(report, 'dock_lease_runtime_warning', 'dock_lease.start_command_available=true');
  assertEvidence(report, 'dock_lease_runtime_warning', 'dock_lease.runtime_allowlists_modified=true');
  assertEvidence(report, 'dock_lease_runtime_warning', 'dock_lease.mutation_allowed_by_policy=true');
  assertEvidence(report, 'dock_lease_guard', 'dock_lease.guard.RUNTIME_PROMOTION_BLOCKED=true');
  assert(report.contradictions.some(item => item.category === 'dock_lease_guard'
    && item.title === 'Dock lease runtime promotion blocked by host-only proof'
    && item.likely_winner === 'HOST_ONLY_DOCK_SCHEMA_BOUNDARY'));
  assert.equal(report.patch_candidates.length, 0);
  assert.equal(validateScanReport(report).valid, true);
});

test('known good frontier profile treats per-lane runtime ids as volatile evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-frontier-volatile-runtime-'));
  await writeFile(join(root, 'current.log'), [
    'RUN_ID=current',
    'LANE=current',
    'DEVICE_RUN_DIR=/tmp/nebula-current',
    'XAUTHORITY=/tmp/xauth-current',
    'nebula.gamescope.GAMESCOPE_PID=100',
    'nebula.xwayland.XWAYLAND_EXIT=135',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'gslocal.log'), [
    'RUN_ID=gslocal',
    'LANE=gslocal-first',
    'DEVICE_RUN_DIR=/tmp/nebula-gslocal',
    'XAUTHORITY=/tmp/xauth-gslocal',
    'nebula.gamescope.GAMESCOPE_PID=200',
    'nebula.xwayland.XWAYLAND_EXIT=0',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'known_good_frontier',
  });

  assert(report.evidence.some(item => item.normalized_claim === 'RUN_ID=current'));
  assert(report.evidence.some(item => item.normalized_claim === 'RUN_ID=gslocal'));
  assert(!report.contradictions.some(item => /RUN_ID|LANE|DEVICE_RUN_DIR|XAUTHORITY|GAMESCOPE_PID|XWAYLAND_EXIT/.test(item.title)));
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

test('gpu upscale framegen profile detects clean Cupscale and Flowframes runtime evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gpu-framegen-clean-'));
  await writeFile(join(root, 'README.md'), [
    'Cupscale uses Real-ESRGAN, ESRGAN, SwinIR, EDSR, waifu2x, and Real-CUGAN as upscaling candidates.',
    'Flowframes supports RIFE, DAIN, FLAVR, XVFI, IFRNet, optical flow, frame interpolation, and frame generation.',
    'Backend proof: nvidia-smi OK; torch.cuda.is_available()=true; CUDA runtime 12.8; driver version 575; backend PyTorch CUDA.',
    'Portable backend: rife-ncnn-vulkan.exe, dain-ncnn-vulkan.exe, ifrnet-ncnn-vulkan.exe use NCNN Vulkan.',
    'Media pipeline: FFmpeg, VapourSynth, Magick.NET, and ImageMagick.',
    'Tuning: fp16 half precision, UHD mode, scene-change, deduplication, GPU IDs, NCNN processing threads, VRAM, tile size.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assert.equal(report.scan.profile, 'gpu_upscale_framegen');
  assertEvidence(report, 'gpu_upscale_runtime', 'UPSCALE_RUNTIME_CANDIDATE');
  assertEvidence(report, 'gpu_framegen_runtime', 'FRAMEGEN_RUNTIME_CANDIDATE');
  assertEvidence(report, 'gpu_backend_surface', 'VULKAN_NCNN_BACKEND_PRESENT');
  assertEvidence(report, 'gpu_backend_surface', 'CUDA_BACKEND_PRESENT');
  assertEvidence(report, 'gpu_cuda_guard', '5090_ACCELERATION_CANDIDATE');
  assertEvidence(report, 'gpu_media_pipeline', 'PERFORMANCE_TUNING_HINT');
  assertEvidence(report, 'gpu_performance_tuning', 'PERFORMANCE_TUNING_HINT');
  assert.equal(report.contradictions.length, 0);

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('gpu upscale framegen profile guards model assets and unverified acceleration claims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gpu-framegen-guards-'));
  await writeFile(join(root, 'models.md'), [
    'ModelPath=models/rife-v4/model.pth',
    '5090 CUDA acceleration supported.',
    'Proton compatible Linux support.',
    'dxgi.dll d3d11.dll proxy DLL for Windows Graphics Capture net8.0-windows WinForms.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assertEvidence(report, 'gpu_model_assets', 'MODEL_ASSET_PRESENT');
  assertEvidence(report, 'gpu_model_asset_guard', 'MODEL_HASH_MISSING');
  assertEvidence(report, 'gpu_model_asset_guard', 'MODEL_LICENSE_UNKNOWN');
  assertEvidence(report, 'gpu_model_asset_guard', 'MODEL_PROVENANCE_MISSING');
  assertEvidence(report, 'gpu_cuda_guard', 'CUDA_CLAIM_UNVERIFIED');
  assertEvidence(report, 'gpu_linux_proton_guard', 'PROTON_COMPATIBLE_CANDIDATE');
  assertEvidence(report, 'gpu_runtime_platform', 'WINDOWS_ONLY_RUNTIME');

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('gpu upscale framegen profile enforces executable patch dossiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gpu-exe-patch-'));
  await writeFile(join(root, 'patches.md'), [
    'TargetExe=Game.exe FileOffset=0x123 PatchedBytes=90',
    'TargetExe=Game.exe SHA256Before=aaaaaaaa SHA256After=bbbbbbbb reversible RollbackPlan=restore BackupPath=backup GameVersion=1.0 FileOffset=0x123 AOBSignature=AA BB PatchSource=research legal offline',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assertEvidence(report, 'gpu_game_patch_guard', 'GAME_PATCH_UNSAFE');
  assertEvidence(report, 'gpu_game_patch_guard', 'EXE_PATCH_HASH_REQUIRED');
  assertEvidence(report, 'gpu_game_patch_guard', 'REVERSIBLE_PATCH_REQUIRED');
  assertEvidence(report, 'gpu_game_patch_guard', 'GAME_PATCH_REVIEW_SAFE');

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('gpu upscale framegen profile treats generated scans and training artifacts as non-authoritative', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gpu-generated-boundary-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'local', 'scans', 'run-01'), { recursive: true });
  await mkdir(join(root, 'local', 'agentic-training-pack-gpu'), { recursive: true });
  await mkdir(join(root, 'nebula-assets', 'reversa-datasets', 'gpu'), { recursive: true });
  await writeFile(join(root, 'src', 'runtime.md'), [
    'ModelPath=models/source-model.pth',
    'Backend proof: nvidia-smi OK; torch.cuda.is_available()=true; CUDA runtime 12.8; driver version 575; backend PyTorch CUDA.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'local', 'scans', 'run-01', 'report.json'), '{"text":"ModelPath=models/generated-model.pth"}', 'utf8');
  await writeFile(join(root, 'local', 'scans', 'run-01', 'dashboard.html'), '<p>5090 CUDA generated echo</p>', 'utf8');
  await writeFile(join(root, 'local', 'agentic-training-pack-gpu', 'agentic-training-pack.jsonl'), '{"text":"TargetExe=Generated.exe FileOffset=0x99"}\n', 'utf8');
  await writeFile(join(root, 'nebula-assets', 'reversa-datasets', 'gpu', 'gpu-upscale-framegen-train.jsonl'), '{"text":"ModelPath=models/dataset-model.pth"}\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assertEvidence(report, 'gpu_model_assets', 'MODEL_ASSET_PRESENT');
  assertEvidence(report, 'generated_evidence_boundary', 'GENERATED_EVIDENCE:local/scans');
  assertEvidence(report, 'generated_evidence_boundary', 'GENERATED_EVIDENCE:nebula-assets/reversa-datasets');
  assertEvidence(report, 'generated_evidence_boundary', 'TRAINING_EVAL_ARTIFACT:local/agentic-training-pack-gpu');
  assertEvidence(report, 'generated_evidence_boundary', 'NOT_SOURCE_AUTHORITY:local/scans');
  assertEvidence(report, 'generated_evidence_boundary', 'NOT_SOURCE_AUTHORITY:nebula-assets/reversa-datasets');
  assertEvidence(report, 'generated_evidence_boundary', 'NOT_SOURCE_AUTHORITY:local/agentic-training-pack-gpu');
  assertNoExtractedText(report, 'generated-model.pth');
  assertNoExtractedText(report, 'dataset-model.pth');
  assertNoExtractedText(report, 'Generated.exe');

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('scanner expands GameNative style runtime JSON into graphics and mobile Linux evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-gamenative-json-'));
  await writeFile(join(root, 'Gamenative_steam_Blender_config.json'), JSON.stringify({
    id: 'STEAM_365670',
    screenSize: '1280x720',
    envVars: 'WRAPPER_MAX_IMAGE_COUNT=0 ZINK_DESCRIPTORS=lazy ZINK_DEBUG=compact MESA_SHADER_CACHE_MAX_SIZE=512MB mesa_glthread=true WINEESYNC=1 MESA_VK_WSI_PRESENT_MODE=mailbox TU_DEBUG=noconform MESA_GL_VERSION_OVERRIDE=4.6',
    cpuList: '0,1,2,3,4,5,6,7',
    cpuListWoW64: '0,1,2,3,4,5,6,7',
    graphicsDriver: 'Wrapper',
    graphicsDriverConfig: 'vulkanVersion=1.3,version=v805,maxDeviceMemory=4096,presentMode=mailbox,adrenotoolsTurnip=0',
    rendererPresentMode: 'fifo',
    dxwrapper: 'dxvk',
    dxwrapperConfig: 'version=2.4.1-gplasync,async=1,vkd3dVersion=2.14.1,videoMemorySize=2048,strict_shader_math=1,renderer=gl',
    audioDriver: 'alsa',
    emulator: 'FEXCore',
    box64Version: '0.4.2',
    fexcoreVersion: '2605',
    wineVersion: 'proton-11.0-1-arm64ec-1',
    executablePath: 'blender.exe',
    steamType: 'normal',
    extraData: {
      lsfgEnabled: 'false',
      fpsLimiterEnabled: false,
      fpsLimiterTarget: 60,
    },
  }), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'gpu_upscale_framegen',
  });

  assertEvidence(report, 'game_runtime_identity', 'id=STEAM_365670');
  assertEvidence(report, 'game_runtime_identity', 'executablePath=blender.exe');
  assertEvidence(report, 'api_translation_layer', 'dxwrapper=dxvk');
  assertEvidence(report, 'api_translation_layer', 'dxwrapperConfig.version=2.4.1-gplasync');
  assertEvidence(report, 'mobile_linux_runtime', 'env.ZINK_DESCRIPTORS=lazy');
  assertEvidence(report, 'mobile_linux_runtime', 'env.MESA_VK_WSI_PRESENT_MODE=mailbox');
  assertEvidence(report, 'pcgw_linux_wine_proton', 'wineVersion=proton-11.0-1-arm64ec-1');
  assertEvidence(report, 'pcgw_video_display_fixes', 'screenSize=1280x720');
  assertEvidence(report, 'pcgw_video_display_fixes', 'rendererPresentMode=fifo');
  assertEvidence(report, 'pcgw_input_audio_network', 'audioDriver=alsa');
  assertEvidence(report, 'power_game_profile', 'cpuList=0,1,2,3,4,5,6,7');
  assertEvidence(report, 'gpu_performance_tuning', 'dxwrapperConfig.videoMemorySize=2048');
  assertEvidence(report, 'frame_generation_pipeline', 'extraData.lsfgEnabled=false');
  assert.equal(report.contradictions.length, 0);
  assert.equal(report.patch_candidates.length, 0);
});

test('power TDP runtime profile detects AutoTDP and handheld-daemon research surfaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-power-tdp-runtime-'));
  await mkdir(join(root, 'src', 'adjustor', 'core'), { recursive: true });
  await writeFile(join(root, 'AutoTDP.sh'), [
    'REQUIRED_PACKAGES=("jq" "sudo" "ryzenadj")',
    'RYZENADJ_EXEC=ryzenadj',
    'set_tdp() { "$RYZENADJ_EXEC" --stapm-limit "$1" --fast-limit "$1" --slow-limit "$1"; }',
    'read_cpu_times() { read -r _ user nice system idle rest < /proc/stat; }',
    'for supply in /sys/class/power_supply/*; do echo "$supply"; done',
    'MIN_TDP=8000 DEFAULT_TDP=15000 MAX_CPU_TDP=30000 STEP_TDP=1000 BATTERY_MAX_TDP=12000',
    'MONITOR_INTERVAL=5 STABLE_SAMPLE_COUNT=3 RYZENADJ_DELAY=2',
    'PERFORMANCE_MODE=balanced POWER_MODE=turbo',
    'SteamAppId=${SteamAppId:-${SteamGameId:-${STEAM_COMPAT_APP_ID:-}}}',
    'wine64-preloader and wineserver are launcher helpers for Proton.',
    'Runtime proof missing until a controlled test later.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'game_profiles.json'), JSON.stringify({
    steam_appids: { 1091500: 'cyberpunk_2077' },
    executables: { 'cyberpunk2077.exe': 'cyberpunk_2077' },
    launcher_types: { wine: 'generic_wine' },
  }, null, 2), 'utf8');
  await writeFile(join(root, 'known_devices.json'), JSON.stringify({
    hx370: {
      DEVICE_PROFILE: 'hx370',
      MIN_TDP: 8000,
      DEFAULT_TDP: 18000,
      MAX_CPU_TDP: 33000,
      BATTERY_MAX_TDP: 15000,
    },
  }, null, 2), 'utf8');
  await writeFile(join(root, 'src', 'adjustor', 'hhd.py'), [
    'from hhd.plugins import HHDPlugin',
    'class AdjustorInitPlugin(HHDPlugin): pass',
    'CONFLICTING_PLUGINS = {"SimpleDeckyTDP": "conflict", "PowerControl": "conflict"}',
    'with open("/sys/devices/virtual/dmi/id/product_name") as product_name: pass',
    'with open("/proc/cpuinfo") as cpuinfo: pass',
    'os.system("systemctl stop plugin_loader")',
    'os.rename(path, new_path)',
    'os.system("systemctl start plugin_loader")',
    'os.system("rm -rf /home/user/homebrew/plugins/hhd-disabled")',
    'SmuDriverPlugin and SmuQamPlugin select an SMU backend.',
    'BatteryPlugin and GpuPlugin attach battery and GPU controls.',
    'RESEARCH_READY_FOR_CONTROLLED_TEST after profile import and daemon model review.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'adjustor', 'core', 'acpi.py'), [
    'os.system("modprobe acpi_call")',
    'with open("/proc/acpi/call", "wb") as acpi_call: pass',
    'with open("/sys/firmware/acpi/platform_profile", "w") as platform_profile: pass',
    'charge_control_end_threshold and charge_type writes are approval gated.',
    'with open(os.path.join(entry.path, "device/power/wakeup"), "r") as wakeup: pass',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'power_tdp_runtime',
  });

  assert.equal(report.scan.profile, 'power_tdp_runtime');
  assertEvidence(report, 'power_tdp_backend', 'TDP_BACKEND_RYZENADJ');
  assertEvidence(report, 'power_tdp_backend', 'TDP_BACKEND_HHD_PLUGIN');
  assertEvidence(report, 'power_tdp_backend', 'TDP_BACKEND_ACPI_CALL');
  assertEvidence(report, 'power_tdp_backend', 'TDP_BACKEND_SMU');
  assertEvidence(report, 'power_game_profile', 'GAME_PROFILE_STEAM_APPID');
  assertEvidence(report, 'power_game_profile', 'GAME_PROFILE_EXECUTABLE');
  assertEvidence(report, 'power_game_profile', 'GAME_PROFILE_WINE_PROTON');
  assertEvidence(report, 'power_mode_profile', 'POWER_MODE_PROFILE');
  assertEvidence(report, 'power_battery_profile', 'BATTERY_CAP_PRESENT');
  assertEvidence(report, 'power_sampling_policy', 'STABLE_SAMPLE_HYSTERESIS');
  assertEvidence(report, 'power_device_profile', 'DEVICE_PROFILE_PRESENT');
  assertEvidence(report, 'power_device_profile', 'DEVICE_AUTODETECT_DMI');
  assertEvidence(report, 'power_plugin_conflict', 'PLUGIN_CONFLICT_DETECTED');
  assertEvidence(report, 'power_mutation_guard', 'MUTATION_REQUIRES_APPROVAL');
  assertEvidence(report, 'power_runtime_proof', 'RUNTIME_PROOF_MISSING');
  assertEvidence(report, 'power_research_status', 'RESEARCH_READY_FOR_CONTROLLED_TEST');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:device/power/wakeup');
  assert(report.commands_to_run.some(command => command.includes('ryzenadj')));
  assert(report.commands_to_run.some(command => command.includes('SimpleDeckyTDP')));

  const aliasReport = await scanProject({
    projectRoot: root,
    profile: 'hhd_autotdp',
  });
  assert.equal(aliasReport.scan.profile, 'hhd_autotdp');
  assertEvidence(aliasReport, 'power_tdp_backend', 'TDP_BACKEND_HHD_PLUGIN');

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

test('agentic training pack absorbs Claude-code-matrix functionality map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-agentic-training-pack-'));
  const manifest = join(repoRoot, 'docs/upstreams/claude-code-matrix/source-sync.json');
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'scripts/build-agentic-training-pack.js'),
    '--manifest',
    manifest,
    '--out',
    root,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const pack = (await readFile(join(root, 'agentic-training-pack.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const capabilities = pack.filter(record => record.type === 'functionality_capability');
  const packHeader = pack.find(record => record.type === 'training_pack');
  const mapHeader = pack.find(record => record.type === 'functionality_absorption_map');

  assert(packHeader.functionality_absorption_map.endsWith('functionality-absorption-map.json'));
  assert.equal(mapHeader.capability_count, 8);
  assert.equal(capabilities.length, 8);
  assert(capabilities.some(record => record.capability_id === 'safe_diagnostics_and_redaction'));
  assert(capabilities.some(record => record.capability_id === 'provider_catalog_and_registry'));
  assert(capabilities.every(record => record.copy_boundary === 'metadata_only_no_third_party_source_text'));
  assert(capabilities.every(record => record.source_paths.length > 0));

  const labels = JSON.parse(await readFile(join(root, 'agentic-training-labels.json'), 'utf8'));
  assert(labels.evidence_categories.includes('functionality_capability'));
  assert(labels.evidence_categories.includes('safe_diagnostics_and_redaction'));
});

test('claude_code_modern detects modern Claude surfaces and unsafe workflow conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-claude-modern-'));
  await mkdir(join(root, '.claude', 'commands'), { recursive: true });
  await mkdir(join(root, '.claude', 'agents'), { recursive: true });
  await mkdir(join(root, '.claude', 'hooks'), { recursive: true });
  await mkdir(join(root, 'skills', 'reversa-audit'), { recursive: true });
  await mkdir(join(root, 'transcripts'), { recursive: true });

  await writeFile(join(root, 'CLAUDE.md'), 'Project memory: ask before destructive commands.\n', 'utf8');
  await writeFile(join(root, 'AGENTS.md'), 'Use sandbox required for write-capable tasks.\n', 'utf8');
  await writeFile(join(root, '.claude', 'settings.json'), '{"permissions":{"defaultMode":"ask"}}\n', 'utf8');
  await writeFile(join(root, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Read"]}}\n', 'utf8');
  await writeFile(join(root, '.claude', 'settings.managed.json'), '{"permissions":{"deny":["Bash(rm -rf:*)"]}}\n', 'utf8');
  await writeFile(join(root, '.claude', 'commands', 'review.md'), 'Slash command /review runs a code review checklist.\n', 'utf8');
  await writeFile(join(root, '.claude', 'agents', 'reviewer.md'), 'Subagent reviewer owns one file and writes a handoff.\n', 'utf8');
  await writeFile(join(root, '.claude', 'hooks', 'hooks.json'), [
    '{"event":"PostToolUse","command":"ruff format ."}',
    '{"event":"PreToolUse","command":"rm -rf /tmp/reversa-danger"}',
  ].join('\n'), 'utf8');
  await writeFile(join(root, '.mcp.json'), '{"mcpServers":{"local":{"command":"node","args":["server.js"]}}}\n', 'utf8');
  await writeFile(join(root, 'skills', 'reversa-audit', 'SKILL.md'), 'Skill workflow with progressive disclosure.\n', 'utf8');
  await writeFile(join(root, 'transcripts', 'session.md'), 'Generated transcript; source_authority=false.\n', 'utf8');
  await writeFile(join(root, 'PLAN.md'), [
    'This is a read-only task.',
    'Next command would apply_patch to edit files.',
    'approval_policy=never with rm -rf /tmp/reversa-danger is forbidden.',
    'Run /data/adb/modules_update/nebula_core/bin/nebula-core before /data/adb/modules/nebula_core/bin/nebula-core.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'claude_code_modern',
  });

  assert.equal(report.scan.profile, 'claude_code_modern');
  assertEvidence(report, 'claude_memory_instruction', 'CLAUDE_MD_MEMORY');
  assertEvidence(report, 'claude_settings_scope', 'SETTINGS_SCOPE_PROJECT');
  assertEvidence(report, 'claude_settings_scope', 'SETTINGS_SCOPE_LOCAL');
  assertEvidence(report, 'claude_settings_scope', 'SETTINGS_SCOPE_MANAGED');
  assertEvidence(report, 'claude_hook_policy', 'HOOK_SAFE_FORMATTER');
  assertEvidence(report, 'claude_hook_policy', 'HOOK_MUTATION_RISK');
  assertEvidence(report, 'claude_command_plan_guard', 'COMMAND_PLAN_UNSAFE');
  assertEvidence(report, 'claude_subagent_surface', 'SUBAGENT_SCOPE_BOUNDARY');
  assertEvidence(report, 'claude_mcp_surface', 'MCP_TOOL_SURFACE');
  assertEvidence(report, 'claude_skill_surface', 'SKILL_WORKFLOW');
  assertEvidence(report, 'claude_command_surface', 'SLASH_COMMAND_SURFACE');
  assertEvidence(report, 'claude_generated_boundary', 'GENERATED_ARTIFACT_NOT_AUTHORITY');
  assertEvidence(report, 'claude_frontier_guard', 'FRONTIER_REGRESSION_RISK');
  assertEvidence(report, 'claude_code_modern_guard', 'PERMISSION_POLICY_CONFLICT:read_only_vs_patch_plan');
  assertEvidence(report, 'claude_code_modern_guard', 'PERMISSION_POLICY_CONFLICT:auto_approve_vs_unsafe_command');
  assertEvidence(report, 'claude_code_modern_guard', 'FRONTIER_REGRESSION_RISK:modules_update_first');
  assert(report.contradictions.some(item => item.category === 'claude_code_modern_guard'
    && item.title.includes('Read-only Claude/Codex task conflicts')));
  assert(report.contradictions.some(item => item.category === 'claude_code_modern_guard'
    && item.title.includes('Auto-approval policy conflicts')));
  assert(report.contradictions.some(item => item.category === 'claude_code_modern_guard'
    && item.title.includes('Pending modules_update plan risks')));

  const validation = validateScanReport(report);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('claude_code_modern aliases and active-first module plans stay valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-claude-modern-active-'));
  await writeFile(join(root, 'CLAUDE.md'), 'Active module is authoritative. Ask before destructive commands.\n', 'utf8');
  await writeFile(join(root, 'PLAN.md'), [
    'Read /data/adb/modules/nebula_core/bin/nebula-core first.',
    'Only after explicit guarded dry-check read /data/adb/modules_update/nebula_core/bin/nebula-core.',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'claude_code',
  });

  assert.equal(report.scan.profile, 'claude_code');
  assertEvidence(report, 'claude_memory_instruction', 'CLAUDE_MD_MEMORY');
  assertEvidence(report, 'claude_frontier_guard', 'ACTIVE_FIRST_AUTHORITY');
  assert(!report.contradictions.some(item => item.category === 'claude_code_modern_guard'));

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

test('semantic policy profile ignores historical recovery evidence and release-body command examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-semantic-recovery-history-'));
  await mkdir(join(root, 'docs', 'orangefox-port'), { recursive: true });
  await mkdir(join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), [
    'No phone actions. No adb install or reboot.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'docs', 'orangefox-port', 'result.md'), [
    '- `fastboot boot OrangeFox.img`: FAIL, `Bad Buffer Size`.',
    '- `fastboot flash recovery_a OrangeFox.img`: PASS.',
    '- Booted recovery by `adb reboot recovery`.',
    'Concrete inference: `fastboot boot` is a poor validation path for this image type.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, '.github', 'workflows', 'release.yml'), [
    'name: release',
    'on: workflow_dispatch',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: release body',
    '        with:',
    '          body: |',
    '            adb push OrangeFox.img /sdcard/recovery.img',
    '            adb shell dd if=/sdcard/recovery.img of=/dev/block/bootdevice/by-name/recovery_a',
    '            adb reboot recovery',
    '      - name: active run command',
    '        run: |',
    '          adb install active.apk',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'device_action_forbidden', 'semantic_policy.device_action_forbidden.device=device_actions_forbidden');
  assertEvidence(report, 'device_action_allowed', 'semantic_policy.device_action_allowed.device=device_actions_allowed');
  assertExtractedText(report, 'adb install active.apk');
  assertNoPolicyExtractedText(report, 'fastboot flash recovery_a OrangeFox.img');
  assertNoPolicyExtractedText(report, 'adb shell dd if=/sdcard/recovery.img');
});

test('semantic policy profile treats Android runtime config as implementation, not operator policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-semantic-runtime-config-'));
  await mkdir(join(root, 'recovery', 'root', 'vendor', 'etc', 'init'), { recursive: true });
  await mkdir(join(root, 'recovery', 'root', 'vendor', 'etc', 'vintf', 'manifest'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), [
    'Proprietary source is reference-only. Do not copy restricted source.',
    'No phone actions. No adb install or reboot.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'recovery', 'root', 'vendor', 'etc', 'init', 'touchscreen.rc'), [
    '# copied from prebuilt/android16/vendor/etc/init.',
    'on post-fs-data',
    '    chmod 666 /dev/thp',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'recovery', 'root', 'vendor', 'etc', 'vintf', 'manifest', 'keymint.xml'), [
    '<!-- Live keymint manifest is copied from prebuilt/android16/vendor/etc/vintf/manifest. -->',
    '<manifest version="1.0" type="device" />',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'proprietary_reference_only', 'semantic_policy.proprietary_reference_only.proprietary_source=reference_only');
  assertEvidence(report, 'device_action_forbidden', 'semantic_policy.device_action_forbidden.device=device_actions_forbidden');
  assertNoEvidence(report, ['source_authority'], 'semantic_policy.source_authority.source=authoritative_or_vendored');
  assertNoEvidence(report, ['device_action_allowed'], 'semantic_policy.device_action_allowed.device=device_actions_allowed');
  assertNoEvidence(report, ['destructive_action'], 'semantic_policy.destructive_action.host_or_device_state=mutates_destructively');
  assert(!report.contradictions.some(item => item.category === 'semantic_policy_contradiction'));
});

test('semantic policy profile ignores schema, sample, analyzer, and copyright content policy noise', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-semantic-content-noise-'));
  await mkdir(join(root, 'dotnet', 'samples', 'Plugin'), { recursive: true });
  await mkdir(join(root, 'docs', 'decisions'), { recursive: true });
  await mkdir(join(root, 'prompt_template_samples', 'WriterPlugin'), { recursive: true });
  await mkdir(join(root, 'python', 'tests', 'unit'), { recursive: true });
  await mkdir(join(root, 'python', 'semantic_kernel', 'agents'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), [
    'This pass is read-only.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, '.editorconfig'), [
    '[*.cs]',
    'dotnet_diagnostic.CA2227.severity = none # Change to be read-only by removing the property setter',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'dotnet', 'samples', 'Plugin', 'messages-openapi.yml'), [
    'description: The unique identifier for an entity. Read-only.',
    'otherDescription: Request for user approval of the generated document.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'docs', 'decisions', '0030-branching-strategy.md'), [
    'Developers create a branch, make changes, submit a pull request, and merge back to main.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'prompt_template_samples', 'WriterPlugin', 'skprompt.txt'), [
    'Only reply the correction, the improvements and nothing else, do not write explanations.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'python', 'semantic_kernel', 'agents', 'approval.py'), [
    '# Check if MCP tool approval is required',
    '# Explicitly allow all domains for this plugin',
    'approval_required = True',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'python', 'tests', 'unit', 'test_kernel.py'), [
    '# Copyright (c) Microsoft. All rights reserved.',
    'def test_kernel():',
    '    assert True',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'read_only', 'semantic_policy.read_only.workspace=read_only');
  assertNoEvidence(report, ['write_allowed', 'source_patch_allowed'], 'patch_allowed');
  assertNoEvidence(report, ['proprietary_reference_only'], 'semantic_policy.proprietary_reference_only.proprietary_source=reference_only');
  assert(
    !report.contradictions.some(item => item.title.includes('Read-only policy conflicts')),
    'content/schema read-only prose should not collide with AGENTS.md task policy'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Approval-required policy conflicts')),
    'sample app approval prose should not become agent approval policy'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Reference-only or do-not-copy policy conflicts')),
    'copyright headers should not become proprietary reference-only policy'
  );
});

test('semantic policy profile separates tester adb limits from device action bans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-semantic-runtime-notes-'));
  await mkdir(join(root, 'app', 'src', 'main', 'java', 'example'), { recursive: true });
  await mkdir(join(root, 'scripts', 'package'), { recursive: true });
  await writeFile(join(root, 'README.md'), 'Install with `adb install app-debug.apk`.\n', 'utf8');
  await writeFile(join(root, 'app', 'src', 'main', 'java', 'example', 'CrashReporter.kt'), [
    '/**',
    " * File crash capture. We can't use logcat in the wild",
    ' * (no adb access from remote testers), so users share a crash report.',
    ' */',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'scripts', 'package', 'package.sh'), [
    '# cleanup',
    'rm -rf alpm deb rpm',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'device_action_allowed', 'semantic_policy.device_action_allowed.device=device_actions_allowed');
  assertNoEvidence(report, ['device_action_forbidden'], 'semantic_policy.device_action_forbidden.device=device_actions_forbidden');
  assertNoEvidence(report, ['destructive_action'], 'semantic_policy.destructive_action.host_or_device_state=mutates_destructively');
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

test('scanner keeps extensionless runtime script probe variables out of global contradictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-runtime-script-probes-'));
  await mkdir(join(root, 'app', 'src', 'main', 'assets', 'linux-runtime', 'bin'), { recursive: true });
  await writeFile(join(root, 'app', 'src', 'main', 'assets', 'linux-runtime', 'bin', 'waylandie-status'), [
    '#!/system/bin/sh',
    'ABSTRACT_OK=false',
    'TCP_OK=false',
    'export WAYLAND_DISPLAY="waylandie"',
    'if [ -S "$XDG_RUNTIME_DIR/wayland-0" ]; then',
    '  ABSTRACT_OK=true',
    'fi',
    'if nc -z 127.0.0.1 7890; then',
    '  TCP_OK=true',
    'fi',
    'export WAYLAND_DISPLAY="$WAYLAND_DISPLAY"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'app', 'src', 'main', 'assets', 'linux-runtime', 'bin', 'waylandie-install-driver'), [
    '#!/system/bin/sh',
    'FILE=""',
    'for candidate in "$@"; do',
    '  FILE="$candidate"',
    'done',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'child_libpath',
  });

  assertEvidence(report, 'build_variables', 'ABSTRACT_OK=false');
  assertEvidence(report, 'build_variables', 'ABSTRACT_OK=true');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for ABSTRACT_OK')),
    'probe booleans in runtime scripts should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for TCP_OK')),
    'probe booleans in runtime scripts should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for FILE')),
    'loop-local script variables should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for WAYLAND_DISPLAY')),
    'self-referential exports should not create durable definition contradictions'
  );
});

test('scanner treats Android.mk module variables as scoped recipe state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-android-mk-scope-'));
  await mkdir(join(root, 'android'), { recursive: true });
  await writeFile(join(root, 'android', 'Android.mk'), [
    'LOCAL_PATH := $(call my-dir)',
    'LOCAL_SHARED_LIBRARIES := libc libdl libdrm',
    'ifeq ($(shell test $(PLATFORM_SDK_VERSION) -ge 30; echo $$?), 0)',
    'MESA_LIBGBM_NAME := libgbm_mesa',
    'else',
    'MESA_LIBGBM_NAME := libgbm',
    'endif',
    'define mesa3d-lib',
    'include $(CLEAR_VARS)',
    'LOCAL_SHARED_LIBRARIES := $(__MY_SHARED_LIBRARIES)',
    'LOCAL_MULTILIB := first',
    'include $(BUILD_PREBUILT)',
    'endef',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'nebula_vulkan_loader',
  });

  assertEvidence(report, 'build_variables', 'LOCAL_PATH=$(call my-dir)');
  assertEvidence(report, 'build_variables', 'LOCAL_SHARED_LIBRARIES=libc libdl libdrm');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for LOCAL_PATH')),
    'Android.mk module locals should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for LOCAL_SHARED_LIBRARIES')),
    'Android.mk module locals should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for MESA_LIBGBM_NAME')),
    'conditional Android.mk recipe values should not conflict without a known-good fact'
  );
});

test('scanner treats CI matrices and generated build outputs as scoped evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-ci-generated-scope-'));
  await mkdir(join(root, 'src', 'freedreno', 'ci'), { recursive: true });
  await mkdir(join(root, 'src', 'freedreno', 'drm-shim'), { recursive: true });
  await mkdir(join(root, 'src', 'freedreno', 'registers'), { recursive: true });
  await mkdir(join(root, 'docs', 'ci'), { recursive: true });
  await mkdir(join(root, 'system'), { recursive: true });
  await writeFile(join(root, 'src', 'freedreno', 'ci', 'deqp-freedreno-a618.toml'), [
    '[deqp.gles31]',
    'deqp = "/deqp-gles/modules/gles31/deqp-gles31"',
    'profile = "gpu"',
    '',
    '[deqp.gles3]',
    'deqp = "/deqp-gles/modules/gles3/deqp-gles3"',
    'profile = "quick_gl"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'docs', 'ci', 'uri-caching.conf'), [
    'access_by_lua_block {',
    '  ngx.var.proxy_authorization = ngx.var.http_authorization;',
    '  ngx.var.proxy_authorization = "Basic " .. auth64;',
    '}',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'freedreno', 'drm-shim', 'README.md'), [
    'Run with `LD_PRELOAD=$prefix/lib/libfreedreno_noop_drm_shim.so`.',
    'Another driver can use `LD_PRELOAD=$prefix/lib/libv3d_noop_drm_shim.so`.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'freedreno', 'registers', 'adreno_pm4.xml'), [
    '<register name="A" description="first counter" />',
    '<register name="B" description="second counter" />',
    '<value STATE_BLOCK="0x6" STATE_TYPE="0x2" />',
    '<value STATE_BLOCK="0x7" STATE_TYPE="0x1" />',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'system', 'box64.conf.cmake'), '# generated box64 config template\n', 'utf8');
  await writeFile(join(root, 'CMakeLists.txt'), [
    'configure_file(system/box64.conf.cmake system/box64.conf)',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'nebula_vulkan_loader',
  });

  assertEvidence(report, 'build_variables', 'deqp=/deqp-gles/modules/gles31/deqp-gles31');
  assertExtractedText(report, 'ngx.var.proxy_authorization = ngx.var.http_authorization;');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/box64.conf');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for deqp')),
    'CI matrix variants should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for profile')),
    'CI matrix profiles should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for ngx.var.proxy_authorization')),
    'docs/ci runtime config examples should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for LD_PRELOAD')),
    'README usage examples should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for description')),
    'XML metadata attributes should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for STATE_BLOCK')),
    'XML register data should not conflict globally'
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

test('scanner scopes package config files by directory and section', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-package-config-scope-'));
  await mkdir(join(root, 'android', 'prefab'), { recursive: true });
  await mkdir(join(root, 'cmake', 'scripts'), { recursive: true });
  await mkdir(join(root, 'dotnet', 'samples'), { recursive: true });
  await mkdir(join(root, 'python', 'samples'), { recursive: true });
  await mkdir(join(root, 'rust', 'ui'), { recursive: true });
  await writeFile(join(root, '.editorconfig'), [
    '[*.cs]',
    'dotnet_diagnostic.CA1031.severity = warning',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'dotnet', 'samples', '.editorconfig'), [
    '[*.cs]',
    'dotnet_diagnostic.CA1031.severity = none',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'pyproject.toml'), [
    '[project]',
    'name = "root-package"',
    '',
    '[tool.ruff]',
    'target-version = "py311"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'python', 'samples', 'pyproject.toml'), [
    '[project]',
    'name = "sample-package"',
    '',
    '[tool.ruff]',
    'target-version = "py310"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'rust', 'ui', 'Cargo.toml'), [
    '[package]',
    'name = "lsfg-vk-ui"',
    'version = "1.0.0"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'android', 'prefab', 'prefab.json'), [
    '{',
    '  "name": "OpenXR",',
    '  "version": "@MAJOR@.@MINOR@.@PATCH@",',
    '  "graphicsDriver": "fixture"',
    '}',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'cmake', 'scripts', 'CMakePresets.json'), [
    '{',
    '  "version": 3,',
    '  "graphicsDriver": "fixture"',
    '}',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'build_variables', 'config.root.glob_cs.dotnet_diagnostic.CA1031.severity=warning');
  assertEvidence(report, 'build_variables', 'config.dotnet/samples.glob_cs.dotnet_diagnostic.CA1031.severity=none');
  assertEvidence(report, 'build_variables', 'config.root.project.name=root-package');
  assertEvidence(report, 'build_variables', 'config.python/samples.project.name=sample-package');
  assertEvidence(report, 'build_variables', 'config.android/prefab.version=@MAJOR@.@MINOR@.@PATCH@');
  assertEvidence(report, 'build_variables', 'config.cmake/scripts.version=3');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for dotnet_diagnostic.CA1031.severity')),
    'same analyzer key in nested .editorconfig files should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for name')),
    'same pyproject project.name in separate package roots should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for tool.ruff.target-version')),
    'same ruff key in separate pyproject roots should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for name')),
    'package metadata names in separate manifest roots should not conflict globally'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for version')),
    'package metadata versions in separate manifest roots should not conflict globally'
  );
});

test('scanner does not treat prompt role syntax as source paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-prompt-role-paths-'));
  await writeFile(join(root, 'agent.js'), [
    '// The transcript has system/developer and system/user/assistant layers.',
    'const runtimeDirs = ["system/bin", "system/xbin", "vendor/bin"];',
    '// Refer to BufferUsage in hardware/interfaces/graphics/common/<ver>/types.hal',
    'const p = "vendor/lib64/libmissing_prompt_role_test.so";',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/developer');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/user/assistant');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/bin');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/xbin');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/bin');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/interfaces/graphics/common/');
  assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_prompt_role_test.so');
});

test('scanner ignores external platform header references while keeping real missing blobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-external-platform-paths-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'Android', 'app', 'src', 'main', 'res', 'values'), { recursive: true });
  await writeFile(join(root, 'src', 'anw_hidden.h'), [
    '/* framework/native libs/nativebase + system/core libcutils are external AOSP references. */',
    '/* perform() ops / API ids (AOSP system/window.h) */',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'gpuvis_trace_utils.h'), [
    '// From kernel/trace/trace.h',
    '// We rely on hardware/drivers implementing the platform contract.',
    '// Location: hardware/interfaces/graphics/common/1.2/',
    '/* See system/graphics.h and system/graphics-base.h. */',
    '/* Values are defined in hardware/libhardware/include/gralloc.h. */',
    '/* See system/radio_metadata.h for the opaque radio metadata structure. */',
    '/* A vendor/tool supplier may have multiple tool IDs. */',
    '/* Returns the actual device vendor/manufacturer. */',
    '/* Information about hardware/rasterization vertex layout. */',
    '/* Dimensions are passed to firmware/hardware. */',
    'const char* missing = "vendor/lib64/libmissing_external_ref_test.so";',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'Android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), [
    '<resources>',
    '  <string name="feat_hardware_title">Full hardware/GPU access</string>',
    '</resources>',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'nebula_vulkan_loader',
  });

  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/core');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/window.h');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/graphics.h');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/graphics-base.h');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:system/radio_metadata.h');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:kernel/trace/trace.h');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/drivers');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/interfaces/graphics/common/1.2/');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/libhardware/include/gralloc.h');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/tool');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:vendor/manufacturer');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/rasterization');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:firmware/hardware');
  assertNoEvidence(report, ['invalid_paths'], 'referenced_path_missing:hardware/GPU');
  assertEvidence(report, 'invalid_paths', 'referenced_path_missing:vendor/lib64/libmissing_external_ref_test.so');
});

test('runtime profiles keep patch context and target init paths out of missing-source checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-runtime-path-scope-'));
  await mkdir(join(root, 'Documentation', 'resources', 'kernel-patches'), { recursive: true });
  await mkdir(join(root, 'vendor', 'etc', 'init'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'src', 'gallium', 'drivers', 'vc4', 'kernel'), { recursive: true });
  await writeFile(join(root, 'Documentation', 'resources', 'kernel-patches', 'cgroup.patch'), [
    'diff --git a/kernel/cgroup/cgroup.c b/kernel/cgroup/cgroup.c',
    '--- a/kernel/cgroup/cgroup.c',
    '+++ b/kernel/cgroup/cgroup.c',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'vendor', 'etc', 'init', 'init.droidspaces.rc'), [
    'service droidspacesd /vendor/bin/droidspaces daemon --foreground',
    'service droidspaces_autoboot /vendor/bin/droidspaces_autoboot.sh',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'mount.c'), [
    '/* Everything else is blocked: kernel/, vm/, fs/, dev/, abi/, debug/. */',
    '/* Android: /dev/block/loopN; recovery/desktop: /dev/loopN */',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'gallium', 'drivers', 'vc4', 'vc4_cl.h'), [
    '#include "kernel/vc4_packet.h"',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'gallium', 'drivers', 'vc4', 'kernel', 'vc4_packet.h'), [
    'enum vc4_packet { VC4_PACKET_HALT = 0 };',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'src', 'intel_perf.c'), [
    'min_file = "device/tile0/gt0/freq0/min_freq";',
    'max_file = "device/tile0/gt0/freq0/max_freq";',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'child_libpath',
  });

  assertEvidence(report, 'init_rc_services', 'init_service:droidspacesd->/vendor/bin/droidspaces');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:kernel/cgroup/cgroup.c');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:/vendor/bin/droidspaces');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:/vendor/bin/droidspaces_autoboot.sh');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:kernel/');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:recovery/desktop');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:kernel/vc4_packet.h');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:device/tile0/gt0/freq0/min_freq');
  assertNoEvidence(report, ['invalid_paths', 'missing_files'], 'referenced_path_missing:device/tile0/gt0/freq0/max_freq');
});

test('scanner treats GitHub Actions run-block assignments as local state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-workflow-run-blocks-'));
  await mkdir(join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(join(root, '.github', 'workflows', 'ci.yml'), [
    'name: ci',
    'on: pull_request',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    if: github.event.discussion.category.name == \'Ideas\' || github.event.discussion.category.name == \'Q&A\'',
    '    steps:',
    '      - name: collect projects',
    '        run: |',
    '          csproj_files=()',
    '          for file in ${{ steps.changed-files.outputs.added_modified }}; do',
    '            dir="./$file"',
    '            dir=$(echo ${dir%/*})',
    '          done',
    '          csproj_files=$(find ./ -type f -name "*.slnx" | tr \'\\n\' \' \')',
  ].join('\n'), 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'semantic_policy',
  });

  assertEvidence(report, 'local_code_assignments', 'csproj_files=()');
  assertEvidence(report, 'local_code_assignments', 'dir=./$file');
  assertNoEvidence(report, ['build_variables', 'local_code_assignments'], 'github.event.discussion.category.name=');
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for csproj_files')),
    'shell locals inside workflow run blocks should not become durable config contradictions'
  );
  assert(
    !report.contradictions.some(item => item.title.includes('Conflicting definitions for dir')),
    'loop locals inside workflow run blocks should not become durable config contradictions'
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

test('android recovery profile does not invent missing recovery files for non-recovery app roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-non-recovery-root-'));
  await writeFile(join(root, 'README.md'), [
    '# Droidspaces Nebula fixture',
    '',
    'This app has a recovery_safe lane in a control-plane UI.',
    'It is not an Android recovery device tree checkout.',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { id("com.android.application") }\n', 'utf8');

  const report = await scanProject({
    projectRoot: root,
    profile: 'android_recovery',
  });

  assertEvidence(report, 'profile_fit', 'profile_fit:android_recovery=not_applicable');
  assertNoEvidence(report, ['missing_files'], 'missing_expected_pattern:/(^|\\/)BoardConfig.*\\.mk$/i');
  assertNoEvidence(report, ['missing_files'], 'missing_expected_pattern:/(^|\\/)AndroidProducts\\.mk$/i');
  assertNoEvidence(report, ['missing_files'], 'missing_expected_pattern:/(^|\\/).*fstab.*$/i');
  assert.equal(report.contradictions.length, 0);
  assert.equal(report.patch_candidates.length, 0);
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

test('scan writer compacts oversized JSON while streaming full JSONL evidence', async () => {
  const report = await scanCurrent();
  const template = report.evidence[0];
  const evidence = Array.from({ length: 5 }, (_, index) => ({
    ...template,
    id: `EV-oversize-${index}`,
    normalized_claim: `oversized_report_fixture:${index}`,
  }));
  const oversized = {
    ...report,
    findings: evidence,
    evidence,
    summary: {
      ...report.summary,
      total_findings: evidence.length,
    },
  };

  const outDir = await mkdtemp(join(tmpdir(), 'reversa-compact-report-test-'));
  await writeScanOutputs(oversized, {
    outDir,
    json: true,
    jsonl: true,
    markdown: true,
    agentHandoff: true,
    jsonArrayLimit: 2,
    reportArrayLimit: 2,
    treeArrayLimit: 2,
  });

  const compactReport = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
  assert.equal(compactReport.output_truncation.truncated, true);
  assert.equal(compactReport.findings.length, 2);
  assert.equal(compactReport.evidence.length, 2);

  const fullEvidenceJsonl = await readFile(join(outDir, 'evidence.jsonl'), 'utf8');
  assert.equal(fullEvidenceJsonl.trim().split('\n').length, evidence.length);

  const handoffFindings = JSON.parse(await readFile(join(outDir, 'agent_handoff', 'findings.json'), 'utf8'));
  assert.equal(handoffFindings.length, 2);
  assert(existsSync(join(outDir, 'agent_handoff', 'findings_overflow.json')));
  assert(existsSync(join(outDir, 'agent_handoff', 'findings.jsonl')));

  const fullFindingsJsonl = await readFile(join(outDir, 'agent_handoff', 'findings.jsonl'), 'utf8');
  assert.equal(fullFindingsJsonl.trim().split('\n').length, evidence.length);
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

function assertExtractedText(report, textIncludes) {
  assert(
    report.evidence.some(item => item.extracted_text.includes(textIncludes)),
    `expected evidence extracted text including ${textIncludes}`
  );
}

function assertNoPolicyExtractedText(report, textIncludes) {
  const policyCategories = new Set(['device_action_allowed', 'destructive_action', 'source_authority']);
  assert(
    !report.evidence.some(item => policyCategories.has(item.category) && item.extracted_text.includes(textIncludes)),
    `expected no policy evidence extracted text including ${textIncludes}`
  );
}
