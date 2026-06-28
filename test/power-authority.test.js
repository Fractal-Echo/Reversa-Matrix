import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildPowerAuthorityProof,
  capturePowerAuthorityProof,
  resolvePowerAuthority,
} from '../scripts/capture-power-authority-proof.js';
import { buildPowerTdpPolicyMatrix } from '../scripts/build-power-tdp-policy-matrix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const fixtureRoot = join(repoRoot, 'test', 'fixtures', 'power-authority');

test('Power authority resolver keeps WSL as observer-only even when ryzenadj is visible', async () => {
  const fixture = await loadFixture('wsl-ryzenadj-present.json');
  const proof = buildPowerAuthorityProof({
    timestamp: 'fixture',
    powerProof: fixture.power_proof,
    privilegeState: fixture.privilege,
  });

  assert.equal(proof.os_layer.detected, 'wsl');
  assert.equal(proof.os_layer.observer_only, true);
  assert.equal(proof.authority.detected_authority_layer, 'WSL_OBSERVER');
  assert.equal(proof.authority.mutation_allowed_by_policy, false);
  assert(proof.authority.denial_reasons.includes('WSL_OBSERVER_ONLY'));
});

test('Power authority resolver distinguishes Windows host plus ryzenadj without allowing writes', async () => {
  const fixture = await loadFixture('windows-ryzenadj-present.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.os_layer.detected, 'windows');
  assert.equal(resolved.authority.backend_owner, 'RYZENADJ_DIRECT_AUTHORITY');
  assert.equal(resolved.classification, 'POWER_AUTHORITY_RYZENADJ_CANDIDATE');
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
  assert(resolved.authority.denial_reasons.includes('RUNTIME_PROOF_MISSING'));
});

test('Power authority resolver distinguishes Linux bare metal plus ryzenadj without allowing writes', async () => {
  const fixture = await loadFixture('linux-baremetal-ryzenadj-present.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.os_layer.detected, 'linux');
  assert.equal(resolved.authority.backend_owner, 'RYZENADJ_DIRECT_AUTHORITY');
  assert.equal(resolved.classification, 'POWER_AUTHORITY_RYZENADJ_CANDIDATE');
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
});

test('Power authority resolver distinguishes HHD authority without allowing writes', async () => {
  const fixture = await loadFixture('hhd-present.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.authority.detected_authority_layer, 'HANDHELD_DAEMON_HHD_AUTHORITY');
  assert.equal(resolved.authority.backend_owner, 'HANDHELD_DAEMON_HHD_AUTHORITY');
  assert.equal(resolved.classification, 'POWER_AUTHORITY_HHD_CANDIDATE');
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
});

test('Power authority resolver treats no backend as unsafe for mutation', async () => {
  const fixture = await loadFixture('no-backend.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.classification, 'POWER_AUTHORITY_NO_BACKEND');
  assert.equal(resolved.authority.detected_authority_layer, 'UNKNOWN_UNSAFE_AUTHORITY');
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
  assert(resolved.authority.denial_reasons.includes('NO_MUTATION_BACKEND'));
});

test('Power authority resolver forces write_allowed false for conflicting backends', async () => {
  const fixture = await loadFixture('conflicting-backends.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.classification, 'POWER_AUTHORITY_CONFLICTING_BACKENDS');
  assert.deepEqual(resolved.authority.conflicting_backends, ['ryzenadj', 'hhd', 'smu']);
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
  assert(resolved.authority.denial_reasons.includes('CONFLICTING_BACKENDS'));
});

test('Power authority resolver forces write_allowed false when privilege is missing', async () => {
  const fixture = await loadFixture('privilege-missing.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.classification, 'POWER_AUTHORITY_PRIVILEGE_MISSING');
  assert.equal(resolved.privilege_state.has_mutation_privilege, false);
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
  assert(resolved.authority.denial_reasons.includes('PRIVILEGE_MISSING'));
});

test('Power authority resolver forces write_allowed false for unsafe unknown authority', async () => {
  const fixture = await loadFixture('unsafe-unknown-authority.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.classification, 'POWER_AUTHORITY_UNKNOWN_UNSAFE');
  assert.equal(resolved.authority.detected_authority_layer, 'UNKNOWN_UNSAFE_AUTHORITY');
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
  assert(resolved.authority.denial_reasons.includes('UNKNOWN_UNSAFE_AUTHORITY'));
});

test('Power authority resolver keeps backend presence separate from write permission', async () => {
  const fixture = await loadFixture('windows-ryzenadj-present.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);
  const ryzenadj = resolved.backend_availability.find(item => item.backend === 'ryzenadj');

  assert.equal(ryzenadj.status, 'present');
  assert.equal(ryzenadj.mutation_capable_in_principle, true);
  assert.equal(ryzenadj.mutation_allowed_by_policy, false);
  assert.equal(ryzenadj.denial_reason, 'RUNTIME_PROOF_MISSING');
});

test('Power authority resolver requires runtime proof before mutation can be considered', async () => {
  const fixture = await loadFixture('windows-ryzenadj-present.json');
  const resolved = resolvePowerAuthority(fixture.power_proof, fixture.privilege);

  assert.equal(resolved.runtime_test_performed, false);
  assert.equal(resolved.authority.mutation_allowed_by_policy, false);
  assert(resolved.authority.denial_reasons.includes('RUNTIME_PROOF_MISSING'));
});

test('Power authority capture writes read-only Stage 02 outputs from an existing power proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-power-authority-'));
  const fixture = await loadFixture('windows-ryzenadj-present.json');
  const powerProofPath = join(root, 'power-tdp-proof.json');
  const privilegePath = join(root, 'privilege.json');
  const out = join(root, 'out');
  await writeFile(powerProofPath, JSON.stringify(fixture.power_proof), 'utf8');
  await writeFile(privilegePath, JSON.stringify(fixture.privilege), 'utf8');

  const result = await capturePowerAuthorityProof({ out, powerProof: powerProofPath, privilegeProbe: privilegePath });

  assert.equal(result.proof.read_only, true);
  assert.equal(result.proof.proof.tdp_write_performed, false);
  assert.equal(result.proof.proof.game_launch_performed, false);
  assert(existsSync(join(out, 'power-authority-proof.json')));
  assert(existsSync(join(out, 'authority-backends.tsv')));
});

test('Power/TDP policy matrix remains read-only after authority proof additions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reversa-power-authority-policy-'));
  const proofPath = join(root, 'power-tdp-proof.json');
  const datasetPath = join(root, 'power.jsonl');
  const out = join(root, 'out');
  const fixture = await loadFixture('windows-ryzenadj-present.json');
  await writeFile(proofPath, JSON.stringify(fixture.power_proof), 'utf8');
  await writeFile(datasetPath, JSON.stringify({
    id: 'tdp_ryzenadj',
    claim: 'TDP_BACKEND_RYZENADJ',
    source_authority: false,
    generated_artifact: true,
  }) + '\n', 'utf8');

  const result = await buildPowerTdpPolicyMatrix({ proof: proofPath, dataset: datasetPath, out });

  assert.equal(result.summary.write_allowed, false);
  assert.equal(result.matrix.rows[0].write_allowed, false);
});

test('studio command exposes power-authority-proof help', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'bin/reversa.js'),
    'studio',
    'power-authority-proof',
    '--help',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /power-authority-proof/);
  assert.match(result.stdout, /--power-proof <path>/);
  assert.match(result.stdout, /authority layer/i);
});

async function loadFixture(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), 'utf8'));
}
