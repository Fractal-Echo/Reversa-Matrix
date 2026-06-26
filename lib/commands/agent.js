import { existsSync } from 'fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { basename, dirname, extname, join, resolve } from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_MODEL_BASE_URL = 'http://127.0.0.1:8000/v1';
const DEFAULT_MODEL_NAME = 'reversa-coder';
const DEFAULT_ADB_BINARY = '/mnt/c/platform-tools/adb.exe';
const DEFAULT_SNAPSHOT_PACKAGE = 'io.droidspaces.nebula.waylandie';
const SAFE_MODES = new Set(['scan-only', 'phone-safe', 'patch-propose']);
const DISABLED_MODES = new Set(['patch-apply', 'recovery-danger']);
const EVIDENCE_EXTENSIONS = new Set(['.json', '.jsonl', '.log', '.md', '.out', '.txt', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'site']);

export default async function agent(args) {
  const { default: chalk } = await import('chalk');
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  if (subcommand === 'doctor') {
    await doctor(parseCommonArgs(rest), chalk);
    return;
  }

  if (subcommand === 'models') {
    await models(parseCommonArgs(rest), chalk);
    return;
  }

  if (subcommand === 'init-memory') {
    await initMemory(parseCommonArgs(rest), chalk);
    return;
  }

  if (subcommand === 'snapshot') {
    await snapshot(parseSnapshotArgs(rest), chalk);
    return;
  }

  if (subcommand === 'replay') {
    await replay(parseReplayArgs(rest), chalk);
    return;
  }

  if (subcommand === 'run') {
    await runAgent(parseRunArgs(rest), chalk);
    return;
  }

  throw new Error(`Unknown agent subcommand: ${subcommand}`);
}

