(() => {
  "use strict";

  const processBtn = document.getElementById("processBtn");
  const downloadLink = document.getElementById("downloadLink");
  const status = document.getElementById("status");
  const thresholdEl = document.getElementById("thresholdDb");
  const thresholdValueEl = document.getElementById("thresholdValue");
  const minMsEl = document.getElementById("minMs");
  const fileRow = document.querySelector('[data-role="fileRow"]');
  const fileNameEl = document.querySelector('[data-role="fileName"]');
  const changeFileBtn = document.querySelector('[data-role="changeFile"]');
  const fileInput = document.getElementById("audioFileInput");

  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";

  let currentFile = null;

  function setStatus(message) {
    if (!status) return;
    status.textContent = message;
    const text = String(message || "").toLowerCase();
    status.dataset.statusState =
      /error|failed|not supported|no audible/.test(text) ? "error" :
      /ready|download/.test(text) ? "success" :
      /decoding|processing|reading|merging/.test(text) ? "processing" :
      "idle";
  }

  function encodeWAV(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, text) {
      for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i += 1) {
      for (let c = 0; c < numberOfChannels; c += 1) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(c)[i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  async function readFile(file) {
    return await file.arrayBuffer();
  }

  function processFile(file) {
    currentFile = file;
    if (processBtn) processBtn.disabled = false;
    if (fileRow && fileNameEl) {
      fileNameEl.textContent = file.name;
      fileRow.classList.remove("is-hidden");
    }
    setStatus("File loaded. Adjust settings and click Remove Silence.");
  }

  if (!processBtn || !downloadLink || !status || !thresholdEl || !minMsEl) {
    window.RemoveSilenceTool = { addFile() {} };
    return;
  }

  if (thresholdValueEl) {
    thresholdValueEl.textContent = `${thresholdEl.value} dB`;
    thresholdEl.addEventListener("input", () => {
      thresholdValueEl.textContent = `${thresholdEl.value} dB`;
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener("click", () => fileInput.click());
  }

  processBtn.addEventListener("click", async () => {
    if (!currentFile) {
      setStatus("No file loaded.");
      return;
    }

    try {
      setStatus("Decoding...");
      const abuf = await readFile(currentFile);
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await actx.decodeAudioData(abuf);

      const thresholdDb = parseFloat(thresholdEl.value);
      const threshold = Math.pow(10, thresholdDb / 20);
      const frameMs = 30;
      const frameSize = Math.floor(decoded.sampleRate * (frameMs / 1000));
      const minFrames = Math.ceil((parseInt(minMsEl.value, 10) || 300) / frameMs);

      const rms = [];
      const channels = decoded.numberOfChannels;
      const len = decoded.length;
      for (let i = 0; i < len; i += frameSize) {
        let sum = 0;
        let count = 0;
        for (let c = 0; c < channels; c += 1) {
          const data = decoded.getChannelData(c);
          for (let j = 0; j < frameSize && i + j < len; j += 1) {
            const s = data[i + j];
            sum += s * s;
            count += 1;
          }
        }
        rms.push(Math.sqrt(sum / Math.max(1, count)));
      }

      const keepSegments = [];
      let idx = 0;
      while (idx < rms.length) {
        if (rms[idx] >= threshold) {
          const start = idx;
          while (idx < rms.length && rms[idx] >= threshold) idx += 1;
          const end = idx;
          if (end - start >= minFrames) {
            keepSegments.push({ start: start * frameSize, end: Math.min(len, end * frameSize) });
          }
        } else {
          idx += 1;
        }
      }

      const merged = [];
      for (const seg of keepSegments) {
        if (!merged.length) {
          merged.push(seg);
          continue;
        }
        const prev = merged[merged.length - 1];
        if (seg.start - prev.end <= frameSize * 2) {
          prev.end = seg.end;
        } else {
          merged.push(seg);
        }
      }

      if (!merged.length) {
        setStatus("No audible segments found with current settings.");
        return;
      }

      let total = 0;
      for (const s of merged) total += s.end - s.start;

      const outCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        decoded.numberOfChannels,
        total,
        decoded.sampleRate
      );
      const outBuf = outCtx.createBuffer(decoded.numberOfChannels, total, decoded.sampleRate);

      let writePos = 0;
      for (const s of merged) {
        for (let c = 0; c < decoded.numberOfChannels; c += 1) {
          const src = decoded.getChannelData(c);
          const dst = outBuf.getChannelData(c);
          for (let k = s.start; k < s.end; k += 1) {
            dst[writePos + k - s.start] = src[k];
          }
        }
        writePos += s.end - s.start;
      }

      const wav = encodeWAV(outBuf);
      const url = URL.createObjectURL(wav);
      downloadLink.href = url;
      downloadLink.download = `${(currentFile.name.replace(/\.[^/.]+$/, "") || "clean")}_nosilence.wav`;
      downloadLink.classList.remove("is-hidden");
      setStatus("Ready - download cleaned file.");
    } catch (e) {
      console.error(e);
      setStatus(`This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`);
    }
  });

  window.RemoveSilenceTool = {
    addFile(file) {
      processFile(file);
    }
  };
})();
