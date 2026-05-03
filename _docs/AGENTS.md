# UI Refactoring System Spec (v1)

## PURPOSE

Refactor any tool page to match the layout, structure, and class system of `index.html`.

This system is STRICT for structure and FLEXIBLE for content.

---

# 1. SCOPE RULE

AI MUST ONLY:

* Restructure HTML layout
* Reorder sections
* Apply correct classes

AI MUST NOT:

* Modify JavaScript
* Modify tool logic
* Modify tool internal markup
* Add inline styles
* Add new classes

---

# 2. GLOBAL RULES

* `<main>` MUST have class: `container`
* All sections MUST use `content-section`
* NO inline styles (`style=""`) allowed
* ONLY classes from global.css / layout.css may be used
* DO NOT invent new classes

---

# 3. LAYOUT ORDER (STRICT)

Sections MUST appear in this exact order:
(IMPORTANT)

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

DO NOT:

* Skip sections
* Reorder sections
* Merge sections
* Duplicate sections

---

# 4. SECTION CLASS CONTRACT

## HERO

Class:

```
content-section section-intro hero
```

Structure:

```
section.hero
  → h1
    → span.hero-highlight
  → p
```

---

## TOOL SECTION (LOCKED STRUCTURE)

Class:

```
content-section tool-section
```

Structure:

```
section.tool-section
  → .tool-ui
    → upload-shell (EXACT COPY FROM INDEX)
    → tool-shell (is-hidden)
      → #audio-tool (UNCHANGED)
  → .trust-line
```

Rules:

* Upload MUST be above tool-shell
* Upload MUST match index EXACTLY
* DO NOT modify upload structure
* DO NOT modify tool markup
* DO NOT rename IDs
* DO NOT modify is-hidden Logic
* for Tool Give wieght to Tool.md

---

## HOW IT WORKS

Class:

```
content-section section-shell section-surface
```

Allowed elements:

```
steps-grid
step-card
step-number
```

---

## CONTENT FLOW (GENERIC TEXT SECTIONS)

Class:

```
content-section content-flow
```

Used for:

* explanations
* paragraphs

---

## SUPPORTED FORMATS + TRUST BLOCK

Class:

```
content-section section-surface
```

Allowed:

```
supported-wrapper
supported-block
supported-items
supported-divider
trust-block
trust-item
```

---

## WHY PLATFORM

Class:

```
content-section section-surface
```

Allowed:

```
why-grid
why-item
```

---

## AI TECHNOLOGY

Class:

```
content-section ai-section
```

---

## KEY BENEFITS

Class:

```
content-section section-surface
```

Allowed:

```
benefits-grid
benefit-item
```

---

## USE CASES

Class:

```
content-section use-cases
```

Allowed:

```
use-case-grid
use-case
use-icon
```

---

## RELATED TOOLS

Class:

```
content-section related-tools
```

Allowed:

```
tool-links-grid
tool-link
tool-pills
tool-pill
```

---

## ARTICLES

Class:

```
content-section related-articles
```

Allowed:

```
article-grid
article-card
article-content
```

---

## BROWSER BENEFITS

Class:

```
content-section section-surface
```

---

## FAQ

Class:

```
content-section section-surface
```

Rules:

* MUST use `<details>` and `<summary>`

---

## FOOTER

Class:

```
site-footer
```

Rules:

* Must match index.html exactly
* No structural changes

---

# 5. TOOL PROTECTION RULES (CRITICAL)

The following are LOCKED:

* upload-shell
* upload-box
* upload-content
* upload-illustration
* #tool-shell
* #audio-tool

AI MUST NOT:

* Modify inner HTML
* Add elements inside tool
* Remove attributes
* Rename IDs

AI MAY ONLY:

* Move the entire block as a unit

---

# 6. VISIBILITY RULE

ONLY use:

```
.is-hidden
```

DO NOT use:

* hidden attribute
* style.display
* inline styles

---

# 7. DYNAMIC CONTENT RULE (UNIVERSAL SYSTEM)

AI MUST derive tool name from filename.

Example:

```
audio-converter.html → Audio Converter
audio-trimmer.html → Audio Trimmer
```

Transformation:

* remove .html
* replace hyphens with spaces
* capitalize words

---

## ACTION MAPPING

```
audio-converter → Audio Conversion
audio-trimmer → Audio Trimming
audio-merger → Audio Merging
```

---

## APPLY TO HEADINGS

AI MUST adapt:

```
"Why This Tool" → "Why [Tool Name]"
"How It Works" → "How [Action] Works"
"Use Cases" → "[Tool Name] Use Cases"
```

---

## CONTENT RULES

AI MAY:

* rewrite text
* optimize headings

AI MUST:

* keep headings short
* avoid keyword stuffing

---

# 8. NO DUPLICATION RULE

AI MUST:

* replace incorrect sections

AI MUST NOT:

* keep old + new versions
* duplicate sections

---

# 9. VALIDATION CHECKLIST

✔ Layout order is correct
✔ Only one tool section exists
✔ Upload block matches index exactly
✔ Tool markup unchanged
✔ No inline styles used
✔ No hidden attribute used
✔ Only approved classes used
✔ No duplicate sections
✔ Headings adapted to tool name

---

# END OF SPEC
