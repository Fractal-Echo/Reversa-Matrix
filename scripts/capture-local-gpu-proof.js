#!/usr/bin/env node

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { hostname } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const PROOF_LEVELS = new Set([
  'GPU_PROOF_UNAVAILABLE',
  'GPU_PROOF_NVIDIA_SMI_ONLY',
  'GPU_PROOF_CUDA_VISIBLE',
  'GPU_PROOF_TORCH_CUDA_VISIBLE',
  'GPU_PROOF_TENSOR_OP_PASS',
  'GPU_PROOF_BACKEND_READY_CUDA',
  'GPU_PROOF_BACKEND_READY_TENSORRT',
  'GPU_PROOF_BACKEND_READY_ONNX',
  'GPU_PROOF_BACKEND_UNKNOWN',
]);

export async function captureLocalGpuProof(options) {
  const outDir = resolveRequiredOut(options.out);
  const pythonCommand = resolvePythonCommand(options.python);
  await mkdir(outDir, { recursive: true });

  const stderrLines = [];
  const nvidiaSmi = probeNvidiaSmi(stderrLines);
  const pythonProbe = probePython(stderrLines, pythonCommand);
  const backendProbe = probeBackends(pythonProbe, stderrLines);
  const proof = buildGpuProof({
    timestamp: new Date().toISOString(),
    host: hostname(),
    nvidiaSmi,
    pythonProbe,
    backendProbe,
  });

  await writeGpuProofOutputs(outDir, proof, stderrLines);
  return { outDir, proof };
}

export function buildGpuProof({ timestamp, host, nvidiaSmi, pythonProbe, backendProbe }) {
  const gpu = {
    nvidia_smi_available: Boolean(nvidiaSmi?.available),
    name: nvidiaSmi?.name ?? 'unknown',
    driver_version: nvidiaSmi?.driver_version ?? 'unknown',
    cuda_version: nvidiaSmi?.cuda_version ?? 'unknown',
    memory_total_mib: Number(nvidiaSmi?.memory_total_mib) || 0,
  };

  const python = {
    requested_executable: pythonProbe?.requested_executable ?? pythonProbe?.executable ?? 'unknown',
    executable: pythonProbe?.executable ?? 'unknown',
    version: pythonProbe?.version ?? 'unknown',
    torch_available: Boolean(pythonProbe?.torch_available),
    torch_version: pythonProbe?.torch_version ?? 'unknown',
    torch_cuda_available: Boolean(pythonProbe?.torch_cuda_available),
    torch_cuda_version: pythonProbe?.torch_cuda_version ?? 'unknown',
    torch_device_name: pythonProbe?.torch_device_name ?? 'unknown',
    tensor_op_pass: Boolean(pythonProbe?.tensor_op_pass),
    torch_cuda_status: classifyTorchCudaStatus(pythonProbe),
  };

  const backends = {
    onnxruntime: normalizeBackendStatus(backendProbe?.onnxruntime),
    tensorrt: normalizeBackendStatus(backendProbe?.tensorrt),
    ncnn: normalizeBackendStatus(backendProbe?.ncnn),
    ffmpeg: normalizeBackendStatus(backendProbe?.ffmpeg),
    vapoursynth: normalizeBackendStatus(backendProbe?.vapoursynth),
  };

  const backend_classifications = classifyBackendReadiness(python, backends);
  const notes = [
    ...(gpu.nvidia_smi_available ? [] : ['nvidia-smi not available or did not return GPU metadata.']),
    ...(python.torch_available ? [] : ['PyTorch is not installed in the probed Python environment.']),
    ...(python.torch_available && !python.torch_cuda_available ? ['TORCH_CUDA_MISSING'] : []),
    ...(python.torch_cuda_available && !python.tensor_op_pass ? ['PyTorch CUDA visible but tensor operation did not pass.'] : []),
  ];

  const classification = classifyGpuProof({ gpu, python });
  if (!PROOF_LEVELS.has(classification)) {
    throw new Error(`Invalid GPU proof classification: ${classification}`);
  }

  return {
    schema_version: 1,
    timestamp,
    host,
    gpu,
    python,
    backends,
    backend_classifications,
    classification,
    safe_for_model_download: false,
    source_authority: false,
    generated_artifact: true,
    notes,
  };
}

export function classifyGpuProof({ gpu, python }) {
  if (python?.torch_cuda_available && python?.tensor_op_pass) return 'GPU_PROOF_TENSOR_OP_PASS';
  if (python?.torch_cuda_available) return 'GPU_PROOF_TORCH_CUDA_VISIBLE';
  if (gpu?.nvidia_smi_available && hasValue(gpu.cuda_version)) return 'GPU_PROOF_CUDA_VISIBLE';
  if (gpu?.nvidia_smi_available) return 'GPU_PROOF_NVIDIA_SMI_ONLY';
  return 'GPU_PROOF_UNAVAILABLE';
}

