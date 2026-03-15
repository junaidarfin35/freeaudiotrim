(() => {
  "use strict";

  const fileInput = document.getElementById("fileInput");
  const uploadDropzone = document.getElementById("uploadDropzone");
  const speedRange = document.getElementById("speedRange");
  const speedValue = document.getElementById("speedValue");
  const previewBtn = document.getElementById("previewBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const exportBtn = document.getElementById("exportBtn");
  const downloadLink = document.getElementById("downloadLink");
  const status = document.getElementById("status");
  const originalDuration = document.getElementById("originalDuration");
  const newDuration = document.getElementById("newDuration");
  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";
  function setStatus(message) {
    status.textContent = message;
    const text = String(message || "").toLowerCase();
    status.dataset.statusState =
      /error|failed|not supported/.test(text) ? "error" :
      /ready|previewing|download/.test(text) ? "success" :
      /decoding|rendering|export/.test(text) ? "processing" :
      "idle";
  }

  let audioContext = null;
  let audioBuffer = null;
  let currentFileName = "audio";
  let sourceNode = null;
  let startedAt = 0;
  let pausedOffset = 0;
  let isPlaying = false;
  let downloadUrl = "";

  if (!fileInput || !uploadDropzone || !speedRange) {
    return;
  }

  bindEvents();
  updateSpeedLabels();

  function bindEvents() {
    uploadDropzone.addEventListener("click", () => fileInput.click());

    uploadDropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });

    uploadDropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadDropzone.classList.add("is-dragover");
    });

    uploadDropzone.addEventListener("dragleave", () => {
      uploadDropzone.classList.remove("is-dragover");
    });

    uploadDropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      uploadDropzone.classList.remove("is-dragover");
      const files = event.dataTransfer ? event.dataTransfer.files : null;
      if (files && files[0]) {
        void loadFile(files[0]);
      }
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        void loadFile(file);
      }
      fileInput.value = "";
    });

    speedRange.addEventListener("input", () => {
      if (isPlaying && sourceNode && audioBuffer) {
        pausedOffset = clamp(getPlaybackTime(), 0, audioBuffer.duration);
        startSource(pausedOffset);
      }
      updateSpeedLabels();
    });

    previewBtn.addEventListener("click", () => void previewAudio());
    pauseBtn.addEventListener("click", pauseAudio);
    stopBtn.addEventListener("click", stopAudio);
    exportBtn.addEventListener("click", () => void exportModified());
  }

  async function loadFile(file) {
    try {
      stopAudio();
      clearDownload();
      setStatus("Decoding audio...");
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await getContext().decodeAudioData(arrayBuffer.slice(0));
      audioBuffer = decoded;
      currentFileName = stripExtension(file.name || "audio");
      pausedOffset = 0;
      updateDurations();
      setStatus("File ready. Preview at selected speed, then export.");
    } catch (error) {
      console.error(error);
      setStatus(`This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`);
    }
  }

  async function previewAudio() {
    if (!audioBuffer) {
      setStatus("Upload an audio file first.");
      return;
    }

    const ctx = getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    startSource(pausedOffset);
    setStatus(`Previewing at ${getSpeed().toFixed(2)}x`);
  }

  function startSource(offsetSeconds) {
    stopSourceOnly();

    const ctx = getContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.setValueAtTime(getSpeed(), ctx.currentTime);
    source.connect(ctx.destination);
    source.start(0, Math.max(0, offsetSeconds));

    source.onended = () => {
      if (!isPlaying) {
        return;
      }
      const played = getPlaybackTime();
      if (audioBuffer && played >= audioBuffer.duration - 0.02) {
        stopAudio();
      }
    };

    sourceNode = source;
    pausedOffset = offsetSeconds;
    startedAt = ctx.currentTime - offsetSeconds / getSpeed();
    isPlaying = true;
  }

  function pauseAudio() {
    if (!isPlaying || !audioBuffer) {
      return;
    }

    pausedOffset = clamp(getPlaybackTime(), 0, audioBuffer.duration);
    isPlaying = false;
    stopSourceOnly();
    setStatus("Preview paused.");
  }

  function stopAudio() {
    isPlaying = false;
    pausedOffset = 0;
    stopSourceOnly();
  }

  function stopSourceOnly() {
    if (!sourceNode) {
      return;
    }

    try {
      sourceNode.onended = null;
      sourceNode.stop();
    } catch (error) {
      // Ignore race with ended state.
    }

    sourceNode.disconnect();
    sourceNode = null;
  }

  async function exportModified() {
    if (!audioBuffer) {
      setStatus("Upload an audio file first.");
      return;
    }

    try {
      setStatus("Rendering modified audio...");
      clearDownload();

      const speed = getSpeed();
      const targetFrames = Math.max(1, Math.ceil(audioBuffer.length / speed));
      const offline = new OfflineAudioContext(audioBuffer.numberOfChannels, targetFrames, audioBuffer.sampleRate);
      const source = offline.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.setValueAtTime(speed, 0);
      source.connect(offline.destination);
      source.start(0);

      const rendered = await offline.startRendering();
      const wavBlob = encodeWav(rendered);
      downloadUrl = URL.createObjectURL(wavBlob);

      downloadLink.href = downloadUrl;
      downloadLink.download = `${currentFileName}_${speed.toFixed(2)}x.wav`;
      downloadLink.style.display = "inline-block";

      setStatus("Export ready. Click Download.");
    } catch (error) {
      console.error(error);
      setStatus("Export failed. Try a smaller file or a different browser.");
    }
  }

  function encodeWav(buffer) {
    const channels = Math.min(buffer.numberOfChannels, 2);
    const sampleRate = buffer.sampleRate;
    const frames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;

    const out = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    let offset = 0;

    const writeString = (value) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
      offset += value.length;
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
      channelData.push(buffer.getChannelData(ch));
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

  function getContext() {
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        throw new Error("Web Audio API is not supported in this browser.");
      }
      audioContext = new Ctx();
    }
    return audioContext;
  }

  function getSpeed() {
    return Number(speedRange.value) || 1;
  }

  function getPlaybackTime() {
    if (!isPlaying || !audioBuffer) {
      return pausedOffset;
    }
    const elapsed = getContext().currentTime - startedAt;
    const activeRate = sourceNode ? sourceNode.playbackRate.value : getSpeed();
    return pausedOffset + elapsed * activeRate;
  }

  function updateSpeedLabels() {
    const speed = getSpeed();
    speedValue.textContent = `${speed.toFixed(2)}x`;
    updateDurations();
  }

  function updateDurations() {
    if (!audioBuffer) {
      originalDuration.textContent = "Original Duration: -";
      newDuration.textContent = "Estimated New Duration: -";
      return;
    }

    const speed = getSpeed();
    const original = audioBuffer.duration;
    const adjusted = original / speed;

    originalDuration.textContent = `Original Duration: ${formatTime(original)}`;
    newDuration.textContent = `Estimated New Duration: ${formatTime(adjusted)}`;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function stripExtension(name) {
    return String(name || "audio").replace(/\.[^./\\]+$/, "");
  }

  function clearDownload() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = "";
    }
    downloadLink.style.display = "none";
    downloadLink.removeAttribute("href");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
