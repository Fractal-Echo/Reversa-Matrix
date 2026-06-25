# Installation

Reversa-Matrix is a Node.js CLI. Today the strongest path is running it from the cloned repository.

## Requirements

- Node.js 18+
- Git
- A source tree to inspect

For Android/Linux/Windows research, install any platform tools separately. Reversa-Matrix does not bundle ADB, compilers, SDKs, debuggers, or device flashing tools.

---

## Clone The Project

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
npm test
```

Inspect the scanner help:

```bash
node ./bin/reversa.js scan --help
```

---

## Run The Fixture Scan

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/android-recovery-current \
  --profile android_recovery \
  --known-good examples/known_good_rm11pro_nx809j.json \
  --out reversa_out
```

Then generate the GUI:

```bash
node ./bin/reversa.js gui --out reversa_out
```

The command prints a `file://` URL to `dashboard.html`.

---

## Installed Package Style

When the package is installed or published in your environment, the same commands are:

```bash
npx reversa scan --help
npx reversa gui --out reversa_out
```

Inside the cloned repository, prefer `node ./bin/reversa.js ...` so you know you are running this checkout.

---

## Build The Docs

Documentation uses MkDocs through Python. Use a local virtual environment:

```bash
sudo apt install -y python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r docs/requirements.txt
python -m mkdocs build --strict
```

---

## Optional Agent Installer

The older Reversa agent installer still exists for compatibility:

```bash
npx reversa install
```

That command creates `.reversa/`, agent skill folders, and engine entry files such as `AGENTS.md` or `CLAUDE.md`. It is not required for scanner/dashboard use.

For the new Reversa-Matrix workflow, start with `scan`, `compare`, and `gui`.

---

## Safety

Scan and compare read the target tree and write outputs to `--out`. They do not modify the inspected source tree.

Still use normal research hygiene:

- keep your source tree in Git
- keep device-specific known-good facts separate
- do not paste secrets into known-good JSON
- review command lists before running anything
- treat destructive commands as manual-only even if they appear in imported artifacts
