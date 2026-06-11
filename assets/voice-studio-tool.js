(() => {
  "use strict";

  const engineApi = window.FreeAudioTrimAudioEngine;
  const voiceApi = window.FreeAudioTrimVoiceEnhancer;
  const PAGE_INPUT_ID = "audioFileInput";
  const DEFAULT_PRESET = "creator";
  const PRESET_ORDER = ["creator", "podcast", "cinematic"];
  const ABSOLUTE_MAX_DURATION_SECONDS = getAbsoluteMaxDurationSeconds();
  const BENCHMARK_CACHE_VERSION = "2026-06-11-tier-bench-v3";
  const BENCHMARK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const BENCHMARK_TIMEOUT_MS = 3000;
  const BENCHMARK_SPEED_LIMITS = {
    creatorDemoteMsPerSecond: 1400,
    creatorPromotePodcastMsPerSecond: 650,
    podcastDemoteMsPerSecond: 1250,
    cinematicPromoteMsPerSecond: 900,
    cinematicProbeFromPodcastMsPerSecond: 850,
  };
  const PRESET_DURATION_MESSAGES = {
    podcast: "Balanced Clean supports clips up to 3 minutes. Use Fast Clean for longer files.",
    cinematic: "Studio Clean supports clips up to 90 seconds. Use Balanced or Fast Clean for longer files.",
  };
  const EXPORT_FLAGS = {
    brandOutro: true,
  };
  const BRAND_OUTRO_URL = "/assets/brand/freeaudiotrim-outro.aac?v=2026-06-06-1";
  const BRAND_OUTRO_FADE_SECONDS = 0.12;
  let brandOutroBufferPromise = null;
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

  window.FreeAudioTrimVoiceStudioFlags = EXPORT_FLAGS;
  let deviceProfile = detectDeviceProfile();
  let benchmarkRunId = 0;

  const state = {
    preset: deviceProfile.recommendedPreset || DEFAULT_PRESET,
    appliedPreset: deviceProfile.recommendedPreset || DEFAULT_PRESET,
    analysisProfile: null,
    renderMeta: null,
    tooLong: false,
    sourceDurationSeconds: 0,
    downloadUrl: "",
    hasEnhanced: false,
    needsEnhance: true,
    isEnhancing: false,
    enhanceProgress: 0,
    enhanceProgressTimer: 0,
    currentMode: "modified",
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
    exportBtn: root.querySelector("#exportBtn"),
    modeButtons: {
      original: root.querySelector('#modeOriginalBtn'),
      modified: root.querySelector('#modeEnhancedBtn'),
    },
    downloadLink: root.querySelector("#downloadLink"),
    status: root.querySelector("#status"),
    progressShell: root.querySelector("#statusProgress"),
    progressFill: root.querySelector("#statusProgressFill"),
    progressPercent: root.querySelector("#statusProgressPercent"),
    progressStage: root.querySelector("#statusProgressStage"),
    metaNote: root.querySelector('[data-role="renderMetaNote"]'),
    presetHint: root.querySelector('[data-role="presetHint"]'),
    targetBadge: root.querySelector("#targetBadge"),
    presetCards: Array.from(root.querySelectorAll("[data-preset]")),
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
        const recommendedKey = capPresetForCurrentContext(
          findPresetKeyByLabel(analysis?.adaptiveProfile?.recommendedPreset || analysis?.heuristic?.recommendedPreset),
          deviceProfile,
          state.sourceDurationSeconds
        );
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
    onBuffer: () => {},
    onStateChange: updateState,
  });

  info("tool initialized", {
    presetCount: Object.keys(voiceApi.PRESETS || {}).length,
    defaultPreset: DEFAULT_PRESET,
    deviceProfile,
  });

  window.__audioEngine = engine;
  bindEvents();
  prepareDownloadButton();
  updatePresetCards();
  updateModeButtons();
  updateRenderMeta();
  updateActionState();
  updateDeviceHint();
  applySettings({ silent: true });
  applyCachedDeviceProfile();
  void scheduleDeviceBenchmark();

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
        const requestedPreset = card.getAttribute("data-preset") || DEFAULT_PRESET;
        const availability = getPresetAvailability(requestedPreset);
        if (!availability.available) {
          setStatus(availability.message || `${voiceApi.PRESETS[requestedPreset]?.label || "That preset"} is not available for this clip right now.`, "warning");
          return;
        }
        state.userPresetLocked = true;
        state.preset = requestedPreset;
        updatePresetCards();
        if (availability.reason === "benchmark-pending") {
          markNeedsEnhance(`${voiceApi.PRESETS[state.preset]?.label || "That preset"} is checking speed in the background. You can still try it now.`);
          return;
        }
        markNeedsEnhance(`Preset changed to ${voiceApi.PRESETS[state.preset]?.label || "Fast Clean"}. Click Re-Enhance to update the result.`);
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

  function applySettings(options = {}) {
    const settings = {
      preset: state.preset,
      analysisProfile: state.analysisProfile,
    };

    if (options.forceEngineSync || !state.hasEnhanced || !state.needsEnhance) {
      engine.setSettings(settings);
      state.appliedPreset = state.preset;
    }
    updateTargetBadge();
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
    state.sourceDurationSeconds = 0;
    state.hasEnhanced = false;
    state.needsEnhance = true;
    state.appliedPreset = state.preset;
    state.currentMode = "original";
    state.userPresetLocked = false;
    state.preset = deviceProfile.recommendedPreset || DEFAULT_PRESET;
    engine.reset();
    clearDownload();
    resetEnhanceProgress();
    updateRenderMeta();
    updateModeButtons();
    updatePresetCards();
    updateTargetBadge();
    updateDeviceHint();
    setStatus("Loading voice recording...", "processing");

    const probedDuration = await probeFileDuration(file, 1800);
    if (Number.isFinite(probedDuration)) {
      info("file metadata detected", {
        fileName: file.name,
        durationSeconds: round(probedDuration),
        sizeBytes: file.size,
      });
    }

    if (Number.isFinite(probedDuration)) {
      state.sourceDurationSeconds = probedDuration;
      syncPresetForCurrentContext();
    }

    if (Number.isFinite(probedDuration) && probedDuration > ABSOLUTE_MAX_DURATION_SECONDS) {
      state.tooLong = true;
      updateActionState();
      warn("file rejected by absolute fast-clean cap", {
        fileName: file.name,
        durationSeconds: round(probedDuration),
        maxDurationSeconds: ABSOLUTE_MAX_DURATION_SECONDS,
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

    state.sourceDurationSeconds = engine.originalBuffer.duration || state.sourceDurationSeconds || 0;
    syncPresetForCurrentContext();

    if (engine.originalBuffer.duration > ABSOLUTE_MAX_DURATION_SECONDS) {
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
    const presetAvailability = getPresetAvailability(state.preset);
    if (!presetAvailability.available) {
      setStatus(presetAvailability.message || "This preset is not available for the current clip.", "warning");
      updatePresetCards();
      return;
    }

    state.isEnhancing = true;
    updateActionState();
    clearDownload();
    startEnhanceProgress();
    setStatus("Enhancing voice locally in your browser...", "processing");
    info("enhancement requested", {
      preset: voiceApi.PRESETS[state.preset]?.label || "Fast Clean",
      fileName: state.activeFile?.name || engine.fileName,
    });

    try {
      applySettings({ silent: true, forceEngineSync: true });
      await engine.primeProcessedBuffer();
      state.hasEnhanced = true;
      state.needsEnhance = false;
      state.appliedPreset = state.preset;
      await switchMode("modified", { silentStatus: true });
      if (state.renderMeta?.fallbackReason) {
        completeEnhanceProgress(false);
        warn("fallback path used for this render", {
          reason: state.renderMeta.fallbackReason,
        });
        setStatus(state.renderMeta.fallbackReason, "warning");
      } else {
        completeEnhanceProgress(true);
        setStatus("Enhanced voice ready. Preview it, switch modes, or download it.", "success");
      }
    } catch (error) {
      state.hasEnhanced = false;
      state.needsEnhance = true;
      completeEnhanceProgress(false);
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
    const exportPresetKey = state.needsEnhance && state.hasEnhanced ? state.appliedPreset : state.preset;
    info("export started", {
      preset: voiceApi.PRESETS[exportPresetKey]?.label || "Fast Clean",
      hasEnhanced: state.hasEnhanced,
      needsEnhance: state.needsEnhance,
    });
    const result = await engine.exportProcessed({
      bufferTransform: appendBrandOutroForExport,
    });
    if (!result) {
      warn("export failed");
      return;
    }
    state.downloadUrl = URL.createObjectURL(result.blob);
    elements.downloadLink.href = state.downloadUrl;
    elements.downloadLink.download = result.fileName.replace("_processed", `_voice_studio_${exportPresetKey}`);
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
    if (result.exportMeta?.brandOutroAppended) {
      setStatus("Enhanced WAV with FreeAudioTrim outro ready. Download when it sounds right.", "success");
    } else if (result.exportMeta?.brandOutroError) {
      setStatus("Enhanced WAV ready. Branding outro could not be added in this browser.", "warning");
    } else if (state.renderMeta?.fallbackReason) {
      setStatus(state.renderMeta.fallbackReason, "warning");
    } else {
      setStatus("Enhanced WAV ready. Download when it sounds right.", "success");
    }
  }

  async function appendBrandOutroForExport(processedBuffer, ctx) {
    if (EXPORT_FLAGS.brandOutro === false) {
      return {
        buffer: processedBuffer,
        meta: {
          brandOutroAppended: false,
          brandOutroSkipped: true,
        },
      };
    }
    try {
      const outroBuffer = await getBrandOutroBuffer(ctx);
      const matchedOutro = await matchBufferSampleRate(outroBuffer, processedBuffer.sampleRate);
      const combined = appendBuffersWithCrossfade(ctx, processedBuffer, matchedOutro, BRAND_OUTRO_FADE_SECONDS);
      return {
        buffer: combined,
        meta: {
          brandOutroAppended: true,
          outroDuration: round(matchedOutro.duration),
        },
      };
    } catch (error) {
      warn("brand outro append failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        buffer: processedBuffer,
        meta: {
          brandOutroAppended: false,
          brandOutroError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  function getBrandOutroBuffer(ctx) {
    if (!brandOutroBufferPromise) {
      brandOutroBufferPromise = fetch(BRAND_OUTRO_URL)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Brand outro missing (${response.status}).`);
          }
          return response.arrayBuffer();
        })
        .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer.slice(0)));
    }
    return brandOutroBufferPromise;
  }

  async function matchBufferSampleRate(sourceBuffer, targetSampleRate) {
    if (!sourceBuffer || sourceBuffer.sampleRate === targetSampleRate) {
      return sourceBuffer;
    }
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) {
      throw new Error("OfflineAudioContext is not supported for outro resampling.");
    }
    const targetLength = Math.max(1, Math.ceil(sourceBuffer.duration * targetSampleRate));
    const offline = new OfflineCtx(sourceBuffer.numberOfChannels, targetLength, targetSampleRate);
    const source = offline.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offline.destination);
    source.start(0);
    return offline.startRendering();
  }

  function appendBuffersWithCrossfade(ctx, firstBuffer, secondBuffer, fadeSeconds = 0) {
    const channels = Math.max(firstBuffer.numberOfChannels, secondBuffer.numberOfChannels);
    const sampleRate = firstBuffer.sampleRate;
    const fadeFrames = Math.max(0, Math.min(
      Math.round((Number(fadeSeconds) || 0) * sampleRate),
      firstBuffer.length,
      secondBuffer.length
    ));
    const outputLength = firstBuffer.length + secondBuffer.length - fadeFrames;
    const output = ctx.createBuffer(channels, outputLength, sampleRate);
    const firstCopyLength = firstBuffer.length - fadeFrames;

    for (let channel = 0; channel < channels; channel += 1) {
      const out = output.getChannelData(channel);

      for (let i = 0; i < firstCopyLength; i += 1) {
        out[i] = readBufferSample(firstBuffer, channel, i);
      }

      for (let i = 0; i < fadeFrames; i += 1) {
        const mix = fadeFrames > 1 ? i / (fadeFrames - 1) : 1;
        const a = readBufferSample(firstBuffer, channel, firstCopyLength + i);
        const b = readBufferSample(secondBuffer, channel, i);
        out[firstCopyLength + i] = (a * (1 - mix)) + (b * mix);
      }

      for (let i = fadeFrames; i < secondBuffer.length; i += 1) {
        out[firstCopyLength + i] = readBufferSample(secondBuffer, channel, i);
      }
    }

    return output;
  }

  function readBufferSample(buffer, channel, index) {
    const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1);
    return buffer.getChannelData(sourceChannel)[index] || 0;
  }

  function updateRenderMeta() {
    const meta = state.renderMeta;
    if (!meta) {
      elements.metaNote.textContent = state.hasEnhanced && state.needsEnhance
        ? `Preview still reflects the last rendered preset. Click Re-Enhance to update it to ${voiceApi.PRESETS[state.preset]?.label || "the selected preset"}.`
        : "Preview the original, then click Enhance Voice to generate the enhanced version.";
      return;
    }
    if (meta.aiDenoiseActive) {
      const cleanupNote = meta.roomControlActive ? "Mild room control active." : "Mild room control bypassed.";
      const mixPercent = Math.round((Number(meta.denoiseMix) || 0) * 100);
      const modelName = meta.modelName || "AI noise reduction";
      const staleNote = state.needsEnhance && state.hasEnhanced
        ? ` Preview still reflects ${meta.presetLabel}. Click Re-Enhance to switch to ${voiceApi.PRESETS[state.preset]?.label || "the selected preset"}.`
        : "";
      elements.metaNote.textContent = `${modelName} active at ${mixPercent}% cleanup mix. ${cleanupNote} ${meta.presetLabel} preset targeting ${meta.targetLufsEstimate.toFixed(1)} LUFS estimate.${staleNote}`;
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
    const activePresetAvailability = getPresetAvailability(state.preset);

    elements.enhanceBtn.disabled = !hasFile || state.tooLong || busy || !activePresetAvailability.available;
    elements.previewBtn.disabled = !canUsePreview;
    elements.exportBtn.disabled = !canUseProcessed;
    elements.modeButtons.original.disabled = !canUsePreview;
    elements.modeButtons.modified.disabled = !canUseProcessed;
    if (elements.seekBar) {
      elements.seekBar.disabled = !canUsePreview;
    }
    elements.enhanceBtn.textContent = busy
      ? "Enhancing..."
      : hasFile && state.hasEnhanced
        ? "Re-Enhance"
        : "Enhance Voice";
    elements.exportBtn.textContent = state.downloadUrl ? "Download WAV" : "Export WAV";
  }

  function startEnhanceProgress() {
    stopEnhanceProgressTimer();
    state.enhanceProgress = 2;
    renderEnhanceProgress("Loading model");
    if (elements.progressShell) {
      elements.progressShell.hidden = false;
    }

    const presetKey = state.preset || DEFAULT_PRESET;
    const speed = presetKey === "creator" ? 2.4 : presetKey === "podcast" ? 1.8 : 1.25;

    state.enhanceProgressTimer = window.setInterval(() => {
      const remaining = 94 - state.enhanceProgress;
      if (remaining <= 0.2) {
        state.enhanceProgress = 94;
        renderEnhanceProgress(getEnhanceStageLabel(state.enhanceProgress));
        return;
      }

      const step = Math.max(0.22, remaining * 0.035 * speed);
      state.enhanceProgress = Math.min(94, state.enhanceProgress + step);
      renderEnhanceProgress(getEnhanceStageLabel(state.enhanceProgress));
    }, 140);
  }

  function completeEnhanceProgress(success) {
    stopEnhanceProgressTimer();
    if (!elements.progressShell) {
      return;
    }

    if (!success) {
      renderEnhanceProgress("Stopped");
      window.setTimeout(() => {
        resetEnhanceProgress();
      }, 450);
      return;
    }

    state.enhanceProgress = 100;
    renderEnhanceProgress("Finalizing output");
    window.setTimeout(() => {
      resetEnhanceProgress();
    }, 700);
  }

  function stopEnhanceProgressTimer() {
    if (state.enhanceProgressTimer) {
      window.clearInterval(state.enhanceProgressTimer);
      state.enhanceProgressTimer = 0;
    }
  }

  function resetEnhanceProgress() {
    stopEnhanceProgressTimer();
    state.enhanceProgress = 0;
    if (elements.progressShell) {
      elements.progressShell.hidden = true;
    }
    if (elements.progressFill) {
      elements.progressFill.style.width = "0%";
    }
    if (elements.progressPercent) {
      elements.progressPercent.textContent = "0%";
    }
    if (elements.progressStage) {
      elements.progressStage.textContent = "Preparing";
    }
  }

  function renderEnhanceProgress(stageLabel) {
    const value = Math.max(0, Math.min(100, Math.round(state.enhanceProgress)));
    if (elements.progressFill) {
      elements.progressFill.style.width = `${value}%`;
    }
    if (elements.progressPercent) {
      elements.progressPercent.textContent = `${value}%`;
    }
    if (elements.progressStage) {
      elements.progressStage.textContent = stageLabel;
    }
  }

  function getEnhanceStageLabel(progress) {
    if (progress < 16) {
      return "Loading model";
    }
    if (progress < 38) {
      return "Analyzing voice";
    }
    if (progress < 72) {
      return "Enhancing speech";
    }
    if (progress < 95) {
      return "Polishing output";
    }
    return "Finalizing output";
  }

  function updatePresetCards() {
    elements.presetCards.forEach((card) => {
      const presetKey = card.getAttribute("data-preset") || DEFAULT_PRESET;
      const availability = getPresetAvailability(presetKey);
      const badge = card.querySelector(".at-model-card__badge");
      card.setAttribute("data-selected", presetKey === state.preset ? "true" : "false");
      card.setAttribute("data-disabled", availability.available ? "false" : "true");
      card.setAttribute("aria-disabled", availability.available ? "false" : "true");
      card.title = availability.message || "";
      if (badge) {
        badge.textContent = availability.badge;
        badge.setAttribute("data-state", availability.available ? "ready" : "muted");
      }
    });
  }

  function updateTargetBadge() {
    const badgePresetKey = state.hasEnhanced && state.needsEnhance ? state.appliedPreset : state.preset;
    elements.targetBadge.textContent = `Preset ${voiceApi.PRESETS[badgePresetKey]?.label || "Fast Clean"}`;
  }

  function updateDeviceHint() {
    if (!elements.presetHint) {
      return;
    }
    const tierLabel = deviceProfile.label || "Balanced creator";
    const presetLabel = voiceApi.PRESETS[deviceProfile.recommendedPreset]?.label || "Balanced Clean";
    const maxLabel = voiceApi.PRESETS[deviceProfile.maxPresetKey]?.label || presetLabel;
    const tierCopy = tierLabel === "Studio creator"
      ? "Your device can handle the richest cleanup modes."
      : tierLabel === "Balanced creator"
        ? "This device looks best suited to balanced voice cleanup."
        : tierLabel === "Starter creator"
          ? "This device is better suited to lighter cleanup modes."
          : tierLabel === "High-end mobile"
            ? "This device can handle richer mobile voice cleanup."
            : tierLabel === "Balanced mobile"
              ? "This device looks best suited to balanced mobile cleanup."
              : "This device is better suited to lighter mobile cleanup.";
    const recommendationCopy = `${presetLabel} is recommended right now.`;
    const ceilingCopy = deviceProfile.maxPresetKey === "cinematic"
      ? "You can still try the other presets if you want."
      : `${maxLabel} is the highest preset recommended for this browser right now.`;
    const durationCopy = getDurationHintCopy();
    const benchmarkCopy = deviceProfile.benchmark
      ? " Performance check complete."
      : " Checking performance in the background.";
    elements.presetHint.textContent = `${tierCopy} ${recommendationCopy} ${ceilingCopy} ${durationCopy}${benchmarkCopy}`.trim();
  }

  async function scheduleDeviceBenchmark() {
    const cached = loadCachedBenchmarkProfile();
    if (cached?.profile) {
      deviceProfile = cached.profile;
      window.FreeAudioTrimVoiceStudioDeviceProfile = deviceProfile;
      syncPresetForCurrentContext();
      if (!state.userPresetLocked && !state.activeFile) {
        const cachedPreset = deviceProfile.recommendedPreset || DEFAULT_PRESET;
        if (cachedPreset !== state.preset) {
          state.preset = cachedPreset;
          updatePresetCards();
          updateTargetBadge();
        }
      }
      if (!cached.isFresh) {
        void runDeviceBenchmark({ backgroundRefresh: true });
      }
      return;
    }
    void runDeviceBenchmark({ backgroundRefresh: false });
  }

  async function runDeviceBenchmark(options = {}) {
    if (typeof voiceApi.benchmarkPreset !== "function") {
      return;
    }
    const runId = ++benchmarkRunId;
    try {
      const benchmarkResults = new Map();
      const benchmark = await withTimeout(voiceApi.benchmarkPreset(deviceProfile.recommendedPreset, {
        durationSeconds: deviceProfile.isMobile ? 0.45 : 0.7,
      }), BENCHMARK_TIMEOUT_MS, "Warmup benchmark timed out.");
      if (runId !== benchmarkRunId) {
        return;
      }
      benchmarkResults.set(benchmark.presetKey || deviceProfile.recommendedPreset, benchmark);
      let nextProfile = refineDeviceProfileFromBenchmark(deviceProfile, benchmark);

      if (nextProfile.maxPresetKey !== "creator" && !benchmarkResults.has("podcast")) {
        const podcastBenchmark = await withTimeout(voiceApi.benchmarkPreset("podcast", {
          durationSeconds: nextProfile.isMobile ? 0.45 : 0.7,
        }), BENCHMARK_TIMEOUT_MS, "Podcast benchmark timed out.");
        if (runId !== benchmarkRunId) {
          return;
        }
        benchmarkResults.set("podcast", podcastBenchmark);
        nextProfile = refineDeviceProfileFromBenchmark(nextProfile, podcastBenchmark);
      }

      if (shouldProbeCinematicBenchmark(nextProfile, benchmarkResults)) {
        const cinematicBenchmark = await withTimeout(voiceApi.benchmarkPreset("cinematic", {
          durationSeconds: nextProfile.isMobile ? 0.45 : 0.7,
        }), BENCHMARK_TIMEOUT_MS, "Studio benchmark timed out.");
        if (runId !== benchmarkRunId) {
          return;
        }
        benchmarkResults.set("cinematic", cinematicBenchmark);
        nextProfile = refineDeviceProfileFromBenchmark(nextProfile, cinematicBenchmark);
      }

      nextProfile = {
        ...nextProfile,
        benchmarkResults: Object.fromEntries(benchmarkResults),
      };

      deviceProfile = nextProfile;
      window.FreeAudioTrimVoiceStudioDeviceProfile = deviceProfile;
      saveCachedBenchmarkProfile(deviceProfile);
      syncPresetForCurrentContext();

      if (!state.userPresetLocked && !state.activeFile) {
        const nextPreset = deviceProfile.recommendedPreset || DEFAULT_PRESET;
        if (nextPreset !== state.preset) {
          state.preset = nextPreset;
          updatePresetCards();
          updateTargetBadge();
        }
      }
      info("device benchmark completed", {
        deviceProfile,
        backgroundRefresh: !!options.backgroundRefresh,
      });
    } catch (error) {
      if (runId !== benchmarkRunId) {
        return;
      }
      warn("device benchmark failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      deviceProfile = {
        ...deviceProfile,
        benchmarkError: error instanceof Error ? error.message : String(error),
      };
      window.FreeAudioTrimVoiceStudioDeviceProfile = deviceProfile;
      syncPresetForCurrentContext();
    }
  }

  function updateModeButtons() {
    const activeMode = state.currentMode || "modified";
    elements.modeButtons.original?.setAttribute("data-selected", activeMode === "original" ? "true" : "false");
    elements.modeButtons.modified?.setAttribute("data-selected", activeMode === "modified" ? "true" : "false");
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
    const keepEnhanced = state.hasEnhanced;
    state.needsEnhance = true;
    state.hasEnhanced = keepEnhanced;
    if (!keepEnhanced) {
      state.currentMode = "original";
      state.renderMeta = null;
      void engine.setMode("original");
    }
    updateRenderMeta();
    updateModeButtons();
    updateActionState();
    setStatus(message, "ready");
  }

  function canUsePreviewActions() {
    return !!engine.originalBuffer && !state.tooLong && !state.isEnhancing;
  }

  function canUseProcessedActions() {
    return !!engine.originalBuffer && !state.tooLong && !state.isEnhancing && state.hasEnhanced;
  }

  async function togglePreviewPlayback() {
    if (!canUsePreviewActions()) {
      return;
    }
    if (!state.hasEnhanced) {
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
              <span class="voice-preset-hint" data-role="presetHint"></span>
            </div>
            <div class="at-model-grid voice-preset-grid">
              ${renderPresetCards()}
            </div>
          </div>

          <div class="voice-primary-action">
            <button class="at-btn at-btn-primary voice-enhance-btn" id="enhanceBtn" type="button">Enhance Voice</button>
          </div>

          <div class="voice-section voice-section--status">
            <p class="voice-meta-note" data-role="renderMetaNote">Pick a preset, click Enhance Voice, then preview the result.</p>
          </div>

          <div class="at-row at-wave-wrap">
            <canvas id="waveformCanvas" class="at-wave" aria-label="Voice enhancement waveform preview"></canvas>
          </div>

          <div class="voice-badge-row">
            <button class="voice-preview-icon-btn" id="previewBtn" type="button" data-playing="false" aria-label="Play enhanced preview">
              <span class="voice-preview-icon" aria-hidden="true">
                <span class="voice-preview-icon__play"></span>
                <span class="voice-preview-icon__pause">
                  <span></span>
                  <span></span>
                </span>
              </span>
            </button>
            <span class="voice-inline-time" id="waveformTime">0:00 / 0:00</span>
            <span class="normalize-badge normalize-badge--ok" id="targetBadge">Preset Fast Clean</span>
            <div class="voice-mode-toggle voice-mode-toggle--switch" role="group" aria-label="Preview mode">
              <button class="voice-mode-btn" id="modeOriginalBtn" type="button" data-selected="false">Original</button>
              <button class="voice-mode-btn" id="modeEnhancedBtn" type="button" data-selected="true">Enhanced</button>
            </div>
          </div>

          <div class="voice-section voice-section--status">
            <div class="at-row at-status" id="status" data-status-state="idle">Upload a voice recording to start.</div>
            <div class="voice-progress-shell" id="statusProgress" hidden>
              <div class="voice-progress-head">
                <span class="voice-progress-stage" id="statusProgressStage">Preparing</span>
                <span class="voice-progress-percent" id="statusProgressPercent">0%</span>
              </div>
              <div class="voice-progress-track">
                <div class="voice-progress-fill" id="statusProgressFill"></div>
              </div>
            </div>
          </div>

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

  function describePreset(key) {
    if (key === "creator") {
      return "Quickest cleanup. Best for speed and lighter devices.";
    }
    if (key === "podcast") {
      return "Best balance of quality and speed for most voices.";
    }
    return "Highest quality cleanup. Slowest, richest finish.";
  }

  function findPresetKeyByLabel(label) {
    const target = String(label || "").trim().toLowerCase();
    if (!target) {
      return "";
    }
    return Object.values(voiceApi.PRESETS).find((preset) => preset.label.toLowerCase() === target)?.key || "";
  }

  function detectDeviceProfile() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const hardwareConcurrency = Math.max(1, Number(navigator.hardwareConcurrency) || 0);
    const deviceMemory = Math.max(0, Number(navigator.deviceMemory) || 0);
    const touchPoints = Math.max(0, Number(navigator.maxTouchPoints) || 0);
    const minViewport = Math.min(window.screen?.width || 0, window.screen?.height || 0);
    const isMobileUa = /android|iphone|ipod|mobile/i.test(ua);
    const isTabletUa = /ipad|tablet/i.test(ua);
    const isTouchMac = /Mac/.test(platform) && touchPoints > 1;
    const isMobile = isMobileUa || isTabletUa || isTouchMac || (touchPoints > 1 && minViewport > 0 && minViewport < 900);
    const hasSharedArrayBuffer = typeof window.SharedArrayBuffer === "function";
    const hasCrossOriginIsolation = !!window.crossOriginIsolated;
    const hasWebGpu = !!navigator.gpu;

    let tierKey = "balanced";
    let label = isMobile ? "Balanced mobile" : "Balanced creator";
    let recommendedPreset = "podcast";
    let maxPresetKey = "podcast";

    if (isMobile) {
      if ((deviceMemory > 0 && deviceMemory <= 6) || hardwareConcurrency <= 6) {
        tierKey = "low";
        label = "Minimum mobile";
        recommendedPreset = "creator";
        maxPresetKey = "creator";
      } else if ((deviceMemory >= 12 && hardwareConcurrency >= 8) || hasWebGpu) {
        tierKey = "pro";
        label = "High-end mobile";
        recommendedPreset = "podcast";
        maxPresetKey = "cinematic";
      }
    } else {
      if ((deviceMemory > 0 && deviceMemory <= 16) || hardwareConcurrency <= 6) {
        tierKey = "low";
        label = "Starter creator";
        recommendedPreset = "creator";
        maxPresetKey = "creator";
      } else if (
        ((deviceMemory >= 32 && hardwareConcurrency >= 12) || (deviceMemory >= 24 && hardwareConcurrency >= 10 && hasWebGpu))
        && hasSharedArrayBuffer
        && hasCrossOriginIsolation
      ) {
        tierKey = "pro";
        label = "Studio creator";
        recommendedPreset = "cinematic";
        maxPresetKey = "cinematic";
      }
    }

    if (!hasSharedArrayBuffer || !hasCrossOriginIsolation) {
      if (isMobile) {
        maxPresetKey = downgradePreset(maxPresetKey);
        recommendedPreset = downgradePreset(recommendedPreset);
      }
      if (tierKey === "pro") {
        tierKey = "balanced";
        label = isMobile ? "Balanced mobile" : "Balanced creator";
      }
    }

    return {
      tierKey,
      label,
      isMobile,
      hardwareConcurrency,
      deviceMemory,
      touchPoints,
      hasSharedArrayBuffer,
      hasCrossOriginIsolation,
      hasWebGpu,
      recommendedPreset,
      maxPresetKey,
      benchmarkCacheKey: createBenchmarkCacheKey({
        isMobile,
        hardwareConcurrency,
        deviceMemory,
        hasSharedArrayBuffer,
        hasCrossOriginIsolation,
        hasWebGpu,
      }),
    };
  }

  function createBenchmarkCacheKey(profile) {
    return [
      BENCHMARK_CACHE_VERSION,
      profile.isMobile ? "mobile" : "desktop",
      profile.hardwareConcurrency || 0,
      profile.deviceMemory || 0,
      profile.hasSharedArrayBuffer ? 1 : 0,
      profile.hasCrossOriginIsolation ? 1 : 0,
      profile.hasWebGpu ? 1 : 0,
    ].join(":");
  }

  function applyCachedDeviceProfile() {
    const cached = loadCachedBenchmarkProfile();
    if (!cached?.profile) {
      return;
    }
    deviceProfile = cached.profile;
    window.FreeAudioTrimVoiceStudioDeviceProfile = deviceProfile;
    if (!state.userPresetLocked && !state.activeFile) {
      state.preset = deviceProfile.recommendedPreset || state.preset;
    }
    syncPresetForCurrentContext();
  }

  function loadCachedBenchmarkProfile() {
    try {
      const raw = window.localStorage.getItem("fat_voice_studio_device_profile");
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== BENCHMARK_CACHE_VERSION) {
        return null;
      }
      if (parsed.cacheKey !== deviceProfile.benchmarkCacheKey) {
        return null;
      }
      if (!parsed.profile || typeof parsed.profile !== "object") {
        return null;
      }
      return {
        profile: parsed.profile,
        isFresh: (Date.now() - (Number(parsed.savedAt) || 0)) < BENCHMARK_CACHE_TTL_MS,
      };
    } catch (error) {
      warn("benchmark cache read failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  function saveCachedBenchmarkProfile(profile) {
    try {
      window.localStorage.setItem("fat_voice_studio_device_profile", JSON.stringify({
        version: BENCHMARK_CACHE_VERSION,
        cacheKey: profile.benchmarkCacheKey,
        savedAt: Date.now(),
        profile,
      }));
    } catch (error) {
      warn("benchmark cache write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function withTimeout(promise, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, Math.max(250, timeoutMs));
      Promise.resolve(promise)
        .then((value) => {
          window.clearTimeout(timerId);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timerId);
          reject(error);
        });
    });
  }

  function refineDeviceProfileFromBenchmark(profile, benchmark) {
    const next = {
      ...profile,
      benchmark,
    };
    const speed = Number(benchmark?.msPerSecond) || 0;
    const testedPreset = benchmark?.presetKey || profile.recommendedPreset;

    if (testedPreset === "creator") {
      if (speed > BENCHMARK_SPEED_LIMITS.creatorDemoteMsPerSecond) {
        next.tierKey = "low";
        next.label = profile.isMobile ? "Minimum mobile" : "Starter creator";
        next.recommendedPreset = "creator";
        next.maxPresetKey = "creator";
        return next;
      }
      if (speed < BENCHMARK_SPEED_LIMITS.creatorPromotePodcastMsPerSecond && profile.maxPresetKey !== "creator") {
        next.tierKey = next.tierKey === "low" ? "balanced" : next.tierKey;
        next.label = profile.isMobile ? "Balanced mobile" : "Balanced creator";
        next.recommendedPreset = "podcast";
        next.maxPresetKey = PRESET_ORDER[Math.max(
          PRESET_ORDER.indexOf(next.maxPresetKey),
          PRESET_ORDER.indexOf("podcast")
        )] || next.maxPresetKey;
      }
      return next;
    }

    if (testedPreset === "podcast") {
      if (speed > BENCHMARK_SPEED_LIMITS.podcastDemoteMsPerSecond) {
        next.tierKey = "balanced";
        next.label = profile.isMobile ? "Balanced mobile" : "Balanced creator";
        next.recommendedPreset = "creator";
        next.maxPresetKey = "podcast";
        return next;
      }
      next.recommendedPreset = "podcast";
      next.maxPresetKey = PRESET_ORDER[Math.max(
        PRESET_ORDER.indexOf(next.maxPresetKey),
        PRESET_ORDER.indexOf("podcast")
      )] || next.maxPresetKey;
      return next;
    }

    if (testedPreset === "cinematic") {
      if (speed > BENCHMARK_SPEED_LIMITS.cinematicPromoteMsPerSecond) {
        next.tierKey = next.tierKey === "low" ? "balanced" : next.tierKey;
        next.label = profile.isMobile ? "Balanced mobile" : "Balanced creator";
        next.recommendedPreset = next.recommendedPreset === "creator" ? "podcast" : next.recommendedPreset;
        next.maxPresetKey = PRESET_ORDER[Math.max(
          PRESET_ORDER.indexOf(next.maxPresetKey),
          PRESET_ORDER.indexOf("podcast")
        )] || "podcast";
        return next;
      }
      next.tierKey = "pro";
      next.label = profile.isMobile ? "High-end mobile" : "Studio creator";
      next.recommendedPreset = "cinematic";
      next.maxPresetKey = "cinematic";
      return next;
    }

    return next;
  }

  function shouldProbeCinematicBenchmark(profile, benchmarkResults) {
    if (benchmarkResults.has("cinematic") || profile.tierKey === "low") {
      return false;
    }
    if (PRESET_ORDER.indexOf(profile.maxPresetKey || "creator") < PRESET_ORDER.indexOf("podcast")) {
      return false;
    }
    const podcastSpeed = Number(benchmarkResults.get("podcast")?.msPerSecond) || 0;
    const creatorSpeed = Number(benchmarkResults.get("creator")?.msPerSecond) || 0;
    if (PRESET_ORDER.indexOf(profile.maxPresetKey || "creator") >= PRESET_ORDER.indexOf("cinematic")) {
      return true;
    }
    if (podcastSpeed > 0 && podcastSpeed <= BENCHMARK_SPEED_LIMITS.cinematicProbeFromPodcastMsPerSecond) {
      return true;
    }
    if (!profile.isMobile && creatorSpeed > 0 && creatorSpeed <= BENCHMARK_SPEED_LIMITS.creatorPromotePodcastMsPerSecond) {
      return true;
    }
    return false;
  }

  function getAbsoluteMaxDurationSeconds() {
    return Object.values(voiceApi?.PRESETS || {}).reduce((maxSeconds, preset) => {
      return Math.max(maxSeconds, Number(preset?.maxDurationSeconds) || 0);
    }, 10 * 60);
  }

  function getPresetDurationLimitSeconds(presetKey) {
    return Math.max(0, Number(voiceApi.PRESETS?.[presetKey]?.maxDurationSeconds) || 0);
  }

  function getDurationMaxPresetKey(durationSeconds) {
    const seconds = Number(durationSeconds) || 0;
    if (seconds > getPresetDurationLimitSeconds("podcast")) {
      return "creator";
    }
    if (seconds > getPresetDurationLimitSeconds("cinematic")) {
      return "podcast";
    }
    return "cinematic";
  }

  function getDurationRestrictionMessage(presetKey) {
    return PRESET_DURATION_MESSAGES[presetKey] || `${voiceApi.PRESETS[presetKey]?.label || "That preset"} is not available for this clip length.`;
  }

  function getPresetAvailability(presetKey) {
    const key = PRESET_ORDER.includes(presetKey) ? presetKey : DEFAULT_PRESET;
    const durationLimit = getPresetDurationLimitSeconds(key);
    const durationSeconds = Number(state.sourceDurationSeconds) || 0;
    const durationBlocked = durationSeconds > 0 && durationLimit > 0 && durationSeconds > durationLimit;
    const deviceMaxPreset = PRESET_ORDER.includes(deviceProfile?.maxPresetKey) ? deviceProfile.maxPresetKey : "cinematic";
    const deviceBlocked = PRESET_ORDER.indexOf(key) > PRESET_ORDER.indexOf(deviceMaxPreset);

    if (durationBlocked) {
      return {
        available: false,
        reason: "duration",
        badge: "Clip too long",
        message: getDurationRestrictionMessage(key),
      };
    }

    if (deviceBlocked && canTryPresetBeforeBenchmark(key, deviceProfile)) {
      return {
        available: true,
        reason: "benchmark-pending",
        badge: "Checking speed",
        message: "",
      };
    }

    if (deviceBlocked) {
      return {
        available: false,
        reason: "device",
        badge: "Device limited",
        message: `${voiceApi.PRESETS[key]?.label || "That preset"} is too heavy for this device right now.`,
      };
    }

    return {
      available: true,
      reason: "",
      badge: "Preset",
      message: "",
    };
  }

  function canTryPresetBeforeBenchmark(presetKey, profile) {
    if (presetKey !== "cinematic") {
      return false;
    }
    if (!profile || profile.isMobile || profile.tierKey === "low") {
      return false;
    }
    if (profile.benchmark || profile.benchmarkResults || profile.benchmarkError) {
      return false;
    }
    const hasStrongDesktopHints =
      ((Number(profile.deviceMemory) || 0) >= 24 && (Number(profile.hardwareConcurrency) || 0) >= 8)
      || !!profile.hasWebGpu;
    return hasStrongDesktopHints;
  }

  function getDurationHintCopy() {
    const durationSeconds = Number(state.sourceDurationSeconds) || 0;
    if (!durationSeconds) {
      return "Fast Clean supports up to 10 minutes, Balanced Clean up to 3 minutes, and Studio Clean up to 90 seconds.";
    }
    if (durationSeconds > getPresetDurationLimitSeconds("podcast")) {
      return "This clip length keeps Fast Clean available and disables Balanced Clean and Studio Clean.";
    }
    if (durationSeconds > getPresetDurationLimitSeconds("cinematic")) {
      return "This clip length keeps Fast Clean and Balanced Clean available and disables Studio Clean.";
    }
    return "This clip length can use all presets, subject to device capability.";
  }

  function capPresetForCurrentContext(presetKey, profile, durationSeconds) {
    const safePreset = capPresetForDevice(presetKey, profile);
    const durationMaxPreset = getDurationMaxPresetKey(durationSeconds);
    return PRESET_ORDER[Math.min(PRESET_ORDER.indexOf(safePreset), PRESET_ORDER.indexOf(durationMaxPreset))] || safePreset;
  }

  function syncPresetForCurrentContext() {
    const nextPreset = capPresetForCurrentContext(state.preset, deviceProfile, state.sourceDurationSeconds);
    if (nextPreset !== state.preset) {
      state.preset = nextPreset;
    }
    if (state.appliedPreset && !getPresetAvailability(state.appliedPreset).available) {
      state.appliedPreset = nextPreset;
    }
    updatePresetCards();
    updateTargetBadge();
    updateDeviceHint();
    updateActionState();
  }

  function capPresetForDevice(presetKey, profile) {
    const safePreset = PRESET_ORDER.includes(presetKey) ? presetKey : (profile?.recommendedPreset || DEFAULT_PRESET);
    const maxPreset = PRESET_ORDER.includes(profile?.maxPresetKey) ? profile.maxPresetKey : "cinematic";
    return PRESET_ORDER[Math.min(PRESET_ORDER.indexOf(safePreset), PRESET_ORDER.indexOf(maxPreset))] || safePreset;
  }

  function downgradePreset(presetKey) {
    const index = PRESET_ORDER.indexOf(presetKey);
    if (index <= 0) {
      return "creator";
    }
    return PRESET_ORDER[index - 1];
  }

  window.VoiceStudioTool = {
    addFile(file) {
      return loadSelectedFile(file);
    },
    reset() {
      info("tool reset requested");
      state.preset = deviceProfile.recommendedPreset || DEFAULT_PRESET;
      state.renderMeta = null;
      state.analysisProfile = null;
      state.tooLong = false;
      state.sourceDurationSeconds = 0;
      state.hasEnhanced = false;
      state.needsEnhance = true;
      state.isEnhancing = false;
      state.currentMode = "modified";
      state.activeFile = null;
      state.userPresetLocked = false;
      clearDownload();
      resetEnhanceProgress();
      engine.reset();
      elements.fileRow.classList.add("is-hidden");
      elements.fileName.textContent = "";
      updateRenderMeta();
      updatePresetCards();
      updateTargetBadge();
      updateDeviceHint();
      updateModeButtons();
      setStatus("Upload a voice recording to start.", "idle");
      updateActionState();
    },
    getDeviceProfile() {
      return { ...deviceProfile };
    },
  };

  window.FreeAudioTrimVoiceStudioDeviceProfile = deviceProfile;

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
