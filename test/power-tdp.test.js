import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildPowerTdpProof,
  capturePowerTdpProof,
  isForbiddenPowerCommand,
} from '../scripts/capture-power-tdp-proof.js';
import {
  buildPowerTdpPolicyMatrix,
  classifyPowerPolicyRecord,
} from '../scripts/build-power-tdp-policy-matrix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

test('Power/TDP proof parses Windows CPU and GPU evidence', () => {
  const proof = powerProofFixture();

  assert.equal(proof.cpu.name, 'AMD Ryzen AI 9 HX 370 w/ Radeon 890M');
  assert.equal(proof.cpu.cores, 12);
  assert.equal(proof.cpu.threads, 24);
  assert.equal(proof.gpu.nvidia_visible, true);
  assert.equal(proof.gpu.radeon_890m_visible, true);
});

test('Power/TDP proof records battery present and absent states', () => {
  const present = powerProofFixture();
  const absent = powerProofFixture({ windowsProbe: { ...windowsProbeFixture(), battery: [] } });

  assert.equal(present.power.battery_present, true);
  assert.equal(present.power.battery_percent, 90);
  assert.equal(absent.power.battery_present, false);
  assert.equal(absent.power.battery_percent, null);
});

test('Power/TDP proof parses powercfg active scheme', () => {
  const proof = powerProofFixture();

  assert.equal(proof.power.windows_power_scheme, 'Balanced');
  assert.equal(proof.tdp_backends.powercfg, 'present');
});

test('Power/TDP proof classifies ryzenadj present by path only', () => {
  const proof = powerProofFixture({
    backendProbe: {
      ryzenadj: 'present',
      hhd: 'missing',
      acpi_call: 'missing',
      smu: 'missing',
      powerprofilesctl: 'missing',
      powercfg: 'present',
    },
  });

  assert.equal(proof.classification, 'POWER_PROOF_RYZENADJ_PRESENT');
  assert.equal(proof.proof.tdp_write_performed, false);
  assert.equal(proof.proof.runtime_test_performed, false);
});

test('Power/TDP proof rejects ryzenadj write commands', () => {
  assert.equal(isForbiddenPowerCommand('ryzenadj', ['--stapm-limit=25000']), true);
  assert.equal(isForbiddenPowerCommand('ryzenadj', ['--fast-limit', '35000']), true);
  assert.equal(isForbiddenPowerCommand('ryzenadj', ['--help']), false);
});

test('Power/TDP proof classifies HHD present by path only', () => {
  const proof = powerProofFixture({
    backendProbe: {
      ryzenadj: 'missing',
      hhd: 'present',
      acpi_call: 'missing',
      smu: 'missing',
      powerprofilesctl: 'missing',
      powercfg: 'missing',
    },
  });

  assert.equal(proof.classification, 'POWER_PROOF_HHD_PRESENT');
  assert.equal(proof.proof.tdp_write_performed, false);
});

test('Power/TDP proof rejects systemctl service mutation commands', () => {
  assert.equal(isForbiddenPowerCommand('systemctl', ['start', 'hhd']), true);
  assert.equal(isForbiddenPowerCommand('systemctl', ['stop', 'hhd']), true);
  assert.equal(isForbiddenPowerCommand('systemctl', ['status', 'hhd']), false);
});

test('Power/TDP proof marks WSL as not authority', () => {
  const proof = powerProofFixture({
    linuxProbe: {
      procVersion: 'Linux version 6.6.87.2-microsoft-standard-WSL2',
      uname: 'Linux host microsoft-standard-WSL2',
      cpuinfo: '',
      powerSupplies: [],
      modules: [],
      commands: {},
    },
  });

  assert.equal(proof.platform.is_wsl, true);
  assert(proof.notes.some(note => /WSL_NOT_AUTHORITY/.test(note)));
});

test('Power/TDP policy matrix never suggests write without approval', () => {
  const proof = powerProofFixture();
  const row = classifyPowerPolicyRecord(powerRecord({ claim: 'TDP_BACKEND_RYZENADJ' }), proof);

  assert.equal(row.write_allowed, false);
  assert(row.categories.includes('APPROVAL_REQUIRED'));
  assert(row.categories.includes('WRITE_DEFERRED'));
  assert.match(row.recommended_policy, /Proposal only/i);
});

test('Power/TDP game profile stays candidate-only', () => {
  const proof = powerProofFixture();
  const row = classifyPowerPolicyRecord(powerRecord({ claim: 'GAME_PROFILE_STEAM_APPID' }), proof);

  assert.equal(row.write_allowed, false);
  assert(row.categories.includes('GAME_PROFILE_CANDIDATE'));
  assert(row.categories.includes('RUNTIME_PROOF_REQUIRED'));
  assert(!row.categories.includes('APPROVAL_REQUIRED'));
});

test('Power/TDP policy matrix writes generated non-authority outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-power-policy-'));
  const proofPath = join(root, 'power-tdp-proof.json');
  const datasetPath = join(root, 'power.jsonl');
  const out = join(root, 'out');
  await writeFile(proofPath, JSON.stringify(powerProofFixture()), 'utf8');
  await writeFile(datasetPath, [
    JSON.stringify(powerRecord({ id: 'p1', claim: 'TDP_BACKEND_RYZENADJ' })),
    JSON.stringify(powerRecord({ id: 'p2', claim: 'GAME_PROFILE_STEAM_APPID' })),
    JSON.stringify(powerRecord({ id: 'p3', claim: 'BATTERY_CAP_PRESENT' })),
  ].join('\n') + '\n', 'utf8');

  const result = await buildPowerTdpPolicyMatrix({ proof: proofPath, dataset: datasetPath, out });
  const matrix = JSON.parse(await readFile(join(out, 'power-tdp-policy-matrix.json'), 'utf8'));

  assert.equal(result.summary.total_records, 3);
  assert.equal(matrix.source_authority, false);
  assert.equal(matrix.generated_artifact, true);
  assert.equal(matrix.summary.write_allowed, false);
  assert(existsSync(join(out, 'power-action-gates.tsv')));
});

