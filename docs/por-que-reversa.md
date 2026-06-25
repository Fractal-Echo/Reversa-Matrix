# Why Reversa-Matrix Exists

Modern code research spans mixed trees: Android device sources, Linux graphics stacks, Windows services, kernels, build systems, generated files, vendor blobs, copied constants, logs, patches, and half-true assumptions from previous ports.

Reversa-Matrix exists for that mess.

---

## The Problem

When a tree gets large enough, nobody can safely reason from memory. A single target may have:

- old device names copied into new bring-up work
- one file claiming one SoC and another file claiming another
- paths that only exist on-device
- partition sizes from a different board
- build flags that contradict known-good test results
- generated files mixed with hand-edited files
- reference trees that are useful but unsafe to import blindly

An agent can help, but only if it has durable evidence. A polished paragraph is not enough. It needs file paths, line numbers, normalized claims, severity, confidence, and a way to compare claims across runs.

---

## Product Position

Reversa-Matrix is shaped around:

- Windows, Android, Linux, and mixed codebases
- source-tree and artifact evidence
- contradiction detection
- known-good facts from real testing
- compare mode between trees
- safe patch candidate review
- dashboard browsing for humans
- JSON/JSONL handoff for Codex agents

The product should read as a professional evidence system, not a migration assistant.

---

## The Operating Principle

```text
Claims must be traceable.
Risk must be labeled.
HTML must not become the source of truth.
Agents must inherit evidence, not informal summaries.
```

That means Reversa-Matrix favors structured outputs, stable evidence IDs, and boring reproducibility over magical auto-fixes.

---

## Who It Is For

- Android recovery, kernel, and vendor bring-up work
- Linux userspace, graphics, compositor, and container research
- Windows service, driver, application, and build-tree analysis
- cross-platform ports where constants and paths drift over time
- Codex-assisted research where the next agent needs a clean handoff
- anyone comparing a current tree to a known-good or reference tree

---

## What It Should Not Do

Reversa-Matrix should not quietly mutate the target. It should not hide weak evidence. It should not run destructive device workflows as normal actions. It should not treat a reference tree as automatically correct.

The tool maps the evidence. Humans and agents still weigh the fix.
