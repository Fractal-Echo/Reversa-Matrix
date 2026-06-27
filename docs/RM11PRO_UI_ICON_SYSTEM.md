# RM11Pro UI And Icon System

Purpose: keep Reversa-Matrix, Nebula, WaylandIE, DroidSpaces, Red Magic control
surfaces, and future APK modules visually consistent.

## Direction

Reversa UI should feel like an RM11Pro operator panel with noir/cyberpunk
inspiration: dense evidence displays, hard light, dark industrial surfaces, and
sharp signal colors. The target mood is inspired by classic and modern
Blade-Runner-style sci-fi, but the assets must remain original Reversa/Nebula
artwork.

- dark base for phone and desktop readability
- red thermal/action accents
- blue Wayland/display accents
- green proof/pass/evidence accents
- amber warning/review accents
- subtle scanline/grid texture for evidence surfaces
- squared 8px-radius controls instead of soft marketing cards
- dense but readable evidence surfaces

The interface should always answer:

1. What was scanned?
2. Is anything blocking?
3. What should I click next?
4. Which command is safe to run?
5. Which artifact should the next agent read?

## Icon Families

Future icon packs should use these families:

| Family | Use | Primary color |
| --- | --- | --- |
| Evidence | findings, logs, manifests, hashes | green |
| Conflict | contradictions, mismatches, blocked state | red |
| Patch | patch candidates, review queue, rollback | amber |
| Display | Wayland, Xwayland, Anland, Gamescope | blue |
| Container | DroidSpaces, Nebula images, runtimes | purple |
| Device | RM11Pro, ADB, thermals, controller state | red/green |
| Agent | handoff, replay, memory, local model | blue/green |
| Safety | destructive commands, secrets, approvals | red/amber |

## First Pack Candidates

- `reversa-matrix`
- `nebula-control`
- `wayland-display`
- `droidspaces-container`
- `redmagic-device`
- `powerdeck-tdp`
- `orangefox-recovery`
- `evidence-scan`
- `contradiction-alert`
- `patch-review`
- `known-good`
- `agent-handoff`

## Implementation Rules

- Keep icons vector-first so Android APKs, docs, dashboards, and launchers can
  reuse the same source.
- Prefer simple silhouette symbols that survive small phone launcher sizes.
- Avoid copying OEM, game, or upstream project logos unless an explicit license
  allows it.
- Store source SVGs and generated PNG/WebP exports separately.
- Every icon should have a source file, export recipe, license note, and intended
  app/module owner.
- Use original symbols only. Do not copy film stills, logos, OEM app icons, game
  logos, or upstream project marks without explicit permission.

## Dashboard Alignment

The current dashboard uses this seed language:

- RM11Pro-first status chip
- Wayland-ready status chip
- Touch-readable status chip
- Offline-evidence status chip
- Triage action cards
- Scan-lane cards
- red/blue/green/amber proof colors

Future Nebula UI should reuse those concepts before adding new visual patterns.
