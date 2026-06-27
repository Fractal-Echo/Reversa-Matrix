import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  classifyNebulaModules,
  validateReadOnlyCommand,
} from '../lib/nebula/companion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function displayLanes(overrides = {}) {
  return {
    protocol_version: 1,
    command: 'display lanes',
    lanes: [
      {
        id: 'phone_app_bridge',
        proof_classification: 'NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS',
        active_blocker: 'NONE_WAYLAND_DISPLAY',
        proof_metrics: {
          vkGetMemoryFdKHR_failures: 0,
          real_buffer_commits: 2,
        },
        gamescope_sidecar: 'xwayland-gamescope-14-exportable-fence-guard-a4-473ba531',
        xwayland_sidecar: 'xwayland-gamescope-06-xwayland-9f1a3d62',
        ...overrides,
      },
    ],
  };
}

test('Nebula companion classifier accepts active good with no pending', () => {
  const result = classifyNebulaModules({
    activeDisplayLanes: displayLanes(),
  });

  assert(result.classifications.includes('NEBULA_ACTIVE_PROOF_OK'));
  assert(result.classifications.includes('NEBULA_PENDING_ABSENT'));
  assert(result.classifications.includes('NEBULA_FRONTIER_MATCHES_KNOWN_GOOD'));
  assert.equal(result.pending_state, 'ABSENT');
});

test('Nebula companion classifier accepts active good with matching pending', () => {
  const result = classifyNebulaModules({
    activeDisplayLanes: displayLanes(),
    pendingDisplayLanes: displayLanes(),
  });

  assert(result.classifications.includes('NEBULA_PENDING_MATCHES_ACTIVE'));
  assert.equal(result.pending_state, 'MATCHES_ACTIVE');
  assert.equal(result.stage_recommendation, 'NO_STAGE_ACTION');
});

test('Nebula companion classifier rejects blocked-export pending below active frontier', () => {
  const result = classifyNebulaModules({
    activeDisplayLanes: displayLanes(),
    pendingDisplayLanes: displayLanes({
      proof_classification: 'NEBULA_R6_EXPORT_A1_VULKAN_LOADER_PIN_CONFIRMED',
      active_blocker: 'blocked_export',
      proof_metrics: {
        vkGetMemoryFdKHR_failures: 1199,
        real_buffer_commits: 0,
      },
    }),
  });

  assert(result.classifications.includes('NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT'));
  assert.equal(result.pending_state, 'REGRESSED_BELOW_ACTIVE');
  assert.equal(result.stage_recommendation, 'UNSAFE_TO_STAGE');
});

test('Nebula companion classifier flags A1E lower-frontier proposals', () => {
  const result = classifyNebulaModules({
    activeDisplayLanes: displayLanes(),
    proposedText: [
      'NEBULA_R6_A1E_BASELINE_SIGBUS_CONFIRMED',
      'Xserver ready=no',
      'SIGBUS stayed fatal',
      'sidecar-13',
      'GLX skipped',
    ].join('\n'),
  });

  assert(result.classifications.includes('NEBULA_FRONTIER_BELOW_KNOWN_GOOD'));
});

test('Nebula companion command safety rejects mutating command strings', () => {
  for (const command of [
    'adb install app-debug.apk',
    'adb reboot',
    'rm -rf /data/adb/modules_update',
    'chmod 666 /dev/kgsl-3d0',
    'setenforce 0',
    'ksud module install module.zip',
    'fastboot flash boot boot.img',
    'dd if=/sdcard/boot.img of=/dev/block/by-name/boot',
    'flash kernel',
  ]) {
    assert.throws(() => validateReadOnlyCommand(command), /Unsafe Nebula companion command rejected/);
  }
});

