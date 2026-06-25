# Installation

Reversa-Matrix is a Node.js CLI. The strongest path for testers is running it from the cloned repository.

## Requirements

- Node.js 18.20.2 or newer
- npm
- Git
- A source tree, config folder, log bundle, or extracted project to inspect

For Android/Linux/Windows/game-runtime research, install any platform tools separately. Reversa-Matrix does not bundle ADB, compilers, SDKs, debuggers, drivers, game files, or device flashing tools.

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
node ./bin/reversa.js scan --profiles
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

## Run The Game Runtime Fixture

```bash
node ./bin/reversa.js scan \
  --project-root ./test/fixtures/bo3-runtime-diagnostics \
  --profile rm11pro_gaming_runtime \
  --out reversa_game_out
```

Then generate the GUI:

```bash
node ./bin/reversa.js gui --out reversa_game_out
```

This fixture exercises game runtime, render enhancement, Vulkan loader, frame timing, texture injection, HDR, API translation, and mobile Linux runtime evidence categories.

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

Documentation uses MkDocs through Python. Install the docs requirements into the user Python site, then build:

```bash
python3 -m pip install --user --break-system-packages -r docs/requirements.txt
python3 -m mkdocs build --strict
```

The build writes the site to `site/`, which is ignored by Git.

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
