# Design System Unification Plan

## Core Problem
UI inconsistency is caused by **two competing design systems** mixed across tools, NOT CSS duplicates.

## The Two Systems

### ✅ NEW: at-* System (STANDARD)
**Reference:** `index.html`, `audio-pitch-changer.html`, `merge-audio-files.html`, `audio-converter.html`

**Core Classes:**
- `.at-root` - Main container
- `.at-row` - Flexbox grouping (replaces all custom rows)
- `.at-btn` - Base button
- `.at-btn-primary` - Primary action (Download/Export)
- `.at-btn-soft` - Secondary action (Change file/Utilities)
- `.at-file-row` - File header with name + change button
- `.at-wave-wrap` - Waveform container with fade overlays
- `.at-status` - Status messages
- `.at-checkbox` - Custom checkbox
- `.at-times` - Time display (start/duration/end)
- `.at-pill` - Link pills for post-action suggestions

**Standard Structure:**
```html
<div id="audio-tool" class="at-root">
  <div class="tool-card">
    <div class="at-file-row is-hidden" data-role="fileRow">
      <!-- file info + change button -->
    </div>
    <div class="at-row at-wave-wrap">
      <canvas class="at-wave"></canvas>
      <div class="at-fade-overlay"></div>
    </div>
    <div class="at-times">
      <span data-role="startTime"></span>
      <span data-role="duration"></span>
      <span data-role="endTime"></span>
    </div>
    <div class="at-row">
      <!-- buttons + checkboxes -->
    </div>
    <div class="at-row at-status" data-role="status"></div>
    <div class="at-row">
      <!-- export buttons -->
    </div>
  </div>
</div>
```

**CSS Location:** `global.css` lines ~1632-1830 (definitive specs)

---

### ⚠️ OLD: Legacy System (TO BE REMOVED)
**Files Using It:**
1. `extract-audio-from-video.html` - Uses `.btn .btn-primary .result-panel .result-actions`
2. `audio-speed-changer.html` - Complex `.control-stack .editor-layout .waveform-shell .transport-bar`
3. `free-mp3-cutter.html` - Mixed layout

**Old Classes:**
- `.btn .btn-primary .btn-secondary` → Replace with `.at-btn .at-btn-primary .at-btn-soft`
- `.result-panel .result-actions` → Replace with `.at-row`
- `.control-stack .editor-layout` → Tool-specific layouts (migrate to standard)
- `.status-text` → Replace with `.at-status`
- `.transport-bar .waveform-shell` → Replace with `.at-wave-wrap`
- `.analysis-card .analysis-grid` → Keep as tool-specific if needed

**Legacy CSS Location:** `global.css` lines ~1184-1260

---

## Migration Priority

### HIGH Priority (Simple Migrations)
1. **extract-audio-from-video.html**
   - Current: `.btn.btn-primary`, `.result-panel`, `.result-actions`
   - Action: Wrap in `at-root`, convert buttons to `at-btn*`, use `.at-row` for groups

2. **normalize-audio-volume.html**
   - Current: JS-rendered UI via `normalize-tool.js`
   - Action: Check JS file, migrate to at-* system

### MEDIUM Priority (Complex Layouts)
3. **audio-speed-changer.html**
   - Current: Complex editor layout with analysis panel
   - Action: Preserve unique features (analysis card), but standardize controls/waveform/export

4. **free-mp3-cutter.html**
   - Status: Completed
   - Action taken: Rebuilt as an SEO-variant mirror of `audio-cutter-online.html` so the page now shares the same cutter UI structure and behavior

5. **mp3-to-m4r.html**
   - Status: Completed
   - Action taken: Rebuilt as a converter-family mirror of `convert-mp3-to-wav.html` and locked to MP3-in, M4R-out

### VERIFY Needed
1. audio-cutter-online.html
2. remove-silence-from-audio.html  
3. audio-video-transcription-online.html
4. trim-mp3-online.html
5. convert-mp3-to-wav.html

---

## Migration Rules

### DO:
✅ Use ONLY `.at-*` classes for new/updated tools
✅ Use `.is-hidden` for visibility (NOT inline styles or `hidden` attribute)
✅ Add `data-role` attributes to all interactive elements
✅ Follow `index.html` structure as canonical reference
✅ Use `.at-row` for ALL button/control groupings

### DON'T:
❌ Mix old `.btn` classes with new `.at-btn`
❌ Create custom row systems (`.controls-row`, `.export-row`)
❌ Use inline `style=""` for visibility/state
❌ Remove existing functionality during migration
❌ Change JavaScript logic - only update HTML structure

---

## Phase 2: CSS Cleanup (AFTER Migration)

Only after all tools use at-* system:
1. Remove legacy `.btn` CSS rules from global.css
2. Merge duplicate selectors
3. Clean undefined variables
4. Reorganize into layer architecture

---

## Success Criteria

- [ ] All tools use `.at-root` as main container
- [ ] Zero usage of `.btn`, `.btn-primary`, `.btn-secondary`
- [ ] All control groups use `.at-row`
- [ ] All waveforms use `.at-wave-wrap`
- [ ] All status messages use `.at-status`
- [ ] All buttons have `.at-btn` base class
- [ ] Visual consistency across all tools (same spacing, colors, interactions)

## Update Note

- `free-mp3-cutter.html` should no longer be treated as a separate cutter UI branch.
- Going forward, `audio-cutter-online.html` is the source-of-truth cutter page and `free-mp3-cutter.html` should remain a content/SEO mirror unless a deliberate product split is introduced.
