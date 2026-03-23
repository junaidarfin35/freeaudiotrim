(() => {
  "use strict";

  const engineApi = window.FreeAudioTrimAudioEngine;
  if (!engineApi) {
    return;
  }

  const fileInput = document.getElementById("fileInput");
  const semitoneRange = document.getElementById("semitoneRange");
  const semitoneValue = document.getElementById("semitoneValue");
  const linkedSpeedRange = document.getElementById("linkedSpeedRange");
  const linkedSpeedValue = document.getElementById("linkedSpeedValue");
  const alsoAdjustSpeed = document.getElementById("alsoAdjustSpeed");
  const speedControlGroup = document.getElementById("speedControlGroup");
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
  const seekBar = document.getElementById("seekBar");
  const transportTime = document.getElementById("transportTime");
  const confidenceValue = document.getElementById("confidenceValue");
  const analysisCard = document.getElementById("confidenceAnalysis")?.closest(".analysis-card") || document.querySelector(".analysis-card");
  const originalDuration = document.getElementById("originalDuration");
  const newDuration = document.getElementById("newDuration");
  const rateValue = document.getElementById("rateValue");
  const keyValue = document.getElementById("keyValue");
  const bpmValue = document.getElementById("bpmValue");
  const originalModeBtn = document.getElementById("originalModeBtn");
  const modifiedModeBtn = document.getElementById("modifiedModeBtn");

  if (!fileInput || !semitoneRange || !previewBtn || !exportBtn) {
    return;
  }

  let downloadUrl = "";
  const analysisState = {
    key: "Waiting for file",
    bpm: 0,
    confidenceLabel: "Low",
    confidence: 0,
  };

  const engine = new engineApi.AudioEngine({
    canvas: waveformCanvas,
    timeOutputs: [waveformTime, transportTime],
    onStatus: setStatus,
    onAnalysis: ({ key, bpm, confidenceLabel, confidence }) => {
      analysisState.key = key || "Unknown";
      analysisState.bpm = Number(bpm) || 0;
      analysisState.confidenceLabel = confidenceLabel || confidenceLevel(confidence);
      analysisState.confidence = Number(confidence) || 0;
      updateAnalysisDisplay();
    },
    onBuffer: ({ originalDuration: sourceDuration, processedDuration }) => {
      originalDuration.textContent = `Original Duration: ${engineApi.formatTime(sourceDuration)}`;
      newDuration.textContent = `Processed Duration: ${engineApi.formatTime(processedDuration)}`;
    },
    onStateChange: updateState,
  });

  bindEvents();
  updatePitchSliderUI();
  updateSpeedUI();
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

    semitoneRange.addEventListener("input", () => {
      pauseBeforeUpdate();
      updatePitchSliderUI();
      applySettings();
    });

    linkedSpeedRange.addEventListener("input", () => {
      pauseBeforeUpdate();
      updateSpeedUI();
      applySettings();
    });

    alsoAdjustSpeed.addEventListener("change", () => {
      pauseBeforeUpdate();
      speedControlGroup.hidden = !alsoAdjustSpeed.checked;
      updateSpeedUI();
      applySettings();
    });

    semitoneMode.addEventListener("change", () => {
      pauseBeforeUpdate();
      syncPitchScaleMode();
      updatePitchSliderUI();
      updateAnalysisDisplay();
      applySettings();
    });

    previewBtn.addEventListener("click", () => void engine.togglePlayPause());
    pauseBtn.addEventListener("click", () => engine.pause());
    stopBtn.addEventListener("click", () => engine.stop());
    jumpStartBtn.addEventListener("click", () => engine.jumpToStart());
    seekBar.addEventListener("input", () => void engine.seekTo(Number(seekBar.value) || 0));
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
      semitoneRange.min = "-12";
      semitoneRange.max = "12";
      semitoneRange.step = "1";
      semitoneRange.value = String(Math.round(currentSemitones));
      return;
    }
    semitoneRange.min = "50";
    semitoneRange.max = "200";
    semitoneRange.step = "1";
    semitoneRange.value = String(Math.round(Math.pow(2, currentSemitones / 12) * 100));
  }

  function getPitchSemitones() {
    if (semitoneMode.checked) {
      return Number(semitoneRange.value) || 0;
    }
    const ratio = Math.max(0.5, (Number(semitoneRange.value) || 100) / 100);
    return 12 * Math.log2(ratio);
  }

  function updatePitchSliderUI() {
    const pitch = getPitchSemitones();
    if (semitoneMode.checked) {
      semitoneValue.textContent = `${pitch >= 0 ? "+" : ""}${Math.round(pitch)} st`;
    } else {
      semitoneValue.textContent = `${Math.pow(2, pitch / 12).toFixed(2)}x`;
    }
    updateAnalysisDisplay();
  }

  function updateSpeedUI() {
    linkedSpeedValue.textContent = `${getSpeed().toFixed(2)}x`;
  }

  function getSpeed() {
    return alsoAdjustSpeed.checked ? Math.max(0.5, Number(linkedSpeedRange.value) || 1) : 1;
  }

  function applySettings() {
    engine.setSettings({
      pitchSemitones: getPitchSemitones(),
      speed: getSpeed(),
    });
    rateValue.textContent = `Preview Mode: ${engine.getPlaybackState().mode === "original" ? "Original" : "Modified"}`;
    updateAnalysisDisplay();
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
    downloadLink.download = result.fileName.replace("_processed", `_pitch_${formatPitchFilePart()}`);
    downloadLink.style.display = "inline-flex";
  }

  function formatPitchFilePart() {
    const pitch = getPitchSemitones();
    return `${pitch >= 0 ? "plus" : "minus"}${Math.abs(Math.round(pitch))}st`;
  }

  function updateState(state) {
    rateValue.textContent = `Preview Mode: ${state.mode === "original" ? "Original" : "Modified"}`;
    previewBtn.textContent = state.isPlaying ? "Pause" : "Play";
    if (seekBar) {
      seekBar.max = String(state.duration || 0);
      seekBar.value = String(Math.min(state.currentTime || 0, state.duration || 0));
    }
    updateAnalysisDisplay();
    setModeButtonState(originalModeBtn, state.mode === "original");
    setModeButtonState(modifiedModeBtn, state.mode === "modified");
  }

  function updateAnalysisDisplay() {
    const pitchShift = getPitchSemitones();
    const displayedKey = transposeKey(analysisState.key, pitchShift);
    keyValue.textContent = displayedKey;
    bpmValue.textContent = analysisState.bpm ? `${analysisState.bpm} BPM` : "-";
    confidenceValue.textContent = `${analysisState.confidenceLabel} confidence`;
    if (analysisCard) {
      analysisCard.dataset.confidence = String(analysisState.confidenceLabel || "low").toLowerCase();
    }
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

  function transposeKey(key, semitones) {
    const match = String(key || "").trim().match(/^([A-G](?:#|b)?)(?:\s+(major|minor))?$/i);
    if (!match) {
      return key || "Unknown";
    }

    const note = match[1].toUpperCase().replace("B", "b");
    const mode = (match[2] || "").toLowerCase();
    const pitchClass = NOTE_TO_PC[note];
    if (pitchClass == null) {
      return key || "Unknown";
    }

    const shift = ((Math.round(semitones) % 12) + 12) % 12;
    const outputNote = NOTE_NAMES[((pitchClass + shift) % 12 + 12) % 12];
    return mode ? `${outputNote} ${mode}` : outputNote;
  }

  function confidenceLevel(score) {
    const value = Number(score) || 0;
    if (value >= 0.75) {
      return "High";
    }
    if (value >= 0.45) {
      return "Medium";
    }
    return "Low";
  }

  const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const NOTE_TO_PC = {
    C: 0,
    "C#": 1,
    DB: 1,
    D: 2,
    "D#": 3,
    EB: 3,
    E: 4,
    F: 5,
    "F#": 6,
    GB: 6,
    G: 7,
    "G#": 8,
    AB: 8,
    A: 9,
    "A#": 10,
    BB: 10,
    B: 11,
  };
})();