export function classifyBackendReadiness(python, backends) {
  const classifications = [];
  if (python.torch_cuda_available && python.tensor_op_pass) classifications.push('GPU_PROOF_BACKEND_READY_CUDA');
  if (backends.tensorrt === 'present') classifications.push('GPU_PROOF_BACKEND_READY_TENSORRT');
  if (backends.onnxruntime === 'present') classifications.push('GPU_PROOF_BACKEND_READY_ONNX');
  if (classifications.length === 0) classifications.push('GPU_PROOF_BACKEND_UNKNOWN');
  return classifications;
}

function classifyTorchCudaStatus(pythonProbe) {
  if (!pythonProbe?.torch_available) return 'TORCH_MISSING';
  if (!pythonProbe?.torch_cuda_available) return 'TORCH_CUDA_MISSING';
  if (pythonProbe?.tensor_op_pass) return 'TORCH_CUDA_TENSOR_OP_PASS';
  return 'TORCH_CUDA_VISIBLE';
}

function probeNvidiaSmi(stderrLines) {
  if (!commandExists('nvidia-smi')) {
    return { available: false };
  }
  const fullResult = runCommand('nvidia-smi', [], { timeout: 8000, maxBuffer: 1024 * 1024 });
  const cudaVersion = parseCudaVersionFromNvidiaSmi(fullResult.stdout);
  if (fullResult.stderr) stderrLines.push(`[nvidia-smi] ${fullResult.stderr.trim()}`);

  const queryResult = runCommand('nvidia-smi', [
    '--query-gpu=name,driver_version,memory.total',
    '--format=csv,noheader,nounits',
  ], { timeout: 8000 });
  if (queryResult.stderr) stderrLines.push(`[nvidia-smi-query] ${queryResult.stderr.trim()}`);
  if (queryResult.status !== 0 || !queryResult.stdout.trim()) {
    return parseNvidiaSmiTable(fullResult.stdout);
  }
  return parseNvidiaSmiCsv(queryResult.stdout, cudaVersion);
}

export function parseNvidiaSmiCsv(stdout, cudaVersion = 'unknown') {
  const firstLine = String(stdout).trim().split(/\r?\n/).find(Boolean);
  if (!firstLine) return { available: false };
  const [name, driver_version, memory_total_mib] = firstLine.split(',').map(part => part.trim());
  return {
    available: true,
    name: name || 'unknown',
    driver_version: driver_version || 'unknown',
    cuda_version: cudaVersion || 'unknown',
    memory_total_mib: Number(String(memory_total_mib).replace(/[^\d.]/g, '')) || 0,
  };
}

export function parseCudaVersionFromNvidiaSmi(stdout) {
  const match = String(stdout).match(/CUDA Version:\s*([0-9.]+)/i);
  return match?.[1] ?? 'unknown';
}

function parseNvidiaSmiTable(stdout) {
  const text = String(stdout);
  if (!/NVIDIA-SMI/i.test(text)) return { available: false };
  const cuda_version = parseCudaVersionFromNvidiaSmi(text);
  const driverMatch = text.match(/Driver Version:\s*([0-9.]+)/i);
  const nameMatch = text.match(/\|\s*\d+\s+(NVIDIA\s+[^|]+?)\s{2,}/i);
  const memoryMatch = text.match(/\/\s*([0-9]+)MiB\s*\|/i);
  return {
    available: true,
    name: nameMatch?.[1]?.trim() ?? 'unknown',
    driver_version: driverMatch?.[1] ?? 'unknown',
    cuda_version,
    memory_total_mib: Number(memoryMatch?.[1]) || 0,
  };
}

