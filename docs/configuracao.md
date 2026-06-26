# Configuration

The scanner/dashboard loop is mostly command-line driven. The important inputs are:

- `--project-root`
- `--profile`
- `--known-good`
- `--out`

---

## Known-Good Facts

Known-good files are JSON documents that record trusted facts from testing or an accepted reference.

Example:

```bash
node ./bin/reversa.js scan \
  --project-root /path/to/tree \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

Known-good facts should be:

- specific
- evidence-backed
- safe to share
- versioned when they affect conclusions
- separate from private secrets or proprietary device material

The long-term goal is a platform-neutral known-good schema that can hold Android device facts, Linux runtime facts, and Windows host/application facts.

---

## Output Directory

Use `--out` to keep generated artifacts out of the target source tree:

```bash
node ./bin/reversa.js scan --project-root /path/to/tree --profile generic_source_tree --out reversa_out
```

The GUI reads the same directory:

```bash
node ./bin/reversa.js gui --out reversa_out
```

---

## Compatibility Config

The original Reversa installer still creates `.reversa/` for agent-team workflows:

```text
.reversa/
├── state.json
├── config.toml
├── config.user.toml
├── plan.md
├── version
├── context/
└── _config/
```

That configuration is useful for the older agent orchestration flow. It is not required for `scan`, `compare`, or `gui`.

---

## Local Safety Defaults

Recommended local habits:

- keep output folders separate from source trees
- commit only curated research artifacts
- ignore local config such as `.reversa/config.user.toml`
- keep known-good files free of secrets
- do not put destructive commands in shared handoff files unless clearly quarantined

---

## Local Agent Memory

Create starter memory files:

```bash
node ./bin/reversa.js agent init-memory
```

The memory folder is:

```text
.reversa/memory/
+-- known_good_frontier.yaml
+-- active_blockers.yaml
+-- contradictions.yaml
+-- phone_targets.yaml
+-- project_constraints.yaml
```

These files preserve the current frontier, active blockers, policy constraints,
and phone target references between runs. They are read before `agent run`
writes a report.
