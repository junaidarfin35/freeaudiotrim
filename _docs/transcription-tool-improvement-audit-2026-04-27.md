# Transcription Tool Improvement Audit

Date: 2026-04-27
Scope: `audio-video-transcription-online.html` and related transcription tool files

## Files Reviewed

- `audio-video-transcription-online.html`
- `assets/transcribe-tool.js`
- `assets/transcribe-worker.js`
- `assets/upload.js`
- `css/global.css`
- `assets/layout.css`
- `assets/upload.css`

Also loaded on the page but not obviously needed for transcription:

- `assets/encoders/lame.min.js`
- `assets/encoders/mp3-encoder.js`

## Current State

The transcription tool is now much closer to the desired product flow:

- Upload file
- Choose language and transcription mode
- Transcribe
- Review transcript
- Edit per segment
- Export TXT/SRT/VTT
- Optionally translate transcript
- Switch between original and translated output

The strongest part of the current implementation is the segment data model. Edited segment text already flows into export and translation, which is the right behavior for both transcription and subtitle use cases.

## Confirmed Behaviors

### Edited Segment Text Affects Exports

Status: `Confirmed`

Exports use segment-backed text, so user edits are reflected in TXT/SRT/VTT downloads.

### Edited Segment Text Feeds Translation

Status: `Confirmed`

Translation input uses `editedText` first, then falls back to original text.

### Timestamps Are Display-Only

Status: `Confirmed`

Users can toggle timestamp visibility, but they cannot edit timestamp values directly.

### Original and Translated Views Can Coexist

Status: `Confirmed`

The tool supports switching between original and translated transcript states.

## Highest Impact Improvements

### 1. Clean Up Dead or Duplicate Model Loading Code

Status: `Completed in Phase 1`

`assets/transcribe-tool.js` contains UI-side `getPipeline()` / `loadModel()` code. The real transcription model loading happens in `assets/transcribe-worker.js`.

Risk:

- The UI-side code references undeclared variables such as `pipeline` and `transcriberPromise`.
- If this path is ever called, it can break.

Recommendation:

- Remove or quarantine the UI-side model-loading path.
- Keep model loading inside the worker.

### 2. Replace Fixed Top Loading Banner

Status: `Completed in Phase 1`

Worker loading messages currently create a fixed top banner called `#loading-status` using inline `style.cssText`.

Risk:

- Bypasses the tool UI system.
- Bypasses shared theme styling.
- Can feel disconnected on mobile.

Recommendation:

- Route model-loading messages into the existing status/progress UI.
- Remove the fixed top banner.

### 3. Remove Production Debug Logs

Status: `Completed in Phase 1`

There are many routine `console.log()` calls in both:

- `assets/transcribe-tool.js`
- `assets/transcribe-worker.js`

Risk:

- Noisy console output.
- Harder to diagnose real issues.
- Slight performance and privacy polish concern.

Recommendation:

- Keep `console.error()` for real failures.
- Remove routine debug logs before production.

### 4. Improve File Size and Duration Policy

Status: `Recommended`

Current constants:

- `MAX_DURATION_SECONDS = 120`
- `LARGE_FILE_BYTES = 50 * 1024 * 1024`

Observation:

- Duration limit is active.
- File-size constant appears unused.

Recommendation:

- Either use the file-size guard or remove the unused constant.
- Show clear user-facing limits before decoding very large files.

### 5. Make Progress More Predictable

Status: `Partially completed in Phase 1`

Current progress is mixed:

- fake progress in `transcribe-tool.js`
- worker chunk progress in `transcribe-worker.js`

Recommendation:

- Use one consistent progress model:
  - preparing audio
  - loading model
  - transcribing chunks
  - finalizing transcript
  - done

Phase 1 note:

- The tool now uses explicit stage messaging for:
  - `Preparing audio`
  - `Downloading model`
  - `Transcribing in browser`
- Fake rotating transcription progress messaging was removed.
- Chunking and segment logic were intentionally left untouched.

