#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { hostname, tmpdir } from 'os';
import { join, resolve, isAbsolute } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const PROOF_LEVELS = new Set([
  'AMD_PROOF_UNAVAILABLE',
  'AMD_PROOF_WINDOWS_GPU_VISIBLE',
  'AMD_PROOF_DIRECTX12_VISIBLE',
  'AMD_PROOF_DIRECTML_CANDIDATE',
  'AMD_PROOF_ONNXRUNTIME_DIRECTML_IMPORT',
  'AMD_PROOF_ONNXRUNTIME_DIRECTML_TINY_OP_PASS',
  'AMD_PROOF_TORCH_DIRECTML_IMPORT',
  'AMD_PROOF_TORCH_DIRECTML_TINY_OP_PASS',
  'AMD_PROOF_VULKAN_VISIBLE',
  'AMD_PROOF_OPENCL_VISIBLE',
  'AMD_PROOF_HIP_VISIBLE',
  'AMD_PROOF_UMA_CONFIRMED',
]);

export async function captureAmdUmaProof(options) {
  const outDir = resolveRequiredOut(options.out);
  await mkdir(outDir, { recursive: true });

  const stderrLines = [];
  const windowsProbe = await loadWindowsProbe(options.windowsProbe, stderrLines);
  const dxdiagText = await loadTextOptional(options.dxdiag, stderrLines);
  const wslProbeText = options.wslProbe
    ? await loadTextOptional(options.wslProbe, stderrLines)
    : runWslProbe(stderrLines);
  const pythonProbe = probePython(options.python, stderrLines);

  const proof = buildAmdUmaProof({
    timestamp: new Date().toISOString(),
    host: hostname(),
    windowsProbe,
    dxdiagText,
    wslProbeText,
    pythonProbe,
  });

  await writeAmdProofOutputs(outDir, proof, stderrLines);
  return { outDir, proof };
}