async function snapshot(options, chalk) {
  if (!existsSync(options.adbBinary)) {
    throw new Error(`ADB binary does not exist: ${options.adbBinary}`);
  }

  await mkdir(options.outDir, { recursive: true });
  await mkdir(join(options.outDir, 'host'), { recursive: true });
  await mkdir(join(options.outDir, 'device'), { recursive: true });
  await mkdir(join(options.outDir, 'app'), { recursive: true });
  await mkdir(join(options.outDir, 'process'), { recursive: true });

  const commandResults = [];
  commandResults.push(await runCapture(options, 'host/adb-version.txt', [options.adbBinary, 'version']));
  commandResults.push(await runCapture(options, 'host/adb-devices-l.txt', [options.adbBinary, 'devices', '-l']));
  commandResults.push(await runCapture(options, 'host/adb-mdns-services.txt', [options.adbBinary, 'mdns', 'services']));

  const adbPrefix = [options.adbBinary];
  if (options.serial) adbPrefix.push('-s', options.serial);

  commandResults.push(await runCapture(options, 'device/getprop.txt', [...adbPrefix, 'shell', 'getprop']));
  commandResults.push(await runCapture(options, 'device/settings-global-adb-wifi.txt', [...adbPrefix, 'shell', 'settings', 'get', 'global', 'adb_enabled']));
  commandResults.push(await runCapture(options, 'device/settings-global-adb-wifi-extra.txt', [...adbPrefix, 'shell', 'settings', 'get', 'global', 'adb_wifi_enabled']));
  commandResults.push(await runCapture(options, 'device/package-path.txt', [...adbPrefix, 'shell', 'pm', 'path', options.packageName]));
  commandResults.push(await runCapture(options, 'device/packages-interest.txt', [...adbPrefix, 'shell', 'pm', 'list', 'packages']));
  commandResults.push(await runCapture(options, 'device/device-nodes.txt', [...adbPrefix, 'shell', 'ls', '-l', '/dev/kgsl-3d0', '/dev/dri', '/dev/dma_heap']));
  commandResults.push(await runCapture(options, 'process/ps-a.txt', [...adbPrefix, 'shell', 'ps', '-A']));
  commandResults.push(await runCapture(options, 'process/proc-net-unix.txt', [...adbPrefix, 'shell', 'cat', '/proc/net/unix']));

  if (options.packageName) {
    commandResults.push(await runCapture(options, 'app/run-as-id.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'id']));
    commandResults.push(await runCapture(options, 'app/files-top.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'find', '.', '-maxdepth', '4', '-type', 'd']));
    commandResults.push(await runCapture(options, 'app/graphics-file-inventory.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'find', './files', '-maxdepth', '9', '-type', 'f']));
    commandResults.push(await runCapture(options, 'app/icd-file-inventory.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'find', './files', '-maxdepth', '9', '-type', 'f', '-name', 'freedreno_icd.json']));
    commandResults.push(await runCapture(options, 'app/freedreno-file-inventory.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'find', './files', '-maxdepth', '9', '-type', 'f', '-name', '*freedreno*']));
    commandResults.push(await runCapture(options, 'app/vulkan-file-inventory.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'find', './files', '-maxdepth', '9', '-type', 'f', '-name', '*vulkan*']));
    commandResults.push(await runCapture(options, 'app/freedreno-file-hashes.txt', [...adbPrefix, 'shell', 'run-as', options.packageName, 'find', './files', '-maxdepth', '9', '-type', 'f', '-name', '*freedreno*', '-exec', 'sha256sum', '{}', '+']));
  }

  await writeFile(join(options.outDir, 'manifest.json'), JSON.stringify({
    created_at: new Date().toISOString(),
    mode: 'phone-safe',
    adb_binary: options.adbBinary,
    serial: options.serial || null,
    package_name: options.packageName || null,
    command_results: commandResults,
  }, null, 2) + '\n', 'utf8');
  await writeFile(join(options.outDir, 'manifest.txt'), buildSnapshotManifestText(options, commandResults), 'utf8');

  const evidenceInputs = await loadEvidenceInputs({
    evidenceFiles: [],
    evidenceDirs: [options.outDir],
    maxEvidenceFiles: 500,
    maxEvidenceBytes: 2 * 1024 * 1024,
  });
  await writeFile(join(options.outDir, 'evidence_files.sha256'), buildEvidenceHashes(evidenceInputs), 'utf8');

  const failed = commandResults.filter(item => item.status === 'fail').length;
  const warnings = commandResults.filter(item => item.status === 'warn').length;
  console.log(chalk.bold('\n  Reversa phone-safe snapshot complete\n'));
  console.log(`  Output:          ${chalk.cyan(options.outDir)}`);
  console.log(`  Serial:          ${chalk.cyan(options.serial || '(default adb target)')}`);
  console.log(`  Package:         ${chalk.cyan(options.packageName || '(none)')}`);
  console.log(`  Commands:        ${chalk.cyan(commandResults.length)}`);
  console.log(`  Warnings:        ${warnings === 0 ? chalk.green(0) : chalk.yellow(warnings)}`);
  console.log(`  Failed commands: ${failed === 0 ? chalk.green(0) : chalk.red(failed)}`);
  console.log(`  Hash manifest:   ${chalk.cyan(join(options.outDir, 'evidence_files.sha256'))}`);
  console.log('');
}

async function doctor(options, chalk) {
  const checks = [
    {
      name: 'node',
      ok: Number(process.versions.node.split('.')[0]) >= 18,
      detail: process.versions.node,
    },
    commandCheck('git', ['--version']),
    {
      name: 'adb',
      ok: existsSync(options.adbBinary),
      detail: options.adbBinary,
    },
    {
      name: 'memory',
      ok: existsSync(options.memoryRoot),
      detail: options.memoryRoot,
    },
  ];

  if (options.network) {
    checks.push(await endpointCheck(options.baseUrl));
  } else {
    checks.push({
      name: 'model endpoint',
      ok: null,
      detail: 'skipped by --no-network',
    });
  }

  console.log(chalk.bold('\n  Reversa local agent doctor\n'));
  for (const check of checks) {
    const mark = check.ok === true ? chalk.green('PASS') : check.ok === false ? chalk.red('MISS') : chalk.gray('SKIP');
    console.log(`  ${mark} ${check.name.padEnd(15)} ${check.detail}`);
  }
  console.log('');
}

async function models(options, chalk) {
  const url = `${trimTrailingSlash(options.baseUrl)}/models`;
  const result = await fetchJson(url, options.timeoutMs);

  console.log(chalk.bold('\n  Reversa local model endpoint\n'));
  console.log(`  Base URL: ${chalk.cyan(options.baseUrl)}`);
  if (!result.ok) {
    console.log(`  Status:   ${chalk.red('unreachable')}`);
    console.log(`  Detail:   ${result.error}`);
    console.log('');
    return;
  }

  const models = Array.isArray(result.value?.data) ? result.value.data : [];
  console.log(`  Status:   ${chalk.green('reachable')}`);
  if (models.length === 0) {
    console.log('  Models:   endpoint responded, but no models were listed');
  } else {
    console.log('  Models:');
    for (const model of models) {
      console.log(`  - ${model.id ?? JSON.stringify(model)}`);
    }
  }
  console.log('');
}

async function initMemory(options, chalk) {
  await mkdir(options.memoryRoot, { recursive: true });

  const files = {
    'known_good_frontier.yaml': knownGoodFrontierTemplate(),
    'active_blockers.yaml': activeBlockersTemplate(),
    'contradictions.yaml': contradictionsTemplate(),
    'phone_targets.yaml': phoneTargetsTemplate(options),
    'project_constraints.yaml': projectConstraintsTemplate(),
  };

  const written = [];
  for (const [fileName, contents] of Object.entries(files)) {
    const path = join(options.memoryRoot, fileName);
    if (existsSync(path) && !options.force) continue;
    await writeFile(path, contents, 'utf8');
    written.push(path);
  }

  console.log(chalk.bold('\n  Reversa memory initialized\n'));
  console.log(`  Memory root: ${chalk.cyan(options.memoryRoot)}`);
  for (const file of written) {
    console.log(`  - ${file}`);
  }
  if (written.length === 0) {
    console.log('  No files written; use --force to refresh templates.');
  }
  console.log('');
}

async function runAgent(options, chalk) {
  if (DISABLED_MODES.has(options.mode)) {
    throw new Error(`Mode ${options.mode} is intentionally disabled in this scaffold. Use scan-only, phone-safe, or patch-propose.`);
  }
  if (!SAFE_MODES.has(options.mode)) {
    throw new Error(`Unknown agent mode: ${options.mode}`);
  }
  if (!options.goal) {
    throw new Error('agent run requires --goal <text>');
  }

  const runDir = options.outDir ?? join(process.cwd(), '.reversa', 'runs', createRunId());
  await mkdir(runDir, { recursive: true });
  await mkdir(join(runDir, 'stdout'), { recursive: true });
  await mkdir(join(runDir, 'stderr'), { recursive: true });
  await mkdir(join(runDir, 'artifacts'), { recursive: true });

  const memory = await loadMemory(options.memoryRoot);
  const evidenceInputs = await loadEvidenceInputs(options);
  const observations = collectObservations(evidenceInputs);
  const contradictions = detectContradictions(options.goal, observations, memory);
  const policy = buildPolicy(options.mode);

  await writeFile(join(runDir, 'prompt.md'), buildPrompt(options, evidenceInputs), 'utf8');
  await writeFile(join(runDir, 'plan.md'), buildPlan(options, policy, evidenceInputs), 'utf8');
  await writeFile(join(runDir, 'tool_calls.jsonl'), buildToolCallsJsonl(options, evidenceInputs), 'utf8');
  await writeFile(join(runDir, 'evidence.jsonl'), observations.map(item => JSON.stringify(item)).join('\n') + (observations.length ? '\n' : ''), 'utf8');
  await writeFile(join(runDir, 'contradictions.yaml'), buildContradictionsYaml(contradictions), 'utf8');
  await writeFile(join(runDir, 'PHONE_REVERSA_AGENT_REPORT.md'), buildAgentReport(options, observations, contradictions, policy, memory), 'utf8');
  await writeFile(join(runDir, 'artifacts/policy.json'), JSON.stringify(policy, null, 2) + '\n', 'utf8');
  await writeFile(join(runDir, 'artifacts/evidence_manifest.json'), JSON.stringify(buildEvidenceManifest(evidenceInputs), null, 2) + '\n', 'utf8');
  await writeFile(join(runDir, 'artifacts/evidence_files.sha256'), buildEvidenceHashes(evidenceInputs), 'utf8');

  console.log(chalk.bold('\n  Reversa local agent run complete\n'));
  console.log(`  Mode:             ${chalk.cyan(options.mode)}`);
  console.log(`  Run directory:    ${chalk.cyan(runDir)}`);
  console.log(`  Evidence inputs:  ${chalk.cyan(evidenceInputs.length)}`);
  console.log(`  Observations:     ${chalk.cyan(observations.length)}`);
  console.log(`  Contradictions:   ${chalk.cyan(contradictions.length)}`);
  console.log(`  Report:           ${chalk.cyan(join(runDir, 'PHONE_REVERSA_AGENT_REPORT.md'))}`);
  console.log('');

  return {
    runDir,
    evidenceInputs,
    observations,
    contradictions,
  };
}

async function replay(options, chalk) {
  if (!options.runDir) {
    throw new Error('agent replay requires --run <existing-run-directory>');
  }

  const promptPath = join(options.runDir, 'prompt.md');
  const manifestPath = join(options.runDir, 'artifacts', 'evidence_manifest.json');
  if (!existsSync(promptPath)) {
    throw new Error(`Replay prompt is missing: ${promptPath}`);
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`Replay evidence manifest is missing: ${manifestPath}`);
  }

  const prompt = await readFile(promptPath, 'utf8');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest)) {
    throw new Error(`Replay evidence manifest must be an array: ${manifestPath}`);
  }

  const goal = readPromptField(prompt, 'Goal');
  const mode = readPromptField(prompt, 'Mode');
  const projectRoot = readPromptField(prompt, 'Project root');
  if (!goal || !mode || !projectRoot) {
    throw new Error(`Replay prompt is missing Goal, Mode, or Project root: ${promptPath}`);
  }

  const verification = await verifyReplayManifest(manifest);
  if (verification.mismatches.length > 0) {
    const details = verification.mismatches
      .slice(0, 5)
      .map(item => `${item.reason}: ${item.path}`)
      .join('; ');
    throw new Error(`Replay evidence verification failed (${verification.mismatches.length} mismatch(es)): ${details}`);
  }

  const evidenceFiles = [...new Set(manifest.map(item => item.path).filter(Boolean))];
  const outDir = options.outDir ?? join(options.runDir, `replay-${createRunId()}`);
  const result = await runAgent({
    ...options,
    goal,
    mode,
    projectRoot,
    evidenceFiles,
    evidenceDirs: [],
    maxEvidenceFiles: Math.max(options.maxEvidenceFiles, evidenceFiles.length),
    outDir,
  }, chalk);

  await writeFile(join(result.runDir, 'artifacts', 'replay_source.json'), JSON.stringify({
    source_run: options.runDir,
    source_prompt: promptPath,
    source_manifest: manifestPath,
    evidence_paths_loaded: evidenceFiles.length,
    verification,
    replayed_at: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8');

  console.log(chalk.bold('  Replay source\n'));
  console.log(`  Source run:       ${chalk.cyan(options.runDir)}`);
  console.log(`  Replay marker:    ${chalk.cyan(join(result.runDir, 'artifacts', 'replay_source.json'))}`);
  if (verification.unverified.length > 0) {
    console.log(`  Unverified files: ${chalk.yellow(verification.unverified.length)} (no saved SHA-256; see replay_source.json)`);
  }
  console.log('');
}

function parseCommonArgs(args) {
  const options = {
    baseUrl: process.env.REVERSA_MODEL_BASE_URL || DEFAULT_MODEL_BASE_URL,
    model: process.env.REVERSA_MODEL || DEFAULT_MODEL_NAME,
    adbBinary: process.env.REVERSA_ADB_BINARY || DEFAULT_ADB_BINARY,
    memoryRoot: resolve(process.cwd(), '.reversa', 'memory'),
    timeoutMs: 2500,
    network: true,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--base-url':
        options.baseUrl = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--model':
        options.model = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--adb-binary':
        options.adbBinary = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--memory-root':
        options.memoryRoot = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--no-network':
        options.network = false;
        break;
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(`Unknown agent option: ${arg}`);
    }
  }

  return options;
}

function parseRunArgs(args) {
  const options = {
    ...parseCommonArgs([]),
    goal: '',
    mode: 'scan-only',
    outDir: null,
    projectRoot: resolve(process.cwd()),
    evidenceFiles: [],
    evidenceDirs: [],
    maxEvidenceFiles: 200,
    maxEvidenceBytes: 1024 * 1024,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--goal':
        options.goal = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--mode':
        options.mode = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--project-root':
        options.projectRoot = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--evidence-file':
        options.evidenceFiles.push(resolve(requireValue(flag, value)));
        if (inlineValue === null) index += 1;
        break;
      case '--evidence-dir':
        options.evidenceDirs.push(resolve(requireValue(flag, value)));
        if (inlineValue === null) index += 1;
        break;
      case '--max-evidence-files':
        options.maxEvidenceFiles = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-evidence-bytes':
        options.maxEvidenceBytes = parseSize(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--base-url':
        options.baseUrl = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--model':
        options.model = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--adb-binary':
        options.adbBinary = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--memory-root':
        options.memoryRoot = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--no-network':
        options.network = false;
        break;
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(`Unknown agent run option: ${arg}`);
    }
  }

  return options;
}

function parseSnapshotArgs(args) {
  const options = {
    ...parseCommonArgs([]),
    serial: process.env.REVERSA_PHONE_SERIAL || '',
    packageName: process.env.REVERSA_ANDROID_PACKAGE || DEFAULT_SNAPSHOT_PACKAGE,
    outDir: resolve(process.cwd(), '.reversa', 'snapshots', createRunId()),
  };
  options.timeoutMs = 15000;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--serial':
        options.serial = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--package':
        options.packageName = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--no-package':
        options.packageName = '';
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--base-url':
        options.baseUrl = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--model':
        options.model = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--adb-binary':
        options.adbBinary = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--memory-root':
        options.memoryRoot = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--no-network':
        options.network = false;
        break;
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(`Unknown agent snapshot option: ${arg}`);
    }
  }

  return options;
}

function parseReplayArgs(args) {
  const options = {
    ...parseCommonArgs([]),
    runDir: null,
    outDir: null,
    maxEvidenceFiles: 500,
    maxEvidenceBytes: 1024 * 1024,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? args[index + 1];

    switch (flag) {
      case '--run':
        options.runDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.outDir = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-evidence-files':
        options.maxEvidenceFiles = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--max-evidence-bytes':
        options.maxEvidenceBytes = parseSize(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--base-url':
        options.baseUrl = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--model':
        options.model = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--adb-binary':
        options.adbBinary = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--memory-root':
        options.memoryRoot = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--no-network':
        options.network = false;
        break;
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(`Unknown agent replay option: ${arg}`);
    }
  }

  return options;
}

async function runCapture(options, relativePath, command) {
  const result = spawnSync(command[0], command.slice(1), {
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const commandText = command.map(shellQuote).join(' ');
  const content = [
    `COMMAND=${commandText}`,
    `EXIT_STATUS=${result.status ?? 'null'}`,
    result.error ? `ERROR=${result.error.message}` : null,
    '',
    'STDOUT:',
    result.stdout ?? '',
    '',
    'STDERR:',
    result.stderr ?? '',
  ].filter(value => value !== null).join('\n');
  const path = join(options.outDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  const stdoutBytes = Buffer.byteLength(result.stdout ?? '', 'utf8');
  const stderrBytes = Buffer.byteLength(result.stderr ?? '', 'utf8');
  const status = result.status === 0 ? 'pass' : stdoutBytes > 0 ? 'warn' : 'fail';
  return {
    path: relativePath,
    command: commandText,
    status,
    exit_status: result.status ?? null,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    stdout_bytes: stdoutBytes,
    stderr_bytes: stderrBytes,
  };
}

function buildSnapshotManifestText(options, commandResults) {
  const lines = [];
  lines.push('# Reversa Phone-Safe Snapshot');
  lines.push('');
  lines.push(`created_at=${new Date().toISOString()}`);
  lines.push(`mode=phone-safe`);
  lines.push(`adb_binary=${options.adbBinary}`);
  lines.push(`serial=${options.serial || '(default adb target)'}`);
  lines.push(`package=${options.packageName || '(none)'}`);
  lines.push('');
  lines.push('## Commands');
  lines.push('');
  for (const result of commandResults) {
    lines.push(`- ${result.status.toUpperCase()} ${result.path}`);
  }
  lines.push('');
  lines.push('## Next');
  lines.push('');
  lines.push('Feed this snapshot back into Reversa-Agent:');
  lines.push('');
  lines.push('```bash');
  lines.push(`node ./bin/reversa.js agent run --mode phone-safe --goal "Inspect this phone-safe snapshot. Do not patch." --evidence-dir ${options.outDir}`);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

async function loadMemory(memoryRoot) {
  const names = [
    'known_good_frontier.yaml',
    'active_blockers.yaml',
    'contradictions.yaml',
    'phone_targets.yaml',
    'project_constraints.yaml',
  ];
  const files = [];
  for (const name of names) {
    const path = join(memoryRoot, name);
    if (!existsSync(path)) continue;
    files.push({ path, text: await readFile(path, 'utf8') });
  }
  return { root: memoryRoot, files };
}

async function loadEvidenceInputs(options) {
  const results = [];
  const paths = [...options.evidenceFiles];

  for (const dir of options.evidenceDirs) {
    const collected = await collectEvidenceDir(dir, options.maxEvidenceFiles - paths.length);
    paths.push(...collected);
    if (paths.length >= options.maxEvidenceFiles) break;
  }

  for (const path of [...new Set(paths)].slice(0, options.maxEvidenceFiles)) {
    results.push(await loadEvidenceFile(path, options.maxEvidenceBytes));
  }
  return results;
}

async function collectEvidenceDir(root, remaining) {
  if (remaining <= 0) return [];
  if (!existsSync(root)) return [root];
  const files = [];
  await walkEvidenceDir(root, files, remaining);
  return files.sort();
}

async function walkEvidenceDir(dir, files, limit) {
  if (files.length >= limit) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= limit) return;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkEvidenceDir(path, files, limit);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EVIDENCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    files.push(path);
  }
}

async function loadEvidenceFile(path, maxBytes) {
  if (!existsSync(path)) {
    return { path, missing: true, skipped: false, text: '', size: 0, sha256: null };
  }
  const info = await stat(path);
  if (!info.isFile()) {
    return { path, missing: false, skipped: true, skip_reason: 'not_file', text: '', size: info.size, sha256: null };
  }
  if (info.size > maxBytes) {
    return { path, missing: false, skipped: true, skip_reason: `larger_than_${maxBytes}_bytes`, text: '', size: info.size, sha256: null };
  }
  const buffer = await readFile(path);
  return {
    path,
    missing: false,
    skipped: false,
    text: buffer.toString('utf8'),
    size: info.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

async function verifyReplayManifest(manifest) {
  const checked = [];
  const unverified = [];
  const mismatches = [];

  for (const entry of manifest) {
    if (!entry?.path) {
      mismatches.push({ path: '(missing path)', reason: 'manifest_entry_missing_path' });
      continue;
    }

    if (entry.missing) {
      if (existsSync(entry.path)) {
        mismatches.push({ path: entry.path, reason: 'recorded_missing_now_exists' });
      } else {
        checked.push({ path: entry.path, status: 'still_missing' });
      }
      continue;
    }

    if (!existsSync(entry.path)) {
      mismatches.push({ path: entry.path, reason: 'recorded_present_now_missing' });
      continue;
    }

    const info = await stat(entry.path);
    if (!info.isFile()) {
      mismatches.push({ path: entry.path, reason: 'recorded_file_now_not_file' });
      continue;
    }

    if (typeof entry.size === 'number' && info.size !== entry.size) {
      mismatches.push({ path: entry.path, reason: `size_changed:${entry.size}->${info.size}` });
      continue;
    }

    if (!entry.sha256) {
      unverified.push({
        path: entry.path,
        reason: entry.skipped ? entry.skip_reason ?? 'skipped_without_hash' : 'no_saved_sha256',
      });
      continue;
    }

    const buffer = await readFile(entry.path);
    const actual = createHash('sha256').update(buffer).digest('hex');
    if (actual !== entry.sha256) {
      mismatches.push({ path: entry.path, reason: `sha256_changed:${entry.sha256}->${actual}` });
      continue;
    }

    checked.push({ path: entry.path, status: 'sha256_match' });
  }

  return {
    checked_count: checked.length,
    unverified_count: unverified.length,
    mismatch_count: mismatches.length,
    checked,
    unverified,
    mismatches,
  };
}

function collectObservations(inputs) {
  const observations = [];
  for (const input of inputs) {
    if (input.missing) {
      observations.push(makeObservation(input.path, 'missing_input', `missing:${input.path}`, 'HIGH'));
      continue;
    }
    if (input.skipped) {
      observations.push(makeObservation(input.path, 'skipped_input', `skipped:${input.skip_reason}`, 'LOW'));
      continue;
    }

    const checks = [
      ['vulkan_loader_env', /\bVK_ICD_FILENAMES\b/g, 'VK_ICD_FILENAMES'],
      ['vulkan_loader_env', /\bVK_DRIVER_FILES\b/g, 'VK_DRIVER_FILES'],
      ['libpath_env', /\bLD_LIBRARY_PATH\b/g, 'LD_LIBRARY_PATH'],
      ['libpath_env', /\bGAMESCOPE_LIBPATH\b/g, 'GAMESCOPE_LIBPATH'],
      ['libpath_env', /\bCHILD_LIBPATH\b/g, 'CHILD_LIBPATH'],
      ['libpath_env', /\bBRIDGE_LIBPATH\b/g, 'BRIDGE_LIBPATH'],
      ['freedreno_icd', /freedreno_icd\.json/g, 'freedreno_icd.json'],
      ['freedreno_library', /libvulkan_freedreno\.so/g, 'libvulkan_freedreno.so'],
      ['qualcomm_umd', /\b(Qualcomm Adreno UMD|Adreno UMD|libvulkan_adreno|vulkan\.adreno)\b/gi, 'Qualcomm/Adreno UMD'],
      ['arm64_va_limit', /\b(39-bit|39 bit|VA_BITS=39|CONFIG_ARM64_VA_BITS=39)\b/gi, '39-bit VA limit'],
      ['glx_gate', /glxinfo\s+-B/g, 'glxinfo -B'],
      ['vulkaninfo_status', /vulkaninfo\b/gi, 'vulkaninfo'],
    ];

    for (const [category, pattern, label] of checks) {
      if (pattern.test(input.text)) {
        observations.push(makeObservation(input.path, category, label, category === 'qualcomm_umd' ? 'HIGH' : 'MEDIUM'));
      }
      pattern.lastIndex = 0;
    }

    const localFreedreno = /\/usr\/local\/(?:etc\/vulkan\/icd\.d\/freedreno_icd\.json|lib\/libvulkan_freedreno\.so)/.test(input.text);
    const systemFreedreno = /\/usr\/share\/vulkan\/icd\.d\/freedreno_icd\.json/.test(input.text);
    if (localFreedreno) observations.push(makeObservation(input.path, 'freedreno_icd', 'local_freedreno_candidate', 'MEDIUM'));
    if (systemFreedreno) observations.push(makeObservation(input.path, 'freedreno_icd', 'system_freedreno_candidate', 'MEDIUM'));

    observations.push(...collectReversaScanSummaryObservations(input));
  }
  return observations;
}

function collectReversaScanSummaryObservations(input) {
  if (!/^# Reversa Scan Summary\b/m.test(input.text)) {
    return [];
  }

  const mappings = [
    ['scan_profile', /^- Profile:\s+`?([^`\n]+)`?/m, 'MEDIUM'],
    ['scan_findings', /^- Findings:\s+([0-9]+)/m, 'MEDIUM'],
    ['scan_contradictions', /^- Contradictions:\s+([0-9]+)/m, 'HIGH'],
    ['scan_patch_candidates', /^- Patch candidates:\s+([0-9]+)/m, 'HIGH'],
    ['scan_highest_severity', /^- Highest severity:\s+([A-Z]+)/m, 'HIGH'],
  ];

  const observations = [];
  for (const [name, pattern, severity] of mappings) {
    const match = input.text.match(pattern);
    if (!match) {
      continue;
    }
    observations.push(makeObservation(input.path, 'reversa_scan_summary', `${name}:${match[1].trim()}`, severity));
  }
  return observations;
}

function detectContradictions(goal, observations, memory) {
  const claims = new Set(observations.map(item => item.normalized_claim));
  const contradictions = [];

  if (claims.has('local_freedreno_candidate') && claims.has('system_freedreno_candidate')) {
    contradictions.push({
      id: 'dual_freedreno_icd_candidates',
      severity: 'HIGH',
      title: 'Dual Freedreno ICD candidates are present',
      detail: 'Both local and system Freedreno ICD paths appeared in the supplied evidence. A bounded A1 run should pin the local Turnip/Freedreno ICD and prove which loader path won.',
      safe_next_action: 'Write or inspect an ICD inventory report before any runtime patch proposal.',
    });
  }

  if (/A1/i.test(goal) && observations.some(item => item.category === 'qualcomm_umd')) {
    contradictions.push({
      id: 'a1_b0_lane_mixing',
      severity: 'HIGH',
      title: 'A1 goal includes Qualcomm/Adreno UMD evidence',
      detail: 'A1 is a Turnip/Freedreno-only export/runtime lane. Qualcomm Adreno UMD evidence belongs to a separate B0 investigation unless policy says otherwise.',
      safe_next_action: 'Keep A1 pinned to VK_ICD_FILENAMES and VK_DRIVER_FILES for the local Freedreno ICD.',
    });
  }

  if (observations.some(item => item.category === 'arm64_va_limit') && !memory.files.some(file => /39-bit|VA_BITS=39/.test(file.text))) {
    contradictions.push({
      id: 'runtime_limit_not_in_memory',
      severity: 'MEDIUM',
      title: '39-bit runtime limitation appears in evidence but not memory',
      detail: 'The supplied evidence mentions a 39-bit/VA_BITS=39 runtime limit, but the active memory templates do not preserve it yet.',
      safe_next_action: 'Update known_good_frontier.yaml before allowing patch-propose mode to rely on this run.',
    });
  }

  return contradictions;
}

function makeObservation(path, category, claim, severity) {
  return {
    id: `obs_${hashText(`${path}:${category}:${claim}`).slice(0, 10)}`,
    timestamp: new Date().toISOString(),
    category,
    severity,
    confidence: 'observed',
    source_file: path,
    source_line_start: 1,
    source_line_end: 1,
    extracted_text: claim,
    normalized_claim: claim,
    suggested_action: 'Inspect source evidence and compare against memory policy before proposing patches.',
  };
}

function buildPolicy(mode) {
  return {
    mode,
    shell_is_not_a_tool: true,
    model_is_reasoning_engine_not_agent: true,
    patch_without_evidence: false,
    patch_source_code_without_report: false,
    allowed_tools: {
      'scan-only': ['read_file', 'reversa_scan_profile', 'contradiction_scan', 'evidence_report_write'],
      'phone-safe': ['read_file', 'adb_snapshot', 'adb_getprop', 'adb_ls', 'adb_cat', 'reversa_scan_profile', 'contradiction_scan', 'evidence_report_write'],
      'patch-propose': ['read_file', 'git_diff', 'grep_repo', 'reversa_scan_profile', 'write_patch_proposal', 'evidence_report_write'],
    }[mode],
    disabled_tools: ['raw_shell', 'adb_dd_write', 'fastboot_flash', 'rm_recursive', 'partition_write', 'chmod_system', 'package_uninstall'],
  };
}

function buildPrompt(options, evidenceInputs) {
  return [
    '# Reversa Local Agent Prompt',
    '',
    `Goal: ${options.goal}`,
    `Mode: ${options.mode}`,
    `Project root: ${options.projectRoot}`,
    '',
    'Evidence inputs:',
    ...evidenceInputs.map(input => `- ${input.path}${input.missing ? ' (missing)' : ''}${input.skipped ? ` (skipped: ${input.skip_reason})` : ''}`),
    '',
    'Rule: Reversa owns tools, policy, memory, and evidence. The model is only a reasoning engine.',
    '',
  ].join('\n');
}

function buildPlan(options, policy, evidenceInputs) {
  return [
    '# Reversa Local Agent Plan',
    '',
    '1. Load memory files.',
    '2. Read supplied evidence files.',
    '3. Extract bounded observations.',
    '4. Detect contradictions against the active goal and policy.',
    '5. Write an auditable report.',
    '',
    `Mode: \`${options.mode}\``,
    `Patch apply enabled: \`${policy.mode === 'patch-apply'}\``,
    `Evidence files: \`${evidenceInputs.length}\``,
    'Evidence hashes: `artifacts/evidence_files.sha256`',
    '',
  ].join('\n');
}

function buildToolCallsJsonl(options, evidenceInputs) {
  const calls = [
    { tool: 'load_memory', memory_root: options.memoryRoot },
    ...evidenceInputs.map(input => ({ tool: 'read_file', path: input.path, missing: input.missing })),
    { tool: 'contradiction_scan', mode: options.mode },
    { tool: 'evidence_report_write' },
  ];
  return calls.map(item => JSON.stringify({ timestamp: new Date().toISOString(), ...item })).join('\n') + '\n';
}

function buildContradictionsYaml(contradictions) {
  if (contradictions.length === 0) return 'contradictions: []\n';
  const lines = ['contradictions:'];
  for (const item of contradictions) {
    lines.push(`  - id: ${item.id}`);
    lines.push(`    severity: ${item.severity}`);
    lines.push(`    title: ${JSON.stringify(item.title)}`);
    lines.push(`    detail: ${JSON.stringify(item.detail)}`);
    lines.push(`    safe_next_action: ${JSON.stringify(item.safe_next_action)}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildAgentReport(options, observations, contradictions, policy, memory) {
  const lines = [];
  lines.push('# Reversa Local Agent Report');
  lines.push('');
  lines.push(`- Goal: ${options.goal}`);
  lines.push(`- Mode: \`${options.mode}\``);
  lines.push(`- Memory root: \`${memory.root}\``);
  lines.push(`- Memory files loaded: ${memory.files.length}`);
  lines.push(`- Observations: ${observations.length}`);
  lines.push(`- Contradictions: ${contradictions.length}`);
  lines.push(`- Patch apply: disabled`);
  lines.push(`- Evidence hash manifest: \`artifacts/evidence_files.sha256\``);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push('- Raw shell tool: disabled');
  lines.push(`- Disabled dangerous tools: ${policy.disabled_tools.join(', ')}`);
  lines.push(`- Allowed tools: ${policy.allowed_tools.join(', ')}`);
  lines.push('');
  lines.push('## Contradictions');
  lines.push('');
  if (contradictions.length === 0) {
    lines.push('No contradictions detected from supplied evidence.');
  } else {
    for (const item of contradictions) {
      lines.push(`### ${item.id}`);
      lines.push('');
      lines.push(`- Severity: ${item.severity}`);
      lines.push(`- Finding: ${item.title}`);
      lines.push(`- Detail: ${item.detail}`);
      lines.push(`- Safe next action: ${item.safe_next_action}`);
      lines.push('');
    }
  }
  lines.push('## Observations');
  lines.push('');
  for (const item of observations) {
    lines.push(`- [${item.category}] ${basename(item.source_file)}: ${item.normalized_claim}`);
  }
  lines.push('');
  lines.push('## Evidence Inputs');
  lines.push('');
  for (const input of options.evidenceFiles) {
    lines.push(`- file: \`${input}\``);
  }
  for (const input of options.evidenceDirs) {
    lines.push(`- directory: \`${input}\``);
  }
  lines.push('');
  lines.push('## Patch Gate');
  lines.push('');
  lines.push('Patch proposal is allowed only after evidence files exist, hashes are recorded, scan profile output is attached, contradictions do not conflict with memory, and no forbidden lane is touched.');
  lines.push('');
  return lines.join('\n');
}

function buildEvidenceManifest(evidenceInputs) {
  return evidenceInputs.map(input => ({
    path: input.path,
    missing: input.missing,
    skipped: input.skipped,
    skip_reason: input.skip_reason ?? null,
    size: input.size,
    sha256: input.sha256,
  }));
}

function buildEvidenceHashes(evidenceInputs) {
  const lines = [];
  for (const input of evidenceInputs) {
    if (input.sha256) {
      lines.push(`${input.sha256}  ${input.path}`);
    } else if (input.missing) {
      lines.push(`MISSING  ${input.path}`);
    } else if (input.skipped) {
      lines.push(`SKIPPED:${input.skip_reason}  ${input.path}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function commandCheck(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    name: command,
    ok: result.status === 0,
    detail: result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : result.error?.message ?? result.stderr.trim(),
  };
}

async function endpointCheck(baseUrl) {
  const result = await fetchJson(`${trimTrailingSlash(baseUrl)}/models`, 2500);
  return {
    name: 'model endpoint',
    ok: result.ok,
    detail: result.ok ? baseUrl : `${baseUrl} (${result.error})`,
  };
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 120)}` };
    }
    return { ok: true, value: text ? JSON.parse(text) : null };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function createRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function requireValue(flag, value) {
  if (value === null || value === undefined || String(value).startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseSize(value) {
  const match = String(value).trim().match(/^([0-9]+)([kKmM]?)$/);
  if (!match) {
    throw new Error(`Invalid size value: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'm') return amount * 1024 * 1024;
  if (unit === 'k') return amount * 1024;
  return amount;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function readPromptField(prompt, field) {
  const prefix = `${field}: `;
  const line = prompt.split(/\r?\n/).find(item => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function knownGoodFrontierTemplate() {
  return `frontiers:
  nebula_runtime:
    device: "device codename / model"
    current_classification: "UNKNOWN"
    current_blocker: "UNKNOWN"
    hard_constraints:
      - "no destructive device operations in scan-only or phone-safe mode"
      - "no patch without evidence report"
      - "preserve lane separation"
      - "preserve 39-bit / VA_BITS=39 runtime limitations when evidence proves them"
    lane_policy:
      A1: "Turnip/Freedreno-only unless memory explicitly changes this"
      B0: "Qualcomm/Adreno UMD investigation lane"
`;
}

function activeBlockersTemplate() {
  return `active_blockers:
  - id: "example_blocker"
    status: "unknown"
    evidence: []
`;
}

function contradictionsTemplate() {
  return `known_contradictions:
  - id: "dual_freedreno_icd_candidates"
    status: "watch"
    rule: "only one Vulkan ICD should be selected for a bounded runtime proof"
`;
}

function phoneTargetsTemplate(options) {
  return `adb:
  binary: "${options.adbBinary}"
  default_serial: "\${REVERSA_PHONE_SERIAL}"
`;
}

function projectConstraintsTemplate() {
  return `tool_policy:
  shell_is_not_a_tool: true
  dangerous_tools_disabled:
    - raw_shell
    - adb_dd_write
    - fastboot_flash
    - rm_recursive
    - partition_write
    - package_uninstall
`;
}

function printHelp() {
  console.log(`
  reversa agent

  Local Reversa agent runtime scaffolding. Reversa owns tools, memory,
  evidence, policy, and reports. Local models are reasoning engines only.

  Usage:
    npx reversa agent <subcommand> [options]

  Subcommands:
    doctor                 Check local runtime prerequisites
    models                 List models from an OpenAI-compatible endpoint
    init-memory            Create .reversa/memory templates
    snapshot               Capture a typed read-only ADB evidence snapshot
    replay                 Rebuild a run from prompt.md and evidence_manifest.json
    run                    Create an auditable local agent run

  Common options:
    --base-url <url>       OpenAI-compatible endpoint (default: ${DEFAULT_MODEL_BASE_URL})
    --model <name>         Served model name (default: ${DEFAULT_MODEL_NAME})
    --adb-binary <path>    ADB binary path (default: ${DEFAULT_ADB_BINARY})
    --memory-root <path>   Memory folder (default: .reversa/memory)
    --no-network           Skip endpoint checks

  Run options:
    --goal <text>          Bounded goal for this run
    --mode <mode>          scan-only | phone-safe | patch-propose
    --evidence-file <path> Add a file to inspect; repeatable
    --evidence-dir <path>  Add a bounded evidence directory; repeatable
    --max-evidence-files <n>  Directory collection cap (default: 200)
    --max-evidence-bytes <n|nK|nM>  Per-file cap (default: 1M)
    --out <path>           Run output directory

  Snapshot options:
    --serial <adb-serial>  Device serial; defaults to adb's selected target
    --package <id>         App package for run-as probes (default: ${DEFAULT_SNAPSHOT_PACKAGE})
    --no-package           Skip app-context probes

  Replay options:
    --run <path>           Existing run directory to replay
    --out <path>           Replay output directory

  Disabled modes in this scaffold:
    patch-apply, recovery-danger
`);
}
