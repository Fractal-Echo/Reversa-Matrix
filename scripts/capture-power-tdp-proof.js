#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { cpus, hostname, machine, platform, release, type } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

export const POWER_PROOF_LEVELS = new Set([
  'POWER_PROOF_UNAVAILABLE',
  'POWER_PROOF_HOST_VISIBLE',
  'POWER_PROOF_BATTERY_VISIBLE',
  'POWER_PROOF_AC_STATE_VISIBLE',
  'POWER_PROOF_BACKEND_DISCOVERED',
  'POWER_PROOF_RYZENADJ_PRESENT',
  'POWER_PROOF_HHD_PRESENT',
  'POWER_PROOF_CONTROL_CANDIDATE',
  'POWER_PROOF_WRITE_DEFERRED',
  'POWER_PROOF_POLICY_MATRIX_READY',
]);

export const FORBIDDEN_POWER_COMMAND_PATTERNS = [
  /\bryzenadj\b.*--(?:stapm|fast|slow)-limit\b/i,
  /\bsystemctl\s+(?:start|stop|restart|enable|disable)\b/i,
  /\bhhd\b.*\b(?:start|enable|install)\b/i,
  /\bmodprobe\b/i,
  /\binsmod\b/i,
  /\btee\s+/i,
  /\becho\b.*>\s*\/sys/i,
  /\bsudo\b.*(?:ryzenadj|systemctl|modprobe|insmod|tee|powercfg|hhd)\b/i,
  /\bpowercfg(?:\.exe)?\s+\/(?:setactive|change)\b/i,
];

const BACKEND_NAMES = [
  'ryzenadj',
  'hhd',
  'acpi_call',
  'smu',
  'powerprofilesctl',
  'powercfg',
];

export async function capturePowerTdpProof(options) {
  const outDir = resolveRequiredOut(options.out);
  await mkdir(outDir, { recursive: true });

  const stderrLines = [];
  const windowsProbe = await loadWindowsProbe(options.windowsProbe, stderrLines);
  const linuxProbe = await loadLinuxProbe(options.linuxProbe, stderrLines);
  const backendProbe = probePowerBackends({ windowsProbe, linuxProbe, stderrLines });
  const proof = buildPowerTdpProof({
    timestamp: new Date().toISOString(),
    host: hostname(),
    windowsProbe,
    linuxProbe,
    backendProbe,
  });

  await writePowerProofOutputs(outDir, proof, stderrLines);
  return { outDir, proof };
}

export function buildPowerTdpProof({ timestamp, host, windowsProbe = null, linuxProbe = null, backendProbe = null }) {
  const normalizedWindows = normalizeWindowsProbe(windowsProbe);
  const normalizedLinux = normalizeLinuxProbe(linuxProbe);
  const currentPlatform = normalizePlatform(normalizedLinux);
  const cpu = normalizeCpu(normalizedWindows, normalizedLinux);
  const gpu = normalizeGpu(normalizedWindows, normalizedLinux);
  const power = normalizePower(normalizedWindows, normalizedLinux);
  const tdpBackends = normalizeTdpBackends(backendProbe, normalizedWindows, normalizedLinux);
  const writeCapableBackendSeen = ['ryzenadj', 'hhd', 'acpi_call', 'smu'].some(name => tdpBackends[name] === 'present');
  const classification = classifyPowerProof({
    platform: currentPlatform,
    power,
    tdpBackends,
    writeCapableBackendSeen,
  });

  if (!POWER_PROOF_LEVELS.has(classification)) {
    throw new Error(`Invalid power proof classification: ${classification}`);
  }

  return {
    schema_version: 1,
    timestamp,
    host,
    platform: currentPlatform,
    cpu,
    gpu,
    power,
    tdp_backends: tdpBackends,
    proof: {
      read_only: true,
      write_capable_backend_seen: writeCapableBackendSeen,
      tdp_write_performed: false,
      runtime_test_performed: false,
    },
    classification,
    source_authority: false,
    generated_artifact: true,
    notes: buildNotes({ platform: currentPlatform, power, tdpBackends, writeCapableBackendSeen }),
  };
}