export function buildAmdUmaProof({ timestamp, host, windowsProbe, dxdiagText = '', wslProbeText = '', pythonProbe = {} }) {
  const normalizedWindows = normalizeWindowsProbe(windowsProbe);
  const dxdiag = parseDxdiag(dxdiagText);
  const cpu = normalizeCpu(normalizedWindows);
  const memory = normalizeMemory(normalizedWindows, dxdiag);
  const gpus = normalizeGpus(normalizedWindows, dxdiag);
  const amdGpu = gpus.find(gpu => /Radeon.*890M|890M.*Radeon|AMD Radeon/i.test(gpu.name)) ?? null;
  const nvidiaVisible = gpus.some(gpu => /NVIDIA|RTX\s*5090/i.test(gpu.name));
  const wsl = parseWslProbe(wslProbeText);
  const python = normalizePythonProbe(pythonProbe);
  const directx12Visible = /DirectX\s*12/i.test(dxdiag.directxVersion ?? '') || dxdiag.directx12Visible;
  const vulkanDriver = hasAmdDriver(normalizedWindows, /Vulkan/i);
  const openclDriver = hasAmdDriver(normalizedWindows, /OpenCL/i);
  const classification = classifyAmdProof({
    amdVisible: Boolean(amdGpu),
    directx12Visible,
    directmlCandidate: Boolean(amdGpu && directx12Visible),
    torchDirectmlTinyOp: python.torch_directml_tiny_op_pass,
    torchDirectmlImport: python.torch_directml_available,
    onnxDirectmlTinyOp: python.onnxruntime_directml_tiny_op_pass,
    onnxDirectmlImport: python.onnxruntime_directml_available,
    vulkanVisible: wsl.vulkan.available || vulkanDriver,
    openclVisible: wsl.opencl.available || openclDriver,
    hipVisible: wsl.rocm_hip.hip_sdk_present || wsl.rocm_hip.rocminfo_present,
    umaConfirmed: memory.uma_status === 'confirmed',
  });

  const proof = {
    schema_version: 1,
    timestamp,
    host,
    cpu,
    memory,
    gpu: {
      amd_visible: Boolean(amdGpu),
      name: amdGpu?.name ?? null,
      driver_version: amdGpu?.driver_version ?? null,
      directx12_visible: directx12Visible,
      adapter_index: amdGpu?.adapter_index ?? null,
      nvidia_visible: nvidiaVisible,
      adapters: gpus,
    },
    directml: {
      candidate: Boolean(amdGpu && directx12Visible),
      torch_directml_available: python.torch_directml_available,
      onnxruntime_directml_available: python.onnxruntime_directml_available,
      onnxruntime_version: python.onnxruntime_version,
      onnxruntime_providers: python.onnxruntime_providers,
      onnxruntime_tiny_op_pass: python.onnxruntime_directml_tiny_op_pass,
      onnxruntime_session_options: python.onnxruntime_session_options,
      onnxruntime_session_providers: python.onnxruntime_session_providers,
      tiny_op_pass: python.torch_directml_tiny_op_pass || python.onnxruntime_directml_tiny_op_pass,
      torch_directml_tiny_op_pass: python.torch_directml_tiny_op_pass,
      onnxruntime_directml_tiny_op_pass: python.onnxruntime_directml_tiny_op_pass,
      available_providers: python.onnxruntime_providers,
    },
    vulkan: {
      available: wsl.vulkan.available || vulkanDriver,
      device_name: wsl.vulkan.device_name ?? (vulkanDriver ? 'AMD Vulkan driver component present' : null),
    },
    opencl: {
      available: wsl.opencl.available || openclDriver,
      device_name: wsl.opencl.device_name ?? (openclDriver ? 'AMD OpenCL driver component present' : null),
    },
    rocm_hip: wsl.rocm_hip,
    windows: {
      present: Boolean(windowsProbe),
      build: normalizedWindows.os?.BuildNumber ?? normalizedWindows.os?.buildNumber ?? null,
      caption: normalizedWindows.os?.Caption ?? normalizedWindows.os?.caption ?? null,
      dxdiag_present: Boolean(dxdiagText),
      directx_version: dxdiag.directxVersion ?? null,
      multi_gpu_system: gpus.length > 1,
    },
    wsl: {
      dxg_present: wsl.dxg_present,
      amd_visible: wsl.amd_visible,
      nvidia_visible: wsl.nvidia_visible,
    },
    python,
    classification,
    classifications: classifyAmdProofSet({
      amdVisible: Boolean(amdGpu),
      directx12Visible,
      directmlCandidate: Boolean(amdGpu && directx12Visible),
      torchDirectmlTinyOp: python.torch_directml_tiny_op_pass,
      torchDirectmlImport: python.torch_directml_available,
      onnxDirectmlTinyOp: python.onnxruntime_directml_tiny_op_pass,
      onnxDirectmlImport: python.onnxruntime_directml_available,
      vulkanVisible: wsl.vulkan.available || vulkanDriver,
      openclVisible: wsl.opencl.available || openclDriver,
      hipVisible: wsl.rocm_hip.hip_sdk_present || wsl.rocm_hip.rocminfo_present,
      umaConfirmed: memory.uma_status === 'confirmed',
    }),
    safe_for_model_download: false,
    source_authority: false,
    generated_artifact: true,
    notes: buildNotes({ amdGpu, nvidiaVisible, memory, directx12Visible, python }),
  };

  if (!PROOF_LEVELS.has(proof.classification)) {
    throw new Error(`Invalid AMD proof classification: ${proof.classification}`);
  }
  return proof;
}

function normalizeWindowsProbe(probe) {
  if (!probe) return {};
  return {
    cpu: first(probe.cpu ?? probe.processor),
    video: toArray(probe.video),
    system: probe.computerSystem ?? probe.system ?? {},
    os: probe.operatingSystem ?? probe.os ?? {},
    physicalMemory: toArray(probe.physicalMemory),
    amdDrivers: toArray(probe.amdDrivers),
    amdPnpDevices: toArray(probe.amdPnpDevices),
  };
}

function normalizeCpu(probe) {
  const cpu = probe.cpu ?? {};
  return {
    name: clean(cpu.Name ?? cpu.name),
    cores: Number(cpu.NumberOfCores ?? cpu.cores) || 0,
    threads: Number(cpu.NumberOfLogicalProcessors ?? cpu.threads) || 0,
  };
}

