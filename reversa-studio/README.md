# Reversa Studio Prototype

Reversa Studio is an early local dashboard prototype for evidence, model
metadata, and guarded workflow planning.

Open `index.html` directly in a browser, or serve this folder with any static
file server. The prototype reads only the JSON files in `fixtures/`.

Version 01 is planning-only:

- no backend service;
- no external network calls;
- no model acquisition;
- no game launch;
- no binary patching;
- no runtime mutation.

Refresh fixtures from a local GPU advisory dataset:

```bash
node ../bin/reversa.js studio export-fixtures \
  --dataset /path/to/gpu-advisory-dataset \
  --out ./fixtures
```

The generated fixtures are display artifacts. They are not authority records.