test('Power/TDP proof capture writes read-only outputs from fixture probes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-power-proof-'));
  const windowsProbe = join(root, 'windows.json');
  const linuxProbe = join(root, 'linux.json');
  const out = join(root, 'out');
  await writeFile(windowsProbe, JSON.stringify(windowsProbeFixture()), 'utf8');
  await writeFile(linuxProbe, JSON.stringify(linuxProbeFixture()), 'utf8');

  const result = await capturePowerTdpProof({ out, windowsProbe, linuxProbe });

  assert.equal(result.proof.proof.read_only, true);
  assert.equal(result.proof.proof.tdp_write_performed, false);
  assert(existsSync(join(out, 'power-tdp-proof.json')));
  assert(existsSync(join(out, 'backend-probe.tsv')));
});

test('Power/TDP Studio fixtures are display artifacts only', async () => {
  const proof = JSON.parse(await readFile(join(repoRoot, 'reversa-studio', 'fixtures', 'sample-power-tdp-proof.json'), 'utf8'));
  const matrix = JSON.parse(await readFile(join(repoRoot, 'reversa-studio', 'fixtures', 'sample-power-policy-matrix.json'), 'utf8'));

  assert.equal(proof.source_authority, false);
  assert.equal(proof.proof.tdp_write_performed, false);
  assert.equal(proof.proof.runtime_test_performed, false);
  assert.equal(matrix.source_authority, false);
  assert.equal(matrix.summary.write_allowed, false);
});

test('Power/TDP Studio UI contains proof, backend, policy, and action-gate panels', async () => {
  const text = await readFile(join(repoRoot, 'reversa-studio', 'index.html'), 'utf8');

  assert.match(text, /Power \/ TDP Proof/);
  assert.match(text, /Host Power Proof/);
  assert.match(text, /Backend Discovery/);
  assert.match(text, /Policy Matrix/);
  assert.match(text, /Action Gate/);
});

test('Power/TDP proof script does not run mutation commands', async () => {
  const text = await readFile(join(repoRoot, 'scripts', 'capture-power-tdp-proof.js'), 'utf8');

  assert.doesNotMatch(text, /runReadOnlyCommand\('systemctl'/);
  assert.doesNotMatch(text, /runReadOnlyCommand\('modprobe'/);
  assert.doesNotMatch(text, /runReadOnlyCommand\('insmod'/);
  assert.doesNotMatch(text, /runReadOnlyCommand\('powercfg(?:\.exe)?',\s*\['\/setactive'/i);
  assert.doesNotMatch(text, /runReadOnlyCommand\('ryzenadj',\s*\['--(?:stapm|fast|slow)-limit/i);
});

function powerProofFixture(overrides = {}) {
  return buildPowerTdpProof({
    timestamp: 'fixture',
    host: 'test-host',
    windowsProbe: overrides.windowsProbe ?? windowsProbeFixture(),
    linuxProbe: overrides.linuxProbe ?? linuxProbeFixture(),
    backendProbe: overrides.backendProbe ?? {
      ryzenadj: 'present',
      hhd: 'missing',
      acpi_call: 'missing',
      smu: 'unknown',
      powerprofilesctl: 'missing',
      powercfg: 'present',
    },
  });
}

function windowsProbeFixture() {
  return {
    cpu: {
      Name: 'AMD Ryzen AI 9 HX 370 w/ Radeon 890M',
      Manufacturer: 'AuthenticAMD',
      NumberOfCores: 12,
      NumberOfLogicalProcessors: 24,
    },
    video: [
      { Name: 'NVIDIA GeForce RTX 5090', DriverVersion: 'fixture' },
      { Name: 'AMD Radeon(TM) 890M Graphics', DriverVersion: 'fixture' },
    ],
    battery: [
      { Name: 'Internal Battery', BatteryStatus: 2, EstimatedChargeRemaining: 90 },
    ],
    computerSystem: {
      Manufacturer: 'Framework',
      Model: 'HX 370 fixture',
      TotalPhysicalMemory: 68719476736,
    },
    operatingSystem: {
      Caption: 'Microsoft Windows 11',
      BuildNumber: '26200',
    },
    powercfg: {
      activeScheme: 'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)',
      list: 'Existing Power Schemes (* Active)',
    },
    paths: {
      ryzenadj: 'C:\\Tools\\ryzenadj.exe',
      hhd: '',
      hhdctl: '',
    },
  };
}

function linuxProbeFixture() {
  return {
    uname: 'Linux test-host 6.6.87.2-microsoft-standard-WSL2',
    procVersion: 'Linux version 6.6.87.2-microsoft-standard-WSL2',
    cpuinfo: 'model name\t: AMD Ryzen AI 9 HX 370 w/ Radeon 890M\n',
    powerSupplies: [],
    modules: [],
    commands: {
      ryzenadj: false,
      hhd: false,
      hhdctl: false,
      powerprofilesctl: false,
    },
    powerProfile: null,
    smu_visible: false,
  };
}

function powerRecord(overrides = {}) {
  return {
    id: overrides.id ?? 'power_tdp_0001',
    source_authority: false,
    generated_artifact: true,
    source_project: overrides.source_project ?? 'fixture',
    claim: overrides.claim ?? 'TDP_BACKEND_RYZENADJ',
    labels: overrides.labels ?? ['power_tdp_backend'],
    text: overrides.text ?? 'fixture text',
  };
}
