(() => {
  "use strict";

  const MAX_FILES = 10;
  const MAX_FILE_SIZE = 200 * 1024 * 1024;
  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";
  const DB_FLOOR = -48;
  const LUFS_OFFSET = -0.691;

  const modePresets = {
    youtube: { targetLufs: -14, truePeak: -1 },
    spotify: { targetLufs: -14, truePeak: -1 },
    podcast: { targetLufs: -16, truePeak: -1 },
    broadcast: { targetLufs: -24, truePeak: -2 }
  };
  const normalizeForPresets = {
    youtube: { targetLufs: -14, truePeak: -1 },
    spotify: { targetLufs: -14, truePeak: -1 },
    podcast: { targetLufs: -16, truePeak: -1 },
    voice: { targetLufs: -16, truePeak: -1 },
    music: { targetLufs: -14, truePeak: -1 }
  };

  const root = document.getElementById("normalize-tool");
  if (!root) {
    return;
  }

  injectStyles();
  root.innerHTML = buildMarkup();

  const elements = {
    dropzone: root.querySelector("[data-dropzone]"),
    input: root.querySelector("[data-input]"),
    uploadMode: root.querySelector("[data-upload-mode]"),
    queueBody: root.querySelector("[data-queue-body]"),
    warnings: root.querySelector("[data-warnings]"),
    emptyState: root.querySelector("[data-empty]"),
    waveform: root.querySelector("[data-waveform]"),
    waveformWrap: root.querySelector("[data-waveform-wrap]"),
    seek: root.querySelector("[data-seek]"),
    playBtn: root.querySelector("[data-play]"),
    pauseBtn: root.querySelector("[data-pause]"),
    stopBtn: root.querySelector("[data-stop]"),
    timeLabel: root.querySelector("[data-time]"),
    meterFill: root.querySelector("[data-meter-fill]"),
    meterValue: root.querySelector("[data-meter-value]"),
    mode: root.querySelector("[data-mode]"),
    targetPeak: root.querySelector("[data-target-peak]"),
    targetLufs: root.querySelector("[data-target-lufs]"),
    truePeak: root.querySelector("[data-true-peak]"),
    peakField: root.querySelector("[data-field-peak]"),
    loudnessFields: root.querySelector("[data-field-loudness]"),
    strategy: root.querySelector("[data-strategy]"),
    format: root.querySelector("[data-format]"),
    processBtn: root.querySelector("[data-process]"),
    downloadZipBtn: root.querySelector("[data-download-zip]"),
    status: root.querySelector("[data-status]")
  };
  const presetButtons = root.querySelectorAll("[data-preset]");

  const state = {
    ctx: null,
    analyser: null,
    source: null,
    rafId: 0,
    queue: [],
    selectedId: null,
    isPlaying: false,
    startedAt: 0,
    pauseOffset: 0,
    waveformCache: new Map(),
    analyserConnected: false,
    uploadMode: "single"
  };

  wireEvents();
  renderQueue();
  updateUploadModeUI();
  setStatus("Ready. Drop up to 10 files to start.");
  updateModeFields();

  function wireEvents() {
    elements.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.input.click();
      }
    });
    elements.dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragover");
    });
    elements.dropzone.addEventListener("dragleave", () => {
      elements.dropzone.classList.remove("is-dragover");
    });
    elements.dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("is-dragover");
      void addFiles(event.dataTransfer?.files || []);
    });

    const fileInput = elements.input;
    const handleFiles = async () => {
      await addFiles(fileInput.files || []);
      fileInput.value = "";
    };
    fileInput.addEventListener("change", handleFiles);

    elements.uploadMode.addEventListener("change", () => {
      state.uploadMode = elements.uploadMode.value;
      updateUploadModeUI();
    });

    presetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.preset || "";
        const values = normalizeForPresets[preset];
        if (!values) {
          return;
        }
        elements.targetLufs.value = String(values.targetLufs);
        elements.truePeak.value = String(values.truePeak);
      });
    });

    elements.queueBody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const row = target.closest("[data-id]");
      if (!row) {
        return;
      }
      const id = row.getAttribute("data-id");
      if (!id) {
        return;
      }

      if (target.matches("[data-remove]")) {
        removeFile(id);
        return;
      }
      if (target.matches("[data-download]")) {
        void downloadOne(id);
        return;
      }

      selectFile(id);
    });

    elements.playBtn.addEventListener("click", () => {
      void playSelected();
    });
    elements.pauseBtn.addEventListener("click", pausePlayback);
    elements.stopBtn.addEventListener("click", stopPlayback);

    elements.seek.addEventListener("input", () => {
      const file = getSelected();
      if (!file) {
        return;
      }
      const nextTime = Number(elements.seek.value) * file.duration;
      seekTo(nextTime);
    });

    elements.mode.addEventListener("change", () => {
      applyPresetIfNeeded();
      updateModeFields();
    });

    elements.processBtn.addEventListener("click", () => {
      void processQueue();
    });
    elements.downloadZipBtn.addEventListener("click", () => {
      void downloadZip();
    });

    const resizeObserver = new ResizeObserver(() => {
      drawWaveform(getSelected(), getCurrentPlaybackTime());
    });
    resizeObserver.observe(elements.waveformWrap);
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    const warnings = [];
    if (state.uploadMode === "single") {
      const file = files[0];
      const validationError = validateFile(file);
      if (validationError) {
        renderWarnings([`${file.name}: ${validationError}`]);
        return;
      }
      if (files.length > 1) {
        warnings.push("Single File mode only uses the first selected file.");
      }
      try {
        setStatus(`Analyzing ${file.name}...`);
        const arrayBuffer = await file.arrayBuffer();
        const ctx = getContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const analysis = analyzeBuffer(decoded);
        const id = `f_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        state.queue = [{
          id,
          file,
          arrayBuffer,
          audioBuffer: decoded,
          duration: decoded.duration,
          analysis,
          output: null
        }];
        state.selectedId = id;
        state.pauseOffset = 0;
        stopPlayback();
      } catch (error) {
        console.error(error);
        warnings.push(`${file.name}: This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`);
      }
      renderWarnings(warnings);
      renderQueue();
      drawWaveform(getSelected(), getCurrentPlaybackTime());
      setStatus("Analysis complete.");
      return;
    }

    const availableSlots = MAX_FILES - state.queue.length;
    if (availableSlots <= 0) {
      warnings.push(`Queue already full (${MAX_FILES} files max).`);
      renderWarnings(warnings);
      return;
    }

    const accepted = files.slice(0, availableSlots);
    if (files.length > accepted.length) {
      warnings.push(`Only the first ${availableSlots} file(s) were accepted.`);
    }

    for (const file of accepted) {
      const validationError = validateFile(file);
      if (validationError) {
        warnings.push(`${file.name}: ${validationError}`);
        continue;
      }
      try {
        setStatus(`Analyzing ${file.name}...`);
        const arrayBuffer = await file.arrayBuffer();
        const ctx = getContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const analysis = analyzeBuffer(decoded);

        state.queue.push({
          id: `f_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          file,
          arrayBuffer,
          audioBuffer: decoded,
          duration: decoded.duration,
          analysis,
          output: null
        });
      } catch (error) {
        console.error(error);
        warnings.push(`${file.name}: This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`);
      }
    }

    if (state.queue.length && !state.selectedId) {
      state.selectedId = state.queue[0].id;
    }

    renderWarnings(warnings);
    renderQueue();
    drawWaveform(getSelected(), getCurrentPlaybackTime());
    setStatus("Analysis complete.");
  }

  function validateFile(file) {
    if (file.size > MAX_FILE_SIZE) {
      return "exceeds 200MB limit.";
    }
    return "";
  }

  function renderWarnings(messages) {
    elements.warnings.innerHTML = "";
    if (!messages.length) {
      return;
    }
    for (const message of messages) {
      const p = document.createElement("p");
      p.className = "normalize-warning";
      p.textContent = message;
      elements.warnings.appendChild(p);
    }
  }

  function renderQueue() {
    const hasRows = state.queue.length > 0;
    elements.emptyState.hidden = hasRows;
    elements.downloadZipBtn.disabled = !state.queue.some((item) => !!item.output);
    elements.processBtn.disabled = !hasRows;
    elements.processBtn.textContent = state.uploadMode === "batch" ? "Process Queue" : "Process File";

    if (!hasRows) {
      elements.queueBody.innerHTML = "";
      stopPlayback();
      state.selectedId = null;
      drawWaveform(null, 0);
      return;
    }

    const rows = state.queue
      .map((item) => {
        const selected = item.id === state.selectedId;
        const outputBadge = item.output
          ? `<span class="normalize-badge normalize-badge--ok">${item.output.format.toUpperCase()} ready</span>`
          : `<span class="normalize-badge">not processed</span>`;

        return `
          <tr data-id="${escapeHtml(item.id)}" class="${selected ? "is-selected" : ""}">
            <td title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</td>
            <td>${formatDuration(item.duration)}</td>
            <td>${formatDb(item.analysis.peakDb)} dBFS</td>
            <td>${formatDb(item.analysis.lufs)} LUFS</td>
            <td>
              ${outputBadge}
              <button type="button" class="normalize-btn normalize-btn--tiny" data-download ${item.output ? "" : "disabled"}>Download</button>
              <button type="button" class="normalize-btn normalize-btn--tiny normalize-btn--ghost" data-remove>Remove</button>
            </td>
          </tr>
        `;
      })
      .join("");
    elements.queueBody.innerHTML = rows;

    const selected = getSelected();
    if (selected) {
      elements.seek.value = "0";
      updateTimeLabel(state.pauseOffset, selected.duration);
      drawWaveform(selected, getCurrentPlaybackTime());
    }
  }

  function selectFile(id) {
    if (!state.queue.some((item) => item.id === id)) {
      return;
    }
    if (state.selectedId !== id) {
      stopPlayback();
      state.selectedId = id;
      state.pauseOffset = 0;
      elements.seek.value = "0";
      renderQueue();
    }
  }

  function removeFile(id) {
    const selectedWasRemoved = state.selectedId === id;
    state.queue = state.queue.filter((item) => item.id !== id);
    for (const key of state.waveformCache.keys()) {
      if (key.startsWith(`${id}:`)) {
        state.waveformCache.delete(key);
      }
    }
    if (selectedWasRemoved) {
      stopPlayback();
      state.selectedId = state.queue[0]?.id || null;
    }
    renderQueue();
  }

  async function playSelected() {
    const selected = getSelected();
    if (!selected) {
      setStatus("Select a file to preview.");
      return;
    }

    const ctx = getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    startSource(selected.audioBuffer, state.pauseOffset);
  }

  function startSource(audioBuffer, offsetSeconds) {
    stopSourceOnly();
    const ctx = getContext();
    if (!state.analyser) {
      state.analyser = ctx.createAnalyser();
      state.analyser.fftSize = 2048;
    }
    if (!state.analyserConnected) {
      state.analyser.connect(ctx.destination);
      state.analyserConnected = true;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.analyser);
    source.start(0, Math.max(0, offsetSeconds));
    source.onended = () => {
      if (!state.isPlaying) {
        return;
      }
      const selected = getSelected();
      const current = getCurrentPlaybackTime();
      if (selected && current >= selected.duration - 0.02) {
        stopPlayback();
      }
    };

    state.source = source;
    state.startedAt = ctx.currentTime - offsetSeconds;
    state.isPlaying = true;
    syncLoop();
  }

  function pausePlayback() {
    if (!state.isPlaying) {
      return;
    }
    state.pauseOffset = getCurrentPlaybackTime();
    state.isPlaying = false;
    stopSourceOnly();
    syncLoop();
  }

  function stopPlayback() {
    state.isPlaying = false;
    state.pauseOffset = 0;
    stopSourceOnly();
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    elements.meterFill.style.height = "0%";
    elements.meterFill.style.background = "transparent";
    elements.meterValue.textContent = "-\u221E dB";

    const selected = getSelected();
    if (selected) {
      updateTimeLabel(0, selected.duration);
      elements.seek.value = "0";
      drawWaveform(selected, 0);
    } else {
      updateTimeLabel(0, 0);
      drawWaveform(null, 0);
    }
  }

  function stopSourceOnly() {
    if (!state.source) {
      return;
    }
    try {
      state.source.onended = null;
      state.source.stop();
    } catch (error) {
      // Ignore stop race.
    }
    state.source.disconnect();
    state.source = null;
  }

  function seekTo(timeSeconds) {
    const selected = getSelected();
    if (!selected) {
      return;
    }
    const clamped = clamp(timeSeconds, 0, selected.duration || 0);
    state.pauseOffset = clamped;

    if (state.isPlaying) {
      startSource(selected.audioBuffer, clamped);
    } else {
      drawWaveform(selected, clamped);
      updateTimeLabel(clamped, selected.duration);
    }
  }

  function syncLoop() {
    cancelAnimationFrame(state.rafId);
    const tick = () => {
      const selected = getSelected();
      if (!selected) {
        return;
      }

      const playback = getCurrentPlaybackTime();
      const duration = selected.duration || 0;
      const ratio = duration > 0 ? clamp(playback / duration, 0, 1) : 0;

      elements.seek.value = String(ratio);
      updateTimeLabel(playback, duration);
      drawWaveform(selected, playback);
      updateMeter();

      if (state.isPlaying) {
        state.rafId = requestAnimationFrame(tick);
      }
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function updateMeter() {
    if (!state.analyser || !state.isPlaying) {
      elements.meterFill.style.height = "0%";
      elements.meterFill.style.background = "transparent";
      elements.meterValue.textContent = "-\u221E dB";
      return;
    }

    const sampleCount = state.analyser.fftSize;
    const data = new Float32Array(sampleCount);
    state.analyser.getFloatTimeDomainData(data);

    let sumSquares = 0;
    for (let i = 0; i < data.length; i += 1) {
      sumSquares += data[i] * data[i];
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, data.length));
    const db = rms > 0 ? 20 * Math.log10(rms) : DB_FLOOR;
    const clampedDb = clamp(db, DB_FLOOR, 0);
    const heightRatio = (clampedDb - DB_FLOOR) / Math.abs(DB_FLOOR);

    if (heightRatio <= 0.001) {
      elements.meterFill.style.height = "0%";
      elements.meterFill.style.background = "transparent";
    } else {
      elements.meterFill.style.height = `${heightRatio * 100}%`;
      elements.meterFill.style.background = clampedDb > -3 ? "#dc2626" : clampedDb > -9 ? "#eab308" : "#16a34a";
    }
    elements.meterValue.textContent = `${formatDb(clampedDb)} dB`;
  }

  function applyPresetIfNeeded() {
    const mode = elements.mode.value;
    const preset = modePresets[mode];
    if (!preset) {
      return;
    }
    elements.targetLufs.value = String(preset.targetLufs);
    elements.truePeak.value = String(preset.truePeak);
    elements.targetPeak.value = String(preset.truePeak);
  }

  function updateModeFields() {
    const mode = elements.mode.value;
    const isPeak = mode === "peak";
    elements.peakField.hidden = !isPeak;
    elements.loudnessFields.hidden = isPeak;
  }

  function updateUploadModeUI() {
    const isBatch = state.uploadMode === "batch";
    elements.input.multiple = isBatch;
    const warnings = elements.warnings;
    if (warnings) {
      warnings.innerHTML = isBatch
        ? '<p class="normalize-muted">Batch mode is enabled. You can add up to 10 files.</p>'
        : '<p class="normalize-muted">Single mode is enabled. Add one file at a time.</p>';
    }
    renderQueue();
  }

  async function processQueue() {
    if (!state.queue.length) {
      setStatus("Upload at least one file first.");
      return;
    }

    elements.processBtn.disabled = true;
    elements.downloadZipBtn.disabled = true;
    stopPlayback();

    try {
      const modeConfig = resolveModeConfig();
      const strategy = elements.strategy.value;
      const format = elements.format.value;

      let sharedTargetLufs = modeConfig.targetLufs;
      if (strategy === "match") {
        if (Number.isFinite(sharedTargetLufs)) {
          // keep resolved mode target
        } else {
          const lufsValues = state.queue.map((item) => item.analysis.lufs).filter(Number.isFinite);
          sharedTargetLufs = lufsValues.length
            ? lufsValues.reduce((acc, value) => acc + value, 0) / lufsValues.length
            : -14;
        }
      }

      for (let index = 0; index < state.queue.length; index += 1) {
        const item = state.queue[index];
        setStatus(`Processing file ${index + 1} of ${state.queue.length}: ${item.file.name}`);

        const gainDb = computeGainDb(item.analysis, modeConfig, strategy, sharedTargetLufs);
        const normalized = applyGainToBuffer(item.audioBuffer, gainDb);
        const outAnalysis = analyzeBuffer(normalized);

        const outputBlob =
          format === "mp3"
            ? encodeMp3(normalized)
            : encodeWav(normalized);

        if (item.output?.url) {
          URL.revokeObjectURL(item.output.url);
        }
        item.output = {
          blob: outputBlob,
          url: URL.createObjectURL(outputBlob),
          format,
          gainDb,
          analysis: outAnalysis,
          fileName: `${stripExtension(item.file.name)}-normalized.${format}`
        };

        renderQueue();
      }

      setStatus("Processing complete. Download individual files or a ZIP archive.");
    } catch (error) {
      console.error(error);
      setStatus(`Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      elements.processBtn.disabled = false;
      elements.downloadZipBtn.disabled = !state.queue.some((item) => !!item.output);
    }
  }

  async function downloadOne(id) {
    const item = state.queue.find((entry) => entry.id === id);
    if (!item?.output) {
      return;
    }
    triggerDownload(item.output.url, item.output.fileName);
  }

  async function downloadZip() {
    const processed = state.queue.filter((item) => !!item.output);
    if (!processed.length) {
      setStatus("Nothing to zip yet. Process files first.");
      return;
    }

    setStatus("Building ZIP archive...");
    try {
      const files = await Promise.all(
        processed.map(async (item) => {
          const output = item.output;
          return {
            name: output.fileName,
            bytes: new Uint8Array(await output.blob.arrayBuffer())
          };
        })
      );
      const zipBlob = createZip(files);
      const zipUrl = URL.createObjectURL(zipBlob);
      triggerDownload(zipUrl, "normalized-audio-files.zip");
      setTimeout(() => URL.revokeObjectURL(zipUrl), 2000);
      setStatus("ZIP ready.");
    } catch (error) {
      console.error(error);
      setStatus("Failed to build ZIP archive.");
    }
  }

  function resolveModeConfig() {
    const mode = elements.mode.value;
    if (mode === "auto") {
      return { mode, targetLufs: -14, truePeak: -1, peak: -1 };
    }
    if (mode === "peak") {
      return {
        mode,
        peak: Number(elements.targetPeak.value),
        targetLufs: NaN,
        truePeak: Number(elements.targetPeak.value)
      };
    }
    if (mode === "loudness") {
      return {
        mode,
        peak: Number(elements.truePeak.value),
        targetLufs: Number(elements.targetLufs.value),
        truePeak: Number(elements.truePeak.value)
      };
    }
    if (modePresets[mode]) {
      return {
        mode,
        peak: modePresets[mode].truePeak,
        targetLufs: modePresets[mode].targetLufs,
        truePeak: modePresets[mode].truePeak
      };
    }
    return { mode: "auto", targetLufs: -14, truePeak: -1, peak: -1 };
  }

  function computeGainDb(analysis, modeConfig, strategy, sharedTargetLufs) {
    const currentPeak = analysis.peakDb;
    const currentLufs = analysis.lufs;

    if (modeConfig.mode === "peak") {
      if (strategy === "match") {
        const peakSafeGain = Number(modeConfig.peak) - currentPeak;
        const lufsGain = sharedTargetLufs - currentLufs;
        return Math.min(lufsGain, peakSafeGain);
      }
      return Number(modeConfig.peak) - currentPeak;
    }

    const targetLufs = strategy === "match" ? sharedTargetLufs : Number(modeConfig.targetLufs);
    const lufsGain = targetLufs - currentLufs;
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

  function drawWaveform(file, playheadTime) {
    const canvas = elements.waveform;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const rect = elements.waveformWrap.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = 220;
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    if (!file) {
      ctx.fillStyle = "#64748b";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Upload and select a file to preview waveform", width / 2, height / 2);
      return;
    }

    const waveform = getWaveformData(file, width);
    const mid = height / 2;
    const drawHeight = height - 42;

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < waveform.length; x += 1) {
      const value = waveform[x];
      const yTop = mid - value * (drawHeight / 2);
      const yBottom = mid + value * (drawHeight / 2);
      ctx.moveTo(x + 0.5, yTop);
      ctx.lineTo(x + 0.5, yBottom);
    }
    ctx.stroke();

    drawTimeline(ctx, width, height, file.duration);

    const progress = file.duration > 0 ? clamp(playheadTime / file.duration, 0, 1) : 0;
    const playheadX = progress * width;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }

  function getWaveformData(file, width) {
    const key = `${file.id}:${width}`;
    const cached = state.waveformCache.get(key);
    if (cached) {
      return cached;
    }

    const channels = [];
    for (let ch = 0; ch < file.audioBuffer.numberOfChannels; ch += 1) {
      channels.push(file.audioBuffer.getChannelData(ch));
    }

    const bucketSize = Math.max(1, Math.floor(file.audioBuffer.length / width));
    const waveform = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const start = x * bucketSize;
      const end = Math.min(file.audioBuffer.length, start + bucketSize);
      let peak = 0;
      for (let i = start; i < end; i += 1) {
        for (let ch = 0; ch < channels.length; ch += 1) {
          const value = Math.abs(channels[ch][i]);
          if (value > peak) {
            peak = value;
          }
        }
      }
      waveform[x] = peak;
    }

    state.waveformCache.set(key, waveform);
    return waveform;
  }

  function drawTimeline(ctx, width, height, duration) {
    if (!duration || !Number.isFinite(duration)) {
      return;
    }
    ctx.fillStyle = "#334155";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const steps = 8;
    for (let i = 0; i <= steps; i += 1) {
      const x = (i / steps) * width;
      const time = (i / steps) * duration;
      ctx.fillText(formatDuration(time), x, height - 16);
    }
  }

  function updateTimeLabel(current, duration) {
    elements.timeLabel.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
  }

  function getCurrentPlaybackTime() {
    if (!state.isPlaying) {
      return state.pauseOffset;
    }
    const ctx = getContext();
    const selected = getSelected();
    if (!selected) {
      return 0;
    }
    const t = ctx.currentTime - state.startedAt;
    return clamp(t, 0, selected.duration);
  }

  function getSelected() {
    if (!state.selectedId) {
      return null;
    }
    return state.queue.find((item) => item.id === state.selectedId) || null;
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
    const right =
      channels > 1
        ? float32ToInt16(audioBuffer.getChannelData(1))
        : null;
    const encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, 192);
    const blockSize = 1152;
    const output = [];

    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      let encoded;
      if (channels > 1 && right) {
        const rightChunk = right.subarray(i, i + blockSize);
        encoded = encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        encoded = encoder.encodeBuffer(leftChunk);
      }
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

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const encoder = new TextEncoder();

    const now = new Date();
    const { dosDate, dosTime } = toDosDateTime(now);

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.bytes;
      const crc = crc32(data);
      const size = data.length;

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dosTime, true);
      localView.setUint16(12, dosDate, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, size, true);
      localView.setUint32(22, size, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dosTime, true);
      centralView.setUint16(14, dosDate, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, size, true);
      centralView.setUint32(24, size, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      localOffset += localHeader.length + data.length;
    }

    const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j += 1) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function toDosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);

    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    return { dosDate, dosTime };
  }

  function triggerDownload(url, fileName) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function setStatus(message) {
    elements.status.textContent = message;
    const text = String(message || "").toLowerCase();
    elements.status.dataset.statusState =
      /error|failed|unknown error/.test(text) ? "error" :
      /complete|download|ready/.test(text) ? "success" :
      /processing|analyzing|building zip|build zip/.test(text) ? "processing" :
      "idle";
  }

  function stripExtension(name) {
    return name.replace(/\.[^./\\]+$/, "");
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
      return "-\u221E";
    }
    return value.toFixed(1);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildMarkup() {
    return `
      <div class="normalize-app">
        <section class="normalize-card">
          <label class="normalize-upload-mode">
            Upload Mode
              <select data-upload-mode>
                <option value="single" selected>Single File</option>
                <option value="batch">Batch Processing</option>
              </select>
            </label>
            <label class="upload-dropzone" data-dropzone tabindex="0" role="button" aria-label="Upload audio files">
              <input data-input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/x-ms-wma,audio/ogg,audio/m4r,audio/3gpp,audio/opus,audio/m4a,audio/x-m4a,audio/aac,audio/amr,audio/flac,audio/x-flac,audio/aiff,audio/x-aiff,audio/ape,audio/x-ape" multiple hidden>
              <div class="upload-dropzone__content">
                <div class="upload-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V7"/><path d="m8.5 10.5 3.5-3.5 3.5 3.5"/><path d="M20 16.5a4.5 4.5 0 0 0-1.5-8.74A6 6 0 0 0 7 8.5 4 4 0 0 0 4.2 16"/><path d="M8 20h8"/></svg></div>
                <strong class="upload-dropzone__primary">Drop audio file here or click to upload</strong>
                <span class="upload-dropzone__secondary">MP3, WAV, M4A, AAC, FLAC, OGG</span>
                <small class="upload-dropzone__meta">Max file size: 200MB</small>
                <small class="upload-dropzone__privacy">Files processed locally in your browser</small>
              </div>
            </label>
            <div data-warnings></div>
        </section>

        <section class="normalize-card">
          <h3>File Queue</h3>
          <div class="normalize-table-wrap">
            <table class="normalize-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Duration</th>
                  <th>Peak Level</th>
                  <th>LUFS</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody data-queue-body></tbody>
            </table>
            <p data-empty class="normalize-muted">No files loaded yet.</p>
          </div>
        </section>

        <section class="normalize-card">
          <h3>Waveform Preview</h3>
          <div class="normalize-waveform-row">
            <div class="normalize-waveform-wrap" data-waveform-wrap>
              <canvas data-waveform aria-label="Waveform preview"></canvas>
            </div>
            <div class="normalize-meter normalize-meter--inline">
              <div class="normalize-meter-scale">
                <span>0</span>
                <span>-6</span>
                <span>-12</span>
                <span>-18</span>
                <span>-24</span>
                <span>-30</span>
                <span>-36</span>
                <span>-48</span>
              </div>
              <div class="normalize-meter-track">
                <div class="normalize-meter-fill" data-meter-fill></div>
              </div>
            </div>
          </div>
          <div class="normalize-meter-db" data-meter-value>-&#8734; dB</div>
          <input data-seek type="range" min="0" max="1" step="0.001" value="0" aria-label="Seek timeline">
          <div class="normalize-controls">
            <button type="button" class="normalize-btn" data-play>Play</button>
            <button type="button" class="normalize-btn normalize-btn--ghost" data-pause>Pause</button>
            <button type="button" class="normalize-btn normalize-btn--ghost" data-stop>Stop</button>
            <span class="normalize-time" data-time>00:00 / 00:00</span>
          </div>
        </section>

        <section class="normalize-card preset-panel">
          <label>Normalize For</label>
          <div class="preset-buttons">
            <button type="button" data-preset="youtube">YouTube</button>
            <button type="button" data-preset="spotify">Spotify</button>
            <button type="button" data-preset="podcast">Podcast</button>
            <button type="button" data-preset="voice">Voice</button>
            <button type="button" data-preset="music">Music</button>
          </div>
        </section>

        <section class="normalize-card">
          <h3>Normalization Settings</h3>
          <div class="normalize-grid">
            <label>
              Mode
              <select data-mode>
                <option value="auto">Auto Fix (Recommended)</option>
                <option value="peak">Peak Normalization</option>
                <option value="loudness">Loudness Normalization</option>
                <option value="youtube">YouTube</option>
                <option value="spotify">Spotify</option>
                <option value="podcast">Podcast</option>
                <option value="broadcast">Broadcast</option>
              </select>
            </label>
            <label data-field-peak>
              Target Peak (dBFS)
              <input data-target-peak type="number" step="0.1" value="-1">
            </label>
            <div data-field-loudness class="normalize-grid normalize-grid--nested">
              <label>
                Target LUFS
                <input data-target-lufs type="number" step="0.1" value="-14">
              </label>
              <label>
                True Peak Limit (dBTP)
                <input data-true-peak type="number" step="0.1" value="-1">
              </label>
            </div>
            <label>
              Normalization Strategy
              <select data-strategy>
                <option value="independent">Independent</option>
                <option value="match">Match Loudness</option>
              </select>
            </label>
            <label>
              Output Format
              <select data-format>
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
              </select>
            </label>
          </div>
          <div class="normalize-actions">
            <button type="button" class="normalize-btn" data-process>Process Queue</button>
            <button type="button" class="normalize-btn normalize-btn--ghost" data-download-zip disabled>Download ZIP</button>
            <span class="normalize-status" data-status></span>
          </div>
        </section>
      </div>
    `;
  }

  function injectStyles() {
    if (document.getElementById("normalize-tool-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "normalize-tool-styles";
    style.textContent = `
      .normalize-app {
        display: grid;
        gap: 1rem;
      }
      .normalize-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 1.25rem;
        box-shadow: var(--color-shadow);
      }
      .normalize-card h3 {
        margin: 0 0 0.75rem;
        font-size: 1.05rem;
      }
      .normalize-warning {
        margin: 0.5rem 0 0;
        color: #b91c1c;
        font-size: 0.92rem;
      }
      .preset-panel{
        margin-bottom:14px;
      }
      .preset-panel > label{
        display:block;
        margin-bottom:8px;
        color:var(--color-text-muted);
        font-size:0.9rem;
        font-weight:600;
      }
      .preset-buttons{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      }
      .preset-buttons button{
        min-height: 2.5rem;
        padding: 0.55rem 0.85rem;
        font-size:0.86rem;
      }
      .normalize-upload-mode {
        display: inline-grid;
        gap: 0.35rem;
        margin-bottom: 0.75rem;
        font-size: 0.9rem;
        color: var(--color-text-muted);
      }
      .normalize-upload-mode select {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 0.4rem 0.5rem;
        font-size: 0.9rem;
        background: var(--color-surface-muted);
      }
      .normalize-table-wrap {
        overflow-x: auto;
      }
      .normalize-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.94rem;
      }
      .normalize-table th,
      .normalize-table td {
        border-bottom: 1px solid #e2e8f0;
        text-align: left;
        padding: 0.55rem 0.5rem;
        vertical-align: middle;
      }
      .normalize-table th {
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--color-text-muted);
      }
      .normalize-table tr.is-selected {
        background: var(--color-primary-soft);
      }
      .normalize-muted {
        color: var(--color-text-muted);
        margin: 0.5rem 0 0;
      }
      .normalize-badge {
        font-size: 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 0.2rem 0.45rem;
        margin-right: 0.35rem;
        display: inline-block;
        background: var(--color-surface-muted);
      }
      .normalize-badge--ok {
        border-color: #16a34a;
        color: #166534;
        background: #f0fdf4;
      }
      .normalize-waveform-wrap {
        flex: 1;
        width: 100%;
        min-width: 0;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: var(--color-surface-muted);
      }
      .normalize-waveform-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 56px;
        gap: 0.5rem;
        align-items: stretch;
      }
      .normalize-waveform-wrap canvas {
        display: block;
        width: 100%;
        height: 220px;
      }
      .normalize-controls {
        margin-top: 0.7rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .normalize-time {
        margin-left: auto;
        font-family: "JetBrains Mono", monospace;
        color: var(--color-text-muted);
        font-size: 0.9rem;
      }
      .normalize-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .normalize-btn--tiny {
        padding: 0.2rem 0.45rem;
        font-size: 0.78rem;
        min-height: 2rem;
      }
      .normalize-meter {
        display: grid;
        grid-template-columns: auto 20px;
        align-items: end;
        gap: 0.35rem;
      }
      .normalize-meter--inline {
        width: 56px;
        flex: 0 0 56px;
        margin-left: 0;
      }
      .normalize-meter-scale {
        height: 220px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        font-family: "JetBrains Mono", monospace;
        font-size: 10px;
        line-height: 1;
        color: var(--color-text-muted);
      }
      .normalize-meter-track {
        width: 20px;
        height: 220px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        overflow: hidden;
        background: var(--color-border);
        position: relative;
      }
      .normalize-meter-fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 0%;
        background: transparent;
        transition: height 0.06s linear;
      }
      .normalize-meter-db {
        font-family: "JetBrains Mono", monospace;
        font-size: 0.8rem;
        color: var(--color-text);
        margin-top: 0.45rem;
      }
      .normalize-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.75rem;
      }
      .normalize-grid label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.88rem;
        color: var(--color-text-muted);
      }
      .normalize-grid select,
      .normalize-grid input {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 0.7rem 0.8rem;
        font-size: 0.9rem;
        background: var(--color-surface-muted);
      }
      .normalize-grid--nested {
        grid-column: 1 / -1;
      }
      .normalize-actions {
        margin-top: 0.85rem;
        display: grid;
        gap: 0.5rem;
        padding: 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface-muted);
      }
      .normalize-actions .normalize-btn {
        justify-self: start;
      }
      .normalize-status {
        width: 100%;
      }
      @media (max-width: 700px) {
        .normalize-waveform-row {
          grid-template-columns: 1fr;
        }
        .normalize-meter--inline {
          width: 100%;
          flex: 0 0 auto;
          grid-template-columns: auto 1fr;
          margin-left: 0;
        }
        .normalize-meter-track {
          width: 100%;
          height: 40px;
        }
        .normalize-meter-scale {
          height: 40px;
          flex-direction: row;
          align-items: center;
        }
        .normalize-time {
          margin-left: 0;
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();
