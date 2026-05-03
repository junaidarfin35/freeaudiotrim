# Reusable Upload Fix Guide

## Goal

Our goal was to rebuild the `[tool-page].html` upload flow so it matches the shared uploader architecture used across the project:

- `upload.js` handles file selection
- the HTML page handles UI transitions
- `[tool-script].js` stays a pure processing module
- the upload box appears first
- the tool UI appears only after a file is selected
- when the queue becomes empty, the upload box returns

We also wanted to remove fragile visibility logic based on `hidden` attributes and inline `display` styles, and move to class-based visibility using `.is-hidden`.

## Final Architecture

The final structure is:

`upload.js`
-> dispatches `file:selected`

`[tool-page].html`
-> listens for `file:selected`
-> hides `#upload-shell`
-> shows `#tool-shell`
-> calls `window.[ToolApi].addFile(file)`

`[tool-script].js`
-> only processes queue + conversion logic
-> exposes `window.[ToolApi].addFile(file)`
-> dispatches `converter:empty` when queue becomes empty

`[tool-page].html`
-> listens for `converter:empty`
-> shows `#upload-shell`
-> hides `#tool-shell`

## Step-by-Step Fix Order

### 1. Replaced the old upload area with the shared upload block

We started by replacing the old upload section in `[tool-page].html` with the same upload structure used in `index.html`.

This gave us:

- `upload-shell`
- `upload-box`
- `upload-content`
- `data-upload-dropzone`
- `data-upload-input="audioFileInput"`
- the upload illustration

We also wrapped upload and tool UI inside one section:

`<section class="content-section section-surface tool-ui">`

And we placed a hidden `#tool-shell` below the upload area.

### 2. Realigned the tool module

At first, the tool script still knew too much about the uploader.
That was the wrong direction.

We corrected `[tool-script].js` so it became a pure processing module again.

We removed:

- upload listeners
- dropzone listeners
- file input listeners
- drag/drop logic
- upload toggling logic
- scroll logic
- any dependency on uploader IDs such as:
  - `audioFileInput`
  - `uploadDropzone`
  - `fileInput`

After that, `[tool-script].js` only kept queue and processing behavior and exposed:

```js
window.[ToolApi] = {
  addFile(file) {
    addFiles([file]);
  }
};
```

### 3. Moved UI transition logic into the page

The page itself became responsible for reacting to the upload lifecycle.

Inside `[tool-page].html`, we added a listener for:

`file:selected`

That page-level listener now:

1. reads the selected file
2. hides `#upload-shell`
3. shows `#tool-shell`
4. calls `window.[ToolApi].addFile(file)`
5. scrolls smoothly to the tool area with a `100px` offset

This matched the correct separation of concerns:

- uploader chooses files
- page manages UI
- tool script processes files

### 4. Moved the empty-state behavior to an event

Originally, the idea of showing the upload box again when the queue became empty was good UX, but the implementation was in the wrong place.

We fixed that by moving the UI reset into an explicit event-based flow.

Inside `[tool-script].js`, the tool now dispatches:

`converter:empty`

This happens after:

- `clearQueue()`
- removing the last remaining file from the queue

Then inside `[tool-page].html`, the page listens for:

`converter:empty`

And reverses the UI:

- shows `#upload-shell`
- hides `#tool-shell`

This kept UI logic out of the converter module.

### 5. Switched from `hidden` / inline display to class-based visibility

Next, we refactored visibility control so the page no longer depended on:

- `hidden` attributes
- `element.hidden`
- `style.display`

Instead, we standardized everything on:

`.is-hidden`

We added a class rule:

```css
.is-hidden { display: none !important; }
```

Then we updated the page logic so:

- `file:selected` adds `.is-hidden` to `#upload-shell`
- `file:selected` removes `.is-hidden` from `#tool-shell`
- `converter:empty` removes `.is-hidden` from `#upload-shell`
- `converter:empty` adds `.is-hidden` to `#tool-shell`

This made visibility control consistent and easier to reason about.

### 6. Found the real reason the upload box broke

After switching to class-based visibility, the upload box still behaved incorrectly.

The actual root cause was not only visibility logic.

The file input:

`<input id="audioFileInput" ...>`

was still placed inside `#tool-shell`.

But `#tool-shell` starts hidden.

That meant the uploader system was trying to work with an input that lived inside a hidden container, which broke the shared upload flow.

### 7. Moved the file input outside the hidden tool shell

This was the final structural fix.

We moved the file input out of `#tool-shell` and placed it before both shells inside the shared tool section.

Final structure:

```html
<input id="audioFileInput" class="is-hidden" type="file" ...>

<div id="upload-shell">...</div>

<div id="tool-shell" class="tool-shell is-hidden">...</div>
```

This solved the uploader problem because:

- `upload.js` could access the input immediately
- the dropzone still referenced it with `data-upload-input="audioFileInput"`
- the tool UI could remain hidden without blocking file selection

### 8. Reset the uploader correctly when the queue becomes empty

When the queue was emptied, we also needed the uploader UI to return to its clean state.

The page already handled showing the upload shell again, but `upload.js` also keeps internal UI state based on the file input value.

So during `converter:empty`, we also:

1. clear `audioFileInput.value`
2. dispatch a `change` event on that input

That allows `upload.js` to reset its own visual state correctly.

## Final Result

By the end, the upload flow worked correctly:

- the upload box is visible first
- the tool shell is hidden first
- selecting a file through `upload.js` triggers `file:selected`
- the page hides the upload box and reveals the tool
- the tool module only processes files
- emptying the queue triggers `converter:empty`
- the page restores the upload box
- the uploader resets cleanly for the next file

## Key Lessons

1. Keep uploader logic out of tool-processing modules.
2. Let the page coordinate UI transitions.
3. Use events for state handoff between systems.
4. Keep shared inputs outside hidden tool containers when the uploader depends on them.
5. Prefer one consistent visibility system instead of mixing classes, `hidden`, and inline styles.

## Placeholder Reference

Use these placeholders when adapting this guide to another tool:

- `[tool-page].html` = the HTML page for that tool
- `[tool-script].js` = the JavaScript file for that tool
- `window.[ToolApi]` = the global API exposed by that tool

Example:

- `audio-speed-changer.html`
- `assets/speed-tool.js`
- `window.AudioSpeedTool`
