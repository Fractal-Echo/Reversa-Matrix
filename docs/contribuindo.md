# Contributing

Contributions are welcome. If you found a bug, have an idea for a new agent, or want to improve something, the process is simple.

---

## Before submitting a PR

Open an issue first to discuss what you want to change. This avoids wasted work on both sides, especially for larger changes.

---

## Local setup

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
```

---

## Project structure

```
Reversa-Matrix/
├── agents/             ← each agent has its folder with SKILL.md
├── bin/                ← CLI entry point (reversa.js)
├── lib/
│   ├── commands/       ← CLI command implementations
│   └── installer/      ← installation and engine detection logic
├── templates/          ← config templates and engine entry files
└── docs/               ← documentation (you are here)
```

---

## Adding a new agent

1. Create the folder `agents/reversa-[name]/`
2. Create `SKILL.md` following the format of existing agents (required frontmatter: `name`, `description`, `license`, `compatibility`, `metadata`)
3. Add a `references/` folder if the agent needs schema or reference templates
4. Update `lib/installer/` to include the new agent in the install list

---

## License

MIT. See [LICENSE](https://github.com/Fractal-Echo/Reversa-Matrix/blob/main/LICENSE) for details.