test('Nebula companion CLI captures active and pending through fake read-only ADB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-nebula-companion-'));
  const outDir = join(root, 'out');
  const fakeAdb = join(root, 'adb');
  await mkdir(outDir, { recursive: true });
  await writeFile(fakeAdb, `#!/usr/bin/env bash
set -e
cmd="$*"
if [[ "$cmd" == "devices -l" ]]; then
  echo "List of devices attached"
  echo "fake-serial device product:NX809J model:RM11"
  exit 0
fi
if [[ "$cmd" == *"if [ -x /data/adb/modules_update/nebula_core/bin/nebula-core ]"* ]]; then
  echo "PRESENT"
  exit 0
fi
if [[ "$cmd" == *"pm path io.droidspaces.nebula.waylandie"* ]]; then
  echo "package:/data/app/current/waylandie/base.apk"
  exit 0
fi
if [[ "$cmd" == *"pm path io.droidspaces.nebula" ]]; then
  echo "package:/data/app/current/nebula/base.apk"
  exit 0
fi
if [[ "$cmd" == *"cmd package list packages -U"* ]]; then
  echo "package:io.droidspaces.nebula uid:10517"
  echo "package:io.droidspaces.nebula.waylandie uid:10518"
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules/nebula_core/bin/nebula-core status --json"* ]]; then
  echo '{"protocol_version":1,"module_id":"nebula_core","module_version":"0.2.2"}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules/nebula_core/bin/nebula-core display lanes --json"* ]]; then
  echo '{"protocol_version":1,"lanes":[{"id":"phone_app_bridge","proof_classification":"NEBULA_R6_WAYLAND_WORKING_REAL_BUFFER_PASS","active_blocker":"NONE_WAYLAND_DISPLAY","proof_metrics":{"vkGetMemoryFdKHR_failures":0,"real_buffer_commits":2}}]}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules/nebula_core/bin/nebula-core display method-profiles --json"* ]]; then
  echo '{"protocol_version":1,"command":"display method-profiles","profiles":[]}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules/nebula_core/bin/nebula-core display method-containers --json"* ]]; then
  echo '{"protocol_version":1,"command":"display method-containers","containers":[]}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules/nebula_core/bin/nebula-core integrations baseline --json"* ]]; then
  echo '{"protocol_version":1,"command":"integrations baseline","integrations":[]}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules/nebula_core/bin/nebula-core cooling policy --json"* ]]; then
  echo '{"protocol_version":1,"command":"cooling policy","preview_only":true,"applied":false}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules_update/nebula_core/bin/nebula-core status --json"* ]]; then
  echo '{"protocol_version":1,"module_id":"nebula_core","module_version":"0.2.2-pending"}'
  exit 0
fi
if [[ "$cmd" == *"/data/adb/modules_update/nebula_core/bin/nebula-core display lanes --json"* ]]; then
  echo '{"protocol_version":1,"lanes":[{"id":"phone_app_bridge","proof_classification":"NEBULA_R6_EXPORT_A1_VULKAN_LOADER_PIN_CONFIRMED","active_blocker":"blocked_export","proof_metrics":{"vkGetMemoryFdKHR_failures":1199,"real_buffer_commits":0}}]}'
  exit 0
fi
echo "unexpected fake adb command: $cmd" >&2
exit 7
`, 'utf8');
  await chmod(fakeAdb, 0o755);

  const run = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'nebula',
    'compare-modules',
    '--adb',
    'fake-serial',
    '--adb-binary',
    fakeAdb,
    '--out',
    outDir,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const classification = JSON.parse(await readFile(join(outDir, 'classification.json'), 'utf8'));
  assert(classification.classifications.includes('NEBULA_ACTIVE_PROOF_OK'));
  assert(classification.classifications.includes('NEBULA_PENDING_REGRESSED_BLOCKED_EXPORT'));
  assert.equal(classification.stage_recommendation, 'UNSAFE_TO_STAGE');
  assert(existsSync(join(outDir, 'active-display-lanes.json')));
  assert(existsSync(join(outDir, 'pending-display-lanes.json')));

  const safety = JSON.parse(await readFile(join(outDir, 'safety.json'), 'utf8'));
  assert.equal(safety.read_only, true);
  assert.equal(safety.pending_module_default_authority, false);
  assert.equal(safety.arbitrary_shell_execution, false);
  const commands = safety.commands.map(item => item.command).join('\n');
  assert.doesNotMatch(commands, /adb install|reboot|rm -rf|fastboot|setenforce/);
});