## Phase 1 Implemented

Status: `Completed`

This pass implemented only the premium-feel improvements around the existing free browser engine:

- removed fake `Fast / Accurate` behavior from the transcription setup
- replaced it with one honest browser-mode presentation
- added device-aware messaging:
  - `Faster on this device`
  - `Running in compatibility mode`
- routed model-loading status through the normal in-tool status/progress area
- removed dead UI-side transcription model-loading code
- tightened file-change / restart / retry reset handling

Intentionally not changed in this pass:

- chunk size
- segment generation
- transcription model choice

## Additional Implemented Progress

### Transcription Quality Baseline

Status: `Completed`

What is now live:

- explicit browser backend selection for Whisper
- quality-safer browser quantization split:
  - `encoder_model: fp16`
  - `decoder_model_merged: q4f16`
  - `wasm` fallback with `q8`
- explicit spoken-language-first transcription flow for better accuracy
- safe baseline Whisper guardrails:
  - `sampling_rate: 16000`
  - `compression_ratio_threshold`
  - `logprob_threshold`
  - `no_speech_threshold`

Why this matters:

- improved speed and quality compared with the earlier global `q4` path
- reduced practical bias toward silent English fallback behavior
- aligned the browser implementation more closely with official Whisper / Transformers.js guidance

### Multi-Tab Stability Layer

Status: `Completed`

What is now live:

- cross-tab model ownership protection
- prevention of duplicate heavy model warmup across tabs
- worker unload/dispose support
- more aggressive idle/reset unload behavior

Why this matters:

- lowers the risk of browser lag or crash when multiple transcription tabs are opened
- reduces duplicate GPU / memory pressure from browser-side Whisper sessions

### Full Whisper Language Coverage and Searchable Picker

Status: `Completed`

What is now live:

- full official Whisper transcription language list in the setup UI
- common languages pinned higher in the list
- lightweight search/filter behavior for language selection
- image-based representative flags instead of unreliable emoji-in-select rendering
- mobile-friendly custom picker UI while preserving the hidden native select as the actual logic source

Why this matters:

- better multilingual discoverability
- faster language selection on mobile and desktop
- more trustworthy visual presentation in Chrome where emoji flags in native selects were degrading into country letters

### Translation Foundation (NLLB/FLORES Mapping)

Status: `Completed`

What is now live:

- dedicated translation language registry for the currently exposed translation languages
- explicit source and target mapping through FLORES codes before NLLB translation
- explicit transcript-language selection in translation setup
- removal of silent default-English source fallback
- UI-side and worker-side validation for missing source/target mapping

Why this matters:

- translation quality is more stable because source and target language routing is explicit
- prevents quiet mis-translation caused by weak source-language assumptions
- aligns the translation step with the documented transcript-as-source workflow

### Translation UX and State Reliability

Status: `Completed`

What is now live:

- expanded exposed translation language coverage for common languages
- clearer translation setup state through smarter source/target selection behavior
- live translation hint copy based on current source and target choices
- prevention of same-language source/target selection
- automatic clearing of stale translated output when the user edits the original transcript after a translation already exists

Why this matters:

- users get a clearer translation flow with fewer ambiguous states
- translated output stays truthful to the latest edited transcript
- broader common-language support is available without changing the translation model

### Cross-Browser Upload Compatibility

Status: `Completed`

What is now live:

- expanded transcription file input `accept` list with explicit audio/video extensions plus wildcard MIME groups
- no `capture` lock on file input, preserving iPhone/iOS Files picker support
- extension-based supported-file fallback in the transcription tool for browsers that provide weak or empty MIME types
- shared upload helper updated for audio + video default format hints

Why this matters:

- better upload reliability across Safari, Chrome, and Edge on desktop/mobile
- improved iPhone and Android picker behavior
- fewer false unsupported-file errors from MIME inconsistencies

## Functionality Improvements

### Copy Subtitle Output

Status: `Optional`

Add actions for:

