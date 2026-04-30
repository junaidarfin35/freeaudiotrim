(() => {
  "use strict";

  const MAX_FILE_SIZE = 200 * 1024 * 1024;
  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";
  const DB_FLOOR = -48;
  const LUFS_OFFSET = -0.691;
  const SMART_TARGET_LUFS = -16;
  const SMART_TRUE_PEAK = -1;

  const fileListEl = document.getElementById("fileList");
  const mergeBtn = document.getElementById("mergeBtn");
  const downloadLink = document.getElementById("downloadLink");
  const statusEl = document.querySelector('[data-role="status"]');
  const fileRow = document.querySelector('[data-role="fileRow"]');
  const fileNameEl = document.querySelector('[data-role="fileName"]');
  const fileIcon = document.querySelector('[data-role="fileIcon"]');
  const changeFileBtn = document.querySelector('[data-role="changeFile"]');
  const reorderHelp = document.querySelector('[data-role="reorderHelp"]');
  const matchVolumeInput = document.getElementById("matchVolume");
  const pageInput = document.getElementById("audioFileInput");

  if (!fileListEl || !mergeBtn || !downloadLink || !statusEl || !pageInput) {
    return;
  }

  const state = {
    items: [],
    ctx: null,
    outputUrl: "",
    outputName: "",
    isMerging: false,
    dragId: null,
    dragPointerId: null,
    dragPlaceholder: null,
    dragStartY: 0,
    dragRowStartTop: 0
  };

  window.MergeAudioTool = {
    addFile(file) {
      addFiles([file]);
    },
    addFiles(fileList) {
      addFiles(fileList);
    },
    clearQueue() {
      clearQueue();
    }
  };

  wireEvents();
  render();
  setStatus("Add at least two files to begin merging.", "idle");

  function wireEvents() {
    changeFileBtn?.addEventListener("click", () => {
      pageInput.click();
    });

    mergeBtn.addEventListener("click", () => {
      void mergeFiles();
    });

    downloadLink.addEventListener("click", (event) => {
      if (!state.outputUrl) {
        event.preventDefault();
        return;
      }
      setStatus("Download started.", "success");
    });

    matchVolumeInput.addEventListener("change", () => {
      if (!state.items.length) {
        return;
      }
      clearOutput();
      setStatus(
        matchVolumeInput.checked
          ? "Volume matching enabled. Merge again to apply it."
          : "Volume matching turned off. Merge again to keep original loudness.",
        "warning"
      );
    });

    fileListEl.addEventListener("click", (event) => {
      const removeButton = event.target.closest('[data-role="removeFile"]');
      if (!removeButton) {
        return;
      }

      const itemId = removeButton.getAttribute("data-id");
      removeItem(itemId);
    });

    fileListEl.addEventListener("pointerdown", (event) => {
      const removeButton = event.target.closest('[data-role="removeFile"]');
      if (removeButton || state.isMerging) {
        return;
      }

      const row = event.target.closest('[data-role="mergeItem"]');
      const itemId = row?.getAttribute("data-id");
      if (!row || !itemId) {
        return;
      }

      state.dragId = itemId;
      state.dragPointerId = event.pointerId;
      state.dragStartY = event.clientY;
      state.dragRowStartTop = row.getBoundingClientRect().top;
      state.dragPlaceholder = document.createElement("div");
      state.dragPlaceholder.className = "merge-item merge-item-placeholder";
      state.dragPlaceholder.innerHTML = '<div class="merge-item-placeholder-copy">Drop here</div>';
      state.dragPlaceholder.style.height = `${row.getBoundingClientRect().height}px`;
      row.after(state.dragPlaceholder);
      row.classList.add("is-dragging");
      fileListEl.classList.add("is-sorting");
      document.body.classList.add("merge-drag-lock");
      row.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    fileListEl.addEventListener("pointermove", (event) => {
      if (!state.dragId || event.pointerId !== state.dragPointerId) {
        return;
      }

      const activeRow = fileListEl.querySelector(`[data-role="mergeItem"][data-id="${state.dragId}"]`);
      if (!activeRow) {
        return;
      }

      event.preventDefault();
      activeRow.style.transform = `translateY(${event.clientY - state.dragStartY}px)`;

      const target = document.elementFromPoint(event.clientX, event.clientY);
      const targetRow = target?.closest?.('[data-role="mergeItem"]');
      if (!targetRow || targetRow === activeRow || targetRow.classList.contains("merge-item-placeholder")) {
        return;
      }

      const rect = targetRow.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      if (state.dragPlaceholder) {
        fileListEl.insertBefore(state.dragPlaceholder, insertBefore ? targetRow : targetRow.nextSibling);
      }
    });

    fileListEl.addEventListener("pointerup", finishDrag);
    fileListEl.addEventListener("pointercancel", finishDrag);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) {
      return;
    }

    const accepted = [];
    const rejected = [];

    incoming.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} exceeds 200MB.`);
        return;
      }

      accepted.push({
        id: `merge_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file
      });
    });

    if (accepted.length) {
      state.items.push(...accepted);
      clearOutput();
      render();
    }

    if (!accepted.length && rejected.length) {
      setStatus(rejected[0], "error");
      return;
    }

    if (rejected.length) {
      setStatus(`${accepted.length} file(s) added. ${rejected.length} skipped.`, "warning");
      return;
    }

    setReadyStatus();
  }

  function removeItem(itemId) {
    const nextItems = state.items.filter((item) => item.id !== itemId);
    if (nextItems.length === state.items.length) {
      return;
    }

    state.items = nextItems;
    clearOutput();

    if (!state.items.length) {
      render();
      clearQueue();
      return;
    }

    render();
    setReadyStatus();
  }

  function clearQueue() {
    revokeOutputUrl();
    state.items = [];
    state.outputUrl = "";
    state.outputName = "";
    state.dragId = null;
    state.dragPointerId = null;
    render();
    setStatus("Add at least two files to begin merging.", "idle");
    document.dispatchEvent(new CustomEvent("converter:empty"));
  }

  function finishDrag(event) {
    if (!state.dragId || event.pointerId !== state.dragPointerId) {
      return;
    }

    const activeRow = fileListEl.querySelector(`[data-role="mergeItem"][data-id="${state.dragId}"]`);
    activeRow?.classList.remove("is-dragging");
    if (activeRow) {
      activeRow.style.transform = "";
    }
    fileListEl.classList.remove("is-sorting");
    document.body.classList.remove("merge-drag-lock");

    if (activeRow && state.dragPlaceholder?.parentNode) {
      state.dragPlaceholder.parentNode.replaceChild(activeRow, state.dragPlaceholder);
    }
    state.dragPlaceholder = null;

    const orderedIds = Array.from(fileListEl.querySelectorAll('[data-role="mergeItem"]')).map((row) =>
      row.getAttribute("data-id")
    );

    state.items.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    state.dragId = null;
    state.dragPointerId = null;
    state.dragStartY = 0;
    state.dragRowStartTop = 0;
    clearOutput();
    setReadyStatus("Order updated. Merge again when you are ready.");
  }

  async function mergeFiles() {
    if (!state.items.length || state.isMerging) {
      return;
    }

    state.isMerging = true;
    updateActionState();
    clearOutput();

    try {
      const decodedBuffers = [];
      for (let index = 0; index < state.items.length; index += 1) {
        const item = state.items[index];
        setStatus(`Decoding file ${index + 1} of ${state.items.length}...`, "processing");
        const arrayBuffer = await item.file.arrayBuffer();
        const audioBuffer = await getContext().decodeAudioData(arrayBuffer.slice(0));
        decodedBuffers.push(audioBuffer);
      }

      const targetSampleRate = Math.max(...decodedBuffers.map((buffer) => buffer.sampleRate));
      const targetChannels = Math.max(...decodedBuffers.map((buffer) => buffer.numberOfChannels));
      const preparedBuffers = [];

      for (let index = 0; index < decodedBuffers.length; index += 1) {
        let buffer = decodedBuffers[index];
        if (buffer.sampleRate !== targetSampleRate || buffer.numberOfChannels !== targetChannels) {
          setStatus(`Preparing file ${index + 1} of ${decodedBuffers.length}...`, "processing");
          buffer = await resampleAudioBuffer(buffer, targetSampleRate, targetChannels);
        }

        if (matchVolumeInput.checked) {
          setStatus(`Normalizing file ${index + 1} of ${decodedBuffers.length}...`, "processing");
          const analysis = analyzeBuffer(buffer);
          const gainDb = computeSmartGainDb(analysis);
          buffer = applyGainToBuffer(buffer, gainDb);
        }

        preparedBuffers.push(buffer);
      }

      setStatus("Merging files...", "processing");
      const mergedBuffer = mergeBuffers(preparedBuffers, targetSampleRate, targetChannels);
      const wavBlob = encodeWav(mergedBuffer);
      const outputUrl = URL.createObjectURL(wavBlob);

      state.outputUrl = outputUrl;
      state.outputName = buildOutputName(state.items);

      downloadLink.href = outputUrl;
      downloadLink.download = state.outputName;

      setStatus("Merged file ready. Download WAV.", "success");
    } catch (error) {
      console.error(error);
      setStatus(`This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`, "error");
    } finally {
      state.isMerging = false;
      updateActionState();
    }
  }

  function render() {
    renderSummary();
    renderList();
    updateActionState();
  }

  function renderSummary() {
    const count = state.items.length;
    if (!count) {
      fileRow?.classList.add("is-hidden");
      reorderHelp?.classList.add("is-hidden");
      fileNameEl.textContent = "";
      fileListEl.classList.add("is-hidden");
      return;
    }

    fileRow?.classList.remove("is-hidden");
    fileListEl.classList.remove("is-hidden");
    reorderHelp?.classList.toggle("is-hidden", count < 2);
    fileNameEl.textContent = `${count} file${count === 1 ? "" : "s"} selected`;
    if (fileIcon && window.lucide) {
      fileIcon.setAttribute("data-lucide", "list-music");
      window.lucide.createIcons();
    }
  }

  function renderList() {
    if (!state.items.length) {
      fileListEl.innerHTML = '<div class="merge-empty">No files added yet. Upload multiple clips to start building your merged track.</div>';
      return;
    }

    fileListEl.innerHTML = state.items
      .map((item, index) => {
        return `
          <div class="merge-item" data-role="mergeItem" data-id="${item.id}">
            <button type="button" class="merge-handle" data-role="dragHandle" aria-label="Drag to reorder">
              <span class="merge-order">${index + 1}</span>
            </button>
            <div class="merge-item-main">
              <div class="merge-item-name">${escapeHtml(item.file.name)}</div>
              <div class="merge-item-meta">${formatFileSizeMB(item.file.size)}</div>
            </div>
            <button type="button" class="at-btn at-btn-soft merge-remove" data-role="removeFile" data-id="${item.id}" aria-label="Remove file">
              <i data-lucide="trash" aria-hidden="true"></i>
            </button>
          </div>
        `;
      })
      .join("");

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function updateActionState() {
    const hasItems = state.items.length > 0;
    const hasOutput = !!state.outputUrl;

    mergeBtn.disabled = !hasItems || state.isMerging;
    downloadLink.classList.toggle("is-hidden", !hasOutput);
    mergeBtn.classList.toggle("is-hidden", hasOutput);
    downloadLink.setAttribute("aria-disabled", hasOutput ? "false" : "true");
  }

  function setReadyStatus(message) {
    if (!state.items.length) {
      setStatus("Add at least two files to begin merging.", "idle");
      return;
    }

    if (message) {
      setStatus(message, state.items.length > 1 ? "ready" : "warning");
      return;
    }

    if (state.items.length === 1) {
      setStatus("1 file ready. Add another file, or merge this one into a WAV copy.", "warning");
      return;
    }

    setStatus("Files ready. Drag to reorder, then merge when you are happy with the stack.", "ready");
  }

  function clearOutput() {
    revokeOutputUrl();
    state.outputUrl = "";
    state.outputName = "";
    downloadLink.removeAttribute("href");
    downloadLink.removeAttribute("download");
    updateActionState();
  }

  function revokeOutputUrl() {
    if (state.outputUrl) {
      URL.revokeObjectURL(state.outputUrl);
    }
  }

  async function resampleAudioBuffer(audioBuffer, targetSampleRate, targetChannels) {
    const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate));
    const offlineContext = new OfflineAudioContext(targetChannels, targetLength, targetSampleRate);
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);
    return offlineContext.startRendering();
  }

  function mergeBuffers(buffers, sampleRate, numberOfChannels) {
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const output = getContext().createBuffer(numberOfChannels, totalLength, sampleRate);
    let offset = 0;

    buffers.forEach((buffer) => {
      for (let channel = 0; channel < numberOfChannels; channel += 1) {
        const src = buffer.getChannelData(channel);
        output.getChannelData(channel).set(src, offset);
      }
      offset += buffer.length;
    });

    return output;
  }

  function computeSmartGainDb(analysis) {
    const lufsGain = SMART_TARGET_LUFS - analysis.lufs;
    const peakSafeGain = SMART_TRUE_PEAK - analysis.peakDb;
    return Math.min(lufsGain, peakSafeGain);
  }

  function applyGainToBuffer(audioBuffer, gainDb) {
    const gain = Math.pow(10, gainDb / 20);
    const output = getContext().createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const input = audioBuffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      for (let index = 0; index < input.length; index += 1) {
        target[index] = clamp(input[index] * gain, -1, 1);
      }
    }

    return output;
  }

  function analyzeBuffer(audioBuffer) {
    let peak = 0;
    let sumSquares = 0;
    const channelCount = audioBuffer.numberOfChannels;
    const sampleCount = audioBuffer.length;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        const absolute = Math.abs(data[index]);
        if (absolute > peak) {
          peak = absolute;
        }
        sumSquares += data[index] * data[index];
      }
    }

    const meanSquare = sumSquares / Math.max(1, sampleCount * channelCount);
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : DB_FLOOR;
    const lufs = meanSquare > 0 ? LUFS_OFFSET + 10 * Math.log10(meanSquare) : DB_FLOOR;
    return { peakDb, lufs };
  }

  function encodeWav(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const frameCount = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = (value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
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

    const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index));
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = clamp(channelData[channel][frame], -1, 1);
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function getContext() {
    if (!state.ctx) {
      state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return state.ctx;
  }

  function buildOutputName(items) {
    if (items.length === 1) {
      return `${stripExtension(items[0].file.name)}-merged.wav`;
    }
    return "merged-audio.wav";
  }

  function formatFileSizeMB(bytes) {
    return `${(Number(bytes || 0) / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setStatus(message, stateName) {
    statusEl.textContent = message;
    statusEl.dataset.statusState = stateName;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function stripExtension(name) {
    return String(name || "").replace(/\.[^./\\]+$/, "");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
