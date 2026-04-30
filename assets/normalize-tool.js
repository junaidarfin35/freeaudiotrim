(() => {
  "use strict";

  const MAX_FILE_SIZE = 200 * 1024 * 1024;
  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";
  const DB_FLOOR = -48;
  const LUFS_OFFSET = -0.691;
  const PAGE_INPUT_ID = "audioFileInput";

  const modePresets = {
    auto: { label: "Auto Fix (Recommended)", targetLufs: -14, truePeak: -1 },
    youtube: { label: "YouTube", targetLufs: -14, truePeak: -1 },
    spotify: { label: "Spotify", targetLufs: -14, truePeak: -1 },
    podcast: { label: "Podcast", targetLufs: -16, truePeak: -1 },
    voice: { label: "Voice", targetLufs: -16, truePeak: -1 },
    music: { label: "Music", targetLufs: -14, truePeak: -1 },
    loudness: { label: "Custom Loudness", targetLufs: -14, truePeak: -1 }
  };

  const root = document.getElementById("normalize-tool");
  if (!root) {
    return;
  }

  root.innerHTML = buildMarkup();

  const elements = {
    fileRow: root.querySelector('[data-role="fileRow"]'),
    fileName: root.querySelector('[data-role="fileName"]'),
    fileIcon: root.querySelector('[data-role="fileIcon"]'),
    changeFileBtn: root.querySelector('[data-role="changeFile"]'),
    durationBadge: root.querySelector('[data-role="durationBadge"]'),
    peakBadge: root.querySelector('[data-role="peakBadge"]'),
    lufsBadge: root.querySelector('[data-role="lufsBadge"]'),
    targetBadge: root.querySelector('[data-role="targetBadge"]'),
    mode: root.querySelector("[data-mode]"),
    targetLufs: root.querySelector("[data-target-lufs]"),
    truePeak: root.querySelector("[data-true-peak]"),
    format: root.querySelector("[data-format]"),
    advancedToggle: root.querySelector('[data-role="advancedToggle"]'),
    advancedPanel: root.querySelector('[data-role="advancedPanel"]'),
    advancedSummary: root.querySelector('[data-role="advancedSummary"]'),
    processBtn: root.querySelector("[data-process]"),
    downloadBtn: root.querySelector("[data-download]"),
    status: root.querySelector("[data-status]")
  };

  const state = {
    ctx: null,
    current: null,
    isProcessing: false
  };

  wireEvents();
  applyModePreset("auto", { silent: true });
  updateActionState();
  updateAdvancedSummary();
  setStatus("Upload one audio file to normalize.", "idle");

  function wireEvents() {
    elements.changeFileBtn.addEventListener("click", () => {
      document.getElementById(PAGE_INPUT_ID)?.click();
    });

    elements.mode.addEventListener("change", () => {
      applyModePreset(elements.mode.value);
    });

    [elements.targetLufs, elements.truePeak, elements.format].forEach((input) => {
      input.addEventListener("input", handleSettingsChange);
      input.addEventListener("change", handleSettingsChange);
    });

    elements.advancedToggle.addEventListener("click", () => {
      const shouldShow = elements.advancedPanel.classList.contains("is-hidden");
      elements.advancedPanel.classList.toggle("is-hidden", !shouldShow);
      elements.advancedToggle.textContent = shouldShow ? "Hide advanced settings" : "Advanced settings";
    });

    elements.processBtn.addEventListener("click", () => {
      void processCurrent();
    });

    elements.downloadBtn.addEventListener("click", downloadCurrent);
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    const file = files[0];
    const validationError = validateFile(file);
    if (validationError) {
      setStatus(`${file.name}: ${validationError}`, "error");
      return;
    }

    setStatus(`Analyzing ${file.name}...`, "processing");

    try {
      releaseCurrentOutput();

      const arrayBuffer = await file.arrayBuffer();
      const decoded = await getContext().decodeAudioData(arrayBuffer.slice(0));
      const analysis = analyzeBuffer(decoded);

      state.current = {
        id: `f_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file,
        audioBuffer: decoded,
        duration: decoded.duration,
        analysis,
        output: null
      };

      renderCurrentFile();
      updateActionState();

      if (files.length > 1) {
        setStatus("Only first selected file used. Analysis complete.", "warning");
      } else {
        setStatus("Analysis complete. Pick mode or process audio.", "ready");
      }
    } catch (error) {
      console.error(error);
      setStatus(`${file.name}: This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`, "error");
    }
  }

  function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      return "exceeds 200MB limit.";
    }
    return "";
  }

  function renderCurrentFile() {
    const current = state.current;
    if (!current) {
      elements.fileRow.classList.add("is-hidden");
      elements.fileName.textContent = "";
      updateAnalysisBadges(null);
      return;
    }

    elements.fileRow.classList.remove("is-hidden");
    elements.fileName.textContent = current.file.name;
    updateFileIcon(current.file);
    updateAnalysisBadges(current.analysis);
    updateAdvancedSummary();
  }

  function updateFileIcon(file) {
    const ext = getExtension(file.name);
    const icon = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "amr"].includes(ext)
      ? "music"
      : "audio-waveform";

    elements.fileIcon.setAttribute("data-lucide", icon);
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function applyModePreset(mode, options = {}) {
    const preset = modePresets[mode] || modePresets.auto;
    elements.mode.value = mode;
    elements.targetLufs.value = String(preset.targetLufs);
    elements.truePeak.value = String(preset.truePeak);
    updateAdvancedSummary();

    if (!options.silent && state.current) {
      clearProcessedOutput();
      updateAnalysisBadges(state.current.analysis);
      setStatus(`${preset.label} selected. Process audio to apply it.`, "warning");
    }
  }

  function handleSettingsChange() {
    updateAdvancedSummary();
    if (!state.current) {
      return;
    }
    clearProcessedOutput();
    updateAnalysisBadges(state.current.analysis);
    setStatus("Settings changed. Process audio again to update download.", "warning");
  }

  function updateAdvancedSummary() {
    const modeLabel = modePresets[elements.mode.value]?.label || "Auto Fix";
    const summary = `${modeLabel} / ${elements.targetLufs.value || "-14"} LUFS / ${elements.truePeak.value || "-1"} dBTP / ${elements.format.value.toUpperCase()}`;
    elements.targetBadge.textContent = `Target ${elements.targetLufs.value || "-14"} LUFS`;
    elements.advancedSummary.textContent = summary;
  }

  function updateAnalysisBadges(analysis) {
    const current = state.current;
    elements.durationBadge.textContent = current ? `Duration ${formatDuration(current.duration)}` : "Duration -";
    elements.peakBadge.textContent = analysis ? `Peak ${formatDb(analysis.peakDb)} dBFS` : "Peak -";
    elements.lufsBadge.textContent = analysis ? `Current ${formatDb(analysis.lufs)} LUFS` : "Current LUFS -";
  }

  function clearProcessedOutput() {
    releaseCurrentOutput();
    if (state.current) {
      state.current.output = null;
    }
    updateActionState();
  }

  function releaseCurrentOutput() {
    if (state.current?.output?.url) {
      URL.revokeObjectURL(state.current.output.url);
    }
  }

  async function processCurrent() {
    if (!state.current || state.isProcessing) {
      return;
    }

    state.isProcessing = true;
    updateActionState();

    try {
      const modeConfig = resolveModeConfig();
      const format = elements.format.value;
      setStatus(`Processing ${state.current.file.name}...`, "processing");

      const gainDb = computeGainDb(state.current.analysis, modeConfig);
      const normalized = applyGainToBuffer(state.current.audioBuffer, gainDb);
      const outAnalysis = analyzeBuffer(normalized);
      const outputBlob = format === "mp3" ? encodeMp3(normalized) : encodeWav(normalized);

      releaseCurrentOutput();
      state.current.output = {
        blob: outputBlob,
        url: URL.createObjectURL(outputBlob),
        format,
        gainDb,
        analysis: outAnalysis,
        fileName: `${stripExtension(state.current.file.name)}-normalized.${format}`
      };

      updateAnalysisBadges(outAnalysis);
      updateActionState();
      setStatus(`Normalized audio ready. Download ${format.toUpperCase()} file.`, "success");
    } catch (error) {
      console.error(error);
      setStatus(`Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    } finally {
      state.isProcessing = false;
      updateActionState();
    }
  }

  function downloadCurrent() {
    if (!state.current?.output?.url) {
      return;
    }
    triggerDownload(state.current.output.url, state.current.output.fileName);
  }

  function updateActionState() {
    const hasFile = !!state.current;
    const hasOutput = !!state.current?.output?.url;

    elements.processBtn.disabled = !hasFile || state.isProcessing;
    elements.downloadBtn.disabled = !hasOutput || state.isProcessing;
    elements.processBtn.classList.toggle("is-hidden", hasOutput);
    elements.downloadBtn.classList.toggle("is-hidden", !hasOutput);
    elements.downloadBtn.textContent = `Download ${elements.format.value.toUpperCase()}`;
  }

  function resolveModeConfig() {
    const mode = elements.mode.value;
    const preset = modePresets[mode] || modePresets.auto;
    return {
      mode,
      targetLufs: Number(elements.targetLufs.value || preset.targetLufs),
      truePeak: Number(elements.truePeak.value || preset.truePeak)
    };
  }

  function computeGainDb(analysis, modeConfig) {
    const currentPeak = analysis.peakDb;
    const currentLufs = analysis.lufs;
    const lufsGain = Number(modeConfig.targetLufs) - currentLufs;
    const peakSafeGain = Number(modeConfig.truePeak) - currentPeak;
    return Math.min(lufsGain, peakSafeGain);
  }

  function applyGainToBuffer(audioBuffer, gainDb) {
    const gain = Math.pow(10, gainDb / 20);
    const output = new AudioBuffer({
      length: audioBuffer.length,
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate
    });

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
      const input = audioBuffer.getChannelData(ch);
      const target = output.getChannelData(ch);
      for (let i = 0; i < input.length; i += 1) {
        target[i] = clamp(input[i] * gain, -1, 1);
      }
    }

    return output;
  }

  function analyzeBuffer(audioBuffer) {
    let peak = 0;
    let sumSquares = 0;
    const channelCount = audioBuffer.numberOfChannels;
    const sampleCount = audioBuffer.length;

    for (let ch = 0; ch < channelCount; ch += 1) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i += 1) {
        const value = Math.abs(data[i]);
        if (value > peak) {
          peak = value;
        }
        sumSquares += data[i] * data[i];
      }
    }

    const meanSquare = sumSquares / Math.max(1, sampleCount * channelCount);
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : DB_FLOOR;
    const lufs = meanSquare > 0 ? LUFS_OFFSET + 10 * Math.log10(meanSquare) : DB_FLOOR;

    return { peak, peakDb, lufs };
  }

  function getContext() {
    if (!state.ctx) {
      state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return state.ctx;
  }

  function encodeWav(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const frames = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const out = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    let offset = 0;

    const writeString = (text) => {
      for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
      offset += text.length;
    };

    writeString("RIFF");
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString("WAVE");
    writeString("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, channels, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, sampleRate * blockAlign, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeString("data");
    view.setUint32(offset, dataSize, true);
    offset += 4;

    const channelData = [];
    for (let ch = 0; ch < channels; ch += 1) {
      channelData.push(audioBuffer.getChannelData(ch));
    }

    for (let i = 0; i < frames; i += 1) {
      for (let ch = 0; ch < channels; ch += 1) {
        const sample = clamp(channelData[ch][i], -1, 1);
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }

    return new Blob([out], { type: "audio/wav" });
  }

  function encodeMp3(audioBuffer) {
    if (!window.lamejs || typeof window.lamejs.Mp3Encoder !== "function") {
      throw new Error("MP3 encoder unavailable (lamejs not loaded).");
    }

    const channels = Math.min(audioBuffer.numberOfChannels, 2);
    const sampleRate = audioBuffer.sampleRate;
    const left = float32ToInt16(audioBuffer.getChannelData(0));
    const right = channels > 1 ? float32ToInt16(audioBuffer.getChannelData(1)) : null;
    const encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, 192);
    const blockSize = 1152;
    const output = [];

    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      const encoded = channels > 1 && right
        ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
        : encoder.encodeBuffer(leftChunk);
      if (encoded.length > 0) {
        output.push(new Uint8Array(encoded));
      }
    }

    const flushed = encoder.flush();
    if (flushed.length > 0) {
      output.push(new Uint8Array(flushed));
    }

    return new Blob(output, { type: "audio/mpeg" });
  }

  function float32ToInt16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const value = clamp(samples[i], -1, 1);
      out[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
    }
    return out;
  }

  function triggerDownload(url, fileName) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function setStatus(message, stateName = "idle") {
    elements.status.textContent = message;
    elements.status.dataset.statusState = stateName;
  }

  function stripExtension(name) {
    return name.replace(/\.[^./\\]+$/, "");
  }

  function getExtension(name) {
    const match = /\.([^.]+)$/.exec(name || "");
    return match ? match[1].toLowerCase() : "";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "00:00";
    }
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatDb(value) {
    if (!Number.isFinite(value)) {
      return "-inf";
    }
    return value.toFixed(1);
  }

  function buildMarkup() {
    return `
      <div class="normalize-app at-root">
        <div class="tool-card">
          <div class="at-file-row is-hidden" data-role="fileRow">
            <div class="at-file-info">
              <i data-lucide="music" data-role="fileIcon"></i>
              <span class="at-file-name" data-role="fileName"></span>
            </div>
            <button type="button" class="at-btn at-btn-soft" data-role="changeFile">Change</button>
          </div>

          <div class="at-row" data-role="fileMeta">
            <span class="normalize-badge" data-role="durationBadge">Duration -</span>
            <span class="normalize-badge" data-role="peakBadge">Peak -</span>
            <span class="normalize-badge" data-role="lufsBadge">Current LUFS -</span>
            <span class="normalize-badge normalize-badge--ok" data-role="targetBadge">Target -</span>
          </div>

          <div class="at-row normalize-section-label">
            <label class="at-label" for="normalizeModeSelect">Normalize mode</label>
            <select id="normalizeModeSelect" data-mode>
              <option value="auto">Auto Fix (Recommended)</option>
              <option value="youtube">YouTube</option>
              <option value="spotify">Spotify</option>
              <option value="podcast">Podcast</option>
              <option value="voice">Voice</option>
              <option value="music">Music</option>
              <option value="loudness">Custom Loudness</option>
            </select>
          </div>

          <div class="at-row">
            <div class="at-status" data-status></div>
          </div>

          <div class="at-row normalize-summary-row">
            <p class="normalize-muted" data-role="advancedSummary"></p>
          </div>

          <div class="at-row normalize-primary-row">
            <button type="button" class="at-btn at-btn-primary" data-process>Process audio</button>
            <button type="button" class="at-btn at-btn-primary is-hidden" data-download>Download MP3</button>
          </div>

          <div class="at-row normalize-toggle-row">
            <button type="button" class="at-btn at-btn-soft" data-role="advancedToggle">Advanced settings</button>
          </div>

          <div class="at-row is-hidden" data-role="advancedPanel">
            <div class="normalize-grid">
              <div class="normalize-tip">
                Tip: -14 LUFS fit YouTube, Spotify, music. -16 LUFS fit voice, podcasts. Keep true peak near -1 dBTP. Use WAV for best quality, MP3 for smaller files.
              </div>
              <label>
                Target LUFS
                <input data-target-lufs type="number" step="0.1" value="-14">
              </label>
              <label>
                True Peak Limit (dBTP)
                <input data-true-peak type="number" step="0.1" value="-1">
              </label>
              <label>
                Output Format
                <select data-format>
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  window.NormalizeTool = {
    addFile(files) {
      void addFiles(files);
    },
    reset() {
      releaseCurrentOutput();
      state.current = null;
      renderCurrentFile();
      updateActionState();
      setStatus("Upload one audio file to normalize.", "idle");
    }
  };
})();