function normalizeMemory(probe, dxdiag) {
  const visibleBytes = Number(probe.system?.TotalPhysicalMemory ?? 0);
  const moduleBytes = toArray(probe.physicalMemory)
    .reduce((sum, item) => sum + (Number(item.Capacity ?? item.capacity) || 0), 0);
  const totalBytes = moduleBytes || visibleBytes;
  const totalMiB = Math.round(totalBytes / 1024 / 1024);
  const sharedMiB = dxdiag.amdSharedMemoryMiB ?? null;
  const has64GibModules = totalMiB >= 65500;
  const uma_status = has64GibModules && sharedMiB ? 'confirmed' : (sharedMiB || /Radeon.*890M/i.test(probe.cpu?.Name ?? '') ? 'inferred' : 'unknown');
  return {
    system_total_mib: totalMiB,
    visible_system_mib: visibleBytes ? Math.round(visibleBytes / 1024 / 1024) : 0,
    uma_shared_mib: sharedMiB,
    uma_status,
  };
}

function normalizeGpus(probe, dxdiag) {
  const result = [];
  const dxByName = new Map(dxdiag.adapters.map(adapter => [adapter.name, adapter]));
  for (const [index, gpu] of toArray(probe.video).entries()) {
    const name = clean(gpu.Name ?? gpu.name);
    if (!name) continue;
    const dx = dxByName.get(name) ?? {};
    result.push({
      adapter_index: index,
      name,
      driver_version: clean(gpu.DriverVersion ?? gpu.driverVersion ?? dx.driverVersion),
      pnp_device_id: gpu.PNPDeviceID ?? gpu.pnpDeviceId ?? null,
      adapter_ram_mib: Math.round((Number(gpu.AdapterRAM ?? 0) || 0) / 1024 / 1024),
      display_memory_mib: dx.displayMemoryMiB ?? null,
      dedicated_memory_mib: dx.dedicatedMemoryMiB ?? null,
      shared_memory_mib: dx.sharedMemoryMiB ?? null,
      hybrid_type: dx.hybridType ?? null,
    });
  }
  return result;
}

export function parseDxdiag(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const directxLine = lines.find(line => /DirectX Version:/i.test(line));
  const adapters = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const card = line.match(/^Card name:\s*(.+)$/i);
    if (card) {
      current = { name: clean(card[1]) };
      adapters.push(current);
      continue;
    }
    if (!current) continue;
    assignDxdiagMiB(current, 'displayMemoryMiB', line.match(/^Display Memory:\s*([0-9]+)\s*MB/i));
    assignDxdiagMiB(current, 'dedicatedMemoryMiB', line.match(/^Dedicated Memory:\s*([0-9]+)\s*MB/i));
    assignDxdiagMiB(current, 'sharedMemoryMiB', line.match(/^Shared Memory:\s*([0-9]+)\s*MB/i));
    const driver = line.match(/^Driver Version:\s*(.+)$/i);
    if (driver) current.driverVersion = clean(driver[1]);
    const hybrid = line.match(/^Hybrid Graphics GPU:\s*(.+)$/i);
    if (hybrid) current.hybridType = clean(hybrid[1]);
  }
  const amdAdapter = adapters.find(adapter => /Radeon.*890M|AMD Radeon/i.test(adapter.name));
  return {
    directxVersion: clean(directxLine?.split(':').slice(1).join(':')),
    directx12Visible: /DirectX\s*12/i.test(directxLine ?? ''),
    adapters,
    amdSharedMemoryMiB: amdAdapter?.sharedMemoryMiB ?? null,
  };
}

function assignDxdiagMiB(target, key, match) {
  if (match) target[key] = Number(match[1]) || 0;
}

function parseWslProbe(text) {
  const value = String(text ?? '');
  return {
    dxg_present: /\/dev\/dxg|crw.*dxg/i.test(value),
    amd_visible: /AMD|Radeon/i.test(value),
    nvidia_visible: /NVIDIA|libnvidia|nvidia-smi/i.test(value),
    vulkan: {
      available: /Vulkan Instance Version|GPU[0-9]|deviceName|driverName/i.test(value),
      device_name: firstMatch(value, /deviceName\s*=\s*(.+)/i),
    },
    opencl: {
      available: /Number of platforms|OpenCL|Platform Name/i.test(value),
      device_name: firstMatch(value, /Device Name\s+(.+)/i),
    },
    rocm_hip: {
      hip_sdk_present: /HIP version|HIP_PATH|hipconfig/i.test(value) && !/not found/i.test(value),
      rocminfo_present: /ROCk module|ROCm|rocminfo/i.test(value) && !/not found/i.test(value),
      usable: /gfx|Agent/i.test(value) && /ROCm|rocminfo/i.test(value),
    },
  };
}

