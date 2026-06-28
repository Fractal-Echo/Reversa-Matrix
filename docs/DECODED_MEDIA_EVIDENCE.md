# Decoded Media Evidence

Reversa can scan decoded media manifests as artifact-backed evidence.

This lane is for proof extracted from videos, screenshots, OCR, frame captures,
and summaries. It is useful for Telegram/RM11Pro/DroidSpaces/Nebula work because
many important findings first appear as local files or screen recordings.

## Profile

Use:

```bash
node ./bin/reversa.js scan \
  --profiles decoded_media_evidence \
  --project-root /path/to/media-extraction-output \
  --include-ignored \
  --out /path/to/reversa-media-scan
```

Aliases:

- `decoded_media_evidence`
- `nebula_media_evidence`
- `telegram_media_evidence`

Use `--include-ignored` when the media extraction folder lives under `local/`.
Reversa ignores `local/` by default so generated scan output does not recursively
scan itself.

## Input

The scanner reads `decoded-media-manifest.jsonl`.

Expected rows can include:

```json
{"path":"D:/Downloads/proof.mp4","sha256":"...","tags":["EVIDENCE:VIDEO_DECODED","DRM:LEASE","WAYLAND:LABWC"],"content_summary":"DRM lease mode reached userspace; connector 89; CRTC 285; fd3 lease received; /dev/dri/renderD128; wlroots DRM backend; labwc compositor."}
```

## Evidence Extracted

The profile records:

- decoded artifact path and hash
- DRM lease evidence
- connector, CRTC, mode, lease fd, card, render node, and scanout plane when
  visible
- wlroots DRM backend and labwc compositor evidence
- KGSL/GLES renderer evidence
- FPS and ping overlay context
- explicit guard text such as `not standalone runtime-lane proof`

## Authority Boundary

Decoded media is evidence, not source authority by itself.

It may corroborate a claim, but it must not directly cause:

- source patching
- APK/module/kernel staging
- ADB or fastboot action
- DRM mutation
- compositor/runtime/game launch
- hard-coded replay of connector, CRTC, plane, fd, or mode IDs

Object IDs and fds are runtime-volatile. A video can prove that a value appeared
in one run; it cannot prove that value is safe to reuse later.

## Nebula Dock Lease Planning Rule

The current decoded video proof supports that an Anland/DroidSpaces dock lease
path reached userspace with DRM lease handoff, KGSL/GLES rendering, Wayland,
wlroots, and labwc.

It does not unblock active Dock replay.

A future Dock pass still needs:

- reviewed source for the broker/receiver path
- dynamic external-only connector, CRTC, plane, fd, and mode discovery
- host fixtures for JSON command and result schemas
- receiver-only smoke proof
- `TEST_ONLY` proof before any real lease mutation
- stop/revoke and rollback evidence
- safe-mode and crash-counter enforcement
- explicit runtime approval

The profile intentionally emits no patch candidates.