function probePython(stderrLines, pythonCommand) {
  if (!pythonCommand) {
    return { available: false };
  }
  const probe = String.raw`
import importlib.util
import json
import sys

result = {
  "available": True,
  "executable": sys.executable,
  "version": sys.version.split()[0],
  "torch_available": False,
  "torch_version": "unknown",
  "torch_cuda_available": False,
  "torch_cuda_version": "unknown",
  "torch_device_name": "unknown",
  "tensor_op_pass": False,
  "imports": {}
}

for name in ["onnxruntime", "tensorrt", "vapoursynth"]:
  result["imports"][name] = importlib.util.find_spec(name) is not None

if importlib.util.find_spec("torch") is not None:
  try:
    import torch
    result["torch_available"] = True
    result["torch_version"] = getattr(torch, "__version__", "unknown")
    result["torch_cuda_available"] = bool(torch.cuda.is_available())
    result["torch_cuda_version"] = getattr(torch.version, "cuda", None) or "unknown"
    if result["torch_cuda_available"]:
      result["torch_device_name"] = torch.cuda.get_device_name(0)
      value = (torch.ones((1,), device="cuda") + 1).detach().cpu().item()
      torch.cuda.synchronize()
      result["tensor_op_pass"] = value == 2
  except Exception as error:
    result["torch_error"] = str(error)

print(json.dumps(result, sort_keys=True))
`;
  const result = runCommand(pythonCommand, ['-c', probe], { timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.stderr) stderrLines.push(`[${pythonCommand}] ${result.stderr.trim()}`);
  if (result.status !== 0 || !result.stdout.trim()) {
    return {
      available: true,
      requested_executable: pythonCommand,
      executable: pythonCommand,
      version: 'unknown',
      error: result.stderr || result.stdout,
    };
  }
  try {
    return { requested_executable: pythonCommand, ...JSON.parse(result.stdout) };
  } catch (error) {
    stderrLines.push(`[python3] Could not parse probe JSON: ${error.message}`);
    return {
      available: true,
      requested_executable: pythonCommand,
      executable: pythonCommand,
      version: 'unknown',
      error: error.message,
    };
  }
}

function probeBackends(pythonProbe, stderrLines) {
  if (!Array.isArray(stderrLines)) throw new Error('stderrLines must be an array');
  return {
    ffmpeg: commandExists('ffmpeg') ? 'present' : 'missing',
    onnxruntime: pythonProbe?.imports?.onnxruntime ? 'present' : 'missing',
    tensorrt: pythonProbe?.imports?.tensorrt ? 'present' : 'missing',
    vapoursynth: pythonProbe?.imports?.vapoursynth ? 'present' : 'missing',
    ncnn: ['ncnnoptimize', 'ncnn2mem', 'ncnn2table'].some(commandExists) ? 'present' : 'missing',
  };
}

async function writeGpuProofOutputs(outDir, proof, stderrLines) {
  await writeFile(join(outDir, 'gpu-proof.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'gpu-proof.md'), renderGpuProofMarkdown(proof), 'utf8');
  await writeFile(join(outDir, 'backend-probe.tsv'), renderBackendProbeTsv(proof), 'utf8');
  await writeFile(join(outDir, 'stderr.log'), stderrLines.join('\n') + (stderrLines.length > 0 ? '\n' : ''), 'utf8');
}

function resolvePythonCommand(pythonPath) {
  if (!pythonPath) return commandExists('python3') ? 'python3' : null;
  const resolved = resolve(pythonPath);
  if (!existsSync(resolved)) {
    throw new Error(`Selected Python does not exist: ${resolved}`);
  }
  return resolved;
}

export function renderGpuProofMarkdown(proof) {
  return [
    '# Local GPU Proof',
    '',
    `- Classification: ${proof.classification}`,
    `- Host: ${proof.host}`,
    `- Nvidia SMI: ${proof.gpu.nvidia_smi_available ? 'present' : 'missing'}`,
    `- GPU: ${proof.gpu.name}`,
    `- Driver: ${proof.gpu.driver_version}`,
    `- CUDA runtime: ${proof.gpu.cuda_version}`,
    `- VRAM MiB: ${proof.gpu.memory_total_mib}`,
    `- Python requested: ${proof.python.requested_executable}`,
    `- Python: ${proof.python.executable} ${proof.python.version}`,
    `- PyTorch: ${proof.python.torch_available ? proof.python.torch_version : 'missing'}`,
    `- PyTorch CUDA: ${proof.python.torch_cuda_status}`,
    `- Tensor op pass: ${proof.python.tensor_op_pass ? 'yes' : 'no'}`,
    `- Safe for model acquisition: ${proof.safe_for_model_download ? 'yes' : 'no'}`,
    '',
    '## Backends',
    '',
    ...Object.entries(proof.backends).map(([name, status]) => `- ${name}: ${status}`),
    '',
    '## Notes',
    '',
    ...(proof.notes.length > 0 ? proof.notes.map(note => `- ${note}`) : ['- None']),
    '',
  ].join('\n');
}

export function renderBackendProbeTsv(proof) {
  return [
    'backend\tstatus',
    ...Object.entries(proof.backends).map(([backend, status]) => `${backend}\t${status}`),
    '',
  ].join('\n');
}

function normalizeBackendStatus(value) {
  if (value === 'present' || value === 'missing' || value === 'unknown') return value;
  return 'unknown';
}

function hasValue(value) {
  return Boolean(value && value !== 'unknown' && value !== 'N/A');
}

function commandExists(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 5000,
    maxBuffer: options.maxBuffer ?? 1024 * 512,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function resolveRequiredOut(out) {
  if (!out) throw new Error('Missing required --out');
  const resolved = resolve(out);
  if (!resolved || resolved === resolve('/')) throw new Error('Refusing to write proof output to filesystem root');
  return resolved;
}

function parseArgs(args) {
  const options = { out: null, python: null, help: false };
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
      case '--python':
        options.python = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown GPU proof option: ${arg}`);
    }
  }
  return options;
}

function requireValue(flag, value) {
  if (!value || String(value).startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/capture-local-gpu-proof.js --out <dir> [--python <path>]

Captures passive local GPU proof. It runs nvidia-smi when present, probes the
selected Python environment, and writes JSON/Markdown/TSV evidence. It never
installs packages, acquires model artifacts, launches games, or mutates runtimes.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await captureLocalGpuProof(options);
  console.log(`GPU proof written: ${result.outDir}`);
  console.log(`Classification: ${result.proof.classification}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
