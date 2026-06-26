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
