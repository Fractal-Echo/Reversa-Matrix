# Reversa Tool Policy

Reversa-Agent uses typed tools. It does not give a model raw shell access.

## Core Rule

```text
Shell is not one tool. Shell is many small tools.
```

Bad:

```text
shell(command: string)
```

Good:

```text
read_file(path)
grep_repo(pattern, root)
git_status(root)
git_diff(root)
reversa_scan_profile(root, profile, out)
adb_getprop(serial, prop)
adb_ls(serial, path)
adb_cat(serial, path)
write_report(path, content)
write_patch_proposal(path, diff)
```

The model can ask for a tool. Reversa decides whether the mode and policy allow
that tool.

## Default Disabled Tools

These stay disabled outside a future explicit danger mode:

```yaml
dangerous_tools:
  raw_shell: disabled
  adb_dd_write: disabled
  fastboot_flash: disabled
  rm_recursive: disabled
  partition_write: disabled
  chmod_system: disabled
  package_uninstall: disabled
```

## Patch Gate

Patch proposal needs evidence:

```yaml
patch_gate:
  evidence_files:
    - path_exists
    - hashes_recorded
    - evidence_manifest_written
    - scan_profile_attached
  contradiction_check:
    - no_conflict_with_known_good_frontier
    - no_forbidden_lane_touched
  user_policy:
    patch_without_evidence: false
    patch_source_code_without_report: false
```

Patch proposal format:

1. Evidence.
2. Contradiction found.
3. Minimal patch.
4. Files touched.
5. Verification command.
6. Rollback command.

## Current Mode Defaults

| Mode | Allowed direction |
| --- | --- |
| `scan-only` | local file reads, Reversa scans, contradiction reports |
| `phone-safe` | scan-only plus future read-only ADB snapshot tools |
| `patch-propose` | scan-only plus patch proposal artifacts |
| `patch-apply` | disabled |
| `recovery-danger` | disabled |

This matches the project rule: patch only when evidence shows it is required or
recommended.

Every `agent run` writes:

```text
artifacts/evidence_files.sha256
artifacts/evidence_manifest.json
```

Those files are the proof that the report can be tied back to exact local
inputs.

## Compatibility Wrapper Rule

Wrapper work is evidence work. Reversa must identify the actual runtime and
graphics/input layer before recommending a wrapper.

Required order:

1. Identify executable type, bitness, launch host, and render/audio/input API.
2. Record the current wrapper version, hash, source URL, and release date.
3. Change one wrapper variable per test run.
4. Record stop conditions and rollback steps.
5. Promote only results backed by logs, screenshots, hashes, or repeated
   controlled runs.

Examples:

- A DOSBox-packaged game starts with DOSBox Staging and config evidence, not
  Direct3D/Vulkan DLL swapping.
- A Direct3D 9 game may enter the DXVK lane only after the D3D9 API and bitness
  are observed.
- A DirectDraw game may enter the dgVoodoo, DDrawCompat, dxwrapper, or cnc-ddraw
  lanes only after DirectDraw evidence exists.
- Old DXVK Async builds are historical evidence unless a current supported fork
  or driver feature proves a reason to test them.

This wrapper rule applies across BO3-Transformed, Pandemonium!-Transformed,
D-Transformed, RM11Pro gaming runtime work, and future game projects.

## Shell Host Rule

Tool friction is training data. When a repo lives in WSL and the command needs
Unix tools, pipes, quoting, `sed`, `rg`, `find`, or shell expansion, run it
inside the WSL shell:

```text
wsl.exe --cd <repo> bash -lc '<command>'
```

Avoid mixing PowerShell parsing with Unix pipelines. If a command fails because
the host shell interpreted it incorrectly, record the mismatch and rerun the
smallest corrected command. Do not turn shell-host friction into speculative
debugging.

When Codex is already running through PowerShell, avoid passing Bash variables
such as `$pack`, `$out`, `$1`, or `$d` through the command string unless they are
proven escaped. Prefer explicit paths or a checked script file for multi-step
training sweeps. PowerShell-side variable expansion can silently turn a valid
Bash command into empty arguments.

## Personal Local Training Rule

Reversa may train locally on reference material for a personal non-commercial
tool when the corpus manifest explicitly marks the source as local experimental
training material.

Hard boundaries:

- personal use only;
- cannot be sold;
- do not redistribute copied third-party source text;
- do not commit copied third-party prompt/source text;
- generated outputs must be Reversa-owned rewrites;
- source authority still comes from corroborated artifacts, not training memory.

This is the anti-copy boundary: learn patterns, create original mechanisms.
