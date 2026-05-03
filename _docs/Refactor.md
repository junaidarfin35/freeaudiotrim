# TASK

Refactor the given HTML page to match the index.html design system.

---

# OBJECTIVE

Transform the page layout, structure, and classes to match index.html system.

DO NOT redesign.
DO NOT invent new UI.
ONLY normalize to system.

---

# SCOPE

YOU MAY:

* Restructure HTML
* Reorder sections
* Apply correct classes
* Normalize headings

YOU MUST NOT:

* Modify JavaScript
* Modify tool logic
* Modify tool internal markup
* Add inline styles
* Add new classes

---

# HARD CONSTRAINTS (NON-NEGOTIABLE)

## 1. Upload Block

* Must match index.html EXACTLY
* No structural or attribute changes
* Asset path MUST be `/assets/icons/upload-illustration.png`

## 2. Tool System

* Use ONLY:

<div id="tool-shell" class="tool-shell is-hidden">
  <div id="tool-root"></div>
</div>

* No custom tool HTML allowed
* Tool is a black box

## 3. CSS Rules

* NO inline styles
* NO `<style>` blocks
* ONLY use classes from:

  * global.css
  * layout.css
  * upload.css

## 4. Asset Paths

* MUST use `/assets/...`
* NEVER use relative paths

---

# LAYOUT ORDER (STRICT)

You MUST enforce this exact order:

1. Hero
2. Tool Section
3. How It Works
4. Supported Formats + Trust
5. Why Tool
6. Content Flow (What is…)
7. Browser Technology
8. Key Benefits
9. Use Cases
10. Related Tools
11. Related Articles
12. FAQ

DO NOT:

* skip sections
* reorder sections
* duplicate sections

---

# CLASS SYSTEM (STRICT)

Use ONLY these patterns:

## Hero

content-section section-intro hero

## Tool

content-section tool-section

## Structured sections

content-section section-shell section-surface

## Text sections

content-section content-flow

## AI section

content-section ai-section

## Use cases

content-section use-cases

## Related tools

content-section related-tools

## Articles

content-section related-articles

---

# TOOL CONTEXT (DYNAMIC)

Extract tool name from filename.

Example:
audio-converter.html → Audio Converter

Apply:

* "Why This Tool" → "Why [Tool Name]"
* "How It Works" → "How [Action] Works"
* "Use Cases" → "[Tool Name] Use Cases"

---

# HEADING RULES

* Keep headings short
* No keyword stuffing
* Must be human-readable

---

# TRUST SYSTEM

Allowed ONLY:

* below tool section
* inside supported section

Remove duplicates elsewhere.

---

# VALIDATION CHECKLIST

Before output, ensure:

* Correct section order
* Only one tool section
* Upload block unchanged
* No inline styles
* No new classes
* Tool structure untouched
* Asset paths correct
* No duplicate sections

---

# OUTPUT FORMAT

Return ONLY the final HTML.

No explanation.
No comments.
No markdown.