function probePython(pythonPath, stderrLines) {
  if (!pythonPath) return { available: false };
  const command = resolvePythonCommand(pythonPath);
  if (!command) return { available: false };
  const probe = String.raw`
import importlib.util
import json
import sys

out = {
  "available": True,
  "requested_executable": sys.executable,
  "executable": sys.executable,
  "version": sys.version.split()[0],
  "torch_directml_available": False,
  "torch_directml_device": None,
  "torch_directml_tiny_op_pass": False,
  "torch_directml_error": None,
  "onnxruntime_available": False,
  "onnxruntime_version": None,
  "onnxruntime_directml_available": False,
  "onnxruntime_providers": [],
  "onnxruntime_session_providers": [],
  "onnxruntime_session_options": {
    "enable_mem_pattern": False,
    "execution_mode": "ORT_SEQUENTIAL"
  },
  "onnxruntime_tiny_model": {
    "source_authority": False,
    "generated_artifact": True,
    "opset": 20,
    "ir_version": 10,
    "external_model": False
  },
  "onnxruntime_input": [[10.0, 20.0, 30.0, 40.0]],
  "onnxruntime_output": None,
  "onnxruntime_expected": [[11.0, 22.0, 33.0, 44.0]],
  "onnxruntime_directml_tiny_op_pass": False,
  "onnxruntime_error": None,
}

try:
  if importlib.util.find_spec("torch_directml") is not None:
    import torch
    import torch_directml
    out["torch_directml_available"] = True
    device = torch_directml.device()
    out["torch_directml_device"] = str(device)
    try:
      x = torch.ones((2, 2), device=device)
      y = x + x
      out["torch_directml_tiny_op_pass"] = bool(float(y.cpu()[0, 0].item()) == 2.0)
    except Exception as error:
      out["torch_directml_error"] = repr(error)
except Exception as error:
  out["torch_directml_error"] = repr(error)

try:
  if importlib.util.find_spec("onnxruntime") is not None:
    import onnxruntime as ort
    out["onnxruntime_available"] = True
    out["onnxruntime_version"] = ort.__version__
    out["onnxruntime_providers"] = list(ort.get_available_providers())
    out["onnxruntime_directml_available"] = "DmlExecutionProvider" in out["onnxruntime_providers"]
    if out["onnxruntime_directml_available"] and importlib.util.find_spec("onnx") is not None and importlib.util.find_spec("numpy") is not None:
      import tempfile
      from pathlib import Path
      import numpy as np
      import onnx
      from onnx import TensorProto, helper, numpy_helper

      with tempfile.TemporaryDirectory(prefix="reversa-onnx-dml-") as temp_dir:
        model_path = Path(temp_dir) / "tiny-add.onnx"
        constant = np.array([[1.0, 2.0, 3.0, 4.0]], dtype=np.float32)
        input_info = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 4])
        output_info = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 4])
        constant_init = numpy_helper.from_array(constant, name="constant")
        node = helper.make_node("Add", ["input", "constant"], ["output"], name="tiny_add")
        graph = helper.make_graph([node], "reversa_tiny_add", [input_info], [output_info], [constant_init])
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 20)], producer_name="reversa-studio")
        model.ir_version = 10
        onnx.checker.check_model(model)
        onnx.save(model, model_path)

        so = ort.SessionOptions()
        so.enable_mem_pattern = False
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        requested_providers = ["DmlExecutionProvider", "CPUExecutionProvider"]
        try:
          sess = ort.InferenceSession(
            str(model_path),
            sess_options=so,
            providers=requested_providers,
            provider_options=[{"device_id": "1"}, {}],
          )
        except Exception:
          sess = ort.InferenceSession(str(model_path), sess_options=so, providers=requested_providers)
        out["onnxruntime_session_providers"] = list(sess.get_providers())
        x = np.array(out["onnxruntime_input"], dtype=np.float32)
        y = sess.run(None, {"input": x})[0]
        out["onnxruntime_output"] = y.tolist()
        out["onnxruntime_directml_tiny_op_pass"] = bool(
          "DmlExecutionProvider" in out["onnxruntime_session_providers"]
          and np.allclose(y, np.array(out["onnxruntime_expected"], dtype=np.float32))
        )
except Exception as error:
  out["onnxruntime_error"] = repr(error)

print(json.dumps(out, sort_keys=True))
`;
  const result = runPythonProbeCommand(command, probe);
  if (result.error) stderrLines.push(`[${command}] ${result.error.message}`);
  if (result.stderr) stderrLines.push(`[${command}] ${result.stderr.trim()}`);
  if (result.status !== 0 || !result.stdout.trim()) {
    return { available: true, requested_executable: command, executable: command, error: result.error?.message ?? result.stderr ?? result.stdout };
  }
  try {
    return { requested_executable: command, ...JSON.parse(result.stdout) };
  } catch (error) {
    stderrLines.push(`[${command}] Could not parse Python probe JSON: ${error.message}`);
    return { available: true, requested_executable: command, executable: command, error: error.message };
  }
}

