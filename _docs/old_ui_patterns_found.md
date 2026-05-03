# Old UI System Patterns - Research Findings

## Files Using OLD System:
1. **extract-audio-from-video.html** - ✅ CONFIRMED OLD
2. **audio-speed-changer.html** - ✅ CONFIRMED OLD  
3. **free-mp3-cutter.html** - MIXED (old structure, different layout)

## Files Using NEW System (at-* classes):
- audio-converter.html
- index.html
- audio-cutter-online.html
- merge-audio-files.html
- audio-pitch-changer.html
- convert-mp3-to-wav.html

## Old Class Patterns Found:

### Button System:
- `.btn` (base class)
- `.btn-primary` (primary action)
- `.btn-secondary` (secondary action)
- `.btn.secondary` (alt syntax)

### Panel/Control System:
- `.result-panel` (container for results)
- `.result-actions` (button group container)
- `.result-helper-text` (status message with variants)
  - `.result-helper-text--processing`
  - `.result-helper-text--success`
- `.status-text` (status display)

### Layout Classes:
- `.control-stack` (vertical control layout)
- `.editor-layout` (main editor wrapper)
- `.editor-main` (main editor content)
- `.transport-bar` (playback controls row)
- `.waveform-shell` (waveform container)
- `.range-row` (range slider + value display)
- `.analysis-card` (side analysis panel)
- `.analysis-grid` (analysis items layout)
- `.analysis-item`, `.analysis-item--key`, `.analysis-item--bpm`, `.analysis-item--confidence`

## OLD CSS Rules Found in global.css:
- `.tool-shell .btn { }` - base button styling
- `.tool-shell .btn[data-role="export"]` - export button variant
- `.tool-shell .btn[data-role="process"]` - process button variant
- `.tool-shell .btn.secondary { }` - secondary button variant
- `.tool-shell .btn[data-role="control"]` - control button variant
- `.tool-shell .btn[data-role="clear"]` - danger/clear button variant

## NEW UI System (at-*):
- `at-btn` (base button)
- `at-btn-primary` (primary variant)
- `at-btn-soft` (soft variant)
- `at-btn[data-ui-role=""]` (role-based variants)
  - `primary`, `secondary`, `control`, `danger`
- `at-root` (ui system root)
- `at-row` (row layout)
- `at-label` (label styling)
- `at-status` (status styling)
- `at-file-row`, `at-file-info`, `at-file-name` (file display)

## Migration Path:
OLD → NEW class mappings:
- `.btn.btn-primary` → `.at-btn.at-btn-primary`
- `.btn.btn-secondary` → `.at-btn` (or `at-btn-soft`)
- `.btn[data-role="control"]` → `.at-btn[data-ui-role="control"]`
- `.result-panel`, `.result-actions` → modernize to `at-*` system

## CSS Not Found in global.css:
These are likely inline styles or in tool-specific CSS:
- result-panel, result-actions, result-helper-text
- control-stack, editor-layout, editor-main
- transport-bar, waveform-shell, range-row
- analysis-card, analysis-grid, analysis-item variants
