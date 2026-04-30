(() => {
  "use strict";

  const conversionMap = {
    "mp3-to-wav": { outputExt: "wav" },
    "wav-to-mp3": { outputExt: "mp3" },
    "m4a-to-mp3": { outputExt: "mp3" },
    "flac-to-mp3": { outputExt: "mp3" }
  };

  const state = {
    queue: [],
    audioContext: null
  };
  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";

  const elements = {
    conversionType: document.getElementById("conversionType"),
    mp3Bitrate: document.getElementById("mp3Bitrate"),
    convertAllBtn: document.getElementById("convertAllBtn"),
    clearBtn: document.getElementById("clearBtn"),
    queueBody: document.getElementById("queueBody"),
    toolStatus: document.getElementById("toolStatus")
  };

  if (
    !elements.conversionType ||
    !elements.mp3Bitrate ||
    !elements.convertAllBtn ||
    !elements.clearBtn ||
    !elements.queueBody ||
    !elements.toolStatus
  ) {
    return;
  }

  wireEvents();
  renderQueue();

  function wireEvents() {
    elements.convertAllBtn.addEventListener("click", () => {
      void convertQueue();
    });

    elements.clearBtn.addEventListener("click", () => {
      clearQueue();
    });

    elements.queueBody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const row = target.closest("tr[data-id]");
      if (!row) {
        return;
      }

      const id = row.getAttribute("data-id") || "";
      if (!id) {
        return;
      }

      if (target.matches("[data-remove]")) {
        removeItem(id);
        return;
      }

      if (target.matches("[data-download]")) {
        downloadItem(id);
      }
    });
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    for (const file of files) {
      const item = {
        id: `q_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file,
        inputExt: getExtension(file.name),
        outputExt: "",
        status: "Ready",
        error: "",
        outputBlob: null,
        outputUrl: ""
      };
      state.queue.push(item);
    }

    setStatus(`${files.length} file(s) added. Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.`);
    renderQueue();
  }

  async function convertQueue() {
    if (!state.queue.length) {
      setStatus("Add at least one file first.");
      return;
    }

    const selectedType = elements.conversionType.value;
    const rule = conversionMap[selectedType];
    if (!rule) {
      setStatus("Invalid conversion type.");
      return;
    }

    const bitrate = Number(elements.mp3Bitrate.value) || 192;
    elements.convertAllBtn.disabled = true;

    let convertedCount = 0;

    try {
      const ctx = getAudioContext();

      for (let i = 0; i < state.queue.length; i += 1) {
        const item = state.queue[i];
        cleanupOutput(item);
        item.outputExt = rule.outputExt;
        item.error = "";

        item.status = "Decoding";
        renderQueue();

        try {
          const sourceBuffer = await item.file.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(sourceBuffer.slice(0));

          item.status = `Encoding ${rule.outputExt.toUpperCase()}`;
          renderQueue();

          let outputBlob;
          if (rule.outputExt === "wav") {
            outputBlob = encodeWav(audioBuffer);
          } else {
            outputBlob = encodeMp3(audioBuffer, bitrate);
          }

          item.outputBlob = outputBlob;
          item.outputUrl = URL.createObjectURL(outputBlob);
          item.status = "Converted";
          convertedCount += 1;
        } catch (error) {
          item.status = "Failed";
          item.error = `This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`;
        }

        renderQueue();
      }

      setStatus(`Done. Converted: ${convertedCount}. Files that failed could not be decoded by this browser.`);
    } finally {
      elements.convertAllBtn.disabled = false;
    }
  }

  function removeItem(id) {
    const index = state.queue.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const [item] = state.queue.splice(index, 1);
    if (item) {
      cleanupOutput(item);
    }

    renderQueue();
    setStatus("File removed from queue.");
    emitEmptyStateIfNeeded();
  }

  function downloadItem(id) {
    const item = state.queue.find((entry) => entry.id === id);
    if (!item || !item.outputUrl || !item.outputBlob) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = item.outputUrl;
    anchor.download = `${stripExtension(item.file.name)}.${item.outputExt || "wav"}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function clearQueue() {
    for (const item of state.queue) {
      cleanupOutput(item);
    }
    state.queue = [];
    renderQueue();
    setStatus("Queue cleared.");
    document.dispatchEvent(new Event("converter:empty"));
  }

  function renderQueue() {
    if (!state.queue.length) {
      elements.queueBody.innerHTML = `
        <tr>
          <td colspan="5">No files in queue.</td>
        </tr>
      `;
      return;
    }

    const rows = state.queue
      .map((item) => {
        const outputText = item.outputExt ? item.outputExt.toUpperCase() : "-";
        const isOk = item.status === "Converted";
        const isErr = item.status === "Failed" || item.status.startsWith("Skipped");
        const statusClass = isOk ? "status-pill ok" : isErr ? "status-pill err" : "status-pill";
        const statusTitle = item.error ? ` title="${escapeHtml(item.error)}"` : "";

        return `
          <tr data-id="${escapeHtml(item.id)}">
            <td title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</td>
            <td>${escapeHtml((item.inputExt || "-").toUpperCase())}</td>
            <td>${escapeHtml(outputText)}</td>
            <td><span class="${statusClass}"${statusTitle}>${escapeHtml(item.status)}</span></td>
            <td>
              <button type="button" class="inline-btn" data-download ${item.outputUrl ? "" : "disabled"}>Download</button>
              <button type="button" class="inline-btn" data-remove>Remove</button>
            </td>
          </tr>
        `;
      })
      .join("");

    elements.queueBody.innerHTML = rows;
  }

  function getAudioContext() {
    if (!state.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        throw new Error("Web Audio API is not available in this browser.");
      }
      state.audioContext = new Ctx();
    }
    return state.audioContext;
  }

  function encodeMp3(audioBuffer, bitrateKbps) {
    if (!window.MP3EncoderModule || typeof window.MP3EncoderModule.encode !== "function") {
      throw new Error("MP3 encoder not loaded.");
    }

    const channels = [];
    const count = Math.min(audioBuffer.numberOfChannels, 2);
    for (let i = 0; i < count; i += 1) {
      channels.push(audioBuffer.getChannelData(i));
    }

    return window.MP3EncoderModule.encode({
      channels,
      sampleRate: audioBuffer.sampleRate,
      bitrateKbps
    });
  }

  function encodeWav(audioBuffer) {
    const channels = Math.min(audioBuffer.numberOfChannels, 2);
    const sampleRate = audioBuffer.sampleRate;
    const frameCount = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frameCount * blockAlign;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

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
      channelData.push(audioBuffer.getChannelData(ch));
    }

    for (let i = 0; i < frameCount; i += 1) {
      for (let ch = 0; ch < channels; ch += 1) {
        const sample = clamp(channelData[ch][i], -1, 1);
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function getExtension(name) {
    const match = /\.([^.]+)$/.exec(name || "");
    return match ? match[1].toLowerCase() : "";
  }

  function stripExtension(name) {
    return (name || "audio").replace(/\.[^./\\]+$/, "");
  }

  function cleanupOutput(item) {
    if (item.outputUrl) {
      URL.revokeObjectURL(item.outputUrl);
    }
    item.outputUrl = "";
    item.outputBlob = null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(message) {
    elements.toolStatus.textContent = message;
  }

  function emitEmptyStateIfNeeded() {
    if (state.queue.length === 0) {
      document.dispatchEvent(new Event("converter:empty"));
    }
  }

  window.AudioConverter = {
    addFile(file) {
      addFiles([file]);
    }
  };
})();
