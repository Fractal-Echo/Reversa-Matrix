# Contributing

Contributions should preserve the evidence-first contract.

---

## Local Setup

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
```

Optional docs build:

```bash
sudo apt install -y python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r docs/requirements.txt
python -m mkdocs build --strict
```

---

## Project Structure

```text
Reversa-Matrix/
+-- bin/                 CLI entry point
+-- lib/
|   +-- commands/        CLI command implementations
|   +-- gui/             Dashboard generation
|   +-- scan/            Scanner, profiles, schemas, writers
|   +-- installer/       Compatibility installer
+-- docs/                Published documentation
+-- examples/            Known-good sample data
+-- test/                Fixtures and Node tests
```

---

## Contribution Rules

- Keep scan and compare read-only against target trees.
- Keep JSON/JSONL as the source of truth.
- Add tests for new profiles, schema fields, or output behavior.
- Do not add destructive device commands as normal actions.
- Do not introduce heavy dependencies without a clear reason.
- Preserve existing install/status/update compatibility unless a change explicitly targets it.

---

## Public Repository Hygiene

Public documentation should stay product-focused and suitable for new contributors. Keep non-public research notes in ignored paths such as `local/`, `private/`, `LOCAL_NOTES.md`, `PRIVATE_NOTES.md`, or `*.local.md`.

Generated scan output should not be committed unless it is intentionally curated as a test fixture or release artifact.

Run this before publishing:

```bash
npm run check:public-clean
```

---

## Adding A Profile

A new profile should define:

- files and directories it cares about
- extraction patterns
- normalized evidence categories
- known-good comparisons, if applicable
- safe validation commands
- fixture coverage

Profile-specific logic should enrich the common report contract, not create a separate output format.

---

## License

MIT. See [LICENSE](https://github.com/Fractal-Echo/Reversa-Matrix/blob/main/LICENSE).