function runPythonProbeCommand(command, probe) {
  const direct = spawnSync(command, ['-c', probe], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  if (!direct.error && direct.status === 0 && direct.stdout.trim()) return direct;

  const windowsPath = toWindowsPath(command);
  if (!windowsPath || !commandExists('powershell.exe')) return direct;

  const tempDir = mkdtempSync(join(tmpdir(), 'reversa-amd-python-probe-'));
  try {
    const probePath = join(tempDir, 'probe.py');
    writeFileSync(probePath, probe, 'utf8');
    const windowsProbePath = toWindowsPath(probePath);
    if (!windowsProbePath) return direct;
    const script = `& ${quotePowerShellString(windowsPath)} ${quotePowerShellString(windowsProbePath)}`;
    const fallback = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    if (fallback.stderr) {
      fallback.stderr = [`Direct python launch failed: ${direct.error?.message ?? direct.stderr ?? direct.stdout}`, fallback.stderr].filter(Boolean).join('\n');
    } else if (direct.error || direct.stderr || direct.stdout) {
      fallback.stderr = `Direct python launch failed: ${direct.error?.message ?? direct.stderr ?? direct.stdout}`;
    }
    return fallback;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function toWindowsPath(path) {
  if (/^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path)) return path;
  if (!commandExists('wslpath')) return null;
  const result = spawnSync('wslpath', ['-w', path], { encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return result.stdout.trim();
}

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizePythonProbe(probe) {
  return {
    available: Boolean(probe?.available),
    requested_executable: probe?.requested_executable ?? 'unknown',
    executable: probe?.executable ?? 'unknown',
    version: probe?.version ?? 'unknown',
    torch_directml_available: Boolean(probe?.torch_directml_available),
    torch_directml_device: probe?.torch_directml_device ?? null,
    torch_directml_tiny_op_pass: Boolean(probe?.torch_directml_tiny_op_pass),
    onnxruntime_available: Boolean(probe?.onnxruntime_available),
    onnxruntime_version: probe?.onnxruntime_version ?? null,
    onnxruntime_directml_available: Boolean(probe?.onnxruntime_directml_available),
    onnxruntime_providers: probe?.onnxruntime_providers ?? [],
    onnxruntime_session_providers: probe?.onnxruntime_session_providers ?? [],
    onnxruntime_session_options: probe?.onnxruntime_session_options ?? null,
    onnxruntime_tiny_model: probe?.onnxruntime_tiny_model ?? null,
    onnxruntime_input: probe?.onnxruntime_input ?? null,
    onnxruntime_output: probe?.onnxruntime_output ?? null,
    onnxruntime_expected: probe?.onnxruntime_expected ?? null,
    onnxruntime_directml_tiny_op_pass: Boolean(probe?.onnxruntime_directml_tiny_op_pass),
    error: probe?.error ?? probe?.torch_directml_error ?? probe?.onnxruntime_error ?? null,
  };
}

function classifyAmdProof(facts) {
  if (facts.onnxDirectmlTinyOp) return 'AMD_PROOF_ONNXRUNTIME_DIRECTML_TINY_OP_PASS';
  if (facts.torchDirectmlTinyOp) return 'AMD_PROOF_TORCH_DIRECTML_TINY_OP_PASS';
  if (facts.torchDirectmlImport) return 'AMD_PROOF_TORCH_DIRECTML_IMPORT';
  if (facts.onnxDirectmlImport) return 'AMD_PROOF_ONNXRUNTIME_DIRECTML_IMPORT';
  if (facts.directmlCandidate) return 'AMD_PROOF_DIRECTML_CANDIDATE';
  if (facts.directx12Visible) return 'AMD_PROOF_DIRECTX12_VISIBLE';
  if (facts.umaConfirmed) return 'AMD_PROOF_UMA_CONFIRMED';
  if (facts.vulkanVisible) return 'AMD_PROOF_VULKAN_VISIBLE';
  if (facts.openclVisible) return 'AMD_PROOF_OPENCL_VISIBLE';
  if (facts.hipVisible) return 'AMD_PROOF_HIP_VISIBLE';
  if (facts.amdVisible) return 'AMD_PROOF_WINDOWS_GPU_VISIBLE';
  return 'AMD_PROOF_UNAVAILABLE';
}

function classifyAmdProofSet(facts) {
  const levels = [];
  if (facts.amdVisible) levels.push('AMD_PROOF_WINDOWS_GPU_VISIBLE');
  if (facts.directx12Visible) levels.push('AMD_PROOF_DIRECTX12_VISIBLE');
  if (facts.directmlCandidate) levels.push('AMD_PROOF_DIRECTML_CANDIDATE');
  if (facts.onnxDirectmlImport) levels.push('AMD_PROOF_ONNXRUNTIME_DIRECTML_IMPORT');
  if (facts.onnxDirectmlTinyOp) levels.push('AMD_PROOF_ONNXRUNTIME_DIRECTML_TINY_OP_PASS');
  if (facts.torchDirectmlImport) levels.push('AMD_PROOF_TORCH_DIRECTML_IMPORT');
  if (facts.torchDirectmlTinyOp) levels.push('AMD_PROOF_TORCH_DIRECTML_TINY_OP_PASS');
  if (facts.vulkanVisible) levels.push('AMD_PROOF_VULKAN_VISIBLE');
  if (facts.openclVisible) levels.push('AMD_PROOF_OPENCL_VISIBLE');
  if (facts.hipVisible) levels.push('AMD_PROOF_HIP_VISIBLE');
  if (facts.umaConfirmed) levels.push('AMD_PROOF_UMA_CONFIRMED');
  if (levels.length === 0) levels.push('AMD_PROOF_UNAVAILABLE');
  return [...new Set(levels)];
}

function buildNotes({ amdGpu, nvidiaVisible, memory, directx12Visible, python }) {
  const notes = [];
  if (amdGpu) notes.push('Radeon 890M visible through Windows hardware evidence.');
  if (nvidiaVisible) notes.push('RTX 5090 is also present; AMD and NVIDIA proof lanes must remain separated.');
  if (memory.uma_status === 'confirmed') notes.push('64 GiB physical memory and shared-memory display evidence confirm UMA-style shared memory.');
  if (directx12Visible) notes.push('DirectX 12 is visible; DirectML remains a candidate until backend import or tiny-op proof exists.');
  if (python.onnxruntime_directml_tiny_op_pass) notes.push('ONNX Runtime DirectML tiny synthetic Add operation passed with memory pattern disabled and sequential execution.');
  if (!python.torch_directml_available) notes.push('torch-directml was not proven in the selected Python environment.');
  if (!python.onnxruntime_directml_available) notes.push('ONNX Runtime DirectML provider was not proven in the selected Python environment.');
  return notes;
}

async function loadWindowsProbe(path, stderrLines) {
  if (path) return JSON.parse(await readFile(resolve(path), 'utf8'));
  if (!commandExists('powershell.exe')) {
    stderrLines.push('powershell.exe not available from this shell; Windows probe unavailable.');
    return null;
  }
  const command = [
    '$ErrorActionPreference="SilentlyContinue";',
    '$cpu=Get-CimInstance Win32_Processor|Select-Object Name,NumberOfCores,NumberOfLogicalProcessors;',
    '$video=Get-CimInstance Win32_VideoController|Select-Object Name,AdapterRAM,DriverVersion,PNPDeviceID,VideoProcessor,AdapterCompatibility;',
    '$system=Get-CimInstance Win32_ComputerSystem|Select-Object Manufacturer,Model,SystemType,TotalPhysicalMemory,HypervisorPresent;',
    '$os=Get-CimInstance Win32_OperatingSystem|Select-Object Caption,Version,BuildNumber,OSArchitecture,TotalVisibleMemorySize;',
    '$memory=Get-CimInstance Win32_PhysicalMemory|Select-Object Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed,DeviceLocator,BankLabel;',
    '$drivers=Get-CimInstance Win32_PnPSignedDriver|Where-Object{$_.DeviceName -match "AMD|Radeon"}|Select-Object DeviceName,DriverVersion,DriverDate,Manufacturer,InfName,DeviceClass;',
    '[ordered]@{cpu=$cpu;video=$video;computerSystem=$system;operatingSystem=$os;physicalMemory=$memory;amdDrivers=$drivers}|ConvertTo-Json -Depth 6',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 * 4 });
  if (result.stderr) stderrLines.push(`[powershell.exe] ${result.stderr.trim()}`);
  if (result.status !== 0 || !result.stdout.trim()) {
    stderrLines.push(`Windows probe failed: ${result.stderr || result.stdout}`);
    return null;
  }
  return JSON.parse(result.stdout);
}

async function loadTextOptional(path, stderrLines) {
  if (!path) return '';
  try {
    return await readFile(resolve(path), 'utf8');
  } catch (error) {
    stderrLines.push(`Could not read ${path}: ${error.message}`);
    return '';
  }
}

function runWslProbe(stderrLines) {
  const commands = [
    ['lspci', []],
    ['ls', ['-l', '/dev/dxg']],
    ['glxinfo', ['-B']],
    ['vulkaninfo', ['--summary']],
    ['clinfo', []],
    ['rocminfo', []],
    ['hipconfig', []],
  ];
  const chunks = [];
  for (const [command, args] of commands) {
    if (!commandExists(command)) continue;
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (result.stderr) stderrLines.push(`[${command}] ${result.stderr.trim()}`);
    chunks.push(`## ${command} ${args.join(' ')}\n${result.stdout}`);
  }
  return chunks.join('\n');
}

async function writeAmdProofOutputs(outDir, proof, stderrLines) {
  await writeFile(join(outDir, 'amd-uma-proof.json'), JSON.stringify(proof, null, 2) + '\n', 'utf8');
  await writeFile(join(outDir, 'amd-uma-proof.md'), renderAmdProofMarkdown(proof), 'utf8');
  await writeFile(join(outDir, 'backend-probe.tsv'), renderBackendProbeTsv(proof), 'utf8');
  await writeFile(join(outDir, 'stderr.log'), stderrLines.join('\n') + (stderrLines.length > 0 ? '\n' : ''), 'utf8');
}

export function renderAmdProofMarkdown(proof) {
  return [
    '# AMD UMA Proof',
    '',
    `- Classification: ${proof.classification}`,
    `- Classifications: ${proof.classifications.join(', ')}`,
    `- CPU: ${proof.cpu.name}`,
    `- GPU: ${proof.gpu.name ?? 'not found'}`,
    `- Driver: ${proof.gpu.driver_version ?? 'unknown'}`,
    `- System memory MiB: ${proof.memory.system_total_mib}`,
    `- UMA status: ${proof.memory.uma_status}`,
    `- UMA shared MiB: ${proof.memory.uma_shared_mib ?? 'unknown'}`,
    `- DirectX: ${proof.windows.directx_version ?? 'unknown'}`,
    `- DirectML candidate: ${proof.directml.candidate ? 'yes' : 'no'}`,
    `- torch-directml: ${proof.directml.torch_directml_available ? 'present' : 'missing'}`,
    `- ONNX Runtime DirectML: ${proof.directml.onnxruntime_directml_available ? 'present' : 'missing'}`,
    `- ONNX Runtime version: ${proof.directml.onnxruntime_version ?? 'unknown'}`,
    `- ONNX Runtime DirectML tiny op: ${proof.directml.onnxruntime_tiny_op_pass ? 'pass' : 'not proven'}`,
    `- ONNX Runtime session mode: ${proof.directml.onnxruntime_session_options?.execution_mode ?? 'unknown'}`,
    `- ONNX Runtime memory pattern: ${proof.directml.onnxruntime_session_options?.enable_mem_pattern === false ? 'disabled' : 'unknown'}`,
    `- Vulkan: ${proof.vulkan.available ? 'visible' : 'not proven'}`,
    `- OpenCL: ${proof.opencl.available ? 'visible' : 'not proven'}`,
    `- ROCm/HIP usable: ${proof.rocm_hip.usable ? 'yes' : 'no'}`,
    `- Safe for model acquisition: ${proof.safe_for_model_download ? 'yes' : 'no'}`,
    '',
    '## Notes',
    '',
    ...(proof.notes.length > 0 ? proof.notes.map(note => `- ${note}`) : ['- None']),
    '',
  ].join('\n');
}

function renderBackendProbeTsv(proof) {
  return [
    'backend\tstatus',
    `windows_amd\t${proof.gpu.amd_visible ? 'present' : 'missing'}`,
    `directx12\t${proof.gpu.directx12_visible ? 'present' : 'missing'}`,
    `directml_candidate\t${proof.directml.candidate ? 'present' : 'missing'}`,
    `torch_directml\t${proof.directml.torch_directml_available ? 'present' : 'missing'}`,
    `onnxruntime_directml\t${proof.directml.onnxruntime_directml_available ? 'present' : 'missing'}`,
    `onnxruntime_directml_tiny_op\t${proof.directml.onnxruntime_tiny_op_pass ? 'present' : 'missing'}`,
    `vulkan\t${proof.vulkan.available ? 'present' : 'missing'}`,
    `opencl\t${proof.opencl.available ? 'present' : 'missing'}`,
    `hip_rocm\t${proof.rocm_hip.usable ? 'present' : 'missing'}`,
    '',
  ].join('\n');
}

function hasAmdDriver(probe, pattern) {
  return toArray(probe.amdDrivers).some(driver => pattern.test(driver.DeviceName ?? driver.deviceName ?? ''))
    || toArray(probe.amdPnpDevices).some(device => pattern.test(device.FriendlyName ?? device.friendlyName ?? ''));
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
  return text.length > 0 ? text : null;
}

function firstMatch(value, regex) {
  return String(value ?? '').match(regex)?.[1]?.trim() ?? null;
}

function commandExists(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0;
}

function resolvePythonCommand(pythonPath) {
  if (!pythonPath) return null;
  const resolved = resolve(pythonPath);
  if (!existsSync(resolved)) {
    throw new Error(`Selected Python does not exist: ${resolved}`);
  }
  return resolved;
}

function resolveRequiredOut(out) {
  if (!out) throw new Error('Missing required --out');
  const resolved = resolve(out);
  if (!resolved || resolved === resolve('/')) throw new Error('Refusing to write proof output to filesystem root');
  return resolved;
}

function parseArgs(args) {
  const options = { out: null, windowsProbe: null, dxdiag: null, wslProbe: null, python: null, help: false };
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
      case '--dxdiag':
        options.dxdiag = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--wsl-probe':
        options.wslProbe = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--python':
        options.python = resolve(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown AMD proof option: ${arg}`);
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
  node scripts/capture-amd-uma-proof.js --out <dir> [--windows-probe <json>] [--dxdiag <txt>] [--python <path>]

Captures local AMD HX 370 / Radeon 890M / UMA evidence. It does not install
drivers, packages, models, launch games, connect to phones, or mutate runtimes.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await captureAmdUmaProof(options);
  console.log(`AMD UMA proof written: ${result.outDir}`);
  console.log(`Classification: ${result.proof.classification}`);
}

if (process.argv[1] && isAbsolute(process.argv[1]) && resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