- Copy SRT
- Copy VTT

Useful for users pasting subtitles into editors without downloading first.

### Download All

Status: `Optional`

After translation, offer a combined export option:

- original TXT
- original SRT
- original VTT
- translated TXT
- translated SRT
- translated VTT

### Cancel Processing

Status: `Recommended later`

Current behavior locks processing while the worker is busy. A proper cancel flow would improve UX for long files.

Recommendation:

- Add a cancel button during processing.
- Use worker termination/recreation or an abort-aware worker flow.

### Model Cache Messaging

Status: `Optional`

First run may take longer because the model downloads. Later runs can be faster from cache.

Recommendation:

- Add clear status copy for:
  - first-time model loading
  - cached model ready
- Suggested first-run copy to add later:
  - `Running this for the first time? Downloading the model may take up to several seconds or a few minutes depending on your internet speed. Please hang in there, we are cooking for you.`

## Quality Improvements

### Adaptive Chunking

Status: `Advanced improvement`

Current worker chunking uses:

- 25 second chunks
- 2 second stride
- single pass for files under about 30 seconds

Recommendation:

- Keep current behavior for now.
- Later, consider adaptive chunking based on duration/noise/enhance mode.

Important:

- Avoid changing chunking or segment generation casually because subtitle timing depends on it.

### Review Segment Rebuilding

Status: `Needs careful review`

`transcribe-tool.js` rebuilds subtitle segments using `buildSubtitles(...)`.

Potential concern:

- This can improve readability, but it can also drift from raw Whisper segment output.

Recommendation:

- Review before changing.
- Preserve timestamp integrity if adjusted.

## UX Improvements

### Result Header

Status: `Optional`

After transcription completes, show a compact result header such as:

- `Transcript ready`
- file name
- duration

### Translation Panel Behavior

Status: `Already aligned`

Current desired UX:

- translation setup stays collapsed
- user opens it only when they want to translate
- no automatic scroll into translation setup

### Export Labels

Status: `Optional`

Current buttons use file extensions.

Possible improvement:

- Keep concise labels, but clarify export groups:
  - `TXT`
  - `SRT subtitles`
  - `VTT captions`

### Edit Mode Feedback

Status: `Optional`

When editing is active, make the state more obvious:

- `Edit transcript`
- `Done editing`

This helps users understand that edits are live and will affect exports.

## SEO Positioning

Recommended wording:

- Use `transcription` and `transcript` as primary UI language.
- Use `subtitles`, `SRT`, and `VTT` as export/action language.

Reason:

- `Transcription` captures broad audio/video-to-text intent.
- `Subtitles` captures SRT/VTT export intent.

Recommended UI labels:

- Main CTA: `Transcribe`
- Result state: `Transcript ready`
- Translation action: `Translate transcript`
- Export actions: `Download TXT`, `Download SRT`, `Download VTT`

## Recommended Next Implementation Pass

Status: `Suggested next step`

1. Remove or quarantine dead UI-side model-loading code.
2. Replace the fixed top loading banner with normal status/progress messages.
3. Remove routine debug logs.
4. Tighten file-size and duration validation messaging.
5. Run smoke tests:
   - upload
   - ready state
   - processing state
   - transcript result
   - edit segment text
   - export TXT/SRT/VTT
   - open translation panel
   - mobile overflow

## Product Question To Settle

Should the public file limit stay at `120 seconds`, or should the UI be designed around a broader message such as short browser-based transcription for now, with longer files planned later?

## Linked Execution Roadmap

Status: `Tracked in project status`

The implementation checklist for the free-only transcription direction is now tracked in:

- `_docs/project-status-2026-04-27.md`

Roadmap buckets:

- `Now`
- `Later`
- `Experimental`

Direction locked for now:

- keep browser-based transcription free
- keep `whisper-large-v3-turbo` as the current main global model
- improve UX, reliability, and honest mode behavior before attempting model replacement

## Translation Phase Note

Status: `Foundation completed`

