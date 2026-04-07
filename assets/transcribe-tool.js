(function () {
  "use strict";

  var srtContent = "";
  var vttContent = "";
  var STYLE_ID = "transcribe-tool-styles";
  var LARGE_FILE_BYTES = 50 * 1024 * 1024;
  var MAX_DURATION_SECONDS = 120;
  var worker = new Worker("/assets/transcribe-worker.js", {
    type: "module"
  });
  var processingLocked = false;
  var activeTranscriptionContext = null;
  var activeTranslationContext = null;
  var progressInterval = null;
  var progressMessages = [
    "Downloading AI model...",
    "Model ready from cache",
    "Good things take time...",
    "Transcribing audio...",
    "Transcription complete"
  ];
  var progressMessageInterval = null;
  var showTimestamps = true;
  var previewEditMode = false;
  var langMap = {
    en: "eng_Latn",
    ar: "arb_Arab",
    es: "spa_Latn",
    fr: "fra_Latn",
    de: "deu_Latn",
    hi: "hin_Deva",
    ur: "urd_Arab",
    tr: "tur_Latn",
    zh: "zho_Hans"
  };

  async function getPipeline() {
    if (!pipeline) {
      var transformers = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0");
      pipeline = transformers.pipeline;
    }
    return pipeline;
  }

  async function loadModel() {
    if (!transcriberPromise) {
      console.log("Initializing model...");
      setStatus("Downloading AI model...", "processing");

      var pipelineFunc = await getPipeline();

      transcriberPromise = pipelineFunc(
        "automatic-speech-recognition",
        "onnx-community/whisper-large-v3-turbo",
        {
          device: "auto",
          dtype: "q4"
        }
      )
      .then(function(model) {
        console.log("Model loaded successfully");
        setStatus("Ready", "ready");
        return model;
      })
      .catch(function(err) {
        console.error("Model loading failed:", err);
        transcriberPromise = null; // reset so retry is possible
        throw err;
      });
    }

    return transcriberPromise;
  }

  function startProgressMessages() {
    var el = document.getElementById("progress-message");
    if (!el) return;

    var index = 0;
    el.textContent = normalizeIncomingText(progressMessages[0]);

    progressMessageInterval = setInterval(function () {
      el.style.opacity = "0";

      setTimeout(function () {
        index = (index + 1) % progressMessages.length;
        el.textContent = normalizeIncomingText(progressMessages[index]);
        el.style.opacity = "1";
      }, 300);
    }, 2500);
  }

  function stopProgressMessages() {
    var el = document.getElementById("progress-message");
    clearInterval(progressMessageInterval);
    if (el) {
      el.textContent = "";
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#audio-tool .at-root{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:20px;box-sizing:border-box;box-shadow:0 8px 24px rgba(0,0,0,0.06)}",
      "#audio-tool .at-root.is-active{border-color:rgba(22,163,74,.28);box-shadow:0 10px 30px rgba(22,163,74,.10)}",
      "#audio-tool .at-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      "#audio-tool .at-row + .at-row{margin-top:12px}",
      "#audio-tool .transcribe-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      "#audio-tool .mode-selector{display:flex;gap:12px;margin-bottom:12px;width:100%;flex-wrap:wrap}",
      "#audio-tool .mode-card{flex:1 1 220px;border:1px solid #ddd;border-radius:12px;padding:12px;cursor:pointer;transition:all .2s ease;background:#fff}",
      "#audio-tool .mode-card:hover{border-color:#4CAF50}",
      "#audio-tool .mode-card.active{border-color:#4CAF50;background:#e8f5e9}",
      "#audio-tool .mode-title{font-weight:700;margin-bottom:4px}",
      "#audio-tool .mode-sub{font-size:12px;color:#666;margin-bottom:6px}",
      "#audio-tool .mode-desc{font-size:13px;color:#444}",
      "#audio-tool .tab-switch{display:flex;gap:8px;width:100%;margin-top:4px}",
      "#audio-tool .tab{appearance:none;border:1px solid #d4d4d8;background:#fff;color:#111;padding:8px 12px;border-radius:999px;cursor:pointer;transition:all .15s ease}",
      "#audio-tool .tab.active{background:#4CAF50;color:#fff;border-color:#4CAF50;font-weight:600}",
      "#audio-tool .translation-section{display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%}",
      "#audio-tool .translation-mode{display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%}",
      "#audio-tool .translation-hint{margin:0;color:#52525b;font-size:13px}",
      "#audio-tool .enhance-block{align-items:flex-start;flex-direction:column;gap:6px}",
      "#audio-tool .enhance-label{display:inline-flex;gap:8px;align-items:center;font-weight:600}",
      "#audio-tool .enhance-desc{margin:0;color:#52525b;font-size:13px}",
      "#audio-tool .progress-container{width:100%;height:6px;background:#eee;border-radius:6px;overflow:hidden;margin-top:10px}",
      "#audio-tool #progress-bar{width:0%;height:100%;background:#4CAF50;transition:width .3s ease}",
      "#audio-tool .at-btn{appearance:none;border:1px solid #d4d4d8;background:#fafafa;color:#111;padding:8px 14px;border-radius:10px;cursor:pointer;transition:all .15s ease}",
      "#audio-tool .at-btn:hover{background:#f4f4f5}",
      "#audio-tool .at-btn:disabled{opacity:.5;cursor:not-allowed}",
      "#audio-tool .at-file{max-width:100%}",
      "#audio-tool .at-file-name{font-weight:600;color:#111827}",
      "#audio-tool .at-status{display:flex;align-items:center;gap:12px;width:100%;min-height:48px;padding:12px 14px;border:1px solid #dbe4f0;border-radius:12px;background:#fff;color:#5b6b82}",
      "#audio-tool .at-status::before{content:'';width:10px;height:10px;border-radius:999px;background:#b7c6d9;flex:0 0 auto}",
      "#audio-tool .at-status[data-status-state='ready']{border-color:rgba(22,163,74,.22);background:#ecfdf5;color:#166534}",
      "#audio-tool .at-status[data-status-state='ready']::before{background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.12)}",
      "#audio-tool .at-transcript-box{width:100%;min-height:180px;padding:14px;border:1px solid #e4e4e7;border-radius:12px;background:#fafafa;color:#52525b;white-space:pre-line}",
      "#audio-tool .ts-segment{padding:12px 0;line-height:2;border-bottom:1px solid #eee;direction:rtl;text-align:right}",
      "#audio-tool .ts-segment:hover{background:#fafafa}",
      "#audio-tool .ts-segment:last-child{border-bottom:0}",
      "#audio-tool .ts-paragraph{direction:rtl;text-align:right;line-height:2;padding:12px 0;white-space:normal}",
      "#audio-tool .ts-sentence{display:inline}",
      "#audio-tool .ts-segment-text{display:inline;white-space:pre-wrap}",
      "#audio-tool .ts-segment-text[contenteditable='true']{outline:none;border-radius:6px;padding:1px 2px;background:rgba(37,99,235,.08)}",
      "#audio-tool .ts-segment-text[contenteditable='true']:focus{background:rgba(37,99,235,.14);box-shadow:0 0 0 2px rgba(37,99,235,.16)}",
      "#audio-tool .ts-time-inline{font-size:12px;color:#999;margin:0 4px;direction:ltr;unicode-bidi:isolate;white-space:nowrap}",
      "@media (max-width:640px){#audio-tool .at-root{padding:12px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function createMarkup() {
    return [
      '<div class="at-root">',
      '  <div class="at-row">',
      '    <input class="at-file" type="file" accept="audio/*,video/*" aria-label="Upload audio or video file">',
      "  </div>",
      '  <div class="at-row">',
      '    <div class="at-file-name" data-role="fileName">No file selected</div>',
      "  </div>",
      '  <div class="at-row at-status" data-role="status">Upload a file to begin transcription</div>',
      '  <div class="at-row">',
      '    <div class="progress-container"><div id="progress-bar"></div></div>',
      '    <div id="progress-message" style="',
      '      margin-top: 10px;',
      '      font-size: 14px;',
      '      opacity: 1;',
      '      transition: opacity 0.3s ease;',
      '      text-align: center;',
      '      color: #666;',
      '    "></div>',
      "  </div>",
      '  <div class="at-row transcribe-controls">',
      '    <label>Transcription Mode:</label>',
      '    <label><input type="radio" name="mode" value="fast" checked> Fast (Quick results)</label>',
      '    <label><input type="radio" name="mode" value="accurate"> Accurate (Better quality, slower)</label>',
      "  </div>",
      '  <div class="at-row transcribe-controls">',
      '    <label for="language-select">Language:</label>',
      '    <select id="language-select">',
      '      <option value="auto">Auto Detect</option>',
      '      <option value="en">English</option>',
      '      <option value="ar">Arabic</option>',
      '      <option value="es">Spanish</option>',
      '      <option value="fr">French</option>',
      '      <option value="de">German</option>',
      '      <option value="hi">Hindi</option>',
      '      <option value="ur">Urdu</option>',
      '      <option value="tr">Turkish</option>',
      '      <option value="zh">Chinese (Simplified)</option>',
      "    </select>",
      "  </div>",
      '  <div class="at-row transcribe-controls enhance-block">',
      '    <label class="enhance-label">',
      '      <input type="checkbox" id="enhance-audio">',
      '      <span>Enhance Audio</span>',
      "    </label>",
      '    <p class="enhance-desc">Improves clarity by normalizing volume and trimming silence. Recommended for noisy recordings. Slightly slower processing.</p>',
      "  </div>",
      '  <div class="at-row">',
      '    <button class="at-btn" id="start-transcribe" data-role="startTranscribe" disabled>Transcribe</button>',
      "  </div>",
      '  <div class="at-row">',
      '    <div class="tab-switch">',
      '      <button class="tab active" data-tab="original">Original</button>',
      '      <button class="tab" data-tab="translated" style="display:none;">Translated</button>',
      "    </div>",
      '    <button class="at-btn" type="button" data-role="toggleEdit" disabled>Edit</button>',
      '    <label style="margin-left: auto; display: flex; align-items: center; gap: 6px;">',
      '      <input type="checkbox" id="show-timestamps" checked>',
      '      <span>Show Timestamps</span>',
      '    </label>',
      "  </div>",
      '  <div class="at-row">',
      '    <div class="at-transcript-box" data-role="transcript">Upload and transcribe a file to see results here.</div>',
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <label for="translate-language">Translate to:</label>',
      '    <select id="translate-language">',
      '      <option value="">Select language</option>',
      '      <option value="en">English</option>',
      '      <option value="ar">Arabic</option>',
      '      <option value="es">Spanish</option>',
      '      <option value="fr">French</option>',
      '      <option value="de">German</option>',
      '      <option value="hi">Hindi</option>',
      '      <option value="ur">Urdu</option>',
      '      <option value="tr">Turkish</option>',
      '      <option value="zh">Chinese</option>',
      "    </select>",
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <label for="modeSelect">Translation Mode:</label>',
      '    <select id="modeSelect">',
      '      <option value="accurate" selected>Accurate (word-by-word)</option>',
      '      <option value="subtitle">Subtitle (short & readable)</option>',
      '    </select>',
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <label>',
      '      <input type="checkbox" id="polishToggle">',
      '      Improve readability (beta)',
      '    </label>',
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <button class="at-btn" id="translate-btn" data-role="translateBtn" disabled>Translate</button>',
      '    <button class="at-btn" id="chatgptTranslateBtn" type="button" disabled>Refine with ChatGPT</button>',
      '    <p class="translation-hint">Best results with clear speech or standard language. Dialects may vary.</p>',
      "  </div>",
      '  <div class="at-row">',
      '    <button class="at-btn" data-role="copyTranscript" disabled>Copy</button>',
      '    <button class="at-btn" data-role="downloadTxt" disabled>Download TXT</button>',
      '    <button class="at-btn" data-role="downloadSrt" disabled>Download SRT</button>',
      '    <button class="at-btn" data-download-vtt disabled>Download VTT</button>',
      '    <button class="at-btn" data-role="restartBtn">Restart</button>',
      "  </div>",
      "</div>"
    ].join("");
  }

  function setStatus(message, state) {
    var el;
    if (typeof message === "string") {
      el = document.querySelector(".at-status");
    } else {
      el = message;
      message = state;
      state = arguments[2];
    }
    if (!el) return;
    el.textContent = normalizeIncomingText(message);
    el.dataset.statusState = state || "idle";
  }

  function setProgress(value) {
    var bar = document.getElementById("progress-bar");
    if (bar) {
      bar.style.width = value + "%";
    }
  }

  function startFakeProgress(start, end) {
    var value = start == null ? 50 : start;
    var limit = end == null ? 90 : end;

    stopFakeProgress();
    progressInterval = setInterval(function () {
      value += Math.random() * 3;

      if (value >= limit) {
        value = limit;
      }

      setProgress(value);
    }, 300);
  }

  function stopFakeProgress() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, enabled) {
    if (copyBtn) {
      copyBtn.disabled = !enabled;
    }
    if (txtBtn) {
      txtBtn.disabled = !enabled;
    }
    if (srtBtn) {
      srtBtn.disabled = !enabled;
    }
    if (vttBtn) {
      vttBtn.disabled = !enabled;
    }
  }

  function setTranscribeButtonState(startBtn, enabled) {
    if (startBtn) {
      startBtn.disabled = !enabled;
    }
  }

  function setTranslationButtonsState(translateBtn, copyBtn, txtBtn, srtBtn, enabled) {
    if (translateBtn) {
      translateBtn.disabled = !enabled;
    }
    if (copyBtn) {
      copyBtn.disabled = !enabled;
    }
    if (txtBtn) {
      txtBtn.disabled = !enabled;
    }
    if (srtBtn) {
      srtBtn.disabled = !enabled;
    }
  }

  function setTranslatedExportButtonsState(copyBtn, txtBtn, srtBtn, enabled) {
    if (copyBtn) {
      copyBtn.disabled = !enabled;
    }
    if (txtBtn) {
      txtBtn.disabled = !enabled;
    }
    if (srtBtn) {
      srtBtn.disabled = !enabled;
    }
  }

  function setEnhanceToggleState(enhanceToggle, enabled) {
    if (enhanceToggle) {
      enhanceToggle.disabled = !enabled;
    }
  }

  function isSupportedMediaFile(file) {
    if (!file || !file.type) {
      return false;
    }

    return file.type.indexOf("audio/") === 0 || file.type.indexOf("video/") === 0;
  }

  function getCurrentTranscriptDuration() {
    return window.currentTranscriptDuration || 0;
  }

  function convertToMono(buffer) {
    if (buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0);
    }

    var length = buffer.length;
    var result = new Float32Array(length);

    for (var channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      var data = buffer.getChannelData(channel);
      for (var i = 0; i < length; i += 1) {
        result[i] += data[i] / buffer.numberOfChannels;
      }
    }

    return result;
  }

  function resampleTo16kHz(data, originalSampleRate) {
    if (originalSampleRate === 16000) {
      return data;
    }

    var ratio = originalSampleRate / 16000;
    var newLength = Math.round(data.length / ratio);
    var result = new Float32Array(newLength);
    var offset = 0;

    for (var i = 0; i < newLength; i += 1) {
      var nextOffset = Math.round((i + 1) * ratio);
      var sum = 0;
      var count = 0;

      for (var j = offset; j < nextOffset && j < data.length; j += 1) {
        sum += data[j];
        count += 1;
      }

      result[i] = sum / count;
      offset = nextOffset;
    }

    return result;
  }

  function normalizeAudio(data) {
    var max = 0;
    for (var i = 0; i < data.length; i += 1) {
      max = Math.max(max, Math.abs(data[i]));
    }
    if (max === 0) {
      return data;
    }

    var scale = 1 / max;
    var result = new Float32Array(data.length);

    for (var j = 0; j < data.length; j += 1) {
      result[j] = data[j] * scale;
    }

    return result;
  }

  function trimSilence(data, threshold) {
    var safeThreshold = threshold == null ? 0.01 : threshold;
    var start = 0;
    var end = data.length - 1;

    while (start < data.length && Math.abs(data[start]) < safeThreshold) {
      start += 1;
    }

    while (end > start && Math.abs(data[end]) < safeThreshold) {
      end -= 1;
    }

    return data.slice(start, end + 1);
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksCorruptedText(text) {
    return false;
  }

  function normalizeText(text) {
    return cleanText(text);
  }













  function normalizeIncomingText(text) {
    return normalizeText(text);
  }

  function normalizeIncomingSegments(segments) {
    return Array.isArray(segments) ? segments.map(function (segment) {
      var timestamp = segment && segment.timestamp;
      return {
        text: normalizeIncomingText(segment && segment.text),
        timestamp: Array.isArray(timestamp) ? [timestamp[0], timestamp[1]] : timestamp
      };
    }) : [];
  }

  function mountMarkup(target, markup) {
    var range = document.createRange();
    range.selectNode(target);
    target.replaceChildren(range.createContextualFragment(markup));
  }

  function improveSpeechStructure(text) {
    return String(text || "")
      .replace(/\n+/g, ". ")
      .replace(/ \u0648/g, ". \u0648")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeArabicText(text) {
    if (!text) return text;

    var cleaned = normalizeText(text);

    cleaned = cleaned
      .replace(/[\u0623\u0625\u0622]/g, "\u0627")
      .replace(/\u0649/g, "\u064A");

    cleaned = cleaned.replace(/\b(\w+)( \1\b)+/g, "$1");
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    cleaned = cleaned
      .replace(/\u060C\s*/g, "\u060C ")
      .replace(/\.\s*/g, ". ");

    return cleaned;
  }

  function splitIntoSentences(text) {
    var normalized = cleanText(text);

    if (!normalized) {
      return [];
    }

    return normalized
      .split(/(?<=[.!?\u061F])\s+|[\r\n]+/)
      .map(function (sentence) {
        return cleanText(sentence);
      })
      .filter(function (sentence) {
        return sentence.length > 0;
      });
  }

  function splitText(text, maxLength) {
    var safeMaxLength = maxLength == null ? 300 : maxLength;
    var sentences = splitIntoSentences(text);
    var chunks = [];
    var current = "";

    if (!sentences.length) {
      return [];
    }

    for (var i = 0; i < sentences.length; i += 1) {
      var sentence = sentences[i];
      var nextChunk = current ? current + " " + sentence : sentence;

      if (nextChunk.length > safeMaxLength) {
        if (current) {
          chunks.push(current.trim());
        }

        if (sentence.length > safeMaxLength) {
          chunks.push(sentence.trim());
          current = "";
        } else {
          current = sentence;
        }
      } else {
        current = nextChunk;
      }
    }

    if (current) {
      chunks.push(current.trim());
    }

    return chunks.filter(function (chunk) {
      return chunk && chunk.trim().length > 0;
    });
  }

  function prepareTranslationInput(text, sourceLangHint) {
    var normalizedText = improveSpeechStructure(text);
    normalizedText = normalizeText(normalizedText);
    var sentences = splitIntoSentences(normalizedText);

    return {
      text: normalizedText,
      sentences: sentences,
      sourceLangHint: sourceLangHint || ""
    };
  }

  function cleanTranslation(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/([.?!])\s*/g, "$1 ")
      .trim();
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function splitIntoLines(text) {
    return String(text || "").split(/(?<=[.\u061F!])\s+/).join("\n");
  }

  function copyTranscript(statusEl) {
    if (!window.currentTranscript || !navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(window.currentTranscript).then(function () {
      setStatus(statusEl, "Copied to clipboard", "ready");
    }).catch(function () {
    });
  }

  function buildExportFileName(type, extension) {
    let base = window.originalFileName || "file";
    base = base.replace(/\.[^/.]+$/, "");
    base = base.replace(/[^\w\-]+/g, "_");
    return `FreeAudioTrim_${base}_${type}.${extension}`;
  }

  function downloadBlob(filename, text) {
    var blob = new Blob([text], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTXT() {
    if (!window.currentTranscript) {
      return;
    }

    downloadBlob(buildExportFileName("Transcription", "txt"), window.currentTranscript);
  }

function generateSRT(segments) {
  if (!segments || segments.length === 0) return "";

  function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
  }

  return segments.map((seg, i) => {
    const start = formatTime(seg.timestamp[0]);
    const end = formatTime(seg.timestamp[1]);

    return `${i + 1}\n${start} --> ${end}\n${seg.text || seg.editedText || seg.originalText || ""}\n`;
  }).join('\n');
}

function generateVTT(segments) {
  if (!segments || segments.length === 0) return "";

  function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  return 'WEBVTT\n\n' + segments.map((seg, i) => {
    const start = formatTime(seg.timestamp[0]);
    const end = formatTime(seg.timestamp[1]);

    return `${start} --> ${end}\n${seg.text || seg.editedText || seg.originalText || ""}\n`;
  }).join('\n');
}

  function downloadSRT() {
    if (!window.currentSegments || window.currentSegments.length === 0) {
    return;
}

    var srt = generateSRT(window.currentSegments);
    downloadBlob(buildExportFileName("Transcription", "srt"), srt);
  }

  function getActiveTranscript() {
    var activeSegments = getActiveSegments();
    if (activeSegments.length) {
      return getSegmentsParagraphText(activeSegments, window.currentTab === "translated");
    }
    if (window.currentTab === "translated") {
      return window.translatedTranscript || "";
    }
    return window.currentTranscript || "";
  }

  function getActiveSegments() {
    return window.currentSegments || [];
  }

  function getSegmentText(segment, useTranslatedText) {
    var translated = cleanText(segment && segment.translatedText);
    var edited = cleanText(segment && segment.editedText);
    var original = cleanText(segment && (segment.originalText || segment.text));

    return fixPunctuation(useTranslatedText && translated ? translated : (edited || original));
  }

  function getSegmentsParagraphText(segments, useTranslatedText) {
    return (segments || []).map(function (segment) {
      return getSegmentText(segment, useTranslatedText);
    }).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function hasTranslatedSegments() {
    return (window.currentSegments || []).some(function (segment) {
      return !!cleanText(segment && segment.translatedText);
    });
  }

  function normalizePreviewSegments(segments) {
    return (segments || []).reduce(function (result, segment) {
      var timestamp = Array.isArray(segment && segment.timestamp)
        ? [segment.timestamp[0], segment.timestamp[1]]
        : (Number.isFinite(segment && segment.start) && Number.isFinite(segment && segment.end)
          ? [segment.start, segment.end]
          : null);
      var originalText = cleanText((segment && (segment.originalText || segment.text)) || "");
      var editedText = cleanText((segment && segment.editedText) || "");
      var translatedText = cleanText((segment && segment.translatedText) || "");

      if (!timestamp || !Number.isFinite(timestamp[0]) || !Number.isFinite(timestamp[1]) || timestamp[1] <= timestamp[0] || !originalText) {
        return result;
      }

      result.push({
        originalText: originalText,
        editedText: editedText,
        translatedText: translatedText,
        timestamp: timestamp
      });

      return result;
    }, []);
  }

  function formatTime(seconds) {
    var m = Math.floor((seconds || 0) / 60);
    var s = Math.floor((seconds || 0) % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function buildSubtitles(chunks) {
    var MAX_CHARS_PER_LINE = 42;
    var MAX_WORDS_PER_LINE = 6;

    function isValidTimestamp(timestamp) {
      return Array.isArray(timestamp) &&
        timestamp.length >= 2 &&
        Number.isFinite(timestamp[0]) &&
        Number.isFinite(timestamp[1]) &&
        timestamp[1] > timestamp[0];
    }

    function tokenizeText(text) {
      var matches = String(text || "").match(/\S+\s*/g);
      return matches ? matches : [];
    }

    function normalizeSegmentText(text) {
      return fixPunctuation(cleanText(text));
    }

    function getWordCount(text) {
      var matches = String(text || "").trim().match(/\S+/g);
      return matches ? matches.length : 0;
    }

    function needsSplit(text) {
      var normalized = normalizeSegmentText(text);
      return normalized.length > MAX_CHARS_PER_LINE || getWordCount(normalized) > MAX_WORDS_PER_LINE;
    }

    function isHardBreakToken(token) {
      return /[.\u061F!,]\s*$/.test(token);
    }

    function isSoftBreakToken(token) {
      return /[,;:]\s*$/.test(token);
    }

    function splitSegmentText(text) {
      var normalized = normalizeSegmentText(text);
      var tokens = tokenizeText(normalized);
      var parts = [];
      var currentTokens = [];

      function flushCurrent() {
        var value = normalizeSegmentText(currentTokens.join(""));
        if (value) {
          parts.push(value);
        }
        currentTokens = [];
      }

      if (!tokens.length) {
        return [];
      }

      tokens.forEach(function (token, index) {
        var currentText = currentTokens.join("");
        var candidate = normalizeSegmentText(currentText + token);
        var candidateWords = getWordCount(candidate);
        var candidateTooLong = candidate.length > MAX_CHARS_PER_LINE || candidateWords > MAX_WORDS_PER_LINE;
        var shouldFlushBeforeToken = currentTokens.length && candidateTooLong;
        var shouldFlushAfterToken = false;

        if (shouldFlushBeforeToken) {
          var trimmedCurrent = normalizeSegmentText(currentText);
          if (isHardBreakToken(trimmedCurrent) || isSoftBreakToken(trimmedCurrent)) {
            flushCurrent();
          } else if (isHardBreakToken(token) || isSoftBreakToken(token)) {
            currentTokens.push(token);
            flushCurrent();
            return;
          } else {
            flushCurrent();
          }
        }

        currentTokens.push(token);

        var updatedText = normalizeSegmentText(currentTokens.join(""));
        var updatedWords = getWordCount(updatedText);

        if ((updatedText.length > MAX_CHARS_PER_LINE || updatedWords > MAX_WORDS_PER_LINE) &&
            currentTokens.length > 1 &&
            (isHardBreakToken(token) || (isSoftBreakToken(token) && index < tokens.length - 1))) {
          shouldFlushAfterToken = true;
        }

        if (shouldFlushAfterToken) {
          flushCurrent();
        }
      });

      flushCurrent();

      if (!parts.length) {
        return normalized ? [normalized] : [];
      }

      return parts;
    }

    function distributeSegmentTiming(parts, start, end) {
      var totalDuration = end - start;
      var totalWeight = parts.reduce(function (sum, part) {
        return sum + Math.max(1, normalizeSegmentText(part).length);
      }, 0);
      var currentTime = start;

      return parts.map(function (part, index) {
        var weight = Math.max(1, normalizeSegmentText(part).length);
        var nextTime = index === parts.length - 1
          ? end
          : start + (totalDuration * ((parts.slice(0, index + 1).reduce(function (sum, value) {
              return sum + Math.max(1, normalizeSegmentText(value).length);
            }, 0)) / totalWeight));
        var item = {
          text: normalizeSegmentText(part),
          timestamp: [currentTime, nextTime]
        };

        currentTime = nextTime;
        return item;
      }).filter(function (item) {
        return item.text && item.timestamp[1] > item.timestamp[0];
      });
    }

    return (chunks || []).reduce(function (result, chunk) {
      var text = normalizeSegmentText(chunk && chunk.text);
      var timestamp = chunk && chunk.timestamp;

      if (!text || !isValidTimestamp(timestamp)) {
        return result;
      }

      if (!needsSplit(text)) {
        result.push({
          text: text,
          timestamp: [timestamp[0], timestamp[1]]
        });
        return result;
      }

      return result.concat(distributeSegmentTiming(splitSegmentText(text), timestamp[0], timestamp[1]));
    }, []);
  }

  function fixPunctuation(text) {
    return normalizeIncomingText(String(text || "")).replace(/\s+([\u061F.!])/g, "$1");
  }

  function detectTranscriptLanguage(text) {
    return /[\u0600-\u06FF]/.test(String(text || "")) ? "ar" : "en";
  }

  function buildSentenceSubtitles(segments) {
    const subtitles = [];

    let sentenceText = "";
    let sentenceStart = null;
    let sentenceEnd = null;
    let previousEnd = null;

    function endsWithSentencePunctuation(text) {
      return /[.\u061F!]$/.test(normalizeIncomingText(String(text || "")).trim());
    }

    segments.forEach(seg => {
      const text = getSegmentText(seg);
      if (!text) {
        return;
      }

      const segStart = seg.timestamp?.[0] ?? seg.start ?? 0;
      const segEnd = seg.timestamp?.[1] ?? seg.end ?? segStart;
      const gap = previousEnd !== null ? segStart - previousEnd : 0;

      const shouldBreak = sentenceText && (
        endsWithSentencePunctuation(sentenceText) ||
        gap > 1 ||
        sentenceText.length > 120
      );

      if (shouldBreak) {
        subtitles.push({
          text: sentenceText.trim(),
          start: sentenceStart || 0,
          end: sentenceEnd || sentenceStart || 0
        });

        sentenceText = "";
        sentenceStart = null;
        sentenceEnd = null;
      }

      if (!sentenceText) {
        sentenceStart = segStart;
        sentenceEnd = segEnd;
        sentenceText = text;
      } else {
        sentenceText += " " + text;
        sentenceEnd = segEnd;
      }

      previousEnd = segEnd;
    });

    if (sentenceText.trim()) {
      subtitles.push({
        text: sentenceText.trim(),
        start: sentenceStart || 0,
        end: sentenceEnd || sentenceStart || 0
      });
    }

    return subtitles;
  }

  async function translateSubtitles(subtitles, targetLang) {
    const translated = [];

    for (let i = 0; i < subtitles.length; i++) {
      const item = subtitles[i];

      const result = await translateText(item.text, targetLang);

      translated.push({
        text: result,
        start: item.start,
        end: item.end
      });
    }

    return translated;
  }

  function renderSegments(container, heading, segments, useTranslatedText) {
    var items = Array.isArray(segments) ? segments : [];
    var fullText = getSegmentsParagraphText(items, useTranslatedText);
    var lang = detectTranscriptLanguage(fullText);

    container.textContent = "";
    container.setAttribute("lang", lang);

    if (heading) {
      var headingEl = document.createElement("div");
      headingEl.className = "ts-segment";

      var headingText = document.createElement("div");
      headingText.className = "ts-text";
      headingText.textContent = heading;
      headingText.lang = lang;

      headingEl.appendChild(headingText);
      container.appendChild(headingEl);
    }

    var paragraphEl = document.createElement("div");
    paragraphEl.className = "ts-paragraph";
    paragraphEl.setAttribute("lang", lang);
    items.forEach(function (segment, index) {
      var start = Array.isArray(segment.timestamp)
        ? segment.timestamp[0]
        : (Number.isFinite(segment.start) ? segment.start : null);
      var lineText = getSegmentText(segment, useTranslatedText);
      var wrapper;
      var textEl;

      if (!lineText) {
        return;
      }

      wrapper = document.createElement("span");
      wrapper.className = "ts-sentence";

      textEl = document.createElement("span");
      textEl.className = "ts-segment-text";
      textEl.setAttribute("data-segment-editor", "1");
      textEl.setAttribute("data-index", String(index));
      textEl.contentEditable = previewEditMode ? "true" : "false";
      textEl.spellcheck = false;
      textEl.lang = lang;

      textEl.textContent = lineText;
      wrapper.appendChild(textEl);

      if (showTimestamps && start !== null) {
        var timeEl = document.createElement("span");
        timeEl.className = "ts-time-inline";
        timeEl.textContent = "[" + formatTime(start) + "]";
        wrapper.appendChild(timeEl);
      }

      paragraphEl.appendChild(wrapper);
      paragraphEl.appendChild(document.createTextNode(" "));
    });

    container.appendChild(paragraphEl);
  }

  function updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn) {
    if (!transcriptEl) {
      return;
    }

    // Preserve audio player reference before updating transcript UI
    var audioPlayer = document.getElementById("audio-player");

    var hasTranslation = hasTranslatedSegments();
    if (translatedTabBtn) {
      translatedTabBtn.style.display = hasTranslation ? "" : "none";
    }
    if (originalTabBtn) {
      originalTabBtn.classList.toggle("active", (window.currentTab || "original") === "original");
    }
    if (translatedTabBtn) {
      translatedTabBtn.classList.toggle("active", (window.currentTab || "original") === "translated");
    }
    updateEditButton(editBtn);

    if (window.currentTab === "translated" && hasTranslation) {
      renderSegments(
        transcriptEl,
        window.translatedTitle || "",
        getActiveSegments(),
        true
      );
    } else if (window.currentTab === "translated" && !hasTranslation) {
      transcriptEl.removeAttribute("lang");
      transcriptEl.textContent = "Translate your transcript to view it here.";
    } else if (window.currentTranscript) {
      window.currentTab = "original";
      renderSegments(
        transcriptEl,
        "",
        getActiveSegments(),
        false
      );
    } else {
      window.currentTab = "original";
      transcriptEl.removeAttribute("lang");
      transcriptEl.textContent = "Upload and transcribe a file to see results here.";
    }

    // Re-append audio player to ensure it's not accidentally removed
    if (audioPlayer && !document.getElementById("audio-player")) {
      var section = document.querySelector("section");
      if (section) {
        section.appendChild(audioPlayer);
      }
    }
  }

  function updateExportLabels(txtBtn, srtBtn, vttBtn) {
    if (txtBtn) {
      txtBtn.textContent = window.currentTab === "translated" ? "Download Translated TXT" : "Download TXT";
    }
    if (srtBtn) {
      srtBtn.textContent = window.currentTab === "translated" ? "Download Translated SRT" : "Download SRT";
    }
    if (vttBtn) {
      vttBtn.textContent = window.currentTab === "translated" ? "Download Translated VTT" : "Download VTT";
    }
  }

  function updateEditButton(editBtn) {
    var hasSegments = getActiveSegments().length > 0;
    if (!editBtn) {
      return;
    }

    editBtn.disabled = !hasSegments;
    editBtn.textContent = previewEditMode ? "Done" : "Edit";
  }

  function copyActiveTranscript(statusEl) {
    var activeText = getActiveTranscript();
    if (!activeText || !navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(activeText).then(function () {
      setStatus(statusEl, "Copied to clipboard", "ready");
    }).catch(function () {
    });
  }

  function downloadActiveTXT() {
    var activeText = getActiveTranscript();
    if (!activeText) {
      return;
    }

    var type = window.currentTab === "translated" ? "Translation" : "Transcription";
    downloadBlob(buildExportFileName(type, "txt"), activeText);
  }

  function downloadActiveSRT() {
    var activeText = getActiveTranscript();
    var activeSegments = getActiveSegments();
    if (!activeText || !activeSegments.length) {
      return;
    }

    var srt = generateSRT(activeSegments.map(function (segment) {
      return {
        text: getSegmentText(segment, window.currentTab === "translated"),
        timestamp: Array.isArray(segment.timestamp)
          ? segment.timestamp
          : [segment.start || 0, segment.end || segment.start || 0]
      };
    }));
    var type = window.currentTab === "translated" ? "Translation" : "Transcription";
    downloadBlob(buildExportFileName(type, "srt"), srt);
  }

  function downloadActiveVTT() {
    var activeText = getActiveTranscript();
    var activeSegments = getActiveSegments();
    if (!activeText || !activeSegments.length) {
      return;
    }

    var vtt = generateVTT(activeSegments.map(function (segment) {
      return {
        text: getSegmentText(segment, window.currentTab === "translated"),
        timestamp: Array.isArray(segment.timestamp)
          ? segment.timestamp
          : [segment.start || 0, segment.end || segment.start || 0]
      };
    }));
    var type = window.currentTab === "translated" ? "Translation" : "Transcription";
    downloadBlob(buildExportFileName(type, "vtt"), vtt);
  }

  function handleTranscriptionResult(text, segments) {
    var context = activeTranscriptionContext;
    if (!context) {
      return;
    }

    var rawText = text || "";
    var formattedText = rawText;

    if (formattedText) {
      formattedText = formattedText.replace(/\s+/g, " ").trim();
      formattedText = formattedText.replace(/([.\u061F!])\s*/g, "$1 ");
      formattedText = splitIntoLines(formattedText);

      if (!formattedText || !formattedText.trim()) {
        formattedText = rawText;
      }
    }

    if (formattedText) {
      previewEditMode = false;
      window.currentSegments = normalizePreviewSegments(segments || []);
      window.currentTranscript = getSegmentsParagraphText(window.currentSegments) || formattedText;
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      window.transcriptionSourceLanguage = context.language;
      window.currentTranscriptDuration = context.duration || 0;
      window.currentTab = "original";
      context.transcriptEl.textContent = window.currentTranscript;
      setExportButtonsState(context.copyBtn, context.txtBtn, context.srtBtn, context.vttBtn, true);
      setTranslationButtonsState(context.translateBtn, null, null, null, false);
      if (context.translateBtn) {
        context.translateBtn.disabled = false;
      }
      var chatgptBtn = document.getElementById("chatgptTranslateBtn");
      if (chatgptBtn) {
        chatgptBtn.disabled = false;
      }
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
      updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
      stopFakeProgress();
      stopProgressMessages();
      var finalProgress = 95;
      var finishInterval = setInterval(function () {
        finalProgress += 1;
        setProgress(finalProgress);

        if (finalProgress >= 100) {
          clearInterval(finishInterval);
        }
      }, 30);
      setStatus(context.statusEl, "Transcription complete", "ready");
      if (context.enhance) {
        setStatus(context.statusEl, "Audio enhanced for better accuracy", "ready");
        setTimeout(function () {
          if (window.currentTranscript === formattedText) {
            setStatus(context.statusEl, "Transcription complete", "ready");
          }
        }, 2500);
      }
    } else {
      previewEditMode = false;
      window.currentTranscript = "";
      window.currentSegments = [];
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      window.transcriptionSourceLanguage = "";
      window.currentTranscriptDuration = 0;
      context.transcriptEl.textContent = "Upload and transcribe a file to see results here.";
      setTranslationButtonsState(context.translateBtn, null, null, null, false);
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
      updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
      stopFakeProgress();
      stopProgressMessages();
      setProgress(0);
      setStatus(context.statusEl, "Transcription failed. Try a shorter or clearer file.", "error");
    }

    processingLocked = false;
    if (typeof context.afterRunCleanup === "function") {
      context.afterRunCleanup({
        keepResults: !!formattedText
      });
    }
    setTranscribeButtonState(context.startBtn, false);
    setEnhanceToggleState(document.getElementById("enhance-audio"), true);
    activeTranscriptionContext = null;
  }

  function handleTranslationResult(text, texts) {
    var context = activeTranslationContext;
    var translatedPayload = Array.isArray(texts) ? texts : [];
    var translatedLines = [];
    var rawTranslation = "";
    var translatedText = "";

    if (!context) {
      return;
    }

    if (translatedPayload.length) {
      rawTranslation = translatedPayload.length === 1
        ? String(translatedPayload[0] || "")
        : translatedPayload.map(function (chunk) {
          return String(chunk || "");
        }).join("\n");
      translatedLines = translatedPayload.map(function (chunk) {
        return String(chunk || "");
      });
    } else {
      rawTranslation = String(text || "");
      translatedLines = rawTranslation ? rawTranslation.split(/\r?\n/) : [];
    }

    if (translatedLines.length !== (window.currentSegments || []).length) {
      (window.currentSegments || []).forEach(function (segment) {
        segment.translatedText = segment.editedText || segment.originalText || "";
      });
      translatedText = getSegmentsParagraphText(window.currentSegments, true);
      window.translatedSubtitles = [];
      window.translatedTranscript = translatedText;
      window.currentTab = "translated";
      setTranslationButtonsState(context.translateBtn, null, null, null, true);
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
      updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
      if (context.transcriptEl) {
        context.transcriptEl.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
      setProgress(100);
      stopProgressMessages();
      setStatus(context.statusEl, "Translation line count mismatch. Showing original text.", "error");
      processingLocked = false;
      if (typeof context.afterRunCleanup === "function") {
        context.afterRunCleanup({
          keepResults: true
        });
      }
      activeTranslationContext = null;
      return;
    }

    if (!cleanTranslation(rawTranslation)) {
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      (window.currentSegments || []).forEach(function (segment) {
        segment.translatedText = "";
      });
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
      updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
      stopProgressMessages();
      setProgress(0);
      setStatus(context.statusEl, "Translation could not be completed. Try a shorter or clearer input.", "error");
      processingLocked = false;
      if (typeof context.afterRunCleanup === "function") {
        context.afterRunCleanup({
          keepResults: true
        });
      }
      activeTranslationContext = null;
      return;
    }

    setStatus(context.statusEl, "Finalizing translation...", "processing");
    setProgress(95);
    window.translatedTitle = "Translated (" + context.selectedLanguageName + " - AI Generated)";

    (window.currentSegments || []).forEach(function (segment, index) {
      var line = translatedLines[index] || "";
      var cleaned = cleanText(String(line || "").replace(/^\s*\[\d+\]\s*/, "").replace(/^\s*\d+\s*/, ""));
      segment.translatedText = cleaned || segment.originalText || "";
    });

    translatedText = getSegmentsParagraphText(window.currentSegments, true);
    window.translatedSubtitles = [];
    window.translatedTranscript = translatedText;
    window.currentTab = "translated";
    setTranslationButtonsState(context.translateBtn, null, null, null, true);
    updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
    updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
    if (context.transcriptEl) {
      context.transcriptEl.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
    setProgress(100);
    stopProgressMessages();
    setStatus(context.statusEl, "Translation complete", "ready");
    processingLocked = false;
    if (typeof context.afterRunCleanup === "function") {
      context.afterRunCleanup({
        keepResults: true
      });
    }
    activeTranslationContext = null;
  }

  worker.onmessage = function (e) {
    var type = e.data.type;
    var text = normalizeIncomingText(e.data.text);
    var segments = normalizeIncomingSegments(e.data.segments);
    var message = normalizeIncomingText(e.data.message);
    var progress = e.data.progress;

    if (type === "loading") {
      var loadingEl = document.getElementById("loading-status") || document.createElement("div");
      if (!loadingEl.id) {
        loadingEl.id = "loading-status";
        loadingEl.style.cssText = "position:fixed;top:0;left:0;width:100%;padding:12px;background:#4CAF50;color:#fff;text-align:center;z-index:9999;font-family:system-ui;";
        document.body.appendChild(loadingEl);
      }
      loadingEl.textContent = normalizeIncomingText(e.data.message || "Loading AI model...");
      return;
    }

    if (type === "loading_done") {
      var loadingEl = document.getElementById("loading-status");
      if (loadingEl) {
        loadingEl.textContent = "Transcribing audio...";
        setTimeout(function () {
          var el = document.getElementById("loading-status");
          if (el) el.remove();
        }, 500);
      }
      return;
    }

    if (type === "ready") {
      var readyEl = document.getElementById("loading-status");
      if (readyEl) {
        readyEl.textContent = "Transcribing audio...";
      }
      return;
    }

    if (e.data.type === "progress") {
      var percent = Math.round((e.data.current / e.data.total) * 100);
      setStatus("Transcribing audio... " + percent + "%");
      return;
    }

    if (type === "result") {
      const finalSegments = buildSubtitles(segments || []);
      window.currentSegments = finalSegments;
      console.log("Segments:", segments);
      console.log("Final Segments:", finalSegments);
      handleTranscriptionResult(
  normalizeArabicText(normalizeIncomingText(text)),
  finalSegments
);
    }

    if (type === "error") {
      var context = activeTranscriptionContext;
      processingLocked = false;
      if (context) {
        setStatus(context.statusEl, message || "Transcription failed", "error");
        stopFakeProgress();
        stopProgressMessages();
        setProgress(0);
        setTranscribeButtonState(context.startBtn, false);
        setEnhanceToggleState(document.getElementById("enhance-audio"), true);
        if (typeof context.afterRunCleanup === "function") {
          context.afterRunCleanup({
            keepResults: false
          });
        }
      }
      activeTranscriptionContext = null;
      if (message) {
        console.error("Transcription worker error:", message);
      }
    }

    if (type === "translation_progress") {
      if (activeTranslationContext) {
        setStatus(activeTranslationContext.statusEl, "Translating structured segments...", "processing");
        setProgress(50 + progress * 0.4);
      }
    }

    if (type === "translation_result") {
      handleTranslationResult(text, e.data.texts);
      srtContent = e.data.srt || "";
      vttContent = e.data.vtt || "";
      var downloadSRTBtn = document.getElementById("downloadSRT");
      var downloadVTTBtn = document.getElementById("downloadVTT");
      if (downloadSRTBtn) downloadSRTBtn.disabled = false;
      if (downloadVTTBtn) downloadVTTBtn.disabled = false;
    }

    if (type === "translation_error") {
      if (activeTranslationContext) {
        processingLocked = false;
        setTranslationButtonsState(activeTranslationContext.translateBtn, null, null, null, !!window.currentTranscript);
        updateTranscriptView(activeTranslationContext.transcriptEl, activeTranslationContext.originalTabBtn, activeTranslationContext.translatedTabBtn, activeTranslationContext.editBtn);
        updateExportLabels(activeTranslationContext.txtBtn, activeTranslationContext.srtBtn, activeTranslationContext.vttBtn);
        stopProgressMessages();
        setProgress(0);
        setStatus(activeTranslationContext.statusEl, message || "Translation could not be completed. Try a shorter or clearer input.", "error");
        if (typeof activeTranslationContext.afterRunCleanup === "function") {
          activeTranslationContext.afterRunCleanup({
            keepResults: true
          });
        }
      }
      activeTranslationContext = null;
      if (message) {
        console.error("Translation worker error:", message);
      }
    }
  };

  async function startTranscription(mode, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, vttBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn, editBtn, input, afterRunCleanup) {
    var audio = window.transcriptionAudio;

    // Prevent concurrent processing
    if (!audio || !audio.data || processingLocked) {
      return;
    }

    // Lock processing
    processingLocked = true;

    // Disable UI
    setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
    setTranscribeButtonState(startBtn, false);
    setTranslationButtonsState(translateBtn, null, null, null, false);
    input.disabled = true;

    try {
      var processedData = audio.data;
      var enhanceToggle = document.getElementById("enhance-audio");
      var enhance = enhanceToggle ? enhanceToggle.checked : false;
      setEnhanceToggleState(enhanceToggle, false);

      if (enhance) {
        try {
          setStatus(statusEl, "Enhancing audio...", "processing");
          processedData = normalizeAudio(processedData);
          processedData = trimSilence(processedData);

          if (!processedData || processedData.length === 0) {
            processedData = audio.data;
          }
        } catch (enhanceError) {
          console.error("Enhancement failed:", enhanceError);
          processedData = audio.data;
        }
      }

      setProgress(50);
      startFakeProgress(50, 90);
      startProgressMessages();
      setStatus(statusEl, "Downloading AI model...", "processing");
      var resampled = resampleTo16kHz(processedData, audio.sampleRate);
      console.log("Resampled samples:", resampled.length);
      console.log("Expected duration after resample (sec):", resampled.length / 16000);
      console.log("Resampled type:", resampled.constructor.name);
      console.log("Resampled length:", resampled.length);
      console.log("Buffer byteLength:", resampled.buffer.byteLength);
      activeTranscriptionContext = {
        language: language,
        enhance: enhance,
        statusEl: statusEl,
        transcriptEl: transcriptEl,
        copyBtn: copyBtn,
        txtBtn: txtBtn,
        srtBtn: srtBtn,
        vttBtn: vttBtn,
        startBtn: startBtn,
        translateBtn: translateBtn,
        originalTabBtn: originalTabBtn,
        translatedTabBtn: translatedTabBtn,
        editBtn: editBtn,
        duration: audio.duration,
        afterRunCleanup: afterRunCleanup
      };

      console.log("Sending audio to worker, length:", resampled.length);
      var selectedLanguage = language || "auto";

worker.postMessage(
  {
    type: "transcribe",
    audio: resampled.buffer,
    selectedLanguage: selectedLanguage
  },
  [resampled.buffer]
);
      return;
    } catch (error) {
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.transcriptionSourceLanguage = "";
      setTranslationButtonsState(translateBtn, null, null, null, false);
      updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
      updateExportLabels(txtBtn, srtBtn, vttBtn);
      console.error("Transcription error:", error);
      if (error && error.message === "MODEL_LOAD_FAILED") {
        setStatus(statusEl, "Failed to load AI model. Check your internet connection.", "error");
      } else {
        setStatus(statusEl, "Transcription failed. Try a shorter or clearer file.", "error");
      }
    } finally {
      // Unlock processing if transcription context not set (error occurred)
      if (!activeTranscriptionContext) {
        processingLocked = false;
        setTranscribeButtonState(startBtn, false);
        setEnhanceToggleState(document.getElementById("enhance-audio"), true);
        if (typeof afterRunCleanup === "function") {
          afterRunCleanup({
            keepResults: false
          });
        }
      }
    }
  }

  function bindTool(root, audioContext) {
    var input = root.querySelector(".at-file");
    var toolRoot = root.querySelector(".at-root");
    var fileNameEl = root.querySelector('[data-role="fileName"]');
    var statusEl = root.querySelector('[data-role="status"]');
    var transcriptEl = root.querySelector('[data-role="transcript"]');
    var copyBtn = root.querySelector('[data-role="copyTranscript"]');
    var txtBtn = root.querySelector('[data-role="downloadTxt"]');
    var srtBtn = root.querySelector('[data-role="downloadSrt"]');
    var vttBtn = root.querySelector('[data-download-vtt]');
    var startBtn = root.querySelector('[data-role="startTranscribe"]');
    var languageSelect = root.querySelector("#language-select");
    var translateBtn = root.querySelector('[data-role="translateBtn"]');
    var translateLanguage = root.querySelector("#translate-language");
    var tabButtons = root.querySelectorAll(".tab");
    var originalTabBtn = root.querySelector('.tab[data-tab="original"]');
    var translatedTabBtn = root.querySelector('.tab[data-tab="translated"]');
    var editBtn = root.querySelector('[data-role="toggleEdit"]');
    var restartBtn = root.querySelector('[data-role="restartBtn"]');
    var timestampCheckbox = root.querySelector('#show-timestamps');
    var modeSelect = root.querySelector('#modeSelect');
    var polishToggle = root.querySelector('#polishToggle');
    var audioPlayer = document.getElementById("audio-player");
    if (!input || input.dataset.transcribeToolBound === "1") {
      return;
    }

    function clearFileSelection() {
      if (root.__audioPreviewUrl) {
        URL.revokeObjectURL(root.__audioPreviewUrl);
        root.__audioPreviewUrl = "";
      }
      input.value = "";
      input.disabled = false;
      fileNameEl.textContent = "No file selected";
      if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.removeAttribute("src");
        audioPlayer.load();
        audioPlayer.style.display = "none";
      }
      if (toolRoot) {
        toolRoot.classList.remove("is-active");
      }
      window.transcriptionAudio = null;
    }

    function resetForNextUpload(options) {
      var keepResults = !!(options && options.keepResults);

      activeTranscriptionContext = null;
      activeTranslationContext = null;
      clearFileSelection();
      stopFakeProgress();
      stopProgressMessages();
      setProgress(0);
      setTranscribeButtonState(startBtn, false);
      setEnhanceToggleState(root.querySelector("#enhance-audio"), true);

      if (!keepResults) {
        previewEditMode = false;
        window.currentTranscript = "";
        window.currentSegments = [];
        window.translatedTranscript = "";
        window.translatedTitle = "";
        window.translatedSubtitles = [];
        window.transcriptionSourceLanguage = "";
        window.currentTranscriptDuration = 0;
        window.originalFileName = "";
        window.currentTab = "original";
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
        updateExportLabels(txtBtn, srtBtn, vttBtn);
        setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
        setTranslationButtonsState(translateBtn, null, null, null, false);
        var chatgptBtn = document.getElementById("chatgptTranslateBtn");
        if (chatgptBtn) {
          chatgptBtn.disabled = true;
        }
      } else if (translateBtn) {
        translateBtn.disabled = !window.currentTranscript;
      }
    }

    setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
    setTranscribeButtonState(startBtn, false);
    setTranslationButtonsState(translateBtn, null, null, null, false);
    var chatgptBtnInit = document.getElementById("chatgptTranslateBtn");
    if (chatgptBtnInit) {
      chatgptBtnInit.disabled = true;
    }
    updateEditButton(editBtn);
    window.currentSegments = [];
    window.translatedSubtitles = [];
    window.currentTranscriptDuration = 0;
    window.currentTab = "original";
    updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
    updateExportLabels(txtBtn, srtBtn, vttBtn);
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyActiveTranscript(statusEl);
      });
    }
    if (txtBtn) {
      txtBtn.addEventListener("click", function () {
        downloadActiveTXT();
      });
    }
    if (srtBtn) {
      srtBtn.addEventListener("click", function () {
        downloadActiveSRT();
      });
    }
    if (vttBtn) {
      vttBtn.addEventListener("click", function () {
        downloadActiveVTT();
      });
    }
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        if (!getActiveSegments().length) {
          return;
        }
        previewEditMode = !previewEditMode;
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
      });
    }
    if (restartBtn) {
      restartBtn.addEventListener("click", function () {
        // Stop any active processing
        stopFakeProgress();
        stopProgressMessages();

        // Clear any active transcription/translation context
        activeTranscriptionContext = null;
        activeTranslationContext = null;
        processingLocked = false;

        // Clear window state
        previewEditMode = false;
        window.currentTranscript = "";
        window.currentSegments = [];
        window.translatedTranscript = "";
        window.translatedTitle = "";
        window.translatedSubtitles = [];
        window.transcriptionSourceLanguage = "";
        window.currentTranscriptDuration = 0;
        window.originalFileName = "";
        window.currentTab = "original";

        // Clear file input and reset audio preview
        clearFileSelection();

        // Dispatch event so page script can restore upload UI
        window.dispatchEvent(new CustomEvent("transcribe-tool-restart"));

        // Re-render the entire tool DOM to get fresh UI state
        if (typeof window.initTranscribeTool === "function") {
          // Clear the bound attribute so re-binding works
          var newInput = root.querySelector(".at-file");
          if (newInput) {
            delete newInput.dataset.transcribeToolBound;
          }
          window.initTranscribeTool(root);
        }
      });
    }
    if (timestampCheckbox) {
      timestampCheckbox.checked = true;

      timestampCheckbox.addEventListener("change", function (e) {
        showTimestamps = e.target.checked;
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
      });
    }
    if (transcriptEl) {
      transcriptEl.addEventListener("input", function (event) {
        var target = event.target;
        var activeSegments;
        var index;
        var nextText;

        if (!target || target.getAttribute("data-segment-editor") !== "1") {
          return;
        }

        activeSegments = getActiveSegments();
        index = Number(target.getAttribute("data-index"));

        if (!Number.isInteger(index) || !activeSegments[index]) {
          return;
        }

        nextText = cleanText(target.textContent || "");

        if (window.currentTab === "translated") {
          activeSegments[index].translatedText = nextText;
          window.translatedTranscript = getSegmentsParagraphText(activeSegments, true);
        } else {
          activeSegments[index].editedText = nextText;
          window.currentTranscript = getSegmentsParagraphText(activeSegments);
        }
      });
    }

    if (tabButtons && tabButtons.length) {
      tabButtons.forEach(function (tabBtn) {
        tabBtn.addEventListener("click", function () {
          var nextTab = tabBtn.dataset.tab || "original";
          if (nextTab === "translated" && !window.translatedTranscript) {
            transcriptEl.textContent = "Translate your transcript to view it here.";
            return;
          }
          window.currentTab = nextTab;
          updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
          updateExportLabels(txtBtn, srtBtn, vttBtn);
        });
      });
    }
    if (startBtn) {
      startBtn.addEventListener("click", async function () {
        if (!window.transcriptionAudio || processingLocked) {
          return;
        }

        var modeNode = root.querySelector('input[name="mode"]:checked');
        var mode = modeNode ? modeNode.value : "fast";
        var language = languageSelect ? languageSelect.value : "auto";

        await startTranscription(mode, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, vttBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn, editBtn, input, resetForNextUpload);
      });
    }
    if (translateBtn) {
      translateBtn.addEventListener("click", async function () {
        if (processingLocked) {
          return;
        }
        var targetLang = translateLanguage ? translateLanguage.value : "";
        var mappedTarget = langMap[targetLang];
        var selectedLanguageName = translateLanguage && translateLanguage.options[translateLanguage.selectedIndex]
          ? translateLanguage.options[translateLanguage.selectedIndex].text
          : "Translated";
        var selectedLang = languageSelect ? languageSelect.value : "";
        var sourceLang = "eng_Latn";

        if (!window.currentSegments || !window.currentSegments.length || !targetLang) {
          return;
        }

        if (!mappedTarget) {
          setStatus(statusEl, "Unsupported language", "error");
          return;
        }

        if (selectedLang && langMap[selectedLang]) {
          sourceLang = langMap[selectedLang];
        }

        if (mappedTarget === sourceLang) {
          setStatus(statusEl, "Source and target languages are the same", "error");
          return;
        }

        if (selectedLang && selectedLang !== "auto" && targetLang === selectedLang) {
          setStatus(statusEl, "Selected language is same as original", "error");
          return;
        }

        var segmentsToTranslate = window.currentSegments || [];
        var linesToTranslate = segmentsToTranslate.map(function (segment) {
          var lineText = cleanText((segment && (segment.editedText || segment.originalText || segment.text)) || "");
          return lineText;
        }).filter(function (line) {
          return line.length > 0;
        });

        var textToTranslate = linesToTranslate.join("\n");

        setTranslationButtonsState(translateBtn, null, null, null, false);
        setStatus(statusEl, "Translating subtitles...", "processing");
        setProgress(50);
        startProgressMessages();
        processingLocked = true;
        activeTranslationContext = {
          statusEl: statusEl,
          transcriptEl: transcriptEl,
          translateBtn: translateBtn,
          txtBtn: txtBtn,
          srtBtn: srtBtn,
          vttBtn: vttBtn,
          originalTabBtn: originalTabBtn,
          translatedTabBtn: translatedTabBtn,
          editBtn: editBtn,
          selectedLanguageName: selectedLanguageName,
          lineCount: linesToTranslate.length,
          afterRunCleanup: resetForNextUpload
        };

        var useWhisperTranslate = mappedTarget === "en";

        worker.postMessage({
          type: "translate_subtitles",
          texts: linesToTranslate,
          segments: window.currentSegments || [],
          sourceLang: sourceLang,
          targetLang: mappedTarget,
          useWhisperTranslate: useWhisperTranslate,
          mode: modeSelect ? modeSelect.value : "accurate",
          polish: polishToggle ? polishToggle.checked : false
        });
      });
    }

    var chatgptTranslateBtn = root.querySelector('#chatgptTranslateBtn');
    if (chatgptTranslateBtn) {
      chatgptTranslateBtn.addEventListener("click", function() {
        var url = "https://chatgpt.com/g/g-69d22a427d808191b5d663806b8cdb00-freeaudiotrim-subtitle-translator";
        window.open(url, "_blank");
      });
    }

    input.dataset.transcribeToolBound = "1";
    input.addEventListener("change", async function (e) {
      if (processingLocked) {
        input.value = "";
        setStatus(statusEl, "Only one file can be processed at a time", "error");
        return;
      }

      // Get only the first file - ignore extra files
      var files = e && e.target && e.target.files ? e.target.files : [];
      var file = files.length > 0 ? files[0] : null;
      if (!file) {
        resetForNextUpload({
          keepResults: false
        });
        return;
      }

      if (files.length > 1) {
        input.value = "";
        resetForNextUpload({
          keepResults: false
        });
        setStatus(statusEl, "Only one file allowed", "error");
        return;
      }

      if (!isSupportedMediaFile(file)) {
        input.value = "";
        resetForNextUpload({
          keepResults: false
        });
        setStatus(statusEl, "Unsupported or corrupted file", "error");
        return;
      }
      if (toolRoot) {
        toolRoot.classList.add("is-active");
      }
      previewEditMode = false;
      activeTranslationContext = null;
      fileNameEl.textContent = file.name;
      window.originalFileName = file.name.replace(/\.[^/.]+$/, "");
      transcriptEl.textContent = "Upload and transcribe a file to see results here.";

      if (audioPlayer) {
        if (root.__audioPreviewUrl) {
          URL.revokeObjectURL(root.__audioPreviewUrl);
        }
        root.__audioPreviewUrl = URL.createObjectURL(file);
        audioPlayer.src = root.__audioPreviewUrl;
        audioPlayer.style.display = "block";
      }
      window.currentTranscript = "";
      window.currentSegments = [];
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      window.transcriptionSourceLanguage = "";
      window.currentTranscriptDuration = 0;
      setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
      setTranscribeButtonState(startBtn, false);
      setTranslationButtonsState(translateBtn, null, null, null, false);
      window.currentTab = "original";
      updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
      updateExportLabels(txtBtn, srtBtn, vttBtn);
      setProgress(0);

      // Validate browser support
      if (!audioContext) {
        resetForNextUpload({
          keepResults: false
        });
        setStatus(statusEl, "Your browser does not support audio processing", "error");
        return;
      }

      setStatus(statusEl, "Processing audio...", "processing");
      setProgress(10);

      try {
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        var arrayBuffer = await file.arrayBuffer();
        var audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        console.log("Decoded duration (sec):", audioBuffer.duration);
        console.log("Decoded samples:", audioBuffer.length);
        console.log("Sample rate:", audioBuffer.sampleRate);

        // Validate duration - reject if too long
        if (audioBuffer.duration > MAX_DURATION_SECONDS) {
          resetForNextUpload({
            keepResults: false
          });
          setStatus(statusEl, "File must be under 120 seconds", "error");
          return;
        }

        // Validate duration - reject if too short
        if (audioBuffer.duration < 1) {
          resetForNextUpload({
            keepResults: false
          });
          setStatus(statusEl, "Unsupported or corrupted file", "error");
          return;
        }

        var monoData = convertToMono(audioBuffer);

        window.transcriptionAudio = {
          sampleRate: audioBuffer.sampleRate,
          data: monoData,
          duration: audioBuffer.duration
        };

        setStatus(statusEl, "Audio ready for transcription", "ready");
        setProgress(30);
        setTranscribeButtonState(startBtn, true);
      } catch (error) {
        resetForNextUpload({
          keepResults: false
        });
        console.error("Audio decoding error:", error);
        setStatus(statusEl, "Unsupported or corrupted file", "error");
      }

    });
  }

  function initTranscribeTool(target) {
    injectStyles();
    var root = typeof target === "string" || !target ? document.querySelector(target || "#audio-tool") : target;
    if (!root) {
      return null;
    }

    if (root.__audioToolController && typeof root.__audioToolController.destroy === "function") {
      root.__audioToolController.destroy();
      root.__audioToolController = null;
    }

    mountMarkup(root, createMarkup());
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    var audioContext = root.__transcribeAudioContext;
    if (!audioContext && AudioContextCtor) {
      audioContext = new AudioContextCtor();
      root.__transcribeAudioContext = audioContext;
    }
    bindTool(root, audioContext);
    return root;
  }

  window.initTranscribeTool = initTranscribeTool;
})();