export function classifyPowerProof({ platform: currentPlatform, power, tdpBackends, writeCapableBackendSeen }) {
  if (tdpBackends.ryzenadj === 'present') return 'POWER_PROOF_RYZENADJ_PRESENT';
  if (tdpBackends.hhd === 'present') return 'POWER_PROOF_HHD_PRESENT';
  if (writeCapableBackendSeen) return 'POWER_PROOF_CONTROL_CANDIDATE';
  if (Object.values(tdpBackends).some(status => status === 'present')) return 'POWER_PROOF_BACKEND_DISCOVERED';
  if (power.ac_online !== null) return 'POWER_PROOF_AC_STATE_VISIBLE';
  if (power.battery_present) return 'POWER_PROOF_BATTERY_VISIBLE';
  if (currentPlatform.os !== 'unknown' || hasValue(power.windows_power_scheme) || hasValue(power.linux_power_profile)) return 'POWER_PROOF_HOST_VISIBLE';
  return 'POWER_PROOF_UNAVAILABLE';
}

export function isForbiddenPowerCommand(command, args = []) {
  const rendered = [command, ...args].filter(Boolean).join(' ');
  return FORBIDDEN_POWER_COMMAND_PATTERNS.some(pattern => pattern.test(rendered));
}

function probePowerBackends({ windowsProbe, linuxProbe, stderrLines }) {
  const result = Object.fromEntries(BACKEND_NAMES.map(name => [name, 'missing']));
  const normalizedWindows = normalizeWindowsProbe(windowsProbe);
  const normalizedLinux = normalizeLinuxProbe(linuxProbe);

  if (normalizedWindows.powercfg?.activeScheme || normalizedWindows.powercfg?.list) result.powercfg = 'present';
  if (normalizedWindows.paths?.ryzenadj) result.ryzenadj = 'present';
  if (normalizedWindows.paths?.hhd || normalizedWindows.paths?.hhdctl) result.hhd = 'present';

  if (normalizedLinux.commands?.ryzenadj) {
    result.ryzenadj = 'present';
    runReadOnlyCommand('ryzenadj', ['--help'], stderrLines, { timeout: 5000, maxBuffer: 64 * 1024 });
  }
  if (normalizedLinux.commands?.hhd || normalizedLinux.commands?.hhdctl) result.hhd = 'present';
  if (normalizedLinux.commands?.powerprofilesctl) result.powerprofilesctl = 'present';
  if (normalizedLinux.modules.includes('acpi_call')) result.acpi_call = 'present';
  if (normalizedLinux.modules.some(name => /ryzen_smu|amd_pmc|amd_smu/i.test(name)) || normalizedLinux.smu_visible) result.smu = 'present';

  return result;
}

async function loadWindowsProbe(windowsProbePath, stderrLines) {
  if (windowsProbePath) {
    return parseProbeText(await readFile(windowsProbePath, 'utf8'), windowsProbePath);
  }
  if (platform() === 'win32' || commandExists('powershell.exe')) {
    return runWindowsReadOnlyProbe(stderrLines);
  }
  return null;
}

async function loadLinuxProbe(linuxProbePath, stderrLines) {
  if (linuxProbePath) {
    return parseProbeText(await readFile(linuxProbePath, 'utf8'), linuxProbePath);
  }
  if (platform() === 'linux') {
    return runLinuxReadOnlyProbe(stderrLines);
  }
  return null;
}

