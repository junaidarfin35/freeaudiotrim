(() => {
  "use strict";

  const engineApi = window.FreeAudioTrimAudioEngine;
  if (!engineApi) {
    return;
  }

  const fileInput = document.getElementById("fileInput");
  const speedRange = document.getElementById("speedRange");
  const speedValue = document.getElementById("speedValue");
  const linkedPitchRange = document.getElementById("linkedPitchRange");
  const linkedPitchValue = document.getElementById("linkedPitchValue");
  const alsoAdjustPitch = document.getElementById("alsoAdjustPitch");
  const pitchControlGroup = document.getElementById("pitchControlGroup");
  const semitoneMode = document.getElementById("semitoneMode");
  const previewBtn = document.getElementById("previewBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const jumpStartBtn = document.getElementById("jumpStartBtn");
  const exportBtn = document.getElementById("exportBtn");
  const downloadLink = document.getElementById("downloadLink");
  const status = document.getElementById("status");
  const waveformCanvas = document.getElementById("waveformCanvas");
  const waveformTime = document.getElementById("waveformTime");
  const transportTime = document.getElementById("transportTime");
  const originalDuration = document.getElementById("originalDuration");
  const newDuration = document.getElementById("newDuration");
  const rateValue = document.getElementById("rateValue");
  const keyValue = document.getElementById("keyValue");
  const bpmValue = document.getElementById("bpmValue");
  const originalModeBtn = document.getElementById("originalModeBtn");
  const modifiedModeBtn = document.getElementById("modifiedModeBtn");

  if (!fileInput || !speedRange || !previewBtn || !exportBtn) {
    return;
  }

  let downloadUrl = "";

  const engine = new engineApi.AudioEngine({
    canvas: waveformCanvas,
    timeOutputs: [waveformTime, transportTime],
    onStatus: setStatus,
    onAnalysis: ({ key, bpm }) => {
      keyValue.textContent = key || "Unknown";
      bpmValue.textContent = bpm ? String(bpm) : "-";
    },
    onBuffer: ({ originalDuration: sourceDuration, processedDuration }) => {
      originalDuration.textContent = `Original Duration: ${engineApi.formatTime(sourceDuration)}`;
      newDuration.textContent = `Processed Duration: ${engineApi.formatTime(processedDuration)}`;
    },
    onStateChange: updateState,
  });

  bindEvents();
  updateSpeedUI();
  updatePitchUI();
  applySettings();

  function bindEvents() {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        clearDownload();
        void engine.loadFile(file).then(() => {
          applySettings();
        });
      }
      fileInput.value = "";
    });

    speedRange.addEventListener("input", () => {
      pauseBeforeUpdate();
      updateSpeedUI();
      applySettings();
    });

    linkedPitchRange.addEventListener("input", () => {
      pauseBeforeUpdate();
      updatePitchUI();
      applySettings();
    });

    alsoAdjustPitch.addEventListener("change", () => {
      pauseBeforeUpdate();
      pitchControlGroup.hidden = !alsoAdjustPitch.checked;
      updatePitchUI();
      applySettings();
    });

    semitoneMode.addEventListener("change", () => {
      pauseBeforeUpdate();
      syncPitchScaleMode();
      updatePitchUI();
      applySettings();
    });

    previewBtn.addEventListener("click", () => void engine.play());
    pauseBtn.addEventListener("click", () => engine.pause());
    stopBtn.addEventListener("click", () => engine.stop());
    jumpStartBtn.addEventListener("click", () => engine.jumpToStart());
    originalModeBtn.addEventListener("click", () => void engine.setMode("original"));
    modifiedModeBtn.addEventListener("click", () => void engine.setMode("modified"));
    exportBtn.addEventListener("click", () => void exportAudio());

    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      void engine.togglePlayPause();
    });
  }

  function pauseBeforeUpdate() {
    if (engine.getPlaybackState().isPlaying) {
      engine.pause();
    }
    clearDownload();
  }

  function syncPitchScaleMode() {
    const currentSemitones = getPitchSemitones();
    if (semitoneMode.checked) {
      linkedPitchRange.min = "-12";
      linkedPitchRange.max = "12";
      linkedPitchRange.step = "1";
      linkedPitchRange.value = String(Math.round(currentSemitones));
      return;
    }
    linkedPitchRange.min = "50";
    linkedPitchRange.max = "200";
    linkedPitchRange.step = "1";
    linkedPitchRange.value = String(Math.round(Math.pow(2, currentSemitones / 12) * 100));
  }

  function getPitchSemitones() {
    if (!alsoAdjustPitch.checked) {
      return 0;
    }
    if (semitoneMode.checked) {
      return Number(linkedPitchRange.value) || 0;
    }
    const ratio = Math.max(0.5, (Number(linkedPitchRange.value) || 100) / 100);
    return 12 * Math.log2(ratio);
  }

  function updateSpeedUI() {
    speedValue.textContent = `${getSpeed().toFixed(2)}x`;
  }

  function updatePitchUI() {
    const pitch = getPitchSemitones();
    if (semitoneMode.checked) {
      linkedPitchValue.textContent = `${pitch >= 0 ? "+" : ""}${Math.round(pitch)} st`;
    } else {
      linkedPitchValue.textContent = `${Math.pow(2, pitch / 12).toFixed(2)}x`;
    }
  }

  function getSpeed() {
    return Math.max(0.5, Number(speedRange.value) || 1);
  }

  function applySettings() {
    engine.setSettings({
      pitchSemitones: getPitchSemitones(),
      speed: getSpeed(),
    });
    rateValue.textContent = `Preview Mode: ${engine.getPlaybackState().mode === "original" ? "Original" : "Modified"}`;
    setStatus("Settings updated. Press Preview or Spacebar.");
  }

  async function exportAudio() {
    clearDownload();
    const result = await engine.exportProcessed();
    if (!result) {
      return;
    }
    downloadUrl = URL.createObjectURL(result.blob);
    downloadLink.href = downloadUrl;
    downloadLink.download = `${result.fileName.replace(".wav", "")}_${getSpeed().toFixed(2)}x.wav`;
    downloadLink.style.display = "inline-flex";
  }

  function updateState(state) {
    rateValue.textContent = `Preview Mode: ${state.mode === "original" ? "Original" : "Modified"}`;
    setModeButtonState(originalModeBtn, state.mode === "original");
    setModeButtonState(modifiedModeBtn, state.mode === "modified");
  }

  function setModeButtonState(button, isActive) {
    button.classList.toggle("btn-primary", isActive);
    button.classList.toggle("btn-secondary", !isActive);
  }

  function setStatus(message) {
    status.textContent = message;
    const text = String(message || "").toLowerCase();
    status.dataset.statusState =
      /error|failed|not supported/.test(text) ? "error" :
      /ready|preview|download|updated/.test(text) ? "success" :
      /decoding|rendering|processing/.test(text) ? "processing" :
      "idle";
  }

  function clearDownload() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = "";
    }
    downloadLink.style.display = "none";
    downloadLink.removeAttribute("href");
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName);
  }
})();