Confirmed architecture to keep:

- `Whisper` is used for transcription
- `Xenova/nllb-200-distilled-600M` is used for translation
- the disabled Whisper-translation branch remains non-active

Product source-of-truth rule:

- uploaded media is the source of truth for transcription
- transcript text, including user-edited segment text, is the source of truth for translation

Tracked next-step execution:

- translation-phase TODO remains documented in `_docs/project-status-2026-04-27.md`
- translation foundation implementation is now completed for the exposed language set
- broader language expansion remains a later step

## Adjacent Tool Compatibility Note

Status: `Completed separately`

Related site work completed after this audit:

- `convert-mp3-to-wav.html` now enforces MP3-only upload input.
- The converter upload path was hardened for Chrome, Safari, Edge, Android, and iPhone/iPad file pickers.
- The page keeps iOS Files-folder access by avoiding `capture` and using explicit MP3 extensions plus MIME fallback handling.

Tracking source:

- `_docs/project-status-2026-04-27.md`

## Adjacent Normalizer Note

Status: `Completed separately`

Related site work completed after this audit:

- `normalize-audio-volume.html` was simplified into a single-stack one-file tool.
- Old queue/batch/ZIP workflow was removed from the active UX.
- Waveform/player were removed after review because they added density without meaningfully helping the normalization task.
- Mode selection now uses a top picker, with advanced settings limited to:
  - target LUFS
  - true peak limit
  - output format
- A short standards-oriented tip was added inside the advanced panel.
- The file input accept contract was hardened for desktop/mobile browser pickers while keeping iPhone Files-folder access.

Tracking source:

- `_docs/project-status-2026-04-27.md`

## Transcription Quality Note

Status: `Planned only - not started`

Whisper research takeaway:

- the most promising transcription improvements are likely to come from better decode settings and better guardrails, not from replacing the model immediately

Planned transcription-quality TODO is now tracked in:

- `_docs/project-status-2026-04-27.md`

Planned categories:

- `Must Do Now`
- `Should Test`
- `Do Not Touch Yet`

## Shared Mobile File-Row Bug Note

Status: `Completed separately`

This audit thread later uncovered a broader shared-tool bug that affected multiple non-transcription pages too:

- mobile file rows could show the container and `Change` button while the filename appeared missing

What happened:

- the first assumption was that the problem was purely CSS
- the file-row mobile layout did need stronger wrapping rules
- but deeper inspection showed a second issue:
  - some tools were not reliably writing the filename into the shared file-row UI at the moment the upload shell handed off to the tool shell

Final fix applied outside the transcription-specific code:

- `css/global.css`
  - stacked file rows safely on mobile
  - made filename text wrap instead of collapsing into over-clipped single-line behavior
  - removed parent clipping from the mobile file-info container
- `assets/upload.js`
  - now syncs `[data-role="fileName"]` and `[data-role="fileRow"]` immediately when a file is selected

Why this note matters here:

- the transcription tool and other modern tools share the same file-row design language
- this bug was a good reminder that some UI issues that look page-specific are actually shared upload-system issues

Tracking source:

- `_docs/project-status-2026-04-27.md`

## Shared Branding Note

Status: `Completed separately`

Shared CSS that this tool depends on was also refreshed to a new brand palette:

- `css/global.css`
- `assets/layout.css`

What changed:

- shared root tokens were remapped to the new blue / amber / slate palette
- transcription-adjacent UI inherited the update through shared CSS only:
  - buttons
  - cards
  - status areas
  - advanced panels
  - language and translation pickers

Why this matters here:

- the transcription tool is one of the heaviest users of shared UI tokens
- this branding pass did not change transcription logic, but it did change the visual identity of the shared tool shell around it

Tracking source:

- `_docs/project-status-2026-04-27.md`

## Pending: Device Capability Gating
- TODO: Add browser capability check (WebGPU + approximate RAM/cores) and use it to warn/disable heavy ASR modes; cannot read VRAM directly, so use safe heuristics.