function runWindowsReadOnlyProbe(stderrLines) {
  const shell = platform() === 'win32' ? 'powershell.exe' : 'powershell.exe';
  if (!commandExists(shell)) return null;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors
$video = Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,PNPDeviceID
$battery = Get-CimInstance Win32_Battery | Select-Object Name,BatteryStatus,EstimatedChargeRemaining
$system = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,BuildNumber
$powerList = powercfg /L 2>$null
$activeScheme = powercfg /GETACTIVESCHEME 2>$null
$paths = @{
  ryzenadj = (where.exe ryzenadj 2>$null | Select-Object -First 1)
  hhd = (where.exe hhd 2>$null | Select-Object -First 1)
  hhdctl = (where.exe hhdctl 2>$null | Select-Object -First 1)
}
[pscustomobject]@{
  cpu = $cpu
  video = $video
  battery = $battery
  computerSystem = $system
  operatingSystem = $os
  powercfg = @{ list = ($powerList -join [Environment]::NewLine); activeScheme = ($activeScheme -join [Environment]::NewLine) }
  paths = $paths
} | ConvertTo-Json -Depth 6
`;
  const result = runReadOnlyCommand(shell, ['-NoProfile', '-NonInteractive', '-Command', script], stderrLines, {
    timeout: 12000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    stderrLines.push(`[windows-probe] Could not parse JSON: ${error.message}`);
    return null;
  }
}

function runLinuxReadOnlyProbe(stderrLines) {
  const commands = Object.fromEntries(['ryzenadj', 'hhd', 'hhdctl', 'powerprofilesctl'].map(name => [name, commandExists(name)]));
  const powerSupplies = readPowerSupplies(stderrLines);
  const modules = readModules(stderrLines);
  const cpuinfo = readTextIfExists('/proc/cpuinfo');
  const procVersion = readTextIfExists('/proc/version');
  const uname = runReadOnlyCommand('uname', ['-a'], stderrLines, { timeout: 3000 }).stdout.trim();
  const powerProfile = commands.powerprofilesctl
    ? runReadOnlyCommand('powerprofilesctl', ['get'], stderrLines, { timeout: 5000 }).stdout.trim()
    : null;
  return {
    uname,
    cpuinfo,
    procVersion,
    powerSupplies,
    modules,
    commands,
    powerProfile,
    smu_visible: existsSync('/sys/kernel/ryzen_smu_drv') || existsSync('/sys/class/hwmon'),
  };
}

function runReadOnlyCommand(command, args, stderrLines, options = {}) {
  if (isForbiddenPowerCommand(command, args)) {
    throw new Error(`Refusing forbidden power/TDP command: ${[command, ...args].join(' ')}`);
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 5000,
    maxBuffer: options.maxBuffer ?? 256 * 1024,
  });
  if (result.stderr) stderrLines?.push?.(`[${command}] ${result.stderr.trim()}`);
  if (result.error?.message) stderrLines?.push?.(`[${command}] ${result.error.message}`);
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function normalizeWindowsProbe(probe) {
  if (!probe) return {};
  return {
    cpu: first(probe.cpu ?? probe.processor),
    video: toArray(probe.video),
    battery: toArray(probe.battery),
    computerSystem: probe.computerSystem ?? probe.system ?? {},
    operatingSystem: probe.operatingSystem ?? probe.os ?? {},
    powercfg: probe.powercfg ?? {},
    paths: probe.paths ?? {},
  };
}

function normalizeLinuxProbe(probe) {
  if (!probe) {
    return {
      uname: '',
      cpuinfo: '',
      procVersion: '',
      powerSupplies: [],
      modules: [],
      commands: {},
      powerProfile: null,
      smu_visible: false,
    };
  }
  return {
    uname: clean(probe.uname) ?? '',
    cpuinfo: clean(probe.cpuinfo) ?? '',
    procVersion: clean(probe.procVersion ?? probe.proc_version) ?? '',
    powerSupplies: toArray(probe.powerSupplies ?? probe.power_supplies),
    modules: toArray(probe.modules),
    commands: probe.commands ?? {},
    powerProfile: clean(probe.powerProfile ?? probe.power_profile),
    smu_visible: Boolean(probe.smu_visible),
  };
}

function normalizePlatform(linuxProbe) {
  const os = platform() === 'win32' ? 'windows' : (platform() === 'linux' ? (isWsl(linuxProbe) ? 'wsl' : 'linux') : 'unknown');
  return {
    os,
    kernel: release() || linuxProbe.uname || 'unknown',
    machine: machine() || 'unknown',
    is_wsl: os === 'wsl',
  };
}

function normalizeCpu(windowsProbe, linuxProbe) {
  const cpu = windowsProbe.cpu ?? {};
  const osCpu = cpus()[0] ?? {};
  const linuxName = parseCpuinfoValue(linuxProbe.cpuinfo, 'model name') ?? parseCpuinfoValue(linuxProbe.cpuinfo, 'Hardware');
  const name = clean(cpu.Name ?? cpu.name ?? linuxName ?? osCpu.model);
  return {
    name: name || 'unknown',
    vendor: clean(cpu.Manufacturer ?? cpu.manufacturer ?? inferCpuVendor(name)) || 'unknown',
    cores: Number(cpu.NumberOfCores ?? cpu.cores) || Math.max(cpus().length ? Math.floor(cpus().length / 2) : 0, 0),
    threads: Number(cpu.NumberOfLogicalProcessors ?? cpu.threads) || cpus().length || 0,
  };
}

function normalizeGpu(windowsProbe, linuxProbe) {
  const adapters = toArray(windowsProbe.video).map(item => ({
    name: clean(item.Name ?? item.name),
    driver_version: clean(item.DriverVersion ?? item.driverVersion),
    pnp_device_id: item.PNPDeviceID ?? item.pnpDeviceId ?? null,
  })).filter(item => item.name);
  const text = `${adapters.map(item => item.name).join('\n')}\n${linuxProbe.uname}\n${linuxProbe.cpuinfo}`;
  return {
    nvidia_visible: /NVIDIA|RTX\s*5090/i.test(text) || commandExists('nvidia-smi'),
    amd_visible: /AMD|Radeon/i.test(text),
    radeon_890m_visible: /Radeon.*890M|890M.*Radeon/i.test(text),
    adapters,
  };
}

function normalizePower(windowsProbe, linuxProbe) {
  const batteryRows = toArray(windowsProbe.battery);
  const linuxBattery = linuxProbe.powerSupplies.find(item => item.type === 'Battery');
  const linuxAc = linuxProbe.powerSupplies.find(item => /Mains|AC|USB/i.test(item.type));
  const windowsBatteryPresent = batteryRows.length > 0;
  const windowsBatteryPercent = firstNumber(batteryRows.map(item => item.EstimatedChargeRemaining ?? item.estimatedChargeRemaining));
  const windowsAcOnline = inferWindowsAcOnline(batteryRows);
  const activeScheme = parsePowercfgActiveScheme(windowsProbe.powercfg?.activeScheme);
  return {
    battery_present: windowsBatteryPresent || Boolean(linuxBattery),
    ac_online: windowsAcOnline ?? parseNullableBool(linuxAc?.online),
    battery_percent: windowsBatteryPercent ?? nullableNumber(linuxBattery?.capacity),
    power_profile: clean(activeScheme ?? linuxProbe.powerProfile) || null,
    windows_power_scheme: activeScheme,
    linux_power_profile: clean(linuxProbe.powerProfile) || null,
  };
}

function normalizeTdpBackends(backendProbe, windowsProbe, linuxProbe) {
  const result = Object.fromEntries(BACKEND_NAMES.map(name => [name, 'unknown']));
  for (const name of BACKEND_NAMES) {
    const value = backendProbe?.[name];
    if (value === 'present' || value === 'missing' || value === 'unknown') result[name] = value;
    else result[name] = 'missing';
  }
  if (windowsProbe.powercfg?.activeScheme || windowsProbe.powercfg?.list) result.powercfg = 'present';
  if (linuxProbe.commands?.powerprofilesctl) result.powerprofilesctl = 'present';
  return result;
}

function buildNotes({ platform: currentPlatform, power, tdpBackends, writeCapableBackendSeen }) {
  const notes = [
    'Read-only proof capture only; no TDP writes, service changes, runtime launches, or power-plan mutations were performed.',
  ];
  if (currentPlatform.is_wsl) notes.push('WSL_NOT_AUTHORITY: WSL can observe host-visible evidence, but it is not the final power-control authority.');
  if (writeCapableBackendSeen) notes.push('Write-capable backend seen; all writes remain deferred behind approval gates.');
  if (tdpBackends.ryzenadj === 'present') notes.push('ryzenadj path/help evidence only; limit-setting commands remain prohibited.');
  if (tdpBackends.hhd === 'present') notes.push('HHD path evidence only; service install/start/stop remains prohibited.');
  if (!power.battery_present) notes.push('Battery state not visible from this proof context.');
  return notes;
}

async function writePowerProofOutputs(outDir, proof, stderrLines) {
  await writeFile(join(outDir, 'power-tdp-proof.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'power-tdp-proof.md'), renderPowerProofMarkdown(proof), 'utf8');
  await writeFile(join(outDir, 'backend-probe.tsv'), renderPowerBackendProbeTsv(proof), 'utf8');
  await writeFile(join(outDir, 'stderr.log'), stderrLines.join('\n') + (stderrLines.length > 0 ? '\n' : ''), 'utf8');
}

export function renderPowerProofMarkdown(proof) {
  return [
    '# Power/TDP Read-Only Proof',
    '',
    `- Classification: ${proof.classification}`,
    `- Host: ${proof.host}`,
    `- Platform: ${proof.platform.os}`,
    `- WSL authority warning: ${proof.platform.is_wsl ? 'yes' : 'no'}`,
    `- CPU: ${proof.cpu.name}`,
    `- NVIDIA visible: ${proof.gpu.nvidia_visible ? 'yes' : 'no'}`,
    `- AMD visible: ${proof.gpu.amd_visible ? 'yes' : 'no'}`,
    `- Radeon 890M visible: ${proof.gpu.radeon_890m_visible ? 'yes' : 'no'}`,
    `- Battery present: ${proof.power.battery_present ? 'yes' : 'no'}`,
    `- AC online: ${proof.power.ac_online === null ? 'unknown' : String(proof.power.ac_online)}`,
    `- Battery percent: ${proof.power.battery_percent ?? 'unknown'}`,
    `- Windows power scheme: ${proof.power.windows_power_scheme ?? 'unknown'}`,
    `- Linux power profile: ${proof.power.linux_power_profile ?? 'unknown'}`,
    `- Read-only: ${proof.proof.read_only ? 'yes' : 'no'}`,
    `- TDP write performed: ${proof.proof.tdp_write_performed ? 'yes' : 'no'}`,
    `- Runtime test performed: ${proof.proof.runtime_test_performed ? 'yes' : 'no'}`,
    '',
    '## Backends',
    '',
    ...Object.entries(proof.tdp_backends).map(([name, status]) => `- ${name}: ${status}`),
    '',
    '## Notes',
    '',
    ...(proof.notes.length > 0 ? proof.notes.map(note => `- ${note}`) : ['- None']),
    '',
  ].join('\n');
}

export function renderPowerBackendProbeTsv(proof) {
  return [
    'backend\tstatus',
    ...Object.entries(proof.tdp_backends).map(([backend, status]) => `${backend}\t${status}`),
    '',
  ].join('\n');
}

function readPowerSupplies(stderrLines) {
  const dir = '/sys/class/power_supply';
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).map(name => {
      const root = join(dir, name);
      return {
        name,
        type: readTextIfExists(join(root, 'type')).trim(),
        online: readTextIfExists(join(root, 'online')).trim(),
        capacity: readTextIfExists(join(root, 'capacity')).trim(),
      };
    });
  } catch (error) {
    stderrLines.push(`[power_supply] ${error.message}`);
    return [];
  }
}

function readModules(stderrLines) {
  try {
    return readTextIfExists('/proc/modules')
      .split(/\r?\n/)
      .map(line => line.trim().split(/\s+/)[0])
      .filter(Boolean);
  } catch (error) {
    stderrLines.push(`[modules] ${error.message}`);
    return [];
  }
}

function readTextIfExists(path) {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

function parseProbeText(text, sourcePath) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, source_path: sourcePath };
  }
}

function parseCpuinfoValue(cpuinfo, key) {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.+)$`, 'im');
  return cpuinfo.match(pattern)?.[1]?.trim() ?? null;
}

