(function () {
  "use strict";

  var TRIM_TOOL_PATH = "/assets/trim-tool.js?v=2026-06-27-playhead-snap-2";
  var BOUND_FLAG = "trimToolLazyBound";
  var loadPromise = null;

  function isTrimToolReady() {
    return !!window.__fatTrimToolReady;
  }

  function markTrimToolReady() {
    window.__fatTrimToolReady = true;
  }

  function loadTrimTool() {
    if (isTrimToolReady()) {
      return Promise.resolve();
    }

    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-trim-tool-runtime="true"]');
      if (existing) {
        existing.addEventListener("load", function () {
          markTrimToolReady();
          resolve();
        }, { once: true });
        existing.addEventListener("error", function () {
          loadPromise = null;
          reject(new Error("Failed to load trim tool runtime."));
        }, { once: true });
        return;
      }

      var script = document.createElement("script");
      script.src = TRIM_TOOL_PATH;
      script.async = true;
      script.dataset.trimToolRuntime = "true";
      script.onload = function () {
        markTrimToolReady();
        resolve();
      };
      script.onerror = function () {
        loadPromise = null;
        reject(new Error("Failed to load trim tool runtime."));
      };
      document.head.appendChild(script);
    });

    return loadPromise;
  }

  function findInput(dropzone) {
    var inputId = dropzone.getAttribute("data-upload-input");
    if (inputId) {
      return document.getElementById(inputId);
    }
    return dropzone.parentElement && dropzone.parentElement.querySelector("input[type='file']");
  }

  function replayDroppedFiles(input, files) {
    if (!input || !files || !files.length || typeof DataTransfer === "undefined") {
      return;
    }

    var dataTransfer = new DataTransfer();
    files.forEach(function (file) {
      dataTransfer.items.add(file);
    });
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindDropzone(dropzone) {
    if (!(dropzone instanceof HTMLElement) || dropzone.dataset[BOUND_FLAG] === "true") {
      return;
    }

    var input = findInput(dropzone);
    if (!input) {
      return;
    }

    dropzone.dataset[BOUND_FLAG] = "true";

    var warm = function () {
      void loadTrimTool().catch(function () {});
    };

    dropzone.addEventListener("pointerenter", warm, { passive: true });
    dropzone.addEventListener("focusin", warm, { passive: true });
    dropzone.addEventListener("dragenter", warm, { passive: true });

    dropzone.addEventListener("click", function (event) {
      if (isTrimToolReady()) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void loadTrimTool().then(function () {
        input.click();
      }).catch(function () {});
    }, true);

    dropzone.addEventListener("keydown", function (event) {
      if (isTrimToolReady()) {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void loadTrimTool().then(function () {
        input.click();
      }).catch(function () {});
    }, true);

    dropzone.addEventListener("drop", function (event) {
      if (isTrimToolReady()) {
        return;
      }

      var files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if (!files.length) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void loadTrimTool().then(function () {
        replayDroppedFiles(input, files);
      }).catch(function () {});
    }, true);
  }

  function bindAllDropzones() {
    var dropzones = document.querySelectorAll("[data-upload-dropzone]");
    dropzones.forEach(bindDropzone);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAllDropzones, { once: true });
  } else {
    bindAllDropzones();
  }
})();
