(() => {
  "use strict";

  const engineApi = window.FreeAudioTrimAudioEngine;
  const voiceApi = window.FreeAudioTrimVoiceEnhancer;
  const PAGE_INPUT_ID = "audioFileInput";
  const MAX_DURATION_SECONDS = 10 * 60;
  const DEFAULT_PRESET = "creator";
  const DEFAULT_SLIDERS = {
    noiseReduction: 88,
    clarityFocus: 58,
    voiceDepth: 56,
    broadcastReady: 62,
  };
  if (!engineApi || !voiceApi) {
    errorLog("tool boot failed", {
      hasAudioEngine: !!engineApi,
      hasVoiceEnhancer: !!voiceApi,
    });
    return;
  }

  const root = document.getElementById("voice-studio-tool");
  if (!root) {
    warn("tool root missing");
    return;
  }

  const state = {
    preset: DEFAULT_PRESET,
    analysisProfile: null,
    renderMeta: null,
    tooLong: false,
    downloadUrl: "",
    compareHeld: false,
    hasEnhanced: false,
    needsEnhance: true,
    isEnhancing: false,
    currentMode: "modified",
    preHoldMode: "modified",
    activeFile: null,
    userPresetLocked: false,
  };

  root.innerHTML = buildMarkup();
  refreshIcons();
  window.addEventListener("load", refreshIcons, { once: true });

  const elements = {
    fileRow: root.querySelector('[data-role="fileRow"]'),
    fileName: root.querySelector('[data-role="fileName"]'),
    changeFileBtn: root.querySelector('[data-role="changeFile"]'),
    waveformCanvas: root.querySelector("#waveformCanvas"),
    waveformTime: root.querySelector("#waveformTime"),
    transportTime: root.querySelector("#transportTime"),
    seekBar: root.querySelector("#seekBar"),
    enhanceBtn: root.querySelector("#enhanceBtn"),
    previewBtn: root.querySelector("#previewBtn"),
    compareHoldBtn: root.querySelector("#compareHoldBtn"),
    exportBtn: root.querySelector("#exportBtn"),
    modeButtons: {
      original: root.querySelector('#modeOriginalBtn'),
      modified: root.querySelector('#modeEnhancedBtn'),
    },
    advancedDetails: root.querySelector("#advancedControls"),
    downloadLink: root.querySelector("#downloadLink"),
    status: root.querySelector("#status"),
    metaNote: root.querySelector('[data-role="renderMetaNote"]'),
    sourceDuration: root.querySelector("#sourceDuration"),
    processedDuration: root.querySelector("#processedDuration"),
    targetBadge: root.querySelector("#targetBadge"),
    presetCards: Array.from(root.querySelectorAll("[data-preset]")),
    sliders: {
      noiseReduction: root.querySelector("#noiseReductionRange"),
      clarityFocus: root.querySelector("#clarityFocusRange"),
      voiceDepth: root.querySelector("#voiceDepthRange"),
      broadcastReady: root.querySelector("#broadcastReadyRange"),
    },
    sliderValues: {
      noiseReduction: root.querySelector("#noiseReductionValue"),
      clarityFocus: root.querySelector("#clarityFocusValue"),
      voiceDepth: root.querySelector("#voiceDepthValue"),
      broadcastReady: root.querySelector("#broadcastReadyValue"),
    },
  };

  const engine = new engineApi.AudioEngine({
    autoPrimeOnSettingsChange: false,
    processor: voiceApi.createProcessor({
      onRenderInfo(meta) {
        state.renderMeta = meta || null;
        updateRenderMeta();
        if (meta) {
          info("render metadata received", meta);
        }
      },
    }),
    canvas: elements.waveformCanvas,
    timeOutputs: [elements.waveformTime, elements.transportTime],
    onStatus: setStatus,
    onAnalysis: (analysis) => {
      state.analysisProfile = analysis || null;
      if (!state.userPresetLocked) {
        const recommendedKey = findPresetKeyByLabel(analysis?.adaptiveProfile?.recommendedPreset || analysis?.heuristic?.recommendedPreset);
        if (recommendedKey && recommendedKey !== state.preset) {
          state.preset = recommendedKey;
          updatePresetCards();
          info("auto preset applied from file analysis", {
            preset: voiceApi.PRESETS[recommendedKey]?.label || recommendedKey,
          });
        }
      }
      applySettings({ silent: true });
    },
    onBuffer: ({ originalDuration, processedDuration }) => {
      elements.sourceDuration.textContent = `Original ${engineApi.formatTime(originalDuration)}`;
      elements.processedDuration.textContent = `Enhanced ${engineApi.formatTime(processedDuration)}`;
    },
    onStateChange: updateState,
  });

  info("tool initialized", {
    presetCount: Object.keys(voiceApi.PRESETS || {}).length,
    defaultPreset: DEFAULT_PRESET,
  });

  if (typeof voiceApi.prewarmWorker === "function") {
    void voiceApi.prewarmWorker()
      .then((runtimeInfo) => {
        info("rnnoise runtime detected", runtimeInfo);
      })
      .catch((error) => {
        warn("rnnoise runtime unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  window.__audioEngine = engine;
  bindEvents();
  prepareDownloadButton();
  updateSliderLabels();
  updatePresetCards();
  updateModeButtons();
  updateRenderMeta();
  updateActionState();
  applySettings({ silent: true });

  function bindEvents() {
    elements.changeFileBtn.addEventListener("click", () => {
      info("change file requested");
      document.getElementById(PAGE_INPUT_ID)?.click();
    });

    elements.enhanceBtn.addEventListener("click", () => {
      void enhanceCurrentVoice();
    });

    elements.previewBtn.addEventListener("click", () => {
      if (!canUsePreviewActions()) {
        return;
      }
      void togglePreviewPlayback();
    });

    elements.exportBtn.addEventListener("click", () => {
      if (!canUseProcessedActions()) {
        return;
      }
      if (state.downloadUrl) {
        elements.downloadLink.click();
        return;
      }
      void exportAudio();
    });

    elements.modeButtons.original?.addEventListener("click", () => {
      if (!canUsePreviewActions()) {
        return;
      }
      void switchMode("original");
    });

    elements.modeButtons.modified?.addEventListener("click", () => {
      if (!canUseProcessedActions()) {
        return;
      }
      void switchMode("modified");
    });

    elements.presetCards.forEach((card) => {
      card.addEventListener("click", () => {
        state.preset = card.getAttribute("data-preset") || DEFAULT_PRESET;
        state.userPresetLocked = true;
        updatePresetCards();
        pauseBeforeUpdate();
        applySettings({ silent: true });
        markNeedsEnhance(`Preset changed to ${voiceApi.PRESETS[state.preset]?.label || "Creator"}. Click Enhance Voice to render the new sound.`);
      });
    });

    Object.entries(elements.sliders).forEach(([key, input]) => {
      if (!input) {
        return;
      }
      input.addEventListener("input", () => {
        updateSliderLabels();
      });
      input.addEventListener("change", () => {
        pauseBeforeUpdate();
        applySettings({ silent: true });
        markNeedsEnhance(`Advanced controls changed. Click Enhance Voice to update the result.`);
        info("advanced control changed", {
          control: key,
          value: readSlider(key),
        });
      });
    });

    if (elements.seekBar) {
      elements.seekBar.addEventListener("input", () => {
        if (!canUsePreviewActions()) {
          return;
        }
        void engine.seekTo(Number(elements.seekBar.value) || 0);
      });
    }

    if (elements.waveformCanvas) {
      elements.waveformCanvas.addEventListener("click", (event) => {
        if (!canUsePreviewActions()) {
          return;
        }
        const rect = elements.waveformCanvas.getBoundingClientRect();
        const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
        const duration = engine.getPlaybackState().duration;
        if (duration) {
          void engine.seekTo(duration * ratio);
        }
      });
    }

    bindHoldCompare();

    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (!canUsePreviewActions()) {
        return;
      }
      void togglePreviewPlayback();
    });
  }

  function bindHoldCompare() {
    const button = elements.compareHoldBtn;
    if (!button) {
      return;
    }

    const holdStart = (event) => {
      if (!canUseProcessedActions() || !engine.originalBuffer) {
        return;
      }
      if (event) {
        event.preventDefault();
      }
      state.compareHeld = true;
      state.preHoldMode = state.currentMode || "modified";
      button.classList.add("is-active");
      button.textContent = "Release to return";
      info("hold-to-compare start", {
        fromMode: state.preHoldMode,
      });
      void switchMode("original", { silentStatus: true, isTemporary: true });
    };

    const holdEnd = (event) => {
      if (!state.compareHeld) {
        return;
      }
      if (event) {
        event.preventDefault();
      }
      state.compareHeld = false;
      button.classList.remove("is-active");
      button.textContent = "Hold to compare";
      info("hold-to-compare end", {
        restoreMode: state.preHoldMode || "modified",
      });
      void switchMode(state.preHoldMode || "modified", { silentStatus: true, isTemporary: true });
    };

    button.addEventListener("pointerdown", holdStart);
    button.addEventListener("pointerup", holdEnd);
    button.addEventListener("pointercancel", holdEnd);
    button.addEventListener("pointerleave", holdEnd);
    button.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        holdStart(event);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        holdEnd(event);
      }
    });
    button.addEventListener("blur", holdEnd);
  }

  function pauseBeforeUpdate() {
    if (engine.getPlaybackState().isPlaying) {
      engine.pause();
    }
    clearDownload();
  }

  function applySettings(options = {}) {
    const settings = {
      preset: state.preset,
      analysisProfile: state.analysisProfile,
      noiseReduction: readSlider("noiseReduction"),
      clarityFocus: readSlider("clarityFocus"),
      voiceDepth: readSlider("voiceDepth"),
      broadcastReady: readSlider("broadcastReady"),
    };

    engine.setSettings(settings);
    elements.targetBadge.textContent = `Preset ${voiceApi.PRESETS[state.preset]?.label || "Creator"}`;
    if (!options.silent && !state.tooLong) {
      setStatus("Settings updated. Click Enhance Voice when you want a fresh render.", "ready");
    }
  }

  async function loadSelectedFile(file) {
    if (!file) {
      return false;
    }

    state.activeFile = file;
    info("file selected", {
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "unknown",
    });

    state.renderMeta = null;
    state.analysisProfile = null;
    state.tooLong = false;
    state.compareHeld = false;
    state.hasEnhanced = false;
    state.needsEnhance = true;
    state.currentMode = "original";
    state.userPresetLocked = false;
    engine.reset();
    clearDownload();
    updateRenderMeta();
    updateModeButtons();
    setStatus("Loading voice recording...", "processing");

    const probedDuration = await probeFileDuration(file, 1800);
    if (Number.isFinite(probedDuration)) {
      info("file metadata detected", {
        fileName: file.name,
        durationSeconds: round(probedDuration),
        sizeBytes: file.size,
      });
    }

    if (Number.isFinite(probedDuration) && probedDuration > MAX_DURATION_SECONDS) {
      state.tooLong = true;
      updateActionState();
      warn("file rejected by 10-minute cap", {
        fileName: file.name,
        durationSeconds: round(probedDuration),
        maxDurationSeconds: MAX_DURATION_SECONDS,
      });
      setStatus("For speed and stability, AI Voice Studio v1 supports voice clips up to 10 minutes.", "error");
      return false;
    }

    const loaded = await engine.loadFile(file);
    if (!loaded || !engine.originalBuffer) {
      warn("file rejected because decode failed or format unsupported", {
        fileName: file.name,
        sizeBytes: file.size,
      });
      updateActionState();
      return false;
    }

    if (engine.originalBuffer.duration > MAX_DURATION_SECONDS) {
      state.tooLong = true;
      engine.reset();
      updateRenderMeta();
      updateActionState();
      setStatus("For speed and stability, AI Voice Studio v1 supports voice clips up to 10 minutes.", "error");
      return false;
    }

    applySettings({ silent: true });
    await switchMode("original", { silentStatus: true });
    updateActionState();
    info("decoded audio ready", {
      fileName: file.name,
      durationSeconds: round(engine.originalBuffer.duration),
      sampleRate: engine.originalBuffer.sampleRate,
      channelCount: engine.originalBuffer.numberOfChannels,
      sizeBytes: file.size,
    });
    setStatus("Preview the original, then click Enhance Voice when you are ready.", "ready");
    return true;
  }

  async function enhanceCurrentVoice() {
    if (!engine.originalBuffer || state.tooLong || state.isEnhancing) {
      return;
    }

    state.isEnhancing = true;
    updateActionState();
    clearDownload();
    setStatus("Enhancing voice locally in your browser...", "processing");
    info("enhancement requested", {
      preset: voiceApi.PRESETS[state.preset]?.label || "Creator",
      fileName: state.activeFile?.name || engine.fileName,
    });

    try {
      await engine.primeProcessedBuffer();
      state.hasEnhanced = true;
      state.needsEnhance = false;
      await switchMode("modified", { silentStatus: true });
      if (state.renderMeta?.fallbackReason) {
        warn("fallback path used for this render", {
          reason: state.renderMeta.fallbackReason,
        });
        setStatus(state.renderMeta.fallbackReason, "warning");
      } else {
        setStatus("Enhanced voice ready. Play it, compare it, or download it.", "success");
      }
    } catch (error) {
      state.hasEnhanced = false;
      state.needsEnhance = true;
      errorLog("final render failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      setStatus("Voice enhancement failed. Check the console log for details.", "error");
    } finally {
      state.isEnhancing = false;
      updateModeButtons();
      updateActionState();
    }
  }

  async function exportAudio() {
    clearDownload();
    info("export started", {
      preset: voiceApi.PRESETS[state.preset]?.label || "Creator",
      hasEnhanced: state.hasEnhanced,
      needsEnhance: state.needsEnhance,
    });
    const result = await engine.exportProcessed();
    if (!result) {
      warn("export failed");
      return;
    }
    state.downloadUrl = URL.createObjectURL(result.blob);
    elements.downloadLink.href = state.downloadUrl;
    elements.downloadLink.download = result.fileName.replace("_processed", `_voice_studio_${state.preset}`);
    elements.downloadLink.textContent = "Download WAV";
    updateActionState();
    updateRenderMeta();
    info("export completed", {
      fileName: elements.downloadLink.download,
      outputDuration: round(result.duration),
      outputChannels: result.numberOfChannels,
      outputShape: result.numberOfChannels === 1 ? "mono" : "stereo",
      sampleRate: result.sampleRate,
      usedProcessedBuffer: result.usedProcessedBuffer,
    });
    if (state.renderMeta?.fallbackReason) {
      setStatus(state.renderMeta.fallbackReason, "warning");
    } else {
      setStatus("Enhanced WAV ready. Download when it sounds right.", "success");
    }
  }

  function updateRenderMeta() {
    const meta = state.renderMeta;
    if (!meta) {
      elements.metaNote.textContent = "Preview the original, then click Enhance Voice to generate the enhanced version.";
      return;
    }
    if (meta.aiDenoiseActive) {
      const cleanupNote = meta.roomControlActive ? "Mild room control active." : "Mild room control bypassed.";
      const mixPercent = Math.round((Number(meta.denoiseMix) || 0) * 100);
      const modelName = meta.modelName || "AI noise reduction";
      elements.metaNote.textContent = `${modelName} active at ${mixPercent}% cleanup mix. ${cleanupNote} ${meta.presetLabel} preset targeting ${meta.targetLufsEstimate.toFixed(1)} LUFS estimate.`;
      return;
    }
    if (meta.fallbackReason) {
      elements.metaNote.textContent = meta.fallbackReason;
      return;
    }
    elements.metaNote.textContent = `${meta.presetLabel} preset active. Studio chain ready.`;
  }

  function updateState(playbackState) {
    state.currentMode = playbackState.mode || state.currentMode;
    const modeLabel = state.currentMode === "original" ? "original" : "enhanced";
    elements.previewBtn.dataset.playing = playbackState.isPlaying ? "true" : "false";
    elements.previewBtn.setAttribute("aria-label", playbackState.isPlaying ? `Pause ${modeLabel} preview` : `Play ${modeLabel} preview`);
    if (elements.seekBar) {
      elements.seekBar.max = String(playbackState.duration || 0);
      elements.seekBar.value = String(Math.min(playbackState.currentTime || 0, playbackState.duration || 0));
    }
    updateModeButtons();
    updateActionState();
  }

  function updateActionState() {
    const hasFile = !!engine.originalBuffer;
    const canUsePreview = canUsePreviewActions();
    const canUseProcessed = canUseProcessedActions();
    const busy = state.isEnhancing;

    elements.enhanceBtn.disabled = !hasFile || state.tooLong || busy;
    elements.previewBtn.disabled = !canUsePreview;
    elements.compareHoldBtn.disabled = !canUseProcessed;
    elements.exportBtn.disabled = !canUseProcessed;
    elements.modeButtons.original.disabled = !canUsePreview;
    elements.modeButtons.modified.disabled = !canUseProcessed;
    if (elements.seekBar) {
      elements.seekBar.disabled = !canUsePreview;
    }
    elements.exportBtn.textContent = state.downloadUrl ? "Download WAV" : "Export WAV";
  }

  function updatePresetCards() {
    elements.presetCards.forEach((card) => {
      card.setAttribute("data-selected", card.getAttribute("data-preset") === state.preset ? "true" : "false");
    });
  }

  function updateModeButtons() {
    const activeMode = state.currentMode || "modified";
    elements.modeButtons.original?.setAttribute("data-selected", activeMode === "original" ? "true" : "false");
    elements.modeButtons.modified?.setAttribute("data-selected", activeMode === "modified" ? "true" : "false");
  }

  function updateSliderLabels() {
    elements.sliderValues.noiseReduction.textContent = `${readSlider("noiseReduction")}%`;
    elements.sliderValues.clarityFocus.textContent = formatSliderDelta(readSlider("clarityFocus"));
    elements.sliderValues.voiceDepth.textContent = formatSliderDelta(readSlider("voiceDepth"));
    elements.sliderValues.broadcastReady.textContent = `${readSlider("broadcastReady")}%`;
  }

  function readSlider(key) {
    return Number(elements.sliders[key]?.value || 0);
  }

  async function switchMode(mode, options = {}) {
    const nextMode = mode === "original" ? "original" : "modified";
    await engine.setMode(nextMode);
    state.currentMode = nextMode;
    updateModeButtons();
    const label = nextMode === "original" ? "original" : "enhanced";
    info(`switched to ${label}`, {
      currentMode: nextMode,
      isTemporary: !!options.isTemporary,
    });
    if (!options.silentStatus) {
      setStatus(nextMode === "original" ? "Original voice ready for comparison." : "Enhanced voice ready for playback.", "ready");
    }
  }

  function markNeedsEnhance(message) {
    state.hasEnhanced = false;
    state.needsEnhance = true;
    state.currentMode = "original";
    state.renderMeta = null;
    void engine.setMode("original");
    updateRenderMeta();
    updateModeButtons();
    updateActionState();
    setStatus(message, "ready");
  }

  function canUsePreviewActions() {
    return !!engine.originalBuffer && !state.tooLong && !state.isEnhancing;
  }

  function canUseProcessedActions() {
    return !!engine.originalBuffer && !state.tooLong && !state.isEnhancing && state.hasEnhanced && !state.needsEnhance;
  }

  async function togglePreviewPlayback() {
    if (!canUsePreviewActions()) {
      return;
    }
    if (!state.hasEnhanced || state.needsEnhance) {
      await switchMode("original", { silentStatus: true });
    }
    void engine.togglePlayPause();
  }

  function setStatus(message, explicitState) {
    elements.status.textContent = message;
    if (explicitState) {
      elements.status.dataset.statusState = explicitState;
      return;
    }
    const text = String(message || "").toLowerCase();
    elements.status.dataset.statusState =
      /error|failed|unsupported/.test(text) ? "error" :
      /ready|preview|download|active/.test(text) ? "ready" :
      /denoising|decoding|rendering|loading|processing|enhancing/.test(text) ? "processing" :
      /unavailable|fallback|without ai/.test(text) ? "warning" :
      "idle";
  }

  function prepareDownloadButton() {
    const link = elements.downloadLink;
    if (!link || link.dataset.enhanced === "true") {
      return;
    }
    link.dataset.enhanced = "true";
    link.style.display = "none";
    link.textContent = "Download WAV";
  }

  function clearDownload() {
    if (state.downloadUrl) {
      URL.revokeObjectURL(state.downloadUrl);
      state.downloadUrl = "";
    }
    elements.downloadLink.removeAttribute("href");
    elements.downloadLink.removeAttribute("download");
    updateActionState();
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName);
  }

  function formatSigned(value) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return `${value >= 0 ? "+" : ""}${Number(value).toFixed(1)}`;
  }

  function formatScore(value) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return `${Math.round(value)}/100`;
  }

  function formatSliderDelta(value) {
    const delta = Number(value) - 50;
    return delta === 0 ? "Neutral" : `${delta > 0 ? "+" : ""}${delta}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function probeFileDuration(file, timeoutMs = 1800) {
    return new Promise((resolve) => {
      const audio = document.createElement("audio");
      const url = URL.createObjectURL(file);
      let settled = false;

      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timerId);
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
        resolve(value);
      };

      const cleanup = () => {
        finish(NaN);
      };

      const timerId = window.setTimeout(() => {
        finish(NaN);
      }, Math.max(250, timeoutMs));

      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const duration = Number(audio.duration);
        finish(Number.isFinite(duration) ? duration : NaN);
      };
      audio.onerror = () => {
        cleanup();
      };

      audio.src = url;
    });
  }

  function buildMarkup() {
    return `
      <div class="voice-studio-app at-root">
        <div class="tool-card voice-studio-card">
          <div class="voice-section voice-section--top">
            <div class="at-file-row is-hidden" data-role="fileRow">
              <div class="at-file-info">
                <i data-lucide="mic"></i>
                <span class="at-file-name" data-role="fileName"></span>
              </div>
              <button type="button" class="at-btn at-btn-soft" data-role="changeFile">Change</button>
            </div>
          </div>

          <div class="voice-section voice-section--preset">
            <div class="voice-section__header">
              <p>Pick a preset</p>
            </div>
            <div class="at-model-grid voice-preset-grid">
              ${renderPresetCards()}
            </div>
          </div>

          <div class="voice-primary-action">
            <button class="at-btn at-btn-primary voice-enhance-btn" id="enhanceBtn" type="button">Enhance Voice</button>
          </div>

          <div class="voice-section voice-section--status">
            <p class="voice-meta-note" data-role="renderMetaNote">Pick a preset, click Enhance Voice, then compare the result.</p>
          </div>

          <div class="at-row at-wave-wrap">
            <canvas id="waveformCanvas" class="at-wave" aria-label="Voice enhancement waveform preview"></canvas>
          </div>
          
          <div class="voice-badge-row">
            <span class="normalize-badge" id="sourceDuration">Original -</span>
            <span class="normalize-badge" id="processedDuration">Enhanced -</span>
            <span class="normalize-badge normalize-badge--ok" id="targetBadge">Preset Creator</span>
          </div>

          <div class="at-times">
            <span id="waveformTime">0:00 / 0:00</span>
          </div>

          <div class="voice-controls-row">
            <button class="at-btn at-btn-soft voice-preview-icon-btn" id="previewBtn" type="button" data-playing="false" aria-label="Play enhanced preview">
              <span class="voice-preview-icon" aria-hidden="true">
                <span class="voice-preview-icon__play"></span>
                <span class="voice-preview-icon__pause">
                  <span></span>
                  <span></span>
                </span>
              </span>
            </button>
            <button class="at-btn at-btn-soft voice-compare-btn" id="compareHoldBtn" type="button">Hold to compare</button>

            <div class="voice-mode-toggle" role="group" aria-label="A/B compare mode">
              <button class="at-btn at-btn-soft voice-mode-btn" id="modeOriginalBtn" type="button" data-selected="false">Original</button>
              <button class="at-btn at-btn-soft voice-mode-btn" id="modeEnhancedBtn" type="button" data-selected="true">Enhanced</button>
            </div>

          </div>

          <div class="voice-section voice-section--status">
            <div class="at-row at-status" id="status" data-status-state="idle">Upload a voice recording to start.</div>
          </div>

          <details class="voice-advanced" id="advancedControls">
            <summary>Advanced Controls</summary>
            <div class="voice-section voice-section--advanced">
              <div class="voice-section__header">
                <p class="voice-advanced-note">Changes apply when you click Enhance Voice again.</p>
              </div>
              <div class="voice-slider-grid">
                ${renderSlider("noiseReduction", "Noise Reduction", "Control background noise without killing speech shape.")}
                ${renderSlider("clarityFocus", "Clarity Focus", "Push presence and vocal intelligibility carefully.")}
                ${renderSlider("voiceDepth", "Voice Depth", "Shape low-mid weight and voice body.")}
                ${renderSlider("broadcastReady", "Broadcast Ready", "Tighten loudness and final control for publish-ready output.")}
              </div>
            </div>
          </details>

          <div class="voice-download-row">
            <button class="at-btn at-btn-soft" id="exportBtn" type="button">Export WAV</button>
          </div>

          <a id="downloadLink" aria-label="Download enhanced voice wav"></a>
        </div>
      </div>
    `;
  }

  function renderPresetCards() {
    return Object.values(voiceApi.PRESETS).map((preset) => `
      <button type="button" class="at-model-card voice-preset-card" data-preset="${preset.key}" data-selected="${preset.key === state.preset ? "true" : "false"}">
        <span class="at-model-card__media voice-preset-card__media"><i data-lucide="${preset.key === "creator" ? "sparkles" : preset.key === "podcast" ? "mic" : "film"}"></i></span>
        <span class="at-model-card__copy">
          <span class="at-model-card__title-row">
            <span class="at-model-card__title">${preset.label}</span>
            <span class="at-model-card__badge" data-state="ready">Preset</span>
          </span>
          <span class="at-model-card__helper">${describePreset(preset.key)}</span>
        </span>
      </button>
    `).join("");
  }

  function renderSlider(id, label, description) {
    const value = DEFAULT_SLIDERS[id];
    return `
      <label class="voice-slider-card" for="${id}Range">
        <span class="voice-slider-head">
          <span class="voice-slider-title">${label}</span>
          <span class="voice-slider-value" id="${id}Value">${id === "noiseReduction" || id === "broadcastReady" ? `${value}%` : "Neutral"}</span>
        </span>
        <span class="voice-slider-copy">${description}</span>
        <input id="${id}Range" type="range" min="0" max="100" step="1" value="${value}">
      </label>
    `;
  }

  function describePreset(key) {
    if (key === "creator") {
      return "Bright, modern, social-ready voice polish.";
    }
    if (key === "podcast") {
      return "Warmer and calmer for long-form spoken voice.";
    }
    return "Controlled lows, lifted presence, bigger finish.";
  }

  function findPresetKeyByLabel(label) {
    const target = String(label || "").trim().toLowerCase();
    if (!target) {
      return "";
    }
    return Object.values(voiceApi.PRESETS).find((preset) => preset.label.toLowerCase() === target)?.key || "";
  }

  window.VoiceStudioTool = {
    addFile(file) {
      return loadSelectedFile(file);
    },
    reset() {
      info("tool reset requested");
      state.preset = DEFAULT_PRESET;
      state.renderMeta = null;
      state.analysisProfile = null;
      state.tooLong = false;
      state.compareHeld = false;
      state.hasEnhanced = false;
      state.needsEnhance = true;
      state.isEnhancing = false;
      state.currentMode = "modified";
      state.preHoldMode = "modified";
      state.activeFile = null;
      state.userPresetLocked = false;
      clearDownload();
      engine.reset();
      Object.entries(DEFAULT_SLIDERS).forEach(([key, value]) => {
        if (elements.sliders[key]) {
          elements.sliders[key].value = String(value);
        }
      });
      elements.advancedDetails.open = false;
      elements.fileRow.classList.add("is-hidden");
      elements.fileName.textContent = "";
      elements.compareHoldBtn.classList.remove("is-active");
      elements.compareHoldBtn.textContent = "Hold to compare";
      elements.sourceDuration.textContent = "Original -";
      elements.processedDuration.textContent = "Enhanced -";
      elements.targetBadge.textContent = "Preset Creator";
      updateRenderMeta();
      updatePresetCards();
      updateSliderLabels();
      updateModeButtons();
      setStatus("Upload a voice recording to start.", "idle");
      updateActionState();
    },
  };

  function info(message, data) {
    emit("info", message, data);
  }

  function warn(message, data) {
    emit("warn", message, data);
  }

  function errorLog(message, data) {
    emit("error", message, data);
  }

  function emit(level, message, data) {
    void level;
    void message;
    void data;
  }
})();