function parsePowercfgActiveScheme(text) {
  const value = clean(text);
  if (!value) return null;
  const paren = value.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const guid = value.match(/Power Scheme GUID:\s*([a-f0-9-]+)/i);
  return guid ? value : value.split(/\r?\n/)[0];
}

function inferWindowsAcOnline(batteryRows) {
  if (!batteryRows.length) return null;
  const statuses = batteryRows.map(item => Number(item.BatteryStatus ?? item.batteryStatus)).filter(Number.isFinite);
  if (statuses.includes(2)) return true;
  if (statuses.includes(1)) return false;
  return null;
}

function parseNullableBool(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === false) return value;
  if (String(value).trim() === '1') return true;
  if (String(value).trim() === '0') return false;
  return null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(values) {
  for (const value of values) {
    const number = nullableNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function inferCpuVendor(name) {
  if (/AMD|Ryzen/i.test(name)) return 'AMD';
  if (/Intel/i.test(name)) return 'Intel';
  return null;
}

function isWsl(linuxProbe) {
  return /microsoft|wsl/i.test(`${linuxProbe.procVersion}\n${linuxProbe.uname}`);
}

function commandExists(command) {
  const lookup = platform() === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0;
}

function resolveRequiredOut(out) {
  if (!out) throw new Error('Missing required --out');
  const resolved = resolve(out);
  if (!resolved || resolved === resolve('/')) throw new Error('Refusing to write proof output to filesystem root');
  return resolved;
}

function parseArgs(args) {
  const options = { out: null, windowsProbe: null, linuxProbe: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--out':
        options.out = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--windows-probe':
        options.windowsProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--linux-probe':
        options.linuxProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown power proof option: ${arg}`);
    }
  }
  return options;
}

function requireValue(flag, value) {
  if (!value || String(value).startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/capture-power-tdp-proof.js --out <dir> [--windows-probe <file>] [--linux-probe <file>]

Captures read-only host power/TDP evidence for Reversa Studio. It may read
processor, GPU, battery, power-profile, and backend path/version/help evidence.
It never writes TDP limits, starts services, changes power plans, launches games,
connects to phones, or mutates runtimes.
`);
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '' && value !== 'unknown';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await capturePowerTdpProof(options);
  console.log(`Power/TDP proof written: ${result.outDir}`);
  console.log(`Classification: ${result.proof.classification}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
