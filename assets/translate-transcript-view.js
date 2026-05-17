(function () {
  "use strict";

  var STORAGE_PREFIX = "fat:translation-view:v1:";
  var MAX_AGE_MS = 12 * 60 * 60 * 1000;
  var RTL_LANGS = new Set([
    "ar", "ara",
    "ur", "urd",
    "fa", "fas", "per", "pes",
    "ps", "pus",
    "he", "heb",
    "yi", "yid",
    "sd", "snd",
    "ku", "ckb"
  ]);
  var translateElementLoader = null;
  var translateElementConfiguredSource = "";
  var translateElementConfiguredTarget = "";
  var resolvedTimedTranslationCues = null;

  var COPY = {
    en: {
      brand: "FreeAudioTrim",
      subtitle: "Translation View",
      copy: "Copy source transcript",
      copied: "Source transcript copied.",
      timestamps: "Show timestamps",
      expiredTitle: "Translation session expired",
      expiredBody: "Return to the transcription tool, then open translation again from your edited transcript.",
      source: "Source",
      target: "Target",
      note: "Only the transcript content below is marked for translation.",
      translationPending: "Google Translate is preparing the transcript in ",
      translationFailed: "Google Translate could not start automatically in this browser. The transcript lines are still marked for translation, but you may need to retry in Chrome or allow Google scripts.",
      toolbarSource: "Source",
      toolbarTarget: "Target",
      toolbarStatePending: "Preparing translation…",
      toolbarStateReady: "Translation active",
      toolbarStateFailed: "Translation could not start",
      downloadTxt: "Download TXT",
      downloadSrt: "Download SRT",
      downloadVtt: "Download VTT",
      openedAt: "Opened",
      untitled: "Transcript",
      translateTxt: "Translate TXT",
      translateSrt: "Translate SRT",
      translateVtt: "Translate VTT"
    },
    ar: {
      brand: "FreeAudioTrim",
      subtitle: "عرض الترجمة",
      copy: "نسخ النص الأصلي",
      copied: "تم نسخ النص الأصلي.",
      timestamps: "إظهار التوقيتات",
      expiredTitle: "انتهت جلسة الترجمة",
      expiredBody: "ارجع إلى أداة التفريغ ثم افتح الترجمة مرة أخرى من النص المعدل.",
      source: "المصدر",
      target: "الهدف",
      note: "المحتوى القابل للترجمة هنا هو نص التفريغ فقط.",
      translationPending: "Google Translate يجهز ترجمة سطور التفريغ إلى ",
      translationFailed: "تعذر تشغيل Google Translate تلقائيًا في هذا المتصفح. سطور التفريغ ما زالت معلمة للترجمة، لكن قد تحتاج إلى إعادة المحاولة في Chrome أو السماح بسكربتات Google.",
      toolbarSource: "المصدر",
      toolbarTarget: "الهدف",
      toolbarStatePending: "جارٍ تجهيز الترجمة…",
      toolbarStateReady: "الترجمة مفعلة",
      toolbarStateFailed: "تعذر تشغيل الترجمة",
      downloadTxt: "تنزيل TXT",
      downloadSrt: "تنزيل SRT",
      downloadVtt: "تنزيل VTT",
      openedAt: "تم الفتح",
      untitled: "النص",
      translateTxt: "ترجمة TXT",
      translateSrt: "ترجمة SRT",
      translateVtt: "ترجمة VTT"
    }
  };

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }

  function getLangCode(lang) {
    var value = String(lang || "").toLowerCase();
    if (!value) {
      return "";
    }
    return value.split("-")[0].split("_")[0];
  }

  function getTextDirectionFromLanguage(lang) {
    var base = getLangCode(lang);
    if (!base) {
      return "auto";
    }
    return RTL_LANGS.has(base) ? "rtl" : "ltr";
  }

  function applyDirection(node, lang) {
    if (!node) {
      return;
    }
    var dir = getTextDirectionFromLanguage(lang);
    node.setAttribute("dir", dir);
    if (lang) {
      node.setAttribute("lang", lang);
    }
  }

  function formatTime(seconds, decimalSeparator) {
    var total = Math.max(0, Number(seconds) || 0);
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var remainder = total % 60;
    var wholeSeconds = Math.floor(remainder);
    var milliseconds = Math.round((remainder - wholeSeconds) * 1000);

    if (milliseconds === 1000) {
      milliseconds = 0;
      wholeSeconds += 1;
    }

    return String(hours).padStart(2, "0")
      + ":"
      + String(minutes).padStart(2, "0")
      + ":"
      + String(wholeSeconds).padStart(2, "0")
      + (decimalSeparator || ",")
      + String(milliseconds).padStart(3, "0");
  }

  function pruneStoredSessions() {
    try {
      var now = Date.now();
      var staleKeys = [];

      for (var index = 0; index < localStorage.length; index += 1) {
        var key = localStorage.key(index);
        if (!key || key.indexOf(STORAGE_PREFIX) !== 0) {
          continue;
        }

        try {
          var raw = localStorage.getItem(key);
          var payload = raw ? JSON.parse(raw) : null;
          var createdAt = payload && Number(payload.createdAt);
          if (!Number.isFinite(createdAt) || (now - createdAt) > MAX_AGE_MS) {
            staleKeys.push(key);
          }
        } catch (error) {
          staleKeys.push(key);
        }
      }

      staleKeys.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (error) {
    }
  }

  function loadPayload() {
    var sessionId = getQueryParam("session");
    if (!sessionId) {
      return null;
    }

    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + sessionId);
      if (!raw) {
        return null;
      }

      var payload = JSON.parse(raw);
      var createdAt = payload && Number(payload.createdAt);
      if (!Number.isFinite(createdAt) || (Date.now() - createdAt) > MAX_AGE_MS) {
        localStorage.removeItem(STORAGE_PREFIX + sessionId);
        return null;
      }

      return payload;
    } catch (error) {
      return null;
    }
  }

  function formatDate(value, uiLang) {
    var date = new Date(Number(value) || Date.now());
    try {
      return date.toLocaleString(uiLang === "ar" ? "ar" : "en", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function fillText(role, value) {
    var node = document.querySelector('[data-role="' + role + '"]');
    if (node) {
      node.textContent = value;
    }
  }

  function clearElement(node) {
    if (node) {
      node.textContent = "";
    }
  }

  function sanitizeFileBaseName(fileName) {
    var value = String(fileName || "").trim();
    if (!value) {
      return "Transcript";
    }
    value = value.replace(/\.[^/.]+$/, "");
    value = value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
    value = value.replace(/\s+/g, "_");
    value = value.replace(/_+/g, "_");
    value = value.replace(/^_+|_+$/g, "");
    return value || "Transcript";
  }

  function downloadTextFile(fileName, text) {
    var blob = new Blob(["\uFEFF", String(text || "")], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getTranslatedSegmentTexts(formatName) {
    var safeFormat = formatName === "srt" || formatName === "vtt" ? formatName : "txt";
    return Array.from(document.querySelectorAll('[data-role="panel-' + safeFormat + '"] [translate="yes"]')).map(function (node) {
      return String(node.textContent || "").trim();
    });
  }

  function buildTranslatedTxt(payload) {
    return getTranslatedSegmentTexts("txt").join("\n\n");
  }

  function normalizeTextSpacing(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitTextIntoSentences(text) {
    var normalized = normalizeTextSpacing(text);
    var matches;

    if (!normalized) {
      return [];
    }

    matches = normalized.match(/[^.!?؟。؛]+(?:[.!?؟。؛]+|$)/g);
    if (!matches || !matches.length) {
      return [normalized];
    }

    return matches.map(function (part) {
      return normalizeTextSpacing(part);
    }).filter(Boolean);
  }

  function getWordWeight(text) {
    var normalized = normalizeTextSpacing(text);
    if (!normalized) {
      return 1;
    }

    var tokens = normalized.split(" ").filter(Boolean);
    return Math.max(tokens.length, Math.ceil(normalized.length / 12), 1);
  }

  function allocateWeightedCounts(totalUnits, weights, requireOneEach) {
    var activeIndexes = [];
    var baseCounts = [];
    var weightedTotal = 0;
    var remainingUnits;
    var fractional = [];
    var distributed;

    weights.forEach(function (weight, index) {
      var safeWeight = Number(weight) || 0;
      baseCounts[index] = 0;
      if (safeWeight <= 0) {
        return;
      }

      activeIndexes.push(index);
      weightedTotal += safeWeight;
    });

    if (!activeIndexes.length || totalUnits <= 0) {
      return baseCounts;
    }

    if (requireOneEach && totalUnits <= activeIndexes.length) {
      activeIndexes.slice(0, totalUnits).forEach(function (index) {
        baseCounts[index] = 1;
      });
      return baseCounts;
    }

    if (requireOneEach) {
      activeIndexes.forEach(function (index) {
        baseCounts[index] = 1;
      });
    }
    remainingUnits = totalUnits - (requireOneEach ? activeIndexes.length : 0);

    activeIndexes.forEach(function (index) {
      var raw = weightedTotal > 0 ? (remainingUnits * weights[index]) / weightedTotal : 0;
      var floorValue = Math.floor(raw);
      baseCounts[index] += floorValue;
      fractional.push({
        index: index,
        remainder: raw - floorValue
      });
    });

    distributed = activeIndexes.reduce(function (sum, index) {
      return sum + baseCounts[index];
    }, 0);

    fractional.sort(function (a, b) {
      return b.remainder - a.remainder;
    });

    for (var cursor = 0; distributed < totalUnits; cursor += 1) {
      var target = fractional[cursor % fractional.length];
      baseCounts[target.index] += 1;
      distributed += 1;
    }

    return baseCounts;
  }

  function isSentenceBoundaryText(text) {
    return /[.!?؟。؛]["')\]]*\s*$/.test(String(text || ""));
  }

  function buildSourceSentenceGroups(segments) {
    var groups = [];
    var current = null;

    (segments || []).forEach(function (segment, index) {
      var text = normalizeTextSpacing(segment && segment.text);
      var timestamp = segment && Array.isArray(segment.timestamp) ? segment.timestamp : null;
      var start = timestamp && Number.isFinite(timestamp[0]) ? Number(timestamp[0]) : null;
      var end = timestamp && Number.isFinite(timestamp[1]) ? Number(timestamp[1]) : start;
      var duration;
      var wordCount;

      if (!text) {
        return;
      }

      if (start == null) {
        start = current && current.end != null ? current.end : 0;
      }
      if (end == null || end < start) {
        end = start;
      }

      if (!current) {
        current = {
          start: start,
          end: end,
          textParts: []
        };
      }

      current.end = Math.max(current.end, end);
      current.textParts.push(text);
      duration = current.end - current.start;
      wordCount = normalizeTextSpacing(current.textParts.join(" ")).split(" ").filter(Boolean).length;

      if (
        isSentenceBoundaryText(text)
        || duration >= 7.5
        || wordCount >= 20
        || current.textParts.length >= 4
        || index === (segments.length - 1)
      ) {
        groups.push({
          start: current.start,
          end: current.end,
          text: normalizeTextSpacing(current.textParts.join(" "))
        });
        current = null;
      }
    });

    if (current) {
      groups.push({
        start: current.start,
        end: current.end,
        text: normalizeTextSpacing(current.textParts.join(" "))
      });
    }

    return groups;
  }

  function buildFallbackOriginalCues(payload) {
    return (payload.segments || []).map(function (segment) {
      var timestamp = segment && Array.isArray(segment.timestamp) ? segment.timestamp : [0, 0];
      return {
        text: String(segment && segment.text || "").trim(),
        timestamp: [
          Number.isFinite(timestamp[0]) ? Number(timestamp[0]) : 0,
          Number.isFinite(timestamp[1]) ? Number(timestamp[1]) : 0
        ]
      };
    }).filter(function (cue) {
      return !!cue.text;
    });
  }

  function buildSentenceAwareTranslatedCues(payload) {
    var translatedSentences = splitTextIntoSentences(buildTranslatedTxt(payload));
    var sourceGroups = buildSourceSentenceGroups(payload.segments || []);
    var sentenceWeights;
    var groupCounts;
    var cursor;
    var cues = [];
    var totalStart;
    var totalEnd;
    var totalDuration;
    var totalWeight;
    var runningStart;

    if (!translatedSentences.length || !sourceGroups.length) {
      return [];
    }

    if (translatedSentences.length === 1) {
      return [{
        text: translatedSentences[0],
        timestamp: [sourceGroups[0].start, sourceGroups[sourceGroups.length - 1].end]
      }];
    }

    sentenceWeights = translatedSentences.map(getWordWeight);

    if (sourceGroups.length >= translatedSentences.length) {
      groupCounts = allocateWeightedCounts(sourceGroups.length, sentenceWeights, true);
      cursor = 0;

      translatedSentences.forEach(function (sentence, index) {
        var count = groupCounts[index] || 0;
        var slice;
        if (count <= 0) {
          return;
        }
        slice = sourceGroups.slice(cursor, cursor + count);
        cursor += count;
        if (!slice.length) {
          return;
        }
        cues.push({
          text: sentence,
          timestamp: [slice[0].start, slice[slice.length - 1].end]
        });
      });

      if (cues.length) {
        return cues;
      }
    }

    totalStart = sourceGroups[0].start;
    totalEnd = sourceGroups[sourceGroups.length - 1].end;
    totalDuration = Math.max(0.001, totalEnd - totalStart);
    totalWeight = sentenceWeights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0) || translatedSentences.length;
    runningStart = totalStart;

    translatedSentences.forEach(function (sentence, index) {
      var weight = sentenceWeights[index] || 1;
      var remainingWeight = sentenceWeights.slice(index).reduce(function (sum, value) {
        return sum + value;
      }, 0) || weight;
      var remainingDuration = totalEnd - runningStart;
      var span = index === translatedSentences.length - 1
        ? remainingDuration
        : Math.max(0.8, remainingDuration * (weight / remainingWeight));
      var end = index === translatedSentences.length - 1
        ? totalEnd
        : Math.min(totalEnd, runningStart + span);
      cues.push({
        text: sentence,
        timestamp: [runningStart, end]
      });
      runningStart = end;
    });

    return cues;
  }

  function getResolvedTimedTranslationCues(payload) {
    if (Array.isArray(resolvedTimedTranslationCues) && resolvedTimedTranslationCues.length) {
      return resolvedTimedTranslationCues;
    }

    return buildFallbackOriginalCues(payload);
  }

  function buildTranslatedSrt(payload) {
    return getResolvedTimedTranslationCues(payload).map(function (cue, index) {
      var translated = String(cue && cue.text || "").trim();
      var start = cue && cue.timestamp && cue.timestamp.length >= 2 ? formatTime(cue.timestamp[0], ",") : "00:00:00,000";
      var end = cue && cue.timestamp && cue.timestamp.length >= 2 ? formatTime(cue.timestamp[1], ",") : "00:00:00,000";
      return [
        String(index + 1),
        start + " --> " + end,
        translated
      ].join("\n");
    }).join("\n\n");
  }

  function buildTranslatedVtt(payload) {
    var body = getResolvedTimedTranslationCues(payload).map(function (cue, index) {
      var translated = String(cue && cue.text || "").trim();
      var start = cue && cue.timestamp && cue.timestamp.length >= 2 ? formatTime(cue.timestamp[0], ".") : "00:00:00.000";
      var end = cue && cue.timestamp && cue.timestamp.length >= 2 ? formatTime(cue.timestamp[1], ".") : "00:00:00.000";
      return [
        String(index + 1),
        start + " --> " + end,
        translated
      ].join("\n");
    }).join("\n\n");
    return "WEBVTT\n\n" + body;
  }

  function getActiveFormat() {
    var active = document.querySelector(".translation-format-btn.is-active");
    return active ? String(active.getAttribute("data-format-button") || "txt") : "txt";
  }

  function updateDownloadButton(button, uiCopy) {
    var formatName = getActiveFormat();
    if (!button) {
      return;
    }
    if (formatName === "srt") {
      button.textContent = uiCopy.downloadSrt;
      return;
    }
    if (formatName === "vtt") {
      button.textContent = uiCopy.downloadVtt;
      return;
    }
    button.textContent = uiCopy.downloadTxt;
  }

  function markTranslationBoundaries() {
    document.querySelectorAll('[translate="no"]').forEach(function (node) {
      if (!node.querySelector('[translate="yes"]')) {
        node.classList.add("notranslate");
      } else {
        node.classList.remove("notranslate");
      }
    });
    document.querySelectorAll('[translate="yes"]').forEach(function (node) {
      node.classList.remove("notranslate");
    });
  }

  function appendTranslateYesText(parent, text, lang, className) {
    var span = document.createElement("span");
    span.className = className || "";
    span.setAttribute("translate", "yes");
    span.textContent = String(text || "");
    applyDirection(span, lang);
    parent.appendChild(span);
  }

  function appendTranslateNoText(parent, text, className) {
    var span = document.createElement("span");
    span.className = className || "";
    span.setAttribute("translate", "no");
    span.textContent = String(text || "");
    parent.appendChild(span);
  }

  function renderTxtPanel(container, payload, showTimestamps) {
    clearElement(container);
    applyDirection(container, payload.sourceLanguageCode || "");
    var paragraph = document.createElement("div");
    paragraph.className = "translation-text translation-text-flow";
    appendTranslateYesText(
      paragraph,
      (payload.segments || []).map(function (segment) {
        return String(segment && segment.text || "").trim();
      }).filter(Boolean).join(" "),
      payload.sourceLanguageCode || "",
      "translation-line-text"
    );
    container.appendChild(paragraph);
  }

  function renderTimedPanel(container, payload, showTimestamps, formatName, cues) {
    clearElement(container);
    applyDirection(container, payload.sourceLanguageCode || "");
    var items = Array.isArray(cues) && cues.length ? cues : buildFallbackOriginalCues(payload);

    if (formatName === "vtt") {
      var header = document.createElement("div");
      header.className = "translation-code-line";
      header.setAttribute("translate", "no");
      header.textContent = "WEBVTT";
      container.appendChild(header);
    }

    items.forEach(function (cue, index) {
      var text = String(cue && cue.text || "").trim();
      var timestamp = cue && Array.isArray(cue.timestamp) ? cue.timestamp : null;
      var block = document.createElement("div");
      var start;
      var end;

      if (!text) {
        return;
      }

      block.className = "translation-segment";

      if (showTimestamps && timestamp && timestamp.length >= 2) {
        start = formatTime(timestamp[0], formatName === "vtt" ? "." : ",");
        end = formatTime(timestamp[1], formatName === "vtt" ? "." : ",");

        if (formatName === "srt") {
          var cueNumber = document.createElement("div");
          cueNumber.className = "translation-code-line";
          cueNumber.setAttribute("translate", "no");
          cueNumber.textContent = String(index + 1);
          block.appendChild(cueNumber);
        }

        var timeRow = document.createElement("div");
        timeRow.className = "translation-code-line";
        timeRow.setAttribute("translate", "no");
        timeRow.textContent = start + " --> " + end;
        block.appendChild(timeRow);
      }

      var textRow = document.createElement("div");
      textRow.className = "translation-code-line";
      appendTranslateYesText(textRow, text, payload.sourceLanguageCode || "", "translation-line-text");
      block.appendChild(textRow);
      container.appendChild(block);
    });
  }

  function waitForGoogleTranslateCombo() {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var timer = window.setInterval(function () {
        var combo = document.querySelector(".goog-te-combo");
        if (combo) {
          window.clearInterval(timer);
          resolve(combo);
          return;
        }
        if ((Date.now() - started) > 12000) {
          window.clearInterval(timer);
          reject(new Error("Google Translate combo not found"));
        }
      }, 250);
    });
  }

  function loadGoogleTranslateElement(sourceLang, targetLang) {
    if (translateElementLoader
      && translateElementConfiguredSource === sourceLang
      && translateElementConfiguredTarget === targetLang) {
      return translateElementLoader;
    }

    translateElementConfiguredSource = sourceLang;
    translateElementConfiguredTarget = targetLang;
    translateElementLoader = new Promise(function (resolve, reject) {
      var script;
      var callbackName = "__fatGoogleTranslateElementInit";

      window[callbackName] = function () {
        try {
          if (!window.google || !window.google.translate || !window.google.translate.TranslateElement) {
            reject(new Error("Google Translate API unavailable"));
            return;
          }

          new window.google.translate.TranslateElement({
            pageLanguage: sourceLang || "auto",
            includedLanguages: targetLang || "",
            autoDisplay: false,
            multilanguagePage: true
          }, "google_translate_element");

          waitForGoogleTranslateCombo().then(resolve).catch(reject);
        } catch (error) {
          reject(error);
        }
      };

      script = document.createElement("script");
      script.src = "https://translate.google.com/translate_a/element.js?cb=" + callbackName;
      script.async = true;
      script.onerror = function () {
        reject(new Error("Could not load Google Translate script"));
      };
      document.head.appendChild(script);
    });

    return translateElementLoader;
  }

  function dispatchChange(node) {
    if (!node) {
      return;
    }
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getTranslatableTextNodes() {
    return Array.from(document.querySelectorAll('[translate="yes"]'));
  }

  function getTranslatableTextSnapshot() {
    return getTranslatableTextNodes().map(function (node) {
      return String(node.textContent || "").trim();
    });
  }

  function hasTranslatedSnapshotChanged(beforeSnapshot) {
    var afterSnapshot = getTranslatableTextSnapshot();
    var length = Math.max(beforeSnapshot.length, afterSnapshot.length);
    var index;

    for (index = 0; index < length; index += 1) {
      if (String(beforeSnapshot[index] || "") !== String(afterSnapshot[index] || "")) {
        return true;
      }
    }

    return false;
  }

  function waitForTranslatedContent(beforeSnapshot, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var timer = window.setInterval(function () {
        if (hasTranslatedSnapshotChanged(beforeSnapshot)) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }

        if ((Date.now() - started) > (timeoutMs || 8000)) {
          window.clearInterval(timer);
          reject(new Error("Translated content did not appear"));
        }
      }, 250);
    });
  }

  function applyInlineTranslation(sourceLang, targetLang) {
    var normalizedSource = getLangCode(sourceLang || "") || "auto";
    var normalizedTarget = getLangCode(targetLang || "");
    var beforeSnapshot = getTranslatableTextSnapshot();

    if (!normalizedTarget) {
      return Promise.resolve(false);
    }

    return loadGoogleTranslateElement(normalizedSource, normalizedTarget).then(function (combo) {
      function applyTargetSelection() {
        if (combo.value === normalizedTarget) {
          combo.value = normalizedSource === "auto" ? "" : normalizedSource;
          dispatchChange(combo);
        }

        combo.value = normalizedTarget;
        dispatchChange(combo);
      }

      if (!combo) {
        return false;
      }

      return new Promise(function (resolve, reject) {
        var attempts = 0;
        var maxAttempts = 3;

        function attemptTranslation() {
          attempts += 1;
          applyTargetSelection();

          waitForTranslatedContent(beforeSnapshot, 3500).then(function () {
            resolve(true);
          }).catch(function () {
            if (attempts >= maxAttempts) {
              reject(new Error("Google Translate did not apply the target language"));
              return;
            }

            window.setTimeout(attemptTranslation, 450);
          });
        }

        window.setTimeout(attemptTranslation, 150);
      });
    });
  }

  function activateFormat(formatName) {
    ["txt", "srt", "vtt"].forEach(function (name) {
      var button = document.querySelector('[data-format-button="' + name + '"]');
      var panel = document.querySelector('[data-role="panel-' + name + '"]');
      if (button) {
        button.classList.toggle("is-active", name === formatName);
      }
      if (panel) {
        panel.classList.toggle("is-hidden", name !== formatName);
      }
    });
  }

  function showEmpty(uiCopy, uiLang) {
    document.documentElement.lang = uiLang;
    document.documentElement.dir = uiLang === "ar" ? "rtl" : "ltr";
    if (document.body) {
      document.body.dir = uiLang === "ar" ? "rtl" : "ltr";
    }
    var empty = document.querySelector('[data-role="empty"]');
    var card = document.querySelector('[data-role="card"]');
    if (card) {
      card.classList.add("is-hidden");
    }
    if (empty) {
      empty.classList.remove("is-hidden");
    }
    fillText("emptyTitle", uiCopy.expiredTitle);
    fillText("emptyBody", uiCopy.expiredBody);
  }

  function init() {
    pruneStoredSessions();

    var payload = loadPayload();
    var uiLang = payload && payload.uiLang === "ar" ? "ar" : "en";
    var uiCopy = COPY[uiLang];

    if (!payload || !payload.transcriptText || !Array.isArray(payload.segments) || !payload.segments.length) {
      showEmpty(uiCopy, uiLang);
      return;
    }

    document.documentElement.lang = uiLang;
    document.documentElement.dir = uiLang === "ar" ? "rtl" : "ltr";
    if (document.body) {
      document.body.dir = uiLang === "ar" ? "rtl" : "ltr";
    }

    var card = document.querySelector('[data-role="card"]');
    var txtPanel = document.querySelector('[data-role="panel-txt"]');
    var srtPanel = document.querySelector('[data-role="panel-srt"]');
    var vttPanel = document.querySelector('[data-role="panel-vtt"]');
    var copyBtn = document.querySelector('[data-role="copyBtn"]');
    var downloadActiveBtn = document.querySelector('[data-role="downloadActiveBtn"]');
    var timestampsToggle = document.querySelector('[data-role="timestampsToggle"]');
    var title = payload.fileName || payload.title || uiCopy.untitled;
    var noteEl = document.querySelector('[data-role="note"]');
    var toolbarStateEl = document.querySelector('[data-role="toolbarState"]');
    var renderAllPanels = function () {
      var showTimestamps = !!(timestampsToggle && timestampsToggle.checked);
      resolvedTimedTranslationCues = null;
      renderTxtPanel(txtPanel, payload, showTimestamps);
      renderTimedPanel(srtPanel, payload, showTimestamps, "srt");
      renderTimedPanel(vttPanel, payload, showTimestamps, "vtt");
      markTranslationBoundaries();
      if (noteEl) {
        noteEl.textContent = uiCopy.translationPending + (payload.targetLanguageName || payload.targetLanguageCode || uiCopy.untitled) + ".";
      }
      if (toolbarStateEl) {
        toolbarStateEl.textContent = uiCopy.toolbarStatePending;
      }
      applyInlineTranslation(payload.sourceLanguageCode, payload.targetLanguageCode).then(function () {
        resolvedTimedTranslationCues = buildSentenceAwareTranslatedCues(payload);
        renderTimedPanel(srtPanel, payload, showTimestamps, "srt", resolvedTimedTranslationCues);
        renderTimedPanel(vttPanel, payload, showTimestamps, "vtt", resolvedTimedTranslationCues);
        if (noteEl) {
          noteEl.textContent = uiCopy.note;
        }
        if (toolbarStateEl) {
          toolbarStateEl.textContent = uiCopy.toolbarStateReady;
        }
      }).catch(function () {
        if (noteEl) {
          noteEl.textContent = uiCopy.translationFailed;
        }
        if (toolbarStateEl) {
          toolbarStateEl.textContent = uiCopy.toolbarStateFailed;
        }
      });
    };

    document.title = title + " - " + uiCopy.subtitle;
    if (card) {
      card.classList.remove("is-hidden");
    }

    fillText("brand", uiCopy.brand);
    fillText("subtitle", uiCopy.subtitle);
    fillText("title", title);
    fillText("meta", uiCopy.openedAt + ": " + formatDate(payload.createdAt, uiLang));
    fillText("sourceChip", uiCopy.source + ": " + (payload.sourceLanguageName || payload.sourceLanguageCode || uiCopy.untitled));
    fillText("targetChip", uiCopy.target + ": " + (payload.targetLanguageName || payload.targetLanguageCode || uiCopy.untitled));
    fillText("toolbarSource", uiCopy.toolbarSource + ": " + (payload.sourceLanguageName || payload.sourceLanguageCode || uiCopy.untitled));
    fillText("toolbarTarget", uiCopy.toolbarTarget + ": " + (payload.targetLanguageName || payload.targetLanguageCode || uiCopy.untitled));
    fillText("toolbarState", uiCopy.toolbarStatePending);
    fillText("note", uiCopy.translationPending + (payload.targetLanguageName || payload.targetLanguageCode || uiCopy.untitled) + ".");
    fillText("copyBtn", uiCopy.copy);
    updateDownloadButton(downloadActiveBtn, uiCopy);
    fillText("timestampsLabel", uiCopy.timestamps);
    fillText("txtBtn", uiCopy.translateTxt);
    fillText("srtBtn", uiCopy.translateSrt);
    fillText("vttBtn", uiCopy.translateVtt);

    if (timestampsToggle) {
      timestampsToggle.checked = !!payload.showTimestamps;
      timestampsToggle.addEventListener("change", renderAllPanels);
    }

    document.querySelectorAll("[data-format-button]").forEach(function (button) {
      button.addEventListener("click", function () {
        activateFormat(button.getAttribute("data-format-button") || "txt");
        updateDownloadButton(downloadActiveBtn, uiCopy);
      });
    });

    if (downloadActiveBtn) {
      downloadActiveBtn.addEventListener("click", function () {
        var fileBase = sanitizeFileBaseName(payload.fileName || payload.title || uiCopy.untitled);
        var activeFormat = getActiveFormat();
        if (activeFormat === "srt") {
          downloadTextFile(fileBase + "_translated.srt", buildTranslatedSrt(payload));
          return;
        }
        if (activeFormat === "vtt") {
          downloadTextFile(fileBase + "_translated.vtt", buildTranslatedVtt(payload));
          return;
        }
        downloadTextFile(fileBase + "_translated.txt", buildTranslatedTxt(payload));
      });
    }

    if (copyBtn && navigator.clipboard && navigator.clipboard.writeText) {
      copyBtn.addEventListener("click", function () {
        navigator.clipboard.writeText(String(payload.transcriptText || "")).then(function () {
          copyBtn.textContent = uiCopy.copied;
          window.setTimeout(function () {
            copyBtn.textContent = uiCopy.copy;
          }, 1800);
        }).catch(function () {
        });
      });
    }

    renderAllPanels();
    activateFormat("txt");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
