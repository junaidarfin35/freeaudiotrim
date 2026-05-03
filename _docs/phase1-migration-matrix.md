# Phase 1 Design System Migration Matrix

Scope: unify tool UIs to `at-*` system tool-by-tool. No CSS cleanup in this phase.

## Status Legend
- `Completed`: migrated and validated for legacy token removal in HTML.
- `Compliant`: already aligned; validated.
- `Shell-aligned`: shell/wrapper aligned to canonical tool container while preserving JS mount points.

## Per-File Status

| File | Status | Notes |
|---|---|---|
| `audio-cutter-online.html` | Completed | `ui-system.js` removed; `at-*` tool shell validated. |
| `audio-converter.html` | Completed | `ui-system.js` removed; `at-*` tool shell validated. |
| `convert-mp3-to-wav.html` | Completed | `ui-system.js` removed; `at-*` tool shell validated. |
| `audio-pitch-changer.html` | Completed | Removed custom row helper `controls-main`; control row now `at-row`. |
| `audio-speed-changer.html` | Completed | Removed legacy `btn*` + custom row-system classes from tool controls. |
| `merge-audio-files.html` | Completed | Removed hidden attr / `data-style` tool attrs; normalized action link to `at-btn at-btn-soft`; removed `ui-system.js`. |
| `extract-audio-from-video.html` | Compliant | Already aligned to `at-*`; retained hooks and behavior. |
| `audio-video-transcription-online.html` | Shell-aligned | Kept `#audio-tool` mount; removed stray unscoped `.at-status` outside tool root. |
| `free-mp3-cutter.html` | Compliant | Uses `#audio-tool` mount with trim system; no legacy class tokens. |
| `ringtone-maker.html` | Completed | Rebuilt as the cutter-family ringtone mirror; upload shell now swaps correctly and M4R export path is wired. |
| `remove-silence-from-audio.html` | Shell-aligned | Added canonical wrapper: `#audio-tool.at-root` around existing `#tool-root` mount. |
| `normalize-audio-volume.html` | Shell-aligned | Moved `at-root` to canonical inner wrapper `#audio-tool` around `#normalize-tool` mount. |
| `mp3-to-m4r.html` | Completed | Added canonical `#audio-tool.at-root > .tool-card` wrapper; preserved existing status/download IDs. |
| `trim-mp3-online.html` | N/A | Redirect page only. |

## Phase 1 Verification Snapshot
- Legacy class tokens removed from tool HTML (`tool-block`, `export-row`, `controls-row`, `btn`, `btn-primary`, `btn-secondary`, `ui-btn`): **clean across all tool pages**.
- `ui-system.js` script references in tool pages: **removed**.
- Required shell IDs (`tool-shell`, upload IDs, mount IDs) preserved.

## Deferred (Phase 2)
- CSS cleanup / dedupe / variable cleanup / layer re-architecture.
