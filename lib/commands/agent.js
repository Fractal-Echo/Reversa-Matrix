import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_MODEL_BASE_URL = 'http://127.0.0.1:8000/v1';
const DEFAULT_MODEL_NAME = 'reversa-coder';
const DEFAULT_ADB_BINARY = '/mnt/c/platform-tools/adb.exe';
const SAFE_MODES = new Set(['scan-only', 'phone-safe', 'patch-propose']);
const DISABLED_MODES = new Set(['patch-apply', 'recovery-danger']);

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

  if (subcommand === 'run') {
    await runAgent(parseRunArgs(rest), chalk);
    return;
  }

  throw new Error(`Unknown agent subcommand: ${subcommand}`);
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
  const evidenceInputs = await loadEvidenceInputs(options.evidenceFiles);
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

  console.log(chalk.bold('\n  Reversa local agent run complete\n'));
  console.log(`  Mode:             ${chalk.cyan(options.mode)}`);
  console.log(`  Run directory:    ${chalk.cyan(runDir)}`);
  console.log(`  Evidence inputs:  ${chalk.cyan(evidenceInputs.length)}`);
  console.log(`  Observations:     ${chalk.cyan(observations.length)}`);
  console.log(`  Contradictions:   ${chalk.cyan(contradictions.length)}`);
  console.log(`  Report:           ${chalk.cyan(join(runDir, 'PHONE_REVERSA_AGENT_REPORT.md'))}`);
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

async function loadEvidenceInputs(paths) {
  const results = [];
  for (const path of paths) {
    if (!existsSync(path)) {
      results.push({ path, missing: true, text: '' });
      continue;
    }
    results.push({ path, missing: false, text: await readFile(path, 'utf8') });
  }
  return results;
}

function collectObservations(inputs) {
  const observations = [];
  for (const input of inputs) {
    if (input.missing) {
      observations.push(makeObservation(input.path, 'missing_input', `missing:${input.path}`, 'HIGH'));
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
      ['qualcomm_umd', /\b(Qualcomm|Adreno UMD|libvulkan_adreno|vulkan\.adreno)\b/gi, 'Qualcomm/Adreno UMD'],
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
      'phone-safe': ['read_file', 'adb_getprop', 'adb_ls', 'adb_cat', 'reversa_scan_profile', 'contradiction_scan', 'evidence_report_write'],
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
    ...evidenceInputs.map(input => `- ${input.path}${input.missing ? ' (missing)' : ''}`),
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
  lines.push('## Patch Gate');
  lines.push('');
  lines.push('Patch proposal is allowed only after evidence files exist, hashes are recorded, scan profile output is attached, contradictions do not conflict with memory, and no forbidden lane is touched.');
  lines.push('');
  return lines.join('\n');
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
    --out <path>           Run output directory

  Disabled modes in this scaffold:
    patch-apply, recovery-danger
`);
}
