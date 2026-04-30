(function () {
  "use strict";

  function classifyButton(btn) {
    const text = (btn.textContent || "").toLowerCase();
    const role = (btn.dataset.role || "").toLowerCase();

    if (
      role === "exportmp3" ||
      role === "exportwav" ||
      role === "export" ||
      role === "process" ||
      role === "convert" ||
      role === "merge" ||
      role === "normalize" ||
      text.includes("download") ||
      text.includes("export") ||
      text.includes("convert") ||
      text.includes("process") ||
      text.includes("merge") ||
      text.includes("normalize")
    ) {
      btn.dataset.uiRole = "primary";
    }

    else if (
      role === "clear" ||
      role === "remove" ||
      role === "delete" ||
      text.includes("clear") ||
      text.includes("remove") ||
      text.includes("delete")
    ) {
      btn.dataset.uiRole = "danger";
    }

    else if (
      role === "playpause" ||
      role === "preview" ||
      role === "reset" ||
      role === "stop" ||
      role === "pause" ||
      role === "advancedtoggle" ||
      role === "control" ||
      text.includes("play") ||
      text.includes("preview") ||
      text.includes("pause") ||
      text.includes("reset") ||
      text.includes("stop")
    ) {
      btn.dataset.uiRole = "control";
    }

    else {
      btn.dataset.uiRole = "secondary";
    }
  }

function enhanceButtons(root = document) {
const buttons = root.querySelectorAll("#audio-tool .at-btn, #audio-tool button");
    buttons.forEach(btn => {
      classifyButton(btn);
      btn.classList.add("ui-btn");
    });
  }

  function enhanceStatus() {
    const statuses = document.querySelectorAll("[data-status]");

    statuses.forEach(el => {
      const state = el.dataset.statusState;

      el.classList.add("ui-status");

      if (state === "success") el.classList.add("success");
      else if (state === "error") el.classList.add("error");
      else if (state === "processing") el.classList.add("processing");
    });
  }

  function init() {
    enhanceButtons();
    groupButtons();
    enhanceStatus();
  }

  document.addEventListener("DOMContentLoaded", init);

})();

function groupButtons() {
  const container = document.querySelector("#audio-tool .tool-shell");
  if (!container) return;

  const buttons = container.querySelectorAll("button");

  const controlRow = document.createElement("div");
  const actionRow = document.createElement("div");

  controlRow.className = "ui-row controls";
  actionRow.className = "ui-row actions";

  buttons.forEach(btn => {
    const role = btn.dataset.role || "";

    if (
      role === "playPause" ||
      role === "preview" ||
      role === "reset" ||
      role === "advancedToggle"
    ) {
      controlRow.appendChild(btn);
    } else if (
      role === "exportMp3" ||
      role === "exportWav"
    ) {
      actionRow.appendChild(btn);
    }
  });

  // clear old buttons
  buttons.forEach(btn => btn.remove());

  // append new structure
  container.appendChild(controlRow);
  container.appendChild(actionRow);
}