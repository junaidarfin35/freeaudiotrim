(function () {
  "use strict";

  var STYLE_ID = "transcribe-tool-styles";
  var LARGE_FILE_BYTES = 50 * 1024 * 1024;
  var transcriber = null;
  var worker = new Worker("/assets/transcribe-worker.js", {
    type: "module"
  });
  var activeTranscriptionContext = null;
  var activeTranslationContext = null;
  var progressInterval = null;
  var progressMessages = [
    "AI is working its magic...",
    "Loading model on your device...",
    "Good things take time...",
    "Optimizing for best accuracy...",
    "Almost there..."
  ];
  var progressMessageInterval = null;
  var showTimestamps = true;
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

  async function loadModel(modelName) {
    if (transcriber && transcriber.model === modelName) {
      return transcriber.instance;
    }

    try {
      var transformers = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js");
      var pipeline = transformers.pipeline;
      var instance = await pipeline(
        "automatic-speech-recognition",
        modelName
      );
      transcriber = {
        model: modelName,
        instance: instance
      };
    } catch (error) {
      throw new Error("MODEL_LOAD_FAILED");
    }

    return transcriber.instance;
  }

  function startProgressMessages() {
    var el = document.getElementById("progress-message");
    if (!el) return;

    var index = 0;
    el.textContent = progressMessages[0];

    progressMessageInterval = setInterval(function () {
      el.style.opacity = "0";

      setTimeout(function () {
        index = (index + 1) % progressMessages.length;
        el.textContent = progressMessages[index];
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
      "#audio-tool .ts-paragraph{direction:rtl;text-align:right;line-height:2;padding:12px 0}",
      "#audio-tool .ts-sentence{display:inline}",
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
      '  <div class="at-row translation-mode">',
      '    <label>Translation Quality:</label>',
      '    <label><input type="radio" name="tmode" value="quick" checked> Quick (Fast, basic translation)</label>',
      '    <label><input type="radio" name="tmode" value="improved"> Improved (Better for spoken or unclear audio)</label>',
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <button class="at-btn" id="translate-btn" data-role="translateBtn" disabled>Translate</button>',
      '    <p class="translation-hint">Best results with clear speech or standard language. Dialects may vary.</p>',
      "  </div>",
      '  <div class="at-row">',
      '    <button class="at-btn" data-role="copyTranscript" disabled>Copy</button>',
      '    <button class="at-btn" data-role="downloadTxt" disabled>Download TXT</button>',
      '    <button class="at-btn" data-role="downloadSrt" disabled>Download SRT</button>',
      "  </div>",
      "</div>"
    ].join("");
  }

  function setStatus(statusEl, message, state) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.dataset.statusState = state || "idle";
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

  function setExportButtonsState(copyBtn, txtBtn, srtBtn, enabled) {
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

  function normalizeText(text) {
    return cleanText(text);
  }

  function improveSpeechStructure(text) {
    return String(text || "")
      .replace(/\n+/g, ". ")
      .replace(/ و/g, ". و")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitIntoSentences(text) {
    var normalized = cleanText(text);

    if (!normalized) {
      return [];
    }

    return normalized
      .split(/(?<=[.!?؟])\s+|[\r\n]+/)
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
    return String(text || "").split(/(?<=[.؟!])\s+/).join("\n");
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

    downloadBlob("transcript.txt", window.currentTranscript);
  }

  function generateSRT(text, duration) {
    if (!text) {
      return "";
    }

    // Use translated subtitles if available
    if (window.currentTab === "translated" && window.translatedSubtitles && window.translatedSubtitles.length > 0) {
      let srt = "";

      function formatTime(t) {
        var hours = Math.floor(t / 3600);
        var minutes = Math.floor((t % 3600) / 60);
        var seconds = (t % 60).toFixed(3);

        return (
          String(hours).padStart(2, "0") + ":" +
          String(minutes).padStart(2, "0") + ":" +
          seconds.padStart(6, "0").replace(".", ",")
        );
      }

      window.translatedSubtitles.forEach(function (sub, index) {
        srt += String(index + 1) + "\n";
        srt += formatTime(sub.start) + " --> " + formatTime(sub.end) + "\n";
        srt += sub.text + "\n\n";
      });

      return srt;
    }

    // Use real timestamps if available
    if (window.currentSegments && window.currentSegments.length > 0) {
      const subtitles = buildSentenceSubtitles(window.currentSegments);
      let srt = "";

      function formatTime(t) {
        var hours = Math.floor(t / 3600);
        var minutes = Math.floor((t % 3600) / 60);
        var seconds = (t % 60).toFixed(3);

        return (
          String(hours).padStart(2, "0") + ":" +
          String(minutes).padStart(2, "0") + ":" +
          seconds.padStart(6, "0").replace(".", ",")
        );
      }

      subtitles.forEach(function (sub, index) {
        srt += String(index + 1) + "\n";
        srt += formatTime(sub.start) + " --> " + formatTime(sub.end) + "\n";
        srt += sub.text + "\n\n";
      });

      return srt;
    }

    // Fallback to fake timestamps
    var sentences = text.split(". ");
    var srt = "";

    function formatTime(t) {
      var hours = Math.floor(t / 3600);
      var minutes = Math.floor((t % 3600) / 60);
      var seconds = (t % 60).toFixed(3);

      return (
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        seconds.padStart(6, "0").replace(".", ",")
      );
    }

    if (sentences.length === 1) {
      srt += "1\n";
      srt += formatTime(0) + " --> " + formatTime(duration) + "\n";
      srt += sentences[0].trim() + "\n\n";
      return srt;
    }

    var chunkDuration = duration / sentences.length;

    sentences.forEach(function (sentence, index) {
      var start = index * chunkDuration;
      var end = (index + 1) * chunkDuration;

      srt += String(index + 1) + "\n";
      srt += formatTime(start) + " --> " + formatTime(end) + "\n";
      srt += sentence.trim() + "\n\n";
    });

    return srt;
  }

  function downloadSRT() {
    if (!window.currentTranscript || !window.transcriptionAudio) {
      return;
    }

    var srt = generateSRT(
      window.currentTranscript,
      window.transcriptionAudio.duration
    );

    downloadBlob("subtitles.srt", srt);
  }

  function getActiveTranscript() {
    if (window.currentTab === "translated") {
      return window.translatedTranscript || "";
    }
    return window.currentTranscript || "";
  }

  function formatTime(seconds) {
    var m = Math.floor((seconds || 0) / 60);
    var s = Math.floor((seconds || 0) % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function splitSentences(text) {
    return String(text || "").split(/(?<=[.؟!])\s+/);
  }

  function buildSentenceSegments(text, duration) {
    var sentences = splitSentences(text).filter(function (sentence) {
      return sentence && sentence.trim();
    });

    if (sentences.length === 0) {
      return [];
    }

    var step = (duration || 0) / sentences.length;
    var time = 0;

    return sentences.map(function (sentence) {
      var segment = {
        text: sentence.trim(),
        time: formatTime(time)
      };
      time += step;
      return segment;
    });
  }

  function buildSegmentsFromWhisper(segments) {
    return segments.map(seg => ({
      text: seg.text.trim(),
      time: formatTime(seg.timestamp[0])
    }));
  }

  function fixPunctuation(text) {
    return String(text || "").replace(/\s+([؟.!])/g, "$1");
  }

  function detectTranscriptLanguage(text) {
    return /[\u0600-\u06FF]/.test(String(text || "")) ? "ar" : "en";
  }

  function mergeSegments(segments) {
    const merged = [];
    let current = null;

    segments.forEach(seg => {
      const text = seg.text.trim();

      if (!current) {
        current = { ...seg, text };
        return;
      }

      const endsWithPunctuation = /[.؟!]/.test(current.text);

      // merge if:
      // - sentence is incomplete
      // - OR current is short
      if (!endsWithPunctuation || current.text.length < 80) {
        current.text += " " + text;
      } else {
        merged.push(current);
        current = { ...seg, text };
      }
    });

    if (current) merged.push(current);

    return merged;
  }

  function buildSentenceSubtitles(segments) {
    const subtitles = [];

    let currentText = "";
    let startTime = null;
    let endTime = null;

    segments.forEach(seg => {
      const text = seg.text.trim();
      const segStart = seg.timestamp?.[0] || 0;
      const segEnd = seg.timestamp?.[1] || segStart;

      if (startTime === null) startTime = segStart;

      currentText += " " + text;
      endTime = segEnd;

      const isLong = currentText.length > 120;
      const hasPause = (segEnd - segStart) > 1.2;
      const endsSentence = /[.؟!]/.test(text);

      if (endsSentence || isLong || hasPause) {
        subtitles.push({
          text: currentText.trim(),
          start: startTime,
          end: endTime
        });

        currentText = "";
        startTime = null;
        endTime = null;
      }
    });

    if (currentText.trim()) {
      subtitles.push({
        text: currentText.trim(),
        start: startTime || 0,
        end: endTime || startTime || 0
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

  function renderSegments(text, duration, container, heading, subtitles) {
    var segments = subtitles || (window.currentSegments && window.currentSegments.length > 0
      ? buildSentenceSubtitles(window.currentSegments).map(sub => ({ text: sub.text, time: formatTime(sub.start) }))
      : buildSentenceSegments(text, duration));
    var lang = detectTranscriptLanguage(text);

    container.innerHTML = "";
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

    if (!segments.length && text) {
      var block = document.createElement("div");
      block.className = "ts-segment";

      var sentenceEl = document.createElement("span");
      sentenceEl.className = "ts-sentence";
      sentenceEl.textContent = text;
      sentenceEl.lang = lang;

      block.appendChild(sentenceEl);
      container.appendChild(block);
      return;
    }

    var paragraphEl = document.createElement("div");
    paragraphEl.className = "ts-paragraph";
    paragraphEl.setAttribute("lang", lang);

    segments.forEach(function (segment) {
      var span = document.createElement("span");
      span.className = "ts-sentence";

      var text = fixPunctuation(segment.text);
      if (segment.time && showTimestamps) {
        text += " (" + segment.time + ")";
      }
      text += " ";

      span.textContent = text;
      paragraphEl.appendChild(span);
    });

    container.appendChild(paragraphEl);
  }

  function updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn) {
    if (!transcriptEl) {
      return;
    }

    var hasTranslation = !!window.translatedTranscript;
    if (translatedTabBtn) {
      translatedTabBtn.style.display = hasTranslation ? "" : "none";
    }
    if (originalTabBtn) {
      originalTabBtn.classList.toggle("active", (window.currentTab || "original") === "original");
    }
    if (translatedTabBtn) {
      translatedTabBtn.classList.toggle("active", (window.currentTab || "original") === "translated");
    }

    if (window.currentTab === "translated" && hasTranslation) {
      renderSegments(
        window.translatedTranscript,
        window.transcriptionAudio ? window.transcriptionAudio.duration : 0,
        transcriptEl,
        window.translatedTitle || "",
        window.translatedSubtitles ? window.translatedSubtitles.map(sub => ({ text: sub.text, time: formatTime(sub.start) })) : null
      );
    } else if (window.currentTab === "translated" && !hasTranslation) {
      transcriptEl.removeAttribute("lang");
      transcriptEl.textContent = "Translate your transcript to view it here.";
    } else if (window.currentTranscript) {
      window.currentTab = "original";
      renderSegments(
        window.currentTranscript,
        window.transcriptionAudio ? window.transcriptionAudio.duration : 0,
        transcriptEl
      );
    } else {
      window.currentTab = "original";
      transcriptEl.removeAttribute("lang");
      transcriptEl.textContent = "Upload and transcribe a file to see results here.";
    }
  }

  function updateExportLabels(txtBtn, srtBtn) {
    if (txtBtn) {
      txtBtn.textContent = window.currentTab === "translated" ? "Download Translated TXT" : "Download TXT";
    }
    if (srtBtn) {
      srtBtn.textContent = window.currentTab === "translated" ? "Download Translated SRT" : "Download SRT";
    }
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

    downloadBlob(window.currentTab === "translated" ? "translated.txt" : "transcript.txt", activeText);
  }

  function downloadActiveSRT() {
    var activeText = getActiveTranscript();
    if (!activeText || !window.transcriptionAudio) {
      return;
    }

    var srt = generateSRT(activeText, window.transcriptionAudio.duration);
    downloadBlob(window.currentTab === "translated" ? "translated.srt" : "subtitles.srt", srt);
  }

  function handleTranscriptionResult(text) {
    var context = activeTranscriptionContext;
    if (!context) {
      return;
    }

    var rawText = text || "";
    var formattedText = rawText;

    if (formattedText) {
      formattedText = formattedText.replace(/\s+/g, " ").trim();
      formattedText = formattedText.replace(/([.؟!])\s*/g, "$1 ");
      formattedText = splitIntoLines(formattedText);

      if (!formattedText || !formattedText.trim()) {
        formattedText = rawText;
      }
    }

    if (formattedText) {
      window.currentTranscript = formattedText;
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.transcriptionSourceLanguage = context.language;
      window.currentTab = "original";
      context.transcriptEl.textContent = formattedText;
      setExportButtonsState(context.copyBtn, context.txtBtn, context.srtBtn, true);
      setTranslationButtonsState(context.translateBtn, null, null, null, false);
      if (context.translateBtn) {
        context.translateBtn.disabled = false;
      }
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn);
      updateExportLabels(context.txtBtn, context.srtBtn);
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
      window.currentTranscript = "";
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.transcriptionSourceLanguage = "";
      context.transcriptEl.textContent = "Upload and transcribe a file to see results here.";
      setTranslationButtonsState(context.translateBtn, null, null, null, false);
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn);
      updateExportLabels(context.txtBtn, context.srtBtn);
      stopFakeProgress();
      stopProgressMessages();
      setProgress(0);
      setStatus(context.statusEl, "Transcription failed. Try a shorter or clearer file.", "error");
    }

    setTranscribeButtonState(context.startBtn, true);
    setEnhanceToggleState(document.getElementById("enhance-audio"), true);
    activeTranscriptionContext = null;
  }

  function handleTranslationResult(text, texts) {
    var context = activeTranslationContext;
    var translatedText = texts ? texts.join(" ") : cleanTranslation(text);

    if (!context) {
      return;
    }

    if (!translatedText) {
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn);
      updateExportLabels(context.txtBtn, context.srtBtn);
      stopProgressMessages();
      setProgress(0);
      setStatus(context.statusEl, "Translation could not be completed. Try a shorter or clearer input.", "error");
      activeTranslationContext = null;
      return;
    }

    setStatus(context.statusEl, "Finalizing translation...", "processing");
    setProgress(95);
    window.translatedTranscript = translatedText;
    window.translatedTitle = "Translated (" + context.selectedLanguageName + " - AI Generated)";
    if (texts) {
      // Rebuild subtitles with translated texts
      const translatedSubtitles = [];

      for (let i = 0; i < context.grouped.length; i++) {
        const group = context.grouped[i];
        const translatedText = texts[i] || "";

        // split translated chunk roughly back
        const parts = translatedText.split(/(?<=[.!?])\s+/);

        for (let j = 0; j < group.length; j++) {
          translatedSubtitles.push({
            ...group[j],
            text: parts[j] || parts[parts.length - 1] || ""
          });
        }
      }

      window.translatedSubtitles = translatedSubtitles;
    } else {
      window.translatedSubtitles = [];
    }
    window.currentTab = "translated";
    setTranslationButtonsState(context.translateBtn, null, null, null, true);
    updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn);
    updateExportLabels(context.txtBtn, context.srtBtn);
    if (context.transcriptEl) {
      context.transcriptEl.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
    setProgress(100);
    stopProgressMessages();
    setStatus(context.statusEl, "Translation complete", "ready");
    activeTranslationContext = null;
  }

  worker.onmessage = function (e) {
    var type = e.data.type;
    var text = e.data.text;
    var segments = e.data.segments;
    var message = e.data.message;
    var progress = e.data.progress;

    if (type === "result") {
      window.currentSegments = segments || [];
      handleTranscriptionResult(text);
    }

    if (type === "error") {
      var context = activeTranscriptionContext;
      if (context) {
        setStatus(context.statusEl, message || "Transcription failed", "error");
        stopFakeProgress();
        setProgress(0);
        setTranscribeButtonState(context.startBtn, true);
        setEnhanceToggleState(document.getElementById("enhance-audio"), true);
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
    }

    if (type === "translation_error") {
      if (activeTranslationContext) {
        setTranslationButtonsState(activeTranslationContext.translateBtn, null, null, null, !!window.currentTranscript);
        updateTranscriptView(activeTranslationContext.transcriptEl, activeTranslationContext.originalTabBtn, activeTranslationContext.translatedTabBtn);
        updateExportLabels(activeTranslationContext.txtBtn, activeTranslationContext.srtBtn);
        stopProgressMessages();
        setProgress(0);
        setStatus(activeTranslationContext.statusEl, message || "Translation could not be completed. Try a shorter or clearer input.", "error");
      }
      activeTranslationContext = null;
      if (message) {
        console.error("Translation worker error:", message);
      }
    }
  };

  async function startTranscription(mode, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn) {
    var audio = window.transcriptionAudio;

    if (!audio || !audio.data) {
      return;
    }

    try {
      setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
      setTranscribeButtonState(startBtn, false);
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

      if (mode === "accurate" && audio.duration > 180) {
        setStatus(statusEl, "Accurate mode supports shorter audio (under 3 minutes)", "error");
        return;
      }

      if (audio.duration > 120) {
        setStatus(statusEl, "Large audio detected. Transcription may take longer.", "processing");
      }
      setProgress(50);
      startFakeProgress(50, 90);
      startProgressMessages();
      setStatus(statusEl, mode === "accurate" ? "Loading accurate model..." : "Loading fast model...", "processing");
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
        startBtn: startBtn,
        translateBtn: translateBtn,
        originalTabBtn: originalTabBtn,
        translatedTabBtn: translatedTabBtn
      };

      console.log("Sending audio to worker, length:", resampled.length);
worker.postMessage(
  {
    type: "transcribe",
    audio: resampled.buffer
  },
  [resampled.buffer] // 🔥 THIS IS THE FIX
);
      return;
    } catch (error) {
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.transcriptionSourceLanguage = "";
      setTranslationButtonsState(translateBtn, null, null, null, false);
      updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
      updateExportLabels(txtBtn, srtBtn);
      console.error("Transcription error:", error);
      if (error && error.message === "MODEL_LOAD_FAILED") {
        setStatus(statusEl, "Failed to load AI model. Check your internet connection.", "error");
      } else {
        setStatus(statusEl, "Transcription failed. Try a shorter or clearer file.", "error");
      }
    } finally {
      if (!activeTranscriptionContext) {
        setTranscribeButtonState(startBtn, true);
        setEnhanceToggleState(document.getElementById("enhance-audio"), true);
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
    var startBtn = root.querySelector('[data-role="startTranscribe"]');
    var languageSelect = root.querySelector("#language-select");
    var translateBtn = root.querySelector('[data-role="translateBtn"]');
    var translateLanguage = root.querySelector("#translate-language");
    var tabButtons = root.querySelectorAll(".tab");
    var originalTabBtn = root.querySelector('.tab[data-tab="original"]');
    var translatedTabBtn = root.querySelector('.tab[data-tab="translated"]');
    var timestampCheckbox = root.querySelector('#show-timestamps');
    if (!input || input.dataset.transcribeToolBound === "1") {
      return;
    }

    setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
    setTranscribeButtonState(startBtn, false);
    setTranslationButtonsState(translateBtn, null, null, null, false);
    window.currentTab = "original";
    updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
    updateExportLabels(txtBtn, srtBtn);
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
    if (timestampCheckbox) {
      timestampCheckbox.checked = true;

      timestampCheckbox.addEventListener("change", function (e) {
        showTimestamps = e.target.checked;
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
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
          updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
          updateExportLabels(txtBtn, srtBtn);
        });
      });
    }
    if (startBtn) {
      startBtn.addEventListener("click", async function () {
        if (!window.transcriptionAudio) {
          return;
        }

        var modeNode = root.querySelector('input[name="mode"]:checked');
        var mode = modeNode ? modeNode.value : "fast";
        var language = languageSelect ? languageSelect.value : "auto";

        await startTranscription(mode, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn);
      });
    }
    if (translateBtn) {
      translateBtn.addEventListener("click", async function () {
        var modeNode = root.querySelector('input[name="tmode"]:checked');
        var translationMode = modeNode ? modeNode.value : "quick";
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

        const subtitles = buildSentenceSubtitles(window.currentSegments);

        function groupSubtitles(subtitles) {
          const groups = [];
          let current = [];
          let currentTextLength = 0;

          for (let i = 0; i < subtitles.length; i++) {
            current.push(subtitles[i]);
            currentTextLength += subtitles[i].text.length;

            // group 4–6 sentences OR until ~300–400 characters
            if (
              currentTextLength > 350 ||
              current.length >= 5
            ) {
              groups.push(current);
              current = [];
              currentTextLength = 0;
            }
          }

          if (current.length) {
            groups.push(current);
          }

          return groups;
        }

        const grouped = groupSubtitles(subtitles);

        const textsToTranslate = grouped.map(group =>
          group.map(s => s.text).join(" ")
        );

        setTranslationButtonsState(translateBtn, null, null, null, false);
        setStatus(statusEl, "Translating subtitles...", "processing");
        setProgress(50);
        startProgressMessages();
        activeTranslationContext = {
          statusEl: statusEl,
          transcriptEl: transcriptEl,
          translateBtn: translateBtn,
          txtBtn: txtBtn,
          srtBtn: srtBtn,
          originalTabBtn: originalTabBtn,
          translatedTabBtn: translatedTabBtn,
          selectedLanguageName: selectedLanguageName,
          grouped: grouped
        };

worker.postMessage({
  type: "translate_subtitles",
  texts: textsToTranslate,
  sourceLang: sourceLang,
  targetLang: mappedTarget
});
      });
    }

    input.dataset.transcribeToolBound = "1";
    input.addEventListener("change", async function (e) {
      var file = e && e.target && e.target.files ? e.target.files[0] : null;
      if (!file) {
        activeTranslationContext = null;
        fileNameEl.textContent = "No file selected";
        if (toolRoot) {
          toolRoot.classList.remove("is-active");
        }

        var audioPlayer = document.getElementById("audio-player");
        if (audioPlayer) {
          audioPlayer.src = "";
          audioPlayer.style.display = "none";
        }

        window.transcriptionAudio = null;
        window.currentTranscript = "";
        window.translatedTranscript = "";
        window.translatedTitle = "";
        window.transcriptionSourceLanguage = "";
        setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
        setTranscribeButtonState(startBtn, false);
        setTranslationButtonsState(translateBtn, null, null, null, false);
        window.currentTab = "original";
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
        updateExportLabels(txtBtn, srtBtn);
        setProgress(0);
        setStatus(statusEl, "Upload a file to begin transcription", "idle");
        return;
      }
      if (toolRoot) {
        toolRoot.classList.add("is-active");
      }
      activeTranslationContext = null;
      fileNameEl.textContent = file.name;
      transcriptEl.textContent = "Upload and transcribe a file to see results here.";

      var audioPlayer = document.getElementById("audio-player");
      if (audioPlayer) {
        audioPlayer.src = URL.createObjectURL(file);
        audioPlayer.style.display = "block";
      }
      window.currentTranscript = "";
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.transcriptionSourceLanguage = "";
      setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
      setTranscribeButtonState(startBtn, false);
      setTranslationButtonsState(translateBtn, null, null, null, false);
      window.currentTab = "original";
      updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
      updateExportLabels(txtBtn, srtBtn);
      setProgress(0);
      if (!audioContext) {
        window.transcriptionAudio = null;
        window.currentTranscript = "";
        window.translatedTranscript = "";
        window.translatedTitle = "";
        window.transcriptionSourceLanguage = "";
        setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
        setTranscribeButtonState(startBtn, false);
        setTranslationButtonsState(translateBtn, null, null, null, false);
        setStatus(statusEl, "Your browser does not support audio processing.", "error");
        return;
      }

      if (file.size > LARGE_FILE_BYTES) {
        setStatus(statusEl, "Large file detected. Processing may take longer.", "processing");
      } else {
        setStatus(statusEl, "Processing audio...", "processing");
      }
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
        var monoData = convertToMono(audioBuffer);

        window.transcriptionAudio = {
          sampleRate: audioBuffer.sampleRate,
          data: monoData,
          duration: audioBuffer.duration
        };

        if (audioBuffer.duration < 1) {
          window.currentTranscript = "";
          window.translatedTranscript = "";
          window.translatedTitle = "";
          window.transcriptionSourceLanguage = "";
          setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
          setTranscribeButtonState(startBtn, false);
          setTranslationButtonsState(translateBtn, null, null, null, false);
          window.currentTab = "original";
          updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
          updateExportLabels(txtBtn, srtBtn);
          setStatus(statusEl, "Audio too short to transcribe.", "error");
          return;
        }

        setStatus(statusEl, "Audio ready for transcription", "ready");
        setProgress(30);
        setTranscribeButtonState(startBtn, true);
      } catch (error) {
        window.transcriptionAudio = null;
        window.currentTranscript = "";
        window.translatedTranscript = "";
        window.translatedTitle = "";
        window.transcriptionSourceLanguage = "";
        setExportButtonsState(copyBtn, txtBtn, srtBtn, false);
        setTranscribeButtonState(startBtn, false);
        setTranslationButtonsState(translateBtn, null, null, null, false);
        window.currentTab = "original";
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
        updateExportLabels(txtBtn, srtBtn);
        setProgress(0);
        console.error("Audio decoding error:", error);
        setStatus(statusEl, "Unable to process this file. Try another format.", "error");
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

    root.innerHTML = createMarkup();
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
