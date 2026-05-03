# FreeAudioTrim UI Refactor Single Source of Truth (SSOT)

Version: 1.0  
Scope: All tool pages and shared UI refactor work

## 1) Source Priority (highest to lowest)

1. `AGENTS.md` (and duplicate `CLAUDE.md`)  
2. `Tool.md`  
3. `SEO.md`  
4. `design-system-unification.md`  
5. `old_ui_patterns_found.md`  
6. `Refactor.md`

If two files conflict, the higher-priority rule wins.

## 2) Core Mission

Refactor tool pages to match `index.html` layout and class system while preserving tool behavior.

Allowed:
- Restructure HTML layout
- Reorder sections
- Apply approved classes
- Rewrite section copy and normalize headings

Not allowed:
- Modify JavaScript logic
- Modify tool processing logic
- Modify locked tool internal markup (see section 6)
- Add inline styles
- Add new CSS classes not already defined in `global.css`, `layout.css`, or `upload.css`

## 3) Global Structural Rules

- `<main>` must use class `container`.
- Every content block must be a `content-section`.
- No inline `style=""`.
- Visibility must use `.is-hidden` only.
- Do not use HTML `hidden` attribute or `style.display` for visibility toggles.
- Asset paths must be absolute: `/assets/...` (not relative paths).

## 4) Required Section Order (strict)

1. Header
2. Hero
3. Tool
4. Trustline (inside tool section)
5. How It Works
6. Supported Formats
7. Why Platform (FreeAudioTrim)
8. Why Tool
9. AI Technology
10. Key Benefits
11. Use Cases
12. Related Tools
13. Articles
14. Browser Benefits
15. FAQs
16. Footer

Rules:
- Do not skip sections.
- Do not reorder sections.
- Do not merge sections.
- Do not duplicate sections.

## 5) Section Class Contract

### Hero
- Class: `content-section section-intro hero`
- Structure: `h1` with `span.hero-highlight`, then `p`

### Tool Section
- Class: `content-section tool-section`
- Required structure:
  - `.tool-ui`
    - `upload-shell` (exact copy from `index.html`)
    - `#tool-shell.tool-shell.is-hidden`
      - `#audio-tool` (unchanged)
  - `.trust-line`

### How It Works
- Class: `content-section section-shell section-surface`
- Allowed helper classes: `steps-grid`, `step-card`, `step-number`

### Content Flow text sections
- Class: `content-section content-flow`

### Supported Formats + Trust Block
- Class: `content-section section-surface`
- Allowed helper classes: `supported-wrapper`, `supported-block`, `supported-items`, `supported-divider`, `trust-block`, `trust-item`

### Why Platform
- Class: `content-section section-surface`
- Allowed helper classes: `why-grid`, `why-item`

### AI Technology
- Class: `content-section ai-section`

### Key Benefits
- Class: `content-section section-surface`
- Allowed helper classes: `benefits-grid`, `benefit-item`

### Use Cases
- Class: `content-section use-cases`
- Allowed helper classes: `use-case-grid`, `use-case`, `use-icon`

### Related Tools
- Class: `content-section related-tools`
- Allowed helper classes: `tool-links-grid`, `tool-link`, `tool-pills`, `tool-pill`

### Articles
- Class: `content-section related-articles`
- Allowed helper classes: `article-grid`, `article-card`, `article-content`

### Browser Benefits
- Class: `content-section section-surface`

### FAQ
- Class: `content-section section-surface`
- Must use `<details>` and `<summary>`

### Footer
- Class: `site-footer`
- Must match `index.html` structure exactly

## 6) Locked Blocks and Tool Protection (critical)

Locked blocks:
- `upload-shell`
- `upload-box`
- `upload-content`
- `upload-illustration`
- `#tool-shell`
- `#audio-tool`

Hard rules:
- Do not edit inner HTML of locked blocks.
- Do not add/remove attributes in locked blocks.
- Do not rename IDs.
- You may only move the full block as a unit during section reordering.

Conflict resolution:
- Any instruction proposing replacement with `#tool-root` is superseded.
- Canonical tool container remains `#audio-tool` unless explicitly changed by a separate approved migration task.

## 7) Upload and Visibility Architecture

Uploader model (from `Tool.md`):
- `upload.js` handles file selection and dispatches `file:selected`.
- Page HTML controls shell visibility and calls `window.[ToolApi].addFile(file)`.
- Tool script remains a processing module and dispatches `converter:empty` when queue empties.
- Page listens to `converter:empty` and restores upload shell.

Required behavior:
- Upload shell visible by default.
- Tool shell hidden by default with `.is-hidden`.
- On `file:selected`: hide upload shell, show tool shell.
- On `converter:empty`: show upload shell, hide tool shell, reset input state.

Important placement rule:
- Shared file input used by `upload.js` must not be trapped in a hidden container if that breaks file selection flow.

## 8) Dynamic Heading Rules

Derive tool name from filename:
- Remove `.html`
- Replace hyphens with spaces
- Capitalize words

Action mapping examples:
- `audio-converter` -> `Audio Conversion`
- `audio-trimmer` -> `Audio Trimming`
- `audio-merger` -> `Audio Merging`

Apply to headings:
- `Why This Tool` -> `Why [Tool Name]`
- `How It Works` -> `How [Action] Works`
- `Use Cases` -> `[Tool Name] Use Cases`

Content rules:
- Keep headings short.
- Keep language human-readable.
- Avoid keyword stuffing.

## 9) Design System Migration Policy (resolved)

Target direction:
- Move legacy `.btn` style pages toward `at-*` system (`at-root`, `at-row`, `at-btn`, `at-status`, etc.).

Constraint:
- Do this only where it does not violate locked-block protection and no-tool-markup-change rules for the current task.

Operational rule:
- For layout-only refactors, preserve tool internals and normalize page shell/sections first.
- Internal `at-*` migrations are separate scoped tasks and must be explicitly approved when they require editing tool internals.

Known priority candidates (research-based):
- `extract-audio-from-video.html`
- `audio-speed-changer.html`
- `free-mp3-cutter.html`
- `normalize-audio-volume.html` (script-rendered UI)

## 10) SEO Content Rules

Each page should:
- Target one primary user intent.
- Solve the user problem quickly.
- Use direct, practical language.
- Avoid filler intros and buzzword copy.

Recommended section intent:
- What is [tool/problem]
- How to use [tool]
- Why use [tool]
- Use cases
- FAQs

Keyword placement:
- Primary keyword in H1
- Primary keyword in first ~100 words
- Primary keyword in 1-2 H2s naturally

Internal linking:
- Use `related.json` for related tools.
- Use contextual anchor text.

Priority order:
- Intent match > readability > structure > keyword density

## 11) Validation Checklist (must pass)

- Layout order is correct.
- Exactly one tool section exists.
- Upload block matches `index.html` exactly.
- Tool markup in locked blocks is unchanged.
- No inline styles.
- No `hidden` attribute for visibility control.
- Only approved classes are used.
- No duplicate sections.
- Headings are adapted to tool name and action.
- Trust elements appear only in allowed locations (tool section and supported/trust block).

## 12) Implementation Notes

- `AGENTS.md` and `CLAUDE.md` are currently duplicates; treat them as one policy.
- `Refactor.md` is partially outdated where it enforces `#tool-root`; use this SSOT instead.
- `design-system-unification.md` and `old_ui_patterns_found.md` remain migration references, not override specs.

