# Reversa-Owned Skill Policy

This corpus teaches Reversa how Claude/Codex skills and plugins are shaped for a
personal, local, non-commercial tool. It does not authorize copying third-party
skill text or plugin implementations into Reversa.

## Rule

```text
Learn the shape. Rebuild the mechanism. Commit only Reversa-owned artifacts.
```

Personal-use local training may include reference material when the manifest
marks it as:

```json
"local_experimental_training_allowed": true
```

That means:

- training is local/private;
- generated outputs must be original Reversa work;
- copied third-party source text is not committed;
- redistribution is not allowed;
- sale/commercial use is not allowed;
- source authority still requires corroborating evidence.

## Import Classes

| Class | Meaning | Allowed Reversa action |
| --- | --- | --- |
| `permissive` | Clear license permits selective reuse | Adapt small mechanisms with attribution |
| `allowlist` | Mixed or folder-specific license evidence | Use only explicitly licensed folders |
| `personal_local` | Reference/no-copy source explicitly marked for local experiments | Learn pattern signal locally; do not copy, sell, redistribute, or commit source text |
| `blocked` | No license, reference-only, or example-only source | Personal local training only when explicitly marked; no copying; reimplement from scratch |
| `unknown` | Evidence incomplete | Manual review before reuse |

## Pattern Extraction Boundary

Allowed:

- skill folder taxonomy;
- manifest field categories;
- validation test ideas;
- naming conventions;
- workflow decomposition;
- safety and permission concepts;
- evidence categories for Reversa scanners.

Not allowed by default:

- vendoring full third-party skill prompts;
- copying plugin code;
- copying marketplace records as Reversa records;
- treating unlicensed repos as trainable source authority;
- committing local upstream caches;
- letting generated scan reports become source authority.
- selling or redistributing copied training material or copied outputs.

## Reversa Rewrite Target

When a useful pattern is found, make a new Reversa-owned artifact:

1. Describe the observed pattern with source URL, commit, license evidence, and
   scan output.
2. Write a Reversa-owned requirement in neutral words.
3. Implement the checker, skill, plugin, template, or doc from scratch.
4. Add tests against synthetic fixtures, not copied upstream files.
5. Record the verification command and artifact hashes.

This is the route for building Reversa's own skill/plugin system without
copy contamination.

The release standard is independent expression. The result may solve a similar
problem, but the mechanism must be written in Reversa's own position, with its
own tests and provenance notes.
