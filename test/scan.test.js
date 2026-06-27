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
const agenticFixture = join(repoRoot, 'test/fixtures/agentic-toolchain');
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
