# Third-Party Notices

Reversa-Matrix is MIT-licensed Fractal-Echo tooling.

## Runtime Dependencies

The npm package uses third-party packages listed in `package.json` and
`package-lock.json`, including `chalk`, `inquirer`, `ora`, and `semver`.
Preserve their upstream license notices when packaging Reversa-Matrix outside
normal npm installation workflows.

## Documentation Tooling

The docs build uses MkDocs and Material for MkDocs from `docs/requirements.txt`.
Those are documentation build dependencies, not runtime scanner dependencies.

## Profile Names And Ecosystem References

Profiles may mention Android, OrangeFox, TWRP, Gamescope, Xwayland, Mesa,
Vulkan, Wine, Proton, DXVK, VKD3D, Special K, ReShade, 3DMigoto, WayLandIE,
DroidSpaces, Anland, and other ecosystems. These are classifier targets or
evidence domains. Reversa-Matrix does not claim ownership of those projects and
does not bundle their binaries unless a future release explicitly says so.

Generated reports should be treated as Reversa-Matrix analysis of inspected
artifacts, not as ownership claims over the inspected project.

## Claude/Codex Tooling Research Sources

The `agentic_toolchain` profile and related docs were informed by a local
source-ingestion pass over public Claude/Codex tooling repositories. Reversa
does not vendor restored Claude Code source or proprietary/commercial-term
material. The detailed pinned source manifest lives at
`docs/upstreams/claude-code-matrix/source-sync.json`.

High-level attribution lanes:

- `shanraisshan/claude-code-best-practice` - MIT, selective pattern adaptation.
- `luongnv89/claude-howto` - MIT, selective beginner workflow adaptation.
- `anthropics/claude-cookbooks` - MIT, selective audit/workflow adaptation.
- `shareAI-lab/learn-claude-code` - MIT, concept adaptation for skills, memory,
  and agent harnesses.
- `thedotmack/claude-mem` - Apache-2.0 with NOTICE preservation required;
  architecture concepts only unless copied files are explicitly tracked.
- `ComposioHQ/awesome-claude-skills` - repo license metadata is ambiguous;
  use per-folder license allowlists only.
- `ChinaSiro/claude-code-sourcemap`, `claude-code-best/claude-code`, and
  `anthropics/claude-code` - reference-only import lanes unless a future
  source-specific license review says otherwise.
