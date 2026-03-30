(function () {
  "use strict";

  var STYLE_ID = "transcribe-tool-styles";
  var LARGE_FILE_BYTES = 50 * 1024 * 1024;
  var transcriber = null;
  var translator = null;
  var worker = new Worker("/assets/transcribe-worker.js", {
    type: "module"
  });
  var activeTranscriptionContext = null;
  var progressInterval = null;
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

  async function loadTranslator() {
    if (translator) {
      return translator;
    }

    var transformers = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js");
    translator = await transformers.pipeline(
      "translation",
      "Xenova/nllb-200-distilled-600M"
    );

    return translator;
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
      "  </div>",
      '  <div class="at-row">',
      '    <div class="mode-selector">',
      '      <div class="mode-card active" data-mode="fast">',
      '        <div class="mode-title">Fast</div>',
      '        <div class="mode-sub">Fastest</div>',
      '        <div class="mode-desc">Loads instantly. Best for quick drafts. Lower accuracy for noisy or non-English audio.</div>',
      "      </div>",
      '      <div class="mode-card" data-mode="accurate">',
      '        <div class="mode-title">Accurate</div>',
      '        <div class="mode-sub">Most Accurate</div>',
      '        <div class="mode-desc">Slower to load. Better accuracy for Arabic, accents, and longer recordings.</div>',
      "      </div>",
      "    </div>",
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

  function splitText(text, maxLength) {
    var safeMaxLength = maxLength == null ? 300 : maxLength;
    var sentences = text.split(/(?<=[.?!])\s+/);
    var chunks = [];
    var current = "";

    for (var i = 0; i < sentences.length; i += 1) {
      var sentence = sentences[i];
      if ((current + sentence).length > safeMaxLength) {
        if (current) {
          chunks.push(current.trim());
        }
        current = sentence;
      } else {
        current += " " + sentence;
      }
    }

    if (current) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
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
      var translatedHeading = window.translatedTitle ? window.translatedTitle + "\n\n" : "";
      transcriptEl.textContent = translatedHeading + window.translatedTranscript;
    } else if (window.currentTab === "translated" && !hasTranslation) {
      transcriptEl.textContent = "Translate your transcript to view it here.";
    } else if (window.currentTranscript) {
      window.currentTab = "original";
      transcriptEl.textContent = window.currentTranscript;
    } else {
      window.currentTab = "original";
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
      setProgress(0);
      setStatus(context.statusEl, "Transcription failed. Try a shorter or clearer file.", "error");
    }

    setTranscribeButtonState(context.startBtn, true);
    setEnhanceToggleState(document.getElementById("enhance-audio"), true);
    activeTranscriptionContext = null;
  }

  worker.onmessage = function (e) {
    var type = e.data.type;
    var text = e.data.text;
    var message = e.data.message;

    if (type === "result") {
      handleTranscriptionResult(text);
    }

    if (type === "error") {
      var context = activeTranscriptionContext;
      if (context) {
        setStatus(context.statusEl, "Transcription failed", "error");
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

      if (audio.duration > 120) {
        setStatus(statusEl, "Large audio detected. Transcription may take longer.", "processing");
      }
      setProgress(50);
      startFakeProgress(50, 90);
      setStatus(statusEl, "Transcribing audio...", "processing");
      var resampled = resampleTo16kHz(processedData, audio.sampleRate);
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

      worker.postMessage({
        type: "transcribe",
        audio: {
          data: resampled,
          sampleRate: 16000
        }
      });
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
    var modeCards = root.querySelectorAll(".mode-card");
    var selectedMode = "fast";

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
    if (modeCards && modeCards.length) {
      modeCards.forEach(function (card) {
        card.addEventListener("click", function () {
          modeCards.forEach(function (c) {
            c.classList.remove("active");
          });
          card.classList.add("active");
          selectedMode = card.dataset.mode || "fast";
        });
      });
    }
    if (startBtn) {
      startBtn.addEventListener("click", async function () {
        if (!window.transcriptionAudio) {
          return;
        }

        var mode = selectedMode;
        var language = languageSelect ? languageSelect.value : "auto";

        await startTranscription(mode, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn);
      });
    }
    if (translateBtn) {
      translateBtn.addEventListener("click", async function () {
        var modeNode = root.querySelector('input[name="tmode"]:checked');
        var mode = modeNode ? modeNode.value : "quick";
        var rawText = window.currentTranscript;
        var targetLang = translateLanguage ? translateLanguage.value : "";
        var mappedTarget = langMap[targetLang];
        var selectedLanguageName = translateLanguage && translateLanguage.options[translateLanguage.selectedIndex]
          ? translateLanguage.options[translateLanguage.selectedIndex].text
          : "Translated";
        var selectedLang = languageSelect ? languageSelect.value : "";
        var sourceLang = "eng_Latn";

        if (!rawText || !targetLang) {
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

        var inputText = cleanText(rawText);
        setTranslationButtonsState(translateBtn, null, null, null, false);
        setStatus(statusEl, "Analyzing text...", "processing");
        setProgress(50);

        try {
          var translationModel = await loadTranslator();
          var chunks = splitText(inputText, mode === "improved" ? 220 : 300);
          var finalText = "";

          for (var i = 0; i < chunks.length; i += 1) {
            if (!chunks[i] || chunks[i].trim().length < 2) {
              continue;
            }
            setProgress(50 + (i / chunks.length) * 40);
            setStatus(statusEl, "Translating part " + (i + 1) + " of " + chunks.length + "...", "processing");
            var translationResult = await translationModel(chunks[i], {
              src_lang: sourceLang,
              tgt_lang: mappedTarget
            });
            finalText += (translationResult && translationResult[0] ? translationResult[0].translation_text : "") + " ";
          }
          finalText = finalText
            .replace(/\s+/g, " ")
            .replace(/\s([.,!?])/g, "$1")
            .trim();
          var translatedText = cleanTranslation(finalText);

          if (!translatedText) {
            window.translatedTranscript = "";
            window.translatedTitle = "";
            updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
            setStatus(statusEl, "Translation could not be completed. Try a shorter or clearer input.", "error");
            return;
          }

          setStatus(statusEl, "Finalizing...", "processing");
          setProgress(95);
          await wait(300);
          window.translatedTranscript = translatedText;
          window.translatedTitle = "Translated (" + selectedLanguageName + " - AI Generated)";
          window.currentTab = "translated";
          setTranslationButtonsState(translateBtn, null, null, null, true);
          updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
          updateExportLabels(txtBtn, srtBtn);
          if (transcriptEl) {
            transcriptEl.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }
          setProgress(100);
          setStatus(statusEl, "Translation complete", "ready");
        } catch (translationError) {
          console.error("Translation error:", translationError);
          setTranslationButtonsState(translateBtn, null, null, null, !!window.currentTranscript);
          updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn);
          updateExportLabels(txtBtn, srtBtn);
          setProgress(0);
          setStatus(statusEl, "Translation could not be completed. Try a shorter or clearer input.", "error");
        } finally {
          if (translateBtn) {
            translateBtn.disabled = !window.currentTranscript;
          }
        }
      });
    }

    input.dataset.transcribeToolBound = "1";
    input.addEventListener("change", async function (e) {
      var file = e && e.target && e.target.files ? e.target.files[0] : null;
      if (!file) {
        fileNameEl.textContent = "No file selected";
        if (toolRoot) {
          toolRoot.classList.remove("is-active");
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
      fileNameEl.textContent = file.name;
      transcriptEl.textContent = "Upload and transcribe a file to see results here.";
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

        if (audioBuffer.duration > 180) {
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
          setStatus(statusEl, "For best performance, please use audio under 3 minutes.", "error");
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
