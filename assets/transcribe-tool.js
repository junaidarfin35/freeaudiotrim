(function () {
  "use strict";

  var srtContent = "";
  var vttContent = "";
  var MAX_DURATION_SECONDS = 180;
  var FRIENDLY_WARNING_SECONDS = 150;
  var TRANSCRIBE_WORKER_URL = "/assets/transcribe-worker.js?v=2026-05-03-1";
  var worker = null;
  var workerGeneration = 0;
  var processingLocked = false;
  var activeTranscriptionContext = null;
  var activeTranslationContext = null;
  var modelWarmState = "idle";
  var modelUnloadPending = false;
  var activePreparedModelKey = "";
  var pendingModelRequestKey = "";
  var progressInterval = null;
  var progressMessageInterval = null;
  var idleUnloadTimer = null;
  var lockHeartbeatTimer = null;
  var lockRetryTimer = null;
  var TRANSCRIPTION_MODELS = [
    {
      key: "baby-raptor",
      label: "Baby Raptor",
      helper: "Fastest multilingual mode for weaker phones.",
      icon: "/assets/transcription-models/baby-raptor.png",
      modelId: "onnx-community/whisper-base_timestamped"
    },
    {
      key: "triceratop",
      label: "Triceratop",
      helper: "Balanced multilingual mode for most devices.",
      icon: "/assets/transcription-models/triceratop.png",
      modelId: "onnx-community/whisper-small_timestamped"
    },
    {
      key: "t-rex",
      label: "T-Rex",
      helper: "Best multilingual accuracy for stronger desktops.",
      icon: "/assets/transcription-models/t-rex.png",
      modelId: "onnx-community/whisper-large-v3-turbo_timestamped"
    }
  ];
  var DEFAULT_TRANSCRIPTION_MODEL_KEY = "triceratop";
  var FALLBACK_TRANSCRIPTION_MODEL_KEY = "baby-raptor";
  var transcriptionCapabilityProfile = null;
  var selectedTranscriptionModelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY;
  var transcriptionModelStates = Object.create(null);
  var progressMessages = [
    "Downloading model...",
    "Preparing browser AI...",
    "Transcribing in browser...",
    "Still working locally in your browser..."
  ];
  var FIRST_RUN_MODEL_COPY = "Running this for the first time? Downloading the model may take up to several seconds or a few minutes depending on your internet speed. Please hang in there, we are cooking for you.";
  var CHECKING_CACHED_MODEL_COPY = "Checking your cached AI model so transcription can stay local in this browser.";
  var EMPTY_TRANSCRIPT_TEXT = "Transcription will appear here after processing.";
  var showTimestamps = true;
  var previewEditMode = false;

  var TRANSLATION_LANGUAGES = [
    { code: "en", name: "English", flores: "eng_Latn" },
    { code: "ar", name: "Arabic (Modern Standard)", flores: "arb_Arab" },
    { code: "es", name: "Spanish", flores: "spa_Latn" },
    { code: "fr", name: "French", flores: "fra_Latn" },
    { code: "de", name: "German", flores: "deu_Latn" },
    { code: "hi", name: "Hindi", flores: "hin_Deva" },
    { code: "ur", name: "Urdu", flores: "urd_Arab" },
    { code: "tr", name: "Turkish", flores: "tur_Latn" },
    { code: "zh", name: "Chinese (Simplified)", flores: "zho_Hans" },
    { code: "pt", name: "Portuguese", flores: "por_Latn" },
    { code: "ru", name: "Russian", flores: "rus_Cyrl" },
    { code: "ja", name: "Japanese", flores: "jpn_Jpan" },
    { code: "ko", name: "Korean", flores: "kor_Hang" },
    { code: "it", name: "Italian", flores: "ita_Latn" },
    { code: "nl", name: "Dutch", flores: "nld_Latn" },
    { code: "fa", name: "Persian", flores: "pes_Arab" },
    { code: "bn", name: "Bengali", flores: "ben_Beng" },
    { code: "id", name: "Indonesian", flores: "ind_Latn" },
    { code: "uk", name: "Ukrainian", flores: "ukr_Cyrl" },
    { code: "vi", name: "Vietnamese", flores: "vie_Latn" }
  ];
  var TRANSCRIPTION_LANGUAGES = [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "ar", name: "Arabic", flag: "🇸🇦" },
    { code: "es", name: "Spanish", flag: "🇪🇸" },
    { code: "fr", name: "French", flag: "🇫🇷" },
    { code: "de", name: "German", flag: "🇩🇪" },
    { code: "hi", name: "Hindi", flag: "🇮🇳" },
    { code: "ur", name: "Urdu", flag: "🇵🇰" },
    { code: "tr", name: "Turkish", flag: "🇹🇷" },
    { code: "zh", name: "Chinese", flag: "🇨🇳" },
    { code: "pt", name: "Portuguese", flag: "🇵🇹" },
    { code: "ru", name: "Russian", flag: "🇷🇺" },
    { code: "ja", name: "Japanese", flag: "🇯🇵" },
    { code: "ko", name: "Korean", flag: "🇰🇷" },
    { code: "it", name: "Italian", flag: "🇮🇹" },
    { code: "nl", name: "Dutch", flag: "🇳🇱" },
    { code: "fa", name: "Persian", flag: "🇮🇷" },
    { code: "bn", name: "Bengali", flag: "🇧🇩" },
    { code: "pa", name: "Punjabi", flag: "🇮🇳" },
    { code: "ta", name: "Tamil", flag: "🇮🇳" },
    { code: "te", name: "Telugu", flag: "🇮🇳" },
    { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
    { code: "id", name: "Indonesian", flag: "🇮🇩" },
    { code: "af", name: "Afrikaans", flag: "🇿🇦" },
    { code: "am", name: "Amharic", flag: "🇪🇹" },
    { code: "as", name: "Assamese", flag: "🇮🇳" },
    { code: "az", name: "Azerbaijani", flag: "🇦🇿" },
    { code: "ba", name: "Bashkir", flag: "🇷🇺" },
    { code: "be", name: "Belarusian", flag: "🇧🇾" },
    { code: "bg", name: "Bulgarian", flag: "🇧🇬" },
    { code: "bo", name: "Tibetan", flag: "🇨🇳" },
    { code: "br", name: "Breton", flag: "🇫🇷" },
    { code: "bs", name: "Bosnian", flag: "🇧🇦" },
    { code: "ca", name: "Catalan", flag: "🇪🇸" },
    { code: "cs", name: "Czech", flag: "🇨🇿" },
    { code: "cy", name: "Welsh", flag: "🇬🇧" },
    { code: "da", name: "Danish", flag: "🇩🇰" },
    { code: "el", name: "Greek", flag: "🇬🇷" },
    { code: "et", name: "Estonian", flag: "🇪🇪" },
    { code: "eu", name: "Basque", flag: "🇪🇸" },
    { code: "fi", name: "Finnish", flag: "🇫🇮" },
    { code: "fo", name: "Faroese", flag: "🇫🇴" },
    { code: "gl", name: "Galician", flag: "🇪🇸" },
    { code: "gu", name: "Gujarati", flag: "🇮🇳" },
    { code: "ha", name: "Hausa", flag: "🇳🇬" },
    { code: "haw", name: "Hawaiian", flag: "🇺🇸" },
    { code: "he", name: "Hebrew", flag: "🇮🇱" },
    { code: "hr", name: "Croatian", flag: "🇭🇷" },
    { code: "ht", name: "Haitian Creole", flag: "🇭🇹" },
    { code: "hu", name: "Hungarian", flag: "🇭🇺" },
    { code: "hy", name: "Armenian", flag: "🇦🇲" },
    { code: "is", name: "Icelandic", flag: "🇮🇸" },
    { code: "jw", name: "Javanese", flag: "🇮🇩" },
    { code: "ka", name: "Georgian", flag: "🇬🇪" },
    { code: "kk", name: "Kazakh", flag: "🇰🇿" },
    { code: "km", name: "Khmer", flag: "🇰🇭" },
    { code: "kn", name: "Kannada", flag: "🇮🇳" },
    { code: "la", name: "Latin", flag: "🇻🇦" },
    { code: "lb", name: "Luxembourgish", flag: "🇱🇺" },
    { code: "ln", name: "Lingala", flag: "🇨🇩" },
    { code: "lo", name: "Lao", flag: "🇱🇦" },
    { code: "lt", name: "Lithuanian", flag: "🇱🇹" },
    { code: "lv", name: "Latvian", flag: "🇱🇻" },
    { code: "mg", name: "Malagasy", flag: "🇲🇬" },
    { code: "mi", name: "Maori", flag: "🇳🇿" },
    { code: "mk", name: "Macedonian", flag: "🇲🇰" },
    { code: "ml", name: "Malayalam", flag: "🇮🇳" },
    { code: "mn", name: "Mongolian", flag: "🇲🇳" },
    { code: "mr", name: "Marathi", flag: "🇮🇳" },
    { code: "ms", name: "Malay", flag: "🇲🇾" },
    { code: "mt", name: "Maltese", flag: "🇲🇹" },
    { code: "my", name: "Myanmar", flag: "🇲🇲" },
    { code: "ne", name: "Nepali", flag: "🇳🇵" },
    { code: "nn", name: "Nynorsk", flag: "🇳🇴" },
    { code: "no", name: "Norwegian", flag: "🇳🇴" },
    { code: "oc", name: "Occitan", flag: "🇫🇷" },
    { code: "pl", name: "Polish", flag: "🇵🇱" },
    { code: "ps", name: "Pashto", flag: "🇦🇫" },
    { code: "ro", name: "Romanian", flag: "🇷🇴" },
    { code: "sa", name: "Sanskrit", flag: "🇮🇳" },
    { code: "sd", name: "Sindhi", flag: "🇵🇰" },
    { code: "si", name: "Sinhala", flag: "🇱🇰" },
    { code: "sk", name: "Slovak", flag: "🇸🇰" },
    { code: "sl", name: "Slovenian", flag: "🇸🇮" },
    { code: "sn", name: "Shona", flag: "🇿🇼" },
    { code: "so", name: "Somali", flag: "🇸🇴" },
    { code: "sq", name: "Albanian", flag: "🇦🇱" },
    { code: "sr", name: "Serbian", flag: "🇷🇸" },
    { code: "su", name: "Sundanese", flag: "🇮🇩" },
    { code: "sv", name: "Swedish", flag: "🇸🇪" },
    { code: "sw", name: "Swahili", flag: "🇹🇿" },
    { code: "tg", name: "Tajik", flag: "🇹🇯" },
    { code: "th", name: "Thai", flag: "🇹🇭" },
    { code: "tk", name: "Turkmen", flag: "🇹🇲" },
    { code: "tl", name: "Tagalog", flag: "🇵🇭" },
    { code: "tt", name: "Tatar", flag: "🇷🇺" },
    { code: "uk", name: "Ukrainian", flag: "🇺🇦" },
    { code: "uz", name: "Uzbek", flag: "🇺🇿" },
    { code: "yi", name: "Yiddish", flag: "🇮🇱" },
    { code: "yo", name: "Yoruba", flag: "🇳🇬" },
    { code: "yue", name: "Cantonese", flag: "🇭🇰" }
  ];
  var PINNED_TRANSCRIPTION_LANGUAGE_CODES = [
    "en", "ar", "es", "fr", "de", "hi", "ur", "tr", "zh", "pt", "ru", "ja", "ko", "it", "nl", "fa", "bn", "pa", "ta", "te", "vi", "id"
  ];
  var TRANSCRIPTION_LANGUAGE_FLAG_CODES = {
    en: "us",
    ar: "sa",
    es: "es",
    fr: "fr",
    de: "de",
    hi: "in",
    ur: "pk",
    tr: "tr",
    zh: "cn",
    pt: "pt",
    ru: "ru",
    ja: "jp",
    ko: "kr",
    it: "it",
    nl: "nl",
    fa: "ir",
    bn: "bd",
    pa: "in",
    ta: "in",
    te: "in",
    vi: "vn",
    id: "id",
    af: "za",
    am: "et",
    as: "in",
    az: "az",
    ba: "ru",
    be: "by",
    bg: "bg",
    bo: "cn",
    br: "fr",
    bs: "ba",
    ca: "es",
    cs: "cz",
    cy: "gb",
    da: "dk",
    el: "gr",
    et: "ee",
    eu: "es",
    fi: "fi",
    fo: "fo",
    gl: "es",
    gu: "in",
    ha: "ng",
    haw: "us",
    he: "il",
    hr: "hr",
    ht: "ht",
    hu: "hu",
    hy: "am",
    is: "is",
    jw: "id",
    ka: "ge",
    kk: "kz",
    km: "kh",
    kn: "in",
    la: "va",
    lb: "lu",
    ln: "cd",
    lo: "la",
    lt: "lt",
    lv: "lv",
    mg: "mg",
    mi: "nz",
    mk: "mk",
    ml: "in",
    mn: "mn",
    mr: "in",
    ms: "my",
    mt: "mt",
    my: "mm",
    ne: "np",
    nn: "no",
    no: "no",
    oc: "fr",
    pl: "pl",
    ps: "af",
    ro: "ro",
    sa: "in",
    sd: "pk",
    si: "lk",
    sk: "sk",
    sl: "si",
    sn: "zw",
    so: "so",
    sq: "al",
    sr: "rs",
    su: "id",
    sv: "se",
    sw: "tz",
    tg: "tj",
    th: "th",
    tk: "tm",
    tl: "ph",
    tt: "ru",
    uk: "ua",
    uz: "uz",
    yi: "il",
    yo: "ng",
    yue: "hk"
  };
  var MODEL_LOCK_KEY = "fat:transcribe:model-lock:v1";
  var MODEL_LOCK_STALE_MS = 20000;
  var MODEL_LOCK_HEARTBEAT_MS = 5000;
  var IDLE_UNLOAD_VISIBLE_MS = 90000;
  var IDLE_UNLOAD_HIDDEN_MS = 15000;
  var TAB_ID = "tab-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  var lockChannel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("fat-transcribe-model")
    : null;

  function createTranscribeWorker() {
    workerGeneration += 1;
    worker = new Worker(TRANSCRIBE_WORKER_URL, {
      type: "module"
    });
    return workerGeneration;
  }

  function getTranscriptionModeByKey(modelKey) {
    return TRANSCRIPTION_MODELS.find(function (item) {
      return item.key === modelKey;
    }) || TRANSCRIPTION_MODELS[0];
  }

  function ensureTranscriptionModelState(modelKey) {
    if (!transcriptionModelStates[modelKey]) {
      transcriptionModelStates[modelKey] = {
        enabled: true,
        reason: "",
        status: "idle",
        progress: 0,
        errorMessage: ""
      };
    }
    return transcriptionModelStates[modelKey];
  }

  function initializeTranscriptionModelStates() {
    TRANSCRIPTION_MODELS.forEach(function (model) {
      ensureTranscriptionModelState(model.key);
    });
  }

  function getSelectedTranscriptionMode() {
    return getTranscriptionModeByKey(selectedTranscriptionModelKey);
  }

  function getSelectedModelState() {
    return ensureTranscriptionModelState(selectedTranscriptionModelKey);
  }

  function hasSelectedTranscriptionLanguage(language) {
    return !!language;
  }

  function createCapabilityDecision(enabled, reason) {
    return {
      enabled: !!enabled,
      reason: enabled ? "" : reason
    };
  }

  function probeTranscriptionCapabilities() {
    var hasWorkers = typeof Worker !== "undefined";
    var hasWasm = typeof WebAssembly !== "undefined";
    var hasAudioSupport = !!(window.AudioContext || window.webkitAudioContext);
    var isCoarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    var deviceMemory = typeof navigator !== "undefined" ? Number(navigator.deviceMemory) : NaN;
    var hardwareConcurrency = typeof navigator !== "undefined" ? Number(navigator.hardwareConcurrency) : NaN;
    var hasKnownMemory = Number.isFinite(deviceMemory) && deviceMemory > 0;
    var hasKnownCpu = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0;
    var lowMemory = hasKnownMemory && deviceMemory < 4;
    var lowCpu = hasKnownCpu && hardwareConcurrency < 4;
    var baselineOk = hasWorkers && hasWasm && hasAudioSupport;
    var browserReason = "This browser cannot run local transcription models";
    var balancedReason = "Needs a bit more memory or CPU for comfortable local use";
    var desktopReason = "Reserved for stronger desktops with WebGPU";
    var modes = Object.create(null);

    if (!baselineOk) {
      TRANSCRIPTION_MODELS.forEach(function (model) {
        modes[model.key] = createCapabilityDecision(false, browserReason);
      });
      return {
        baselineOk: false,
        isCoarsePointer: isCoarsePointer,
        deviceMemory: hasKnownMemory ? deviceMemory : null,
        hardwareConcurrency: hasKnownCpu ? hardwareConcurrency : null,
        modes: modes
      };
    }

    modes["baby-raptor"] = createCapabilityDecision(true, "");

    if (isCoarsePointer) {
      var mobileSmallReady = hasKnownMemory && deviceMemory >= 4 && hasKnownCpu && hardwareConcurrency >= 6;
      modes.triceratop = createCapabilityDecision(mobileSmallReady, balancedReason);
    } else {
      modes.triceratop = createCapabilityDecision(!(lowMemory || lowCpu), balancedReason);
    }

    var hasWebGPU = hasWebGPUAcceleration();
    var hasTyrannosaurMemory = hasKnownMemory && deviceMemory >= 8;
    var hasTyrannosaurCpu = hasKnownCpu && hardwareConcurrency >= 8;
    modes["t-rex"] = createCapabilityDecision(
      baselineOk && hasWebGPU && !isCoarsePointer && hasTyrannosaurMemory && hasTyrannosaurCpu,
      desktopReason
    );

    return {
      baselineOk: true,
      isCoarsePointer: isCoarsePointer,
      deviceMemory: hasKnownMemory ? deviceMemory : null,
      hardwareConcurrency: hasKnownCpu ? hardwareConcurrency : null,
      modes: modes
    };
  }

  function applyTranscriptionCapabilityProfile(profile) {
    transcriptionCapabilityProfile = profile || probeTranscriptionCapabilities();

    TRANSCRIPTION_MODELS.forEach(function (model) {
      var state = ensureTranscriptionModelState(model.key);
      var decision = transcriptionCapabilityProfile.modes[model.key] || createCapabilityDecision(false, "This browser cannot run local transcription models");
      state.enabled = !!decision.enabled;
      state.reason = decision.reason || "";
      if (!state.enabled) {
        state.status = "disabled";
        state.progress = 0;
        state.errorMessage = "";
      } else if (state.status === "disabled") {
        state.status = "idle";
      }
    });

    if (!ensureTranscriptionModelState(DEFAULT_TRANSCRIPTION_MODEL_KEY).enabled) {
      selectedTranscriptionModelKey = ensureTranscriptionModelState(FALLBACK_TRANSCRIPTION_MODEL_KEY).enabled
        ? FALLBACK_TRANSCRIPTION_MODEL_KEY
        : DEFAULT_TRANSCRIPTION_MODEL_KEY;
    } else {
      selectedTranscriptionModelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY;
    }

    modelWarmState = getSelectedModelState().status;
  }

  function getModelAvailabilityLabel(modelKey) {
    var state = ensureTranscriptionModelState(modelKey);
    if (!state.enabled) {
      return "Disabled";
    }
    if (state.status === "ready") {
      return "Ready";
    }
    if (state.status === "loading") {
      return "Downloading";
    }
    if (state.status === "blocked") {
      return "Waiting";
    }
    if (state.status === "error") {
      return "Available";
    }
    return "Available";
  }

  function getSelectedModelLoadingText() {
    var model = getSelectedTranscriptionMode();
    return "Preparing " + model.label + "...";
  }

  function getSelectedModelLockedText() {
    return "Another transcription tab is holding the AI model. Wait a moment or close the other tab.";
  }

  function buildTranscriptionModelCardsMarkup() {
    return TRANSCRIPTION_MODELS.map(function (model) {
      return [
        '<button class="at-model-card" type="button" data-role="modelCard" data-model-key="', model.key, '">',
        '  <span class="at-model-card__media">',
        '    <img src="', model.icon, '" alt="" loading="lazy" width="64" height="64">',
        "  </span>",
        '  <span class="at-model-card__copy">',
        '    <span class="at-model-card__title-row">',
        '      <span class="at-model-card__title">', escapeHtml(model.label), "</span>",
        '      <span class="at-model-card__badge" data-role="modelBadge" data-model-key="', model.key, '">Available</span>',
        "    </span>",
        '    <span class="at-model-card__helper">', escapeHtml(model.helper), "</span>",
        '    <span class="at-model-card__reason" data-role="modelReason" data-model-key="', model.key, '"></span>',
        "  </span>",
        "</button>"
      ].join("");
    }).join("");
  }

  function hasWebGPUAcceleration() {
    return !!(typeof navigator !== "undefined" && navigator.gpu);
  }

  function getDeviceSupportLabel() {
    if (!transcriptionCapabilityProfile || !transcriptionCapabilityProfile.baselineOk) {
      return "Local transcription unavailable on this browser";
    }

    return hasWebGPUAcceleration()
      ? "High-performance local AI available"
      : "Local AI available in compatibility mode";
  }

  function getProcessingInfoCopy() {
    return getDeviceSupportLabel() + ". Transcription runs entirely in your browser, so your media never leaves your device.";
  }

  function getAudioReadyStatus(language) {
    var selectedModel = getSelectedTranscriptionMode();
    var selectedState = getSelectedModelState();

    if (!selectedState.enabled) {
      return selectedModel.label + " is disabled on this device. " + selectedState.reason;
    }

    if (modelWarmState === "loading") {
      return "Audio ready for transcription. " + getSelectedModelLoadingText();
    }

    if (!hasSelectedTranscriptionLanguage(language)) {
      return "Audio ready for transcription. Choose the spoken language while " + selectedModel.label + " gets ready.";
    }

    if (modelWarmState === "ready") {
      return selectedModel.label + " is ready. Press Transcribe when you're ready.";
    }

    return "Audio ready for transcription. " + getDeviceSupportLabel();
  }

  function getSelectedTranscriptionLanguage() {
    var languageSelect = document.querySelector("#language-select");
    return languageSelect ? languageSelect.value : "";
  }

  function getWarmModelReadyStatus(loadState, language) {
    var model = getSelectedTranscriptionMode();
    var baseMessage = loadState === "downloaded"
      ? model.label + " downloaded and ready."
      : model.label + " ready from cache.";

    if (!window.transcriptionAudio) {
      return baseMessage;
    }

    if (!hasSelectedTranscriptionLanguage(language)) {
      return baseMessage + " Choose the spoken language before transcribing for best accuracy.";
    }

    return baseMessage + " Press Transcribe when you're ready.";
  }

  function getModelStartStatus(loadState) {
    var model = getSelectedTranscriptionMode();
    return loadState === "downloaded"
      ? model.label + " downloaded. Starting transcription..."
      : model.label + " ready from cache. Starting transcription...";
  }

  function getPrimaryTranscribeRoot() {
    return document.getElementById("audio-tool");
  }

  function getPrimaryTranscribeStatusEl() {
    if (activeTranscriptionContext && activeTranscriptionContext.statusEl) {
      return activeTranscriptionContext.statusEl;
    }

    var root = getPrimaryTranscribeRoot();
    return root ? root.querySelector('[data-role="status"]') : null;
  }

  function refreshTranscribeLayout() {
    var root = getPrimaryTranscribeRoot();
    if (root) {
      updateToolLayout(root);
    }
  }

  function canStartTranscription(language) {
    return !!window.transcriptionAudio
      && hasSelectedTranscriptionLanguage(language)
      && !processingLocked
      && modelWarmState === "ready";
  }

  function syncTranscribeReadyState() {
    var startBtn = document.querySelector('[data-role="startTranscribe"]');
    var selectedLanguage = getSelectedTranscriptionLanguage();
    var selectedState = getSelectedModelState();
    var canStart = canStartTranscription(selectedLanguage);

    if (startBtn) {
      setTranscribeButtonState(startBtn, canStart);
      if (!window.transcriptionAudio) {
        startBtn.textContent = "Transcribe";
      } else if (!selectedState.enabled) {
        startBtn.textContent = "Transcribe unavailable";
      } else if (modelWarmState === "blocked") {
        startBtn.textContent = "Waiting for model access";
      } else if (modelWarmState === "loading") {
        startBtn.textContent = getSelectedModelLoadingText();
      } else if (modelWarmState === "error") {
        startBtn.textContent = "Retry model download";
      } else if (!hasSelectedTranscriptionLanguage(selectedLanguage)) {
        startBtn.textContent = "Select language first";
      } else {
        startBtn.textContent = "Transcribe";
      }
    }
  }

  function syncTranslationReadyState() {
    var translateBtn = document.querySelector('[data-role="translateBtn"]');
    var chatgptBtn = document.getElementById("chatgptTranslateBtn");
    var translateSourceLanguage = document.querySelector("#translate-source-language");
    var translateLanguage = document.querySelector("#translate-language");
    var hasSegments = !!(window.currentSegments && window.currentSegments.length);
    var hasResults = hasTranscriptResults() || hasTranslatedSegments();
    var sourceCode = translateSourceLanguage ? translateSourceLanguage.value : "";

    updateTranslationTargetOptions(translateLanguage, sourceCode);

    var targetCode = translateLanguage ? translateLanguage.value : "";
    var ready = hasSegments
      && !processingLocked
      && !!getTranslationFloresCode(sourceCode)
      && !!getTranslationFloresCode(targetCode)
      && sourceCode !== targetCode;

    if (translateBtn) {
      translateBtn.disabled = !ready;
    }
    if (chatgptBtn) {
      chatgptBtn.disabled = !hasResults || processingLocked;
    }

    updateTranslationHint();
    syncCustomTranslationPickers();
  }

  function getSuggestedTranscriptionLanguage() {
    if (typeof navigator === "undefined" || !navigator.language) {
      return "";
    }

    var base = String(navigator.language || "").toLowerCase().split("-")[0];
    return TRANSCRIPTION_LANGUAGES.some(function (item) {
      return item.code === base;
    }) ? base : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getSortedTranscriptionLanguages() {
    var pinnedMap = Object.create(null);
    PINNED_TRANSCRIPTION_LANGUAGE_CODES.forEach(function (code, index) {
      pinnedMap[code] = index;
    });

    var pinned = [];
    var rest = [];

    TRANSCRIPTION_LANGUAGES.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(pinnedMap, item.code)) {
        pinned.push(item);
      } else {
        rest.push(item);
      }
    });

    pinned.sort(function (a, b) {
      return pinnedMap[a.code] - pinnedMap[b.code];
    });
    rest.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    return pinned.concat(rest);
  }

  function getTranscriptionLanguageByCode(code) {
    var normalized = String(code || "").toLowerCase();
    var index;

    for (index = 0; index < TRANSCRIPTION_LANGUAGES.length; index += 1) {
      if (TRANSCRIPTION_LANGUAGES[index].code === normalized) {
        return TRANSCRIPTION_LANGUAGES[index];
      }
    }

    return null;
  }

  function getTranslationLanguageByCode(code) {
    var normalized = String(code || "").toLowerCase();
    var index;

    for (index = 0; index < TRANSLATION_LANGUAGES.length; index += 1) {
      if (TRANSLATION_LANGUAGES[index].code === normalized) {
        return TRANSLATION_LANGUAGES[index];
      }
    }

    return null;
  }

  function getTranslationFloresCode(code) {
    var item = getTranslationLanguageByCode(code);
    return item ? item.flores : "";
  }

  function getTranslationLanguageFlagUrl(code) {
    return getTranscriptionLanguageFlagUrl(code);
  }

  function buildTranslationLanguageOptions(placeholder) {
    var options = ['<option value="">' + escapeHtml(placeholder) + "</option>"];

    TRANSLATION_LANGUAGES.forEach(function (item) {
      options.push(
        '<option value="' + escapeHtml(item.code) + '">' +
        escapeHtml(item.name) +
        "</option>"
      );
    });

    return options.join("");
  }

  function getSuggestedTranslationSourceCode() {
    var sourceCode = String(window.transcriptionSourceLanguage || "").toLowerCase();
    if (getTranslationLanguageByCode(sourceCode)) {
      return sourceCode;
    }
    return "";
  }

  function syncTranslationSourceSelection(selectEl, preferExistingValue) {
    if (!selectEl) {
      return "";
    }

    var nextValue = "";
    if (preferExistingValue && getTranslationLanguageByCode(selectEl.value)) {
      nextValue = selectEl.value;
    } else {
      nextValue = getSuggestedTranslationSourceCode();
    }

    selectEl.value = nextValue;
    return nextValue;
  }

  function updateTranslationTargetOptions(selectEl, sourceCode) {
    var selectedValue;

    if (!selectEl) {
      return;
    }

    selectedValue = selectEl.value;

    Array.prototype.forEach.call(selectEl.options || [], function (option) {
      if (!option.value) {
        option.disabled = false;
        return;
      }
      option.disabled = !!sourceCode && option.value === sourceCode;
    });

    if (selectedValue && selectedValue === sourceCode) {
      selectEl.value = "";
    }
  }

  function buildTranslationLanguageSelectionMarkup(code, placeholderText) {
    var item = getTranslationLanguageByCode(code);
    var flagUrl = getTranslationLanguageFlagUrl(code);

    if (!item) {
      return '<span data-role="translationLanguagePickerPlaceholder">' + escapeHtml(placeholderText || "Choose language") + "</span>";
    }

    return [
      '<span data-role="translationLanguagePickerSelection">',
      flagUrl
        ? '<img src="' + escapeHtml(flagUrl) + '" alt="" loading="lazy" decoding="async" width="20" height="15" data-role="translationLanguagePickerFlag">'
        : "",
      '<span data-role="translationLanguagePickerTextWrap">',
      '<span data-role="translationLanguagePickerName">' + escapeHtml(item.name) + "</span>",
      '<span data-role="translationLanguagePickerCode">' + escapeHtml(item.code.toUpperCase()) + "</span>",
      "</span>",
      "</span>"
    ].join("");
  }

  function buildTranslationLanguagePickerOptions(query, selectedCode, blockedCode) {
    var normalizedQuery = String(query || "").trim().toLowerCase();
    var filtered = TRANSLATION_LANGUAGES.filter(function (item) {
      if (!normalizedQuery) {
        return true;
      }

      return item.name.toLowerCase().indexOf(normalizedQuery) !== -1
        || item.code.toLowerCase().indexOf(normalizedQuery) !== -1;
    });

    if (!filtered.length) {
      return '<div data-role="translationLanguagePickerEmpty">No matching languages found.</div>';
    }

    return filtered.map(function (item) {
      var flagUrl = getTranslationLanguageFlagUrl(item.code);
      var isSelected = item.code === selectedCode;
      var isBlocked = !!blockedCode && item.code === blockedCode;

      return [
        '<button type="button" data-role="translationLanguagePickerOption" data-language-code="' + escapeHtml(item.code) + '"',
        isSelected ? ' aria-current="true"' : "",
        isBlocked ? " disabled" : "",
        '>',
        flagUrl
          ? '<img src="' + escapeHtml(flagUrl) + '" alt="" loading="lazy" decoding="async" width="20" height="15" data-role="translationLanguagePickerFlag">'
          : "",
        '<span data-role="translationLanguagePickerOptionLabel">' + escapeHtml(item.name) + "</span>",
        '<span data-role="translationLanguagePickerOptionCode">' + escapeHtml(item.code.toUpperCase()) + "</span>",
        isBlocked
          ? '<span data-role="translationLanguagePickerDisabledMark" aria-hidden="true">Source</span>'
          : (isSelected ? '<span data-role="translationLanguagePickerSelectedMark" aria-hidden="true">Selected</span>' : ""),
        "</button>"
      ].join("");
    }).join("");
  }

  function syncTranslationPickerUi(config) {
    var selectEl = document.querySelector(config.selectSelector);
    var toggleEl = document.querySelector(config.toggleSelector);
    var currentEl = document.querySelector(config.currentSelector);
    var searchEl = document.querySelector(config.searchSelector);
    var listEl = document.querySelector(config.listSelector);
    var blockedCode = typeof config.getBlockedCode === "function" ? config.getBlockedCode() : "";

    if (!selectEl || !toggleEl || !currentEl || !listEl) {
      return;
    }

    currentEl.innerHTML = buildTranslationLanguageSelectionMarkup(selectEl.value, config.placeholderText);
    toggleEl.dataset.hasValue = selectEl.value ? "true" : "false";
    listEl.innerHTML = buildTranslationLanguagePickerOptions(searchEl ? searchEl.value : "", selectEl.value, blockedCode);
  }

  function syncCustomTranslationPickers() {
    syncTranslationPickerUi({
      selectSelector: "#translate-source-language",
      toggleSelector: '[data-role="translateSourcePickerToggle"]',
      currentSelector: '[data-role="translateSourcePickerCurrent"]',
      searchSelector: '[data-role="translateSourcePickerSearch"]',
      listSelector: '[data-role="translateSourcePickerList"]',
      placeholderText: "Select transcript language"
    });
    syncTranslationPickerUi({
      selectSelector: "#translate-language",
      toggleSelector: '[data-role="translateTargetPickerToggle"]',
      currentSelector: '[data-role="translateTargetPickerCurrent"]',
      searchSelector: '[data-role="translateTargetPickerSearch"]',
      listSelector: '[data-role="translateTargetPickerList"]',
      placeholderText: "Select target language",
      getBlockedCode: function () {
        var sourceEl = document.querySelector("#translate-source-language");
        return sourceEl ? sourceEl.value : "";
      }
    });
  }

  function updateTranslationHint() {
    var hintEl = document.querySelector('[data-role="translationHint"]');
    var translateSourceLanguage = document.querySelector("#translate-source-language");
    var translateLanguage = document.querySelector("#translate-language");
    var sourceCode = translateSourceLanguage ? translateSourceLanguage.value : "";
    var targetCode = translateLanguage ? translateLanguage.value : "";
    var sourceItem = getTranslationLanguageByCode(sourceCode);
    var targetItem = getTranslationLanguageByCode(targetCode);

    if (!hintEl) {
      return;
    }

    if (!sourceItem) {
      hintEl.textContent = "Translation uses your transcript, including any segment edits. Choose the transcript language carefully for best results.";
      return;
    }

    if (!targetItem) {
      hintEl.textContent = "Transcript language is set to " + sourceItem.name + ". Choose a different target language to translate your edited transcript.";
      return;
    }

    if (sourceCode === targetCode) {
      hintEl.textContent = "Choose a target language different from the transcript language.";
      return;
    }

    hintEl.textContent = "Translating from " + sourceItem.name + " to " + targetItem.name + ". Any segment edits will be included.";
  }

  function getTranscriptionLanguageFlagUrl(code) {
    var flagCode = TRANSCRIPTION_LANGUAGE_FLAG_CODES[String(code || "").toLowerCase()];
    if (!flagCode) {
      return "";
    }
    return "https://flagcdn.com/24x18/" + encodeURIComponent(flagCode.toLowerCase()) + ".png";
  }

  function buildTranscriptionLanguageSelectionMarkup(code) {
    var item = getTranscriptionLanguageByCode(code);
    var flagUrl = getTranscriptionLanguageFlagUrl(code);

    if (!item) {
      return '<span data-role="languagePickerPlaceholder">Choose language for best accuracy</span>';
    }

    return [
      '<span data-role="languagePickerSelection">',
      flagUrl
        ? '<img src="' + escapeHtml(flagUrl) + '" alt="" loading="lazy" decoding="async" width="20" height="15" data-role="languagePickerFlag">'
        : "",
      '<span data-role="languagePickerTextWrap">',
      '<span data-role="languagePickerName">' + escapeHtml(item.name) + "</span>",
      '<span data-role="languagePickerCode">' + escapeHtml(item.code.toUpperCase()) + "</span>",
      "</span>",
      "</span>"
    ].join("");
  }

  function buildTranscriptionLanguagePickerOptions(query, selectedCode) {
    var normalizedQuery = String(query || "").trim().toLowerCase();
    var filtered = getSortedTranscriptionLanguages().filter(function (item) {
      if (!normalizedQuery) {
        return true;
      }

      return item.name.toLowerCase().indexOf(normalizedQuery) !== -1
        || item.code.toLowerCase().indexOf(normalizedQuery) !== -1;
    });

    if (!filtered.length) {
      return '<div data-role="languagePickerEmpty">No matching languages found.</div>';
    }

    return filtered.map(function (item) {
      var flagUrl = getTranscriptionLanguageFlagUrl(item.code);
      var isSelected = item.code === selectedCode;

      return [
        '<button type="button" data-role="languagePickerOption" data-language-code="' + escapeHtml(item.code) + '"',
        isSelected ? ' aria-current="true"' : "",
        '>',
        flagUrl
          ? '<img src="' + escapeHtml(flagUrl) + '" alt="" loading="lazy" decoding="async" width="20" height="15" data-role="languagePickerFlag">'
          : "",
        '<span data-role="languagePickerOptionLabel">' + escapeHtml(item.name) + "</span>",
        '<span data-role="languagePickerOptionCode">' + escapeHtml(item.code.toUpperCase()) + "</span>",
        isSelected ? '<span data-role="languagePickerSelectedMark" aria-hidden="true">Selected</span>' : "",
        "</button>"
      ].join("");
    }).join("");
  }

  function buildTranscriptionLanguageOptions() {
    var options = ['<option value="">Choose language for best accuracy</option>'];

    getSortedTranscriptionLanguages().forEach(function (item) {
      options.push(
        '<option value="' + escapeHtml(item.code) + '">' +
        escapeHtml(item.flag + " " + item.name) +
        "</option>"
      );
    });

    return options.join("");
  }

  function getTranscriptionFeedback(text, warnings, context) {
    var normalizedText = normalizeIncomingText(text);
    var warningList = Array.isArray(warnings) ? warnings : [];
    var language = context && context.language ? context.language : "auto";
    var usedEnhance = !!(context && context.enhance);
    var hasWarning = function (value) {
      return warningList.indexOf(value) !== -1;
    };

    if (!normalizedText) {
      if (hasWarning("no_clear_speech") || hasWarning("mostly_silence")) {
        return {
          message: "No clear speech detected. Try Enhance audio or use a cleaner recording.",
          state: "warning"
        };
      }

      return {
        message: "Transcription failed. Try a shorter or clearer file.",
        state: "error"
      };
    }

    if (hasWarning("repetition")) {
      return {
        message: language === "auto"
          ? "Transcript ready. Review repeated sections and choose the language manually if needed."
          : "Transcript ready. Review repeated sections before exporting or translating.",
        state: "warning"
      };
    }

    if (hasWarning("weak_audio")) {
      return {
        message: language === "auto"
          ? "Transcript ready. Weak speech signal detected; choose the language manually if anything looks off."
          : "Transcript ready. Weak speech signal detected; review the transcript before exporting.",
        state: "warning"
      };
    }

    if (hasWarning("language_hint")) {
      return {
        message: "Transcript ready. Picking the spoken language manually can improve difficult files.",
        state: "warning"
      };
    }

    if (usedEnhance) {
      return {
        message: "Audio enhanced for better accuracy",
        state: "ready"
      };
    }

    return {
      message: "Transcription complete",
      state: "ready"
    };
  }

  function setProgressMessage(message) {
    var el = document.getElementById("progress-message");
    if (!el) {
      return;
    }
    el.textContent = normalizeIncomingText(message || "");
  }

  function readModelLock() {
    try {
      var raw = window.localStorage.getItem(MODEL_LOCK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeModelLock(lock) {
    try {
      window.localStorage.setItem(MODEL_LOCK_KEY, JSON.stringify(lock));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeModelLock() {
    try {
      window.localStorage.removeItem(MODEL_LOCK_KEY);
    } catch (error) {
    }
  }

  function hasFreshModelLock(lock) {
    return !!(lock && lock.ownerId && (Date.now() - Number(lock.ts || 0)) < MODEL_LOCK_STALE_MS);
  }

  function isModelLockOwnedByThisTab(lock) {
    return hasFreshModelLock(lock) && lock.ownerId === TAB_ID;
  }

  function isModelLockOwnedByOtherTab(lock) {
    return hasFreshModelLock(lock) && lock.ownerId !== TAB_ID;
  }

  function claimModelLock() {
    var existing = readModelLock();

    if (isModelLockOwnedByOtherTab(existing)) {
      return false;
    }

    writeModelLock({
      ownerId: TAB_ID,
      ts: Date.now()
    });

    return isModelLockOwnedByThisTab(readModelLock());
  }

  function renewModelLock() {
    if (!isModelLockOwnedByThisTab(readModelLock())) {
      return false;
    }

    return writeModelLock({
      ownerId: TAB_ID,
      ts: Date.now()
    });
  }

  function releaseModelLock() {
    if (isModelLockOwnedByThisTab(readModelLock())) {
      removeModelLock();
    }
  }

  function startLockHeartbeat() {
    if (lockHeartbeatTimer) {
      return;
    }

    lockHeartbeatTimer = window.setInterval(function () {
      renewModelLock();
    }, MODEL_LOCK_HEARTBEAT_MS);
  }

  function stopLockHeartbeat() {
    if (lockHeartbeatTimer) {
      window.clearInterval(lockHeartbeatTimer);
      lockHeartbeatTimer = null;
    }
  }

  function notifyOtherTabs(message) {
    if (lockChannel) {
      lockChannel.postMessage(message);
    }
  }

  function setModelUiState(modelKey, nextState, errorMessage) {
    var state = ensureTranscriptionModelState(modelKey);
    if (!state.enabled) {
      state.status = "disabled";
      state.progress = 0;
      state.errorMessage = "";
      return;
    }

    state.status = nextState;
    if (nextState !== "loading") {
      state.progress = nextState === "ready" ? 100 : 0;
    }
    state.errorMessage = nextState === "error" ? (errorMessage || "") : "";
  }

  function resetOtherModelStates(activeModelKey) {
    TRANSCRIPTION_MODELS.forEach(function (model) {
      if (model.key === activeModelKey) {
        return;
      }
      var state = ensureTranscriptionModelState(model.key);
      if (state.enabled) {
        state.status = "idle";
        state.progress = 0;
        state.errorMessage = "";
      }
    });
  }

  function rebuildTranscribeWorker() {
    if (worker) {
      try {
        worker.terminate();
      } catch (error) {
      }
    }
    var generation = createTranscribeWorker();
    attachWorkerListeners(worker, generation);
  }

  function scheduleWarmupRetry() {
    if (lockRetryTimer) {
      window.clearTimeout(lockRetryTimer);
    }

    lockRetryTimer = window.setTimeout(function () {
      lockRetryTimer = null;
      if (!processingLocked && window.transcriptionAudio && modelWarmState === "blocked") {
        requestModelWarmup();
      }
    }, 3000);
  }

  function clearIdleUnloadTimer() {
    if (idleUnloadTimer) {
      window.clearTimeout(idleUnloadTimer);
      idleUnloadTimer = null;
    }
  }

  function scheduleIdleUnload(delayMs) {
    clearIdleUnloadTimer();

    if (processingLocked || (modelWarmState !== "loading" && modelWarmState !== "ready")) {
      return;
    }

    idleUnloadTimer = window.setTimeout(function () {
      idleUnloadTimer = null;
      requestWorkerUnload("idle", true);
    }, delayMs);
  }

  function requestWorkerUnload(reason, includeTranslation) {
    clearIdleUnloadTimer();
    stopLockHeartbeat();

    if (processingLocked) {
      return;
    }

    if (modelWarmState === "idle" && !modelUnloadPending) {
      releaseModelLock();
      syncTranscribeReadyState();
      refreshTranscribeLayout();
      notifyOtherTabs({
        type: "lock_released",
        ownerId: TAB_ID,
        reason: reason || "idle"
      });
      return;
    }

    modelWarmState = "idle";
    modelUnloadPending = true;
    pendingModelRequestKey = "";
    activePreparedModelKey = "";
    resetOtherModelStates("");
    if (selectedTranscriptionModelKey) {
      setModelUiState(selectedTranscriptionModelKey, "idle");
    }
    syncTranscribeReadyState();
    refreshTranscribeLayout();
    if (!worker) {
      return;
    }
    worker.postMessage({
      type: "unload",
      includeTranslation: includeTranslation !== false,
      reason: reason || "idle"
    });
  }

  function ensureModelOwnership(statusEl, startBtn) {
    if (claimModelLock()) {
      startLockHeartbeat();
      if (modelWarmState === "idle" || modelWarmState === "blocked") {
        modelWarmState = "loading";
      }
      return true;
    }

    modelWarmState = "blocked";
    setModelUiState(selectedTranscriptionModelKey, "blocked");
    notifyOtherTabs({
      type: "release_request",
      requesterId: TAB_ID
    });
    scheduleWarmupRetry();

    if (statusEl) {
      setStatus(statusEl, getSelectedModelLockedText(), "warning");
    }
    if (startBtn) {
      setTranscribeButtonState(startBtn, false);
    }
    refreshTranscribeLayout();

    return false;
  }

  function requestModelWarmup() {
    var selectedModel = getSelectedTranscriptionMode();
    var selectedState = getSelectedModelState();
    var shouldReusePreparedModel = activePreparedModelKey === selectedModel.key;

    if (!window.transcriptionAudio || !selectedState.enabled) {
      modelWarmState = selectedState.enabled ? "idle" : "disabled";
      syncTranscribeReadyState();
      refreshTranscribeLayout();
      return;
    }

    if ((modelWarmState === "loading" || modelWarmState === "ready") && shouldReusePreparedModel) {
      return;
    }

    if (!claimModelLock()) {
      modelWarmState = "blocked";
      setModelUiState(selectedModel.key, "blocked");
      syncTranscribeReadyState();
      notifyOtherTabs({
        type: "release_request",
        requesterId: TAB_ID
      });
      scheduleWarmupRetry();
      refreshTranscribeLayout();
      return;
    }

    clearIdleUnloadTimer();
    startLockHeartbeat();
    if (!worker) {
      rebuildTranscribeWorker();
    } else if ((activePreparedModelKey && activePreparedModelKey !== selectedModel.key) || (pendingModelRequestKey && pendingModelRequestKey !== selectedModel.key)) {
      rebuildTranscribeWorker();
    }

    pendingModelRequestKey = selectedModel.key;
    activePreparedModelKey = "";
    resetOtherModelStates(selectedModel.key);
    setModelUiState(selectedModel.key, "loading");
    modelWarmState = "loading";
    syncTranscribeReadyState();
    refreshTranscribeLayout();
    worker.postMessage({
      type: "preload_model",
      modelKey: selectedModel.key
    });
  }

  function bindTranscribeLifecycleEvents() {
    if (window.__transcribeLifecycleBound) {
      return;
    }

    window.__transcribeLifecycleBound = true;

    if (lockChannel) {
      lockChannel.onmessage = function (event) {
        var data = event && event.data ? event.data : {};

        if (data.requesterId === TAB_ID || data.ownerId === TAB_ID) {
          return;
        }

        if (data.type === "release_request") {
          if (!processingLocked) {
            requestWorkerUnload("peer_request", true);
          }
          return;
        }

        if (data.type === "lock_released") {
          if (modelWarmState === "blocked" && window.transcriptionAudio && !processingLocked) {
            requestModelWarmup();
          }
          syncTranscribeReadyState();
        }
      };
    }

    window.addEventListener("storage", function (event) {
      if (event.key !== MODEL_LOCK_KEY) {
        return;
      }

      if (!event.newValue && modelWarmState === "blocked" && window.transcriptionAudio && !processingLocked) {
        requestModelWarmup();
      }
      syncTranscribeReadyState();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (!processingLocked) {
          scheduleIdleUnload(IDLE_UNLOAD_HIDDEN_MS);
        }
        return;
      }

      clearIdleUnloadTimer();
      if (modelWarmState === "blocked" && window.transcriptionAudio && !processingLocked) {
        requestModelWarmup();
      } else if (modelWarmState === "ready") {
        scheduleIdleUnload(IDLE_UNLOAD_VISIBLE_MS);
      }
      syncTranscribeReadyState();
    });

    window.addEventListener("pagehide", function () {
      clearIdleUnloadTimer();
      stopLockHeartbeat();
      releaseModelLock();
      try {
        if (worker) {
          worker.postMessage({
            type: "unload",
            includeTranslation: true,
            reason: "pagehide"
          });
        }
      } catch (error) {
      }
    });
  }


  function createMarkup() {
    return [
      '<div class="at-root">',
      '  <div class="at-row at-file">',
      '    <div class="at-file-info">',
      '      <i class="at-file-icon is-hidden" data-lucide="music" data-role="fileIcon" aria-hidden="true"></i>',
      '      <div class="at-file-name" data-role="fileName">No file selected</div>',
      "    </div>",
      '    <div data-role="fileActions">',
      '      <button class="at-btn at-btn-soft is-hidden" type="button" data-role="changeFileBtn">Change file</button>',
      '      <button class="at-btn at-btn-soft is-hidden" type="button" data-role="restartBtn">Start over</button>',
      "    </div>",
      "  </div>",
      '  <div class="at-row at-status" data-role="status">Upload a file to begin transcription</div>',
      '  <div class="at-row is-hidden" data-role="progressRow">',
      '    <div class="progress-container"><div id="progress-bar"></div></div>',
        '    <div id="progress-message"></div>',
      "  </div>",
      '  <div class="at-row is-hidden" data-role="processingInfo">',
      '    <div class="at-help" data-role="processingHint">Transcription runs entirely in your browser, so your media never leaves your device.</div>',
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="modelRow">',
      '    <div class="at-model-grid" data-role="modelGrid">' + buildTranscriptionModelCardsMarkup() + "</div>",
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="languageRow">',
      '    <div class="at-language-field">',
      '      <label for="language-search-input">Select transcription language</label>',
      '      <div data-role="languagePicker">',
      '        <button class="at-btn at-btn-soft" type="button" data-role="languagePickerToggle" aria-expanded="false">',
      '          <span data-role="languagePickerCurrent">Choose language for best accuracy</span>',
      '          <span data-role="languagePickerChevron" aria-hidden="true">▾</span>',
      "        </button>",
      '        <div class="is-hidden" data-role="languagePickerPanel">',
      '          <input id="language-search-input" type="search" data-role="languagePickerSearch" placeholder="Search language or code" autocomplete="off" spellcheck="false">',
      '          <div data-role="languagePickerList"></div>',
      "        </div>",
      "      </div>",
      '      <select id="language-select" class="is-hidden">' + buildTranscriptionLanguageOptions() + "</select>",
      "    </div>",
      "  </div>",
      '  <div class="at-row transcribe-controls enhance-block is-hidden" data-role="enhanceRow">',
      '    <label class="enhance-label">',
      '      <input type="checkbox" id="enhance-audio">',
      '      <span class="enhance-label-copy">',
      '        <strong>Enhance audio</strong>',
      '        <small>Cleaner speech for noisy recordings</small>',
      '      </span>',
      "    </label>",
    '    <p class="enhance-desc">Normalizes volume before transcription. Slightly slower, but often worth it for rough audio.</p>',
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="transcribeRow">',
      '    <button class="at-btn at-btn-primary" id="start-transcribe" data-role="startTranscribe" disabled>Transcribe</button>',
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="viewControlsRow">',
      '    <div class="tab-switch">',
      '      <button class="tab active" data-tab="original">Original</button>',
      '      <button class="tab" data-tab="translated">Translated</button>',
      "    </div>",
      '    <button class="at-btn at-btn-soft" type="button" data-role="toggleEdit" disabled>Edit transcript</button>',
      '    <label class="enhance-label">',
      '      <input type="checkbox" id="show-timestamps" checked>',
      '      <span>Show Timestamps</span>',
      '    </label>',
      "  </div>",
      '  <div class="at-row is-hidden" data-role="transcriptRow">',
      '    <div class="at-transcript-box" data-role="transcript">Transcription will appear here after processing.</div>',
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="translateEntryRow">',
      '    <button class="at-btn" type="button" data-role="toggleTranslateSetup" disabled>Translate transcript</button>',
      '    <button class="at-btn at-btn-soft" id="chatgptTranslateBtn" type="button" data-role="chatgptTranslateBtn" disabled>Refine with ChatGPT</button>',
      "  </div>",
      '  <div data-role="translationPanel" class="is-hidden">',
      '  <div class="at-row translation-section">',
      '    <div class="at-language-field">',
      '      <label for="translate-source-search-input">Transcript language</label>',
      '      <div data-role="translateSourcePicker">',
      '        <button class="at-btn at-btn-soft" type="button" data-role="translateSourcePickerToggle" aria-expanded="false">',
      '          <span data-role="translateSourcePickerCurrent">Select transcript language</span>',
      '          <span data-role="translateSourcePickerChevron" aria-hidden="true">▾</span>',
      "        </button>",
      '        <div class="is-hidden" data-role="translateSourcePickerPanel">',
      '          <input id="translate-source-search-input" type="search" data-role="translateSourcePickerSearch" placeholder="Search transcript language" autocomplete="off" spellcheck="false">',
      '          <div data-role="translateSourcePickerList"></div>',
      "        </div>",
      "      </div>",
      '      <select id="translate-source-language" class="is-hidden">' + buildTranslationLanguageOptions("Select transcript language") + "</select>",
      "    </div>",
      '    <div class="at-language-field">',
      '      <label for="translate-target-search-input">Translate to</label>',
      '      <div data-role="translateTargetPicker">',
      '        <button class="at-btn at-btn-soft" type="button" data-role="translateTargetPickerToggle" aria-expanded="false">',
      '          <span data-role="translateTargetPickerCurrent">Select target language</span>',
      '          <span data-role="translateTargetPickerChevron" aria-hidden="true">▾</span>',
      "        </button>",
      '        <div class="is-hidden" data-role="translateTargetPickerPanel">',
      '          <input id="translate-target-search-input" type="search" data-role="translateTargetPickerSearch" placeholder="Search target language" autocomplete="off" spellcheck="false">',
      '          <div data-role="translateTargetPickerList"></div>',
      "        </div>",
      "      </div>",
      '      <select id="translate-language" class="is-hidden">' + buildTranslationLanguageOptions("Select target language") + "</select>",
      "    </div>",
      '    <div class="at-language-field">',
      '      <label for="modeSelect">Translation mode</label>',
      '      <select id="modeSelect">',
      '        <option value="accurate" selected>Accurate (word-by-word)</option>',
      '        <option value="subtitle">Subtitle (short & readable)</option>',
      "      </select>",
      "    </div>",
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <label class="enhance-label">',
      '      <input type="checkbox" id="polishToggle">',
      '      <span>Improve readability (beta)</span>',
      '    </label>',
      '    <p class="translation-hint" data-role="translationHint">Translation uses your transcript, including any segment edits. Choose the transcript language carefully for best results.</p>',
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <button class="at-btn at-btn-primary" id="translate-btn" data-role="translateBtn" disabled>Start translation</button>',
      "  </div>",
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="exportRow">',
      '    <button class="at-btn at-btn-soft" data-role="copyTranscript" disabled>Copy</button>',
      '    <button class="at-btn" data-role="downloadTxt" disabled>Download TXT</button>',
      '    <button class="at-btn" data-role="downloadSrt" disabled>Download SRT</button>',
      '    <button class="at-btn" data-download-vtt disabled>Download VTT</button>',
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

  function getProgressValue() {
    var bar = document.getElementById("progress-bar");
    if (!bar || !bar.style || !bar.style.width) {
      return 0;
    }
    return Math.max(0, Math.min(100, parseFloat(bar.style.width) || 0));
  }

  function startFakeProgress(start, end, label) {
    var value = Math.max(start == null ? 0 : start, getProgressValue());
    var limit = end == null ? 92 : end;
    var message = label || "Transcribing in browser...";

    stopFakeProgress();
    progressInterval = setInterval(function () {
      if (value < 40) {
        value += 1.1 + Math.random() * 0.9;
      } else if (value < 75) {
        value += 0.55 + Math.random() * 0.55;
      } else {
        value += 0.18 + Math.random() * 0.28;
      }
      if (value >= limit) {
        value = limit;
      }
      setProgress(Math.max(getProgressValue(), value));
      if (activeTranscriptionContext && activeTranscriptionContext.statusEl) {
        setStatus(activeTranscriptionContext.statusEl, normalizeIncomingText(message) + " " + Math.round(Math.max(getProgressValue(), value)) + "%", "processing");
      }
    }, 500);
  }

  function stopFakeProgress() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function startProgressMessages(messages) {
    var items = Array.isArray(messages) && messages.length ? messages : progressMessages;
    var index = 0;
    stopProgressMessages(false);
    setProgressMessage(items[0]);
    progressMessageInterval = setInterval(function () {
      index = (index + 1) % items.length;
      setProgressMessage(items[index]);
    }, 2400);
  }

  function stopProgressMessages(clearMessage) {
    if (progressMessageInterval) {
      clearInterval(progressMessageInterval);
      progressMessageInterval = null;
    }
    if (clearMessage !== false) {
      setProgressMessage("");
    }
  }

  function setElementVisible(element, visible) {
    if (!element) {
      return;
    }
    element.classList.toggle("is-hidden", !visible);
  }

  function hasTranscriptResults() {
    return !!(window.currentTranscript || getActiveSegments().length);
  }

  function updateRuntimeMessaging(root) {
    if (!root) {
      return;
    }

    var processingHintEl = root.querySelector('[data-role="processingHint"]');

    if (processingHintEl) {
      processingHintEl.textContent = getProcessingInfoCopy();
    }
  }

  function syncTranscriptionModelCards(root) {
    if (!root) {
      return;
    }

    var cards = root.querySelectorAll('[data-role="modelCard"]');
    cards.forEach(function (card) {
      var modelKey = card.getAttribute("data-model-key") || "";
      var state = ensureTranscriptionModelState(modelKey);
      var isSelected = modelKey === selectedTranscriptionModelKey;
      var badge = root.querySelector('[data-role="modelBadge"][data-model-key="' + modelKey + '"]');
      var reason = root.querySelector('[data-role="modelReason"][data-model-key="' + modelKey + '"]');

      card.dataset.selected = isSelected ? "true" : "false";
      card.dataset.state = state.status;
      card.disabled = !state.enabled || processingLocked;
      card.setAttribute("aria-pressed", isSelected ? "true" : "false");

      if (badge) {
        badge.textContent = getModelAvailabilityLabel(modelKey);
        badge.dataset.state = state.status;
      }

      if (reason) {
        if (!state.enabled) {
          reason.textContent = state.reason;
        } else if (state.status === "error") {
          reason.textContent = state.errorMessage || "Could not prepare this mode. Try again.";
        } else {
          reason.textContent = "";
        }
      }
    });
  }

  function refreshTranscriptionModelUi(root) {
    syncTranscriptionModelCards(root || getPrimaryTranscribeRoot());
    syncTranscribeReadyState();
  }

  function selectTranscriptionModel(modelKey, options) {
    var nextModel = getTranscriptionModeByKey(modelKey);
    var nextState = ensureTranscriptionModelState(nextModel.key);
    var forceReload = !!(options && options.forceReload);

    if (!nextState.enabled || processingLocked) {
      refreshTranscriptionModelUi(getPrimaryTranscribeRoot());
      return;
    }

    var changed = selectedTranscriptionModelKey !== nextModel.key;
    selectedTranscriptionModelKey = nextModel.key;
    modelWarmState = nextState.status;

    refreshTranscriptionModelUi(getPrimaryTranscribeRoot());

    if (window.transcriptionAudio && (changed || forceReload || nextState.status === "error" || modelWarmState !== "ready")) {
      requestModelWarmup();
    }
  }

  function updateFileIcon(root, file) {
    if (!root) {
      return;
    }

    var icon = root.querySelector('[data-role="fileIcon"]');
    if (!icon) {
      return;
    }

    if (!file) {
      icon.classList.add("is-hidden");
      icon.setAttribute("data-lucide", "music");
      return;
    }

    icon.classList.remove("is-hidden");
    icon.setAttribute("data-lucide", file.type && file.type.startsWith("video") ? "video" : "music");

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function updateTranslateEntryButton(toggleBtn, root, hasResults, hasTranslation, isProcessing) {
    if (!toggleBtn) {
      return;
    }

    var isOpen = !!(root && root.__translationSetupOpen);
    if (hasTranslation) {
      toggleBtn.textContent = isOpen ? "Hide translation setup" : "Translate another language";
    } else {
      toggleBtn.textContent = isOpen ? "Hide translation setup" : "Translate transcript";
    }

    toggleBtn.disabled = !hasResults || isProcessing;
  }

  function updateToolLayout(root) {
    if (!root) {
      return;
    }

    var toolCard = root.querySelector(".at-root");
    var hasAudioReady = !!window.transcriptionAudio;
    var hasResults = hasTranscriptResults();
    var hasTranslation = hasTranslatedSegments();
    var isProcessing = processingLocked;
    var isPreparing = !!(toolCard && toolCard.classList.contains("is-active") && !hasAudioReady && !hasResults && !isProcessing);
    var isModelLoading = hasAudioReady && modelWarmState === "loading" && !hasResults && !isProcessing;
    var showSetup = hasAudioReady && !hasResults && !isProcessing;
    var showResults = hasResults || hasTranslation;
    var translationPanel = root.querySelector('[data-role="translationPanel"]');
    var translateEntryBtn = root.querySelector('[data-role="toggleTranslateSetup"]');
    var chatgptEntryBtn = root.querySelector('[data-role="chatgptTranslateBtn"]');

    if (!showResults) {
      root.__translationSetupOpen = false;
    }

    setElementVisible(root.querySelector('[data-role="progressRow"]'), isPreparing || isProcessing || isModelLoading);
    setElementVisible(root.querySelector('[data-role="processingInfo"]'), isProcessing || isModelLoading);
    setElementVisible(root.querySelector('[data-role="modelRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="languageRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="enhanceRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="transcribeRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="viewControlsRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="transcriptRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="translateEntryRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="exportRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="changeFileBtn"]'), hasAudioReady || showResults);
    setElementVisible(root.querySelector('[data-role="restartBtn"]'), hasAudioReady || isPreparing || isProcessing || showResults);
    setElementVisible(translationPanel, showResults && !!root.__translationSetupOpen && !isProcessing);
    updateTranslateEntryButton(translateEntryBtn, root, hasResults, hasTranslation, isProcessing);
    if (chatgptEntryBtn) {
      chatgptEntryBtn.disabled = !showResults || isProcessing;
    }
    syncTranscriptionModelCards(root);
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

  function getFileExtension(fileName) {
    var value = String(fileName || "");
    var lastDotIndex = value.lastIndexOf(".");
    if (lastDotIndex < 0) {
      return "";
    }
    return value.slice(lastDotIndex).toLowerCase();
  }

  function isSupportedMediaFile(file) {
    var type = String(file && file.type || "").toLowerCase();
    var extension = getFileExtension(file && file.name);
    var supportedExtensions = {
      ".mp3": true,
      ".wav": true,
      ".m4a": true,
      ".aac": true,
      ".flac": true,
      ".ogg": true,
      ".oga": true,
      ".mp4": true,
      ".m4v": true,
      ".mov": true,
      ".webm": true,
      ".mpga": true
    };

    if (!file) {
      return false;
    }

    if (type.indexOf("audio/") === 0 || type.indexOf("video/") === 0) {
      return true;
    }

    return !!supportedExtensions[extension];
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

  function isArabicLanguage(language) {
    return String(language || "").toLowerCase() === "ar";
  }

  function normalizeArabicText(text) {
    if (!text) return text;

    var cleaned = normalizeText(text);
    return cleaned
      .replace(/\u060C\s*/g, "\u060C ")
      .replace(/([.\u061F!])\s*/g, "$1 ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeTranscriptTextForDisplay(text, language) {
    var incoming = normalizeIncomingText(text);
    return isArabicLanguage(language) ? normalizeArabicText(incoming) : incoming;
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

  function clearTranslatedState() {
    window.translatedTranscript = "";
    window.translatedTitle = "";
    window.translatedSubtitles = [];
    (window.currentSegments || []).forEach(function (segment) {
      if (segment) {
        segment.translatedText = "";
      }
    });
    if (window.currentTab === "translated") {
      window.currentTab = "original";
    }
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

  function buildSubtitles(chunks, language) {
    var isArabic = isArabicLanguage(language);
    var MAX_CHARS_PER_LINE = isArabic ? 46 : 42;
    var MAX_WORDS_PER_LINE = isArabic ? 8 : 7;
    var MAX_LINE_DURATION = isArabic ? 6 : 5.5;
    var MAX_GAP_SECONDS = isArabic ? 0.6 : 0.75;

    function isValidTimestamp(timestamp) {
      return Array.isArray(timestamp) &&
        timestamp.length >= 2 &&
        Number.isFinite(timestamp[0]) &&
        Number.isFinite(timestamp[1]) &&
        timestamp[1] > timestamp[0];
    }

    function normalizeSegmentText(text) {
      return fixPunctuation(cleanText(text));
    }

    function getWordCount(text) {
      var matches = String(text || "").trim().match(/\S+/g);
      return matches ? matches.length : 0;
    }

    function endsSentence(text) {
      return /[.\u061F!?]$/.test(normalizeSegmentText(text));
    }

    function shouldAttachWithoutSpace(text) {
      return /^[)\]}.,!\u061F\u060C:;]+/.test(text);
    }

    function joinTexts(left, right) {
      var safeLeft = normalizeSegmentText(left);
      var safeRight = normalizeSegmentText(right);

      if (!safeLeft) return safeRight;
      if (!safeRight) return safeLeft;
      if (shouldAttachWithoutSpace(safeRight)) {
        return safeLeft + safeRight;
      }

      return safeLeft + " " + safeRight;
    }

    function shouldStartNewSubtitle(current, nextText, nextTimestamp) {
      var candidateText = joinTexts(current.text, nextText);
      var gap = Math.max(0, nextTimestamp[0] - current.timestamp[1]);
      var duration = nextTimestamp[1] - current.timestamp[0];

      return gap > MAX_GAP_SECONDS ||
        endsSentence(current.text) ||
        candidateText.length > MAX_CHARS_PER_LINE ||
        getWordCount(candidateText) > MAX_WORDS_PER_LINE ||
        duration > MAX_LINE_DURATION;
    }

    return normalizeIncomingSegments(chunks).reduce(function (result, chunk) {
      var text = normalizeSegmentText(chunk && chunk.text);
      var timestamp = chunk && chunk.timestamp;

      if (!text || !isValidTimestamp(timestamp)) {
        return result;
      }

      var current = result[result.length - 1];
      if (!current) {
        result.push({
          text: text,
          timestamp: [timestamp[0], timestamp[1]]
        });
        return result;
      }

      if (shouldStartNewSubtitle(current, text, timestamp)) {
        result.push({
          text: text,
          timestamp: [timestamp[0], timestamp[1]]
        });
        return result;
      }

      current.text = joinTexts(current.text, text);
      current.timestamp[1] = Math.max(current.timestamp[1], timestamp[1]);
      return result;
    }, []);
  }

  function fixPunctuation(text) {
    return normalizeIncomingText(String(text || ""))
      .replace(/\s+([,.:;!\u061F\u060C])/g, "$1")
      .replace(/([\u060C,.:;])(?=\S)/g, "$1 ");
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

    var root = transcriptEl.closest("#audio-tool");
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
      transcriptEl.textContent = EMPTY_TRANSCRIPT_TEXT;
    }

    // Re-append audio player to ensure it's not accidentally removed
    if (audioPlayer && !document.getElementById("audio-player")) {
      var section = document.querySelector("section");
      if (section) {
        section.appendChild(audioPlayer);
      }
    }

    updateToolLayout(root);
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
    editBtn.textContent = previewEditMode ? "Done editing" : "Edit transcript";
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

  function handleTranscriptionResult(text, segments, warnings) {
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
      syncTranslationSourceSelection(document.querySelector("#translate-source-language"), false);
      if (document.querySelector("#translate-language")) {
        document.querySelector("#translate-language").value = "";
      }
      context.transcriptEl.textContent = window.currentTranscript;
      setExportButtonsState(context.copyBtn, context.txtBtn, context.srtBtn, context.vttBtn, true);
      setTranslationButtonsState(context.translateBtn, null, null, null, false);
      var chatgptBtn = document.getElementById("chatgptTranslateBtn");
      if (chatgptBtn) {
        chatgptBtn.disabled = false;
      }
      syncTranslationReadyState();
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
      updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
      setProgressMessage("Transcription complete");
      setProgress(100);
      var feedback = getTranscriptionFeedback(formattedText, warnings, context);
      setStatus(context.statusEl, feedback.message, feedback.state);
    } else {
      previewEditMode = false;
      window.currentTranscript = "";
      window.currentSegments = [];
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      window.transcriptionSourceLanguage = "";
      window.currentTranscriptDuration = 0;
      syncTranslationSourceSelection(document.querySelector("#translate-source-language"), false);
      if (document.querySelector("#translate-language")) {
        document.querySelector("#translate-language").value = "";
      }
      context.transcriptEl.textContent = EMPTY_TRANSCRIPT_TEXT;
      setTranslationButtonsState(context.translateBtn, null, null, null, false);
      updateTranscriptView(context.transcriptEl, context.originalTabBtn, context.translatedTabBtn, context.editBtn);
      updateExportLabels(context.txtBtn, context.srtBtn, context.vttBtn);
      syncTranslationReadyState();
      setProgressMessage("");
      setProgress(0);
      var emptyFeedback = getTranscriptionFeedback("", warnings, context);
      setStatus(context.statusEl, emptyFeedback.message, emptyFeedback.state);
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
      syncTranslationReadyState();
      if (context.transcriptEl) {
        context.transcriptEl.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
      setProgress(100);
      setProgressMessage("");
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
      setProgressMessage("");
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
    setProgressMessage("Finalizing translation...");
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
    syncTranslationReadyState();
    if (context.transcriptEl) {
      context.transcriptEl.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
    setProgress(100);
    setProgressMessage("Translation complete");
    setStatus(context.statusEl, "Translation complete", "ready");
    processingLocked = false;
    if (typeof context.afterRunCleanup === "function") {
      context.afterRunCleanup({
        keepResults: true
      });
    }
    activeTranslationContext = null;
  }

  function attachWorkerListeners(targetWorker, generation) {
    if (!targetWorker) {
      return;
    }

    targetWorker.onmessage = function (e) {
      if (generation !== workerGeneration) {
        return;
      }

      var type = e.data.type;
      var text = normalizeIncomingText(e.data.text);
      var segments = normalizeIncomingSegments(e.data.segments);
      var message = normalizeIncomingText(e.data.message);
      var progress = e.data.progress;
      var modelKey = e.data.modelKey || selectedTranscriptionModelKey;
      var model = getTranscriptionModeByKey(modelKey);
      var modelState = ensureTranscriptionModelState(modelKey);

      if (type === "loading") {
        if (activeTranslationContext) {
          setStatus(activeTranslationContext.statusEl, "Preparing translation model...", "processing");
          setProgressMessage("Preparing translation model...");
        }
        return;
      }

      if (type === "model_loading") {
        pendingModelRequestKey = modelKey;
        activePreparedModelKey = "";
        resetOtherModelStates(modelKey);
        setModelUiState(modelKey, "loading");
        if (modelKey === selectedTranscriptionModelKey) {
          modelWarmState = "loading";
          var loadingStatusEl = getPrimaryTranscribeStatusEl();
          if (loadingStatusEl) {
            setStatus(loadingStatusEl, "Preparing " + model.label + "...", "processing");
          }
          setProgress(0);
          setProgressMessage(CHECKING_CACHED_MODEL_COPY);
        }
        refreshTranscribeLayout();
        return;
      }

      if (type === "model_download_progress") {
        var downloadPercent = Math.max(0, Math.min(100, Math.round(e.data.progress || 0)));
        modelState.progress = downloadPercent;
        setModelUiState(modelKey, "loading");
        if (modelKey === selectedTranscriptionModelKey) {
          modelWarmState = "loading";
          var downloadStatusEl = getPrimaryTranscribeStatusEl();
          if (downloadStatusEl) {
            setStatus(downloadStatusEl, "Downloading " + model.label + "... " + downloadPercent + "%", "processing");
          }
          setProgress(downloadPercent);
          setProgressMessage(FIRST_RUN_MODEL_COPY);
        }
        refreshTranscribeLayout();
        return;
      }

      if (type === "model_ready") {
        modelUnloadPending = false;
        pendingModelRequestKey = "";
        activePreparedModelKey = modelKey;
        resetOtherModelStates(modelKey);
        setModelUiState(modelKey, "ready");
        startLockHeartbeat();
        if (modelKey === selectedTranscriptionModelKey) {
          modelWarmState = "ready";
        }
        if (activeTranscriptionContext && activeTranscriptionContext.modelKey === modelKey) {
          setStatus(activeTranscriptionContext.statusEl, getModelStartStatus(e.data.loadState), "processing");
          setProgress(0);
          setProgressMessage("Transcribing in browser...");
        } else if (modelKey === selectedTranscriptionModelKey) {
          var warmupStatusEl = getPrimaryTranscribeStatusEl();
          if (warmupStatusEl) {
            setStatus(warmupStatusEl, getWarmModelReadyStatus(e.data.loadState, getSelectedTranscriptionLanguage()), "ready");
          }
          setProgress(0);
          setProgressMessage("");
          scheduleIdleUnload(document.hidden ? IDLE_UNLOAD_HIDDEN_MS : IDLE_UNLOAD_VISIBLE_MS);
        }
        syncTranscribeReadyState();
        refreshTranscribeLayout();
        return;
      }

      if (type === "model_error") {
        modelUnloadPending = false;
        pendingModelRequestKey = "";
        setModelUiState(modelKey, "error", message || "Could not prepare this mode.");
        if (!activeTranscriptionContext && modelKey === selectedTranscriptionModelKey) {
          modelWarmState = "error";
          stopLockHeartbeat();
          releaseModelLock();
          var errorStatusEl = getPrimaryTranscribeStatusEl();
          if (errorStatusEl) {
            setStatus(errorStatusEl, message || "Failed to prepare the selected transcription mode.", "error");
          }
          setProgress(0);
          setProgressMessage("");
          syncTranscribeReadyState();
          refreshTranscribeLayout();
        }
        return;
      }

      if (type === "unloaded") {
        modelUnloadPending = false;
        pendingModelRequestKey = "";
        activePreparedModelKey = "";
        modelWarmState = getSelectedModelState().enabled ? "idle" : "disabled";
        resetOtherModelStates("");
        if (selectedTranscriptionModelKey) {
          setModelUiState(selectedTranscriptionModelKey, getSelectedModelState().enabled ? "idle" : "disabled");
        }
        stopLockHeartbeat();
        releaseModelLock();
        syncTranscribeReadyState();
        refreshTranscribeLayout();
        notifyOtherTabs({
          type: "lock_released",
          ownerId: TAB_ID
        });
        return;
      }

      if (type === "unload_error" || type === "unload_skipped") {
        modelUnloadPending = false;
        syncTranscribeReadyState();
        refreshTranscribeLayout();
        return;
      }

      if (type === "status") {
        if (activeTranscriptionContext) {
          setStatus(activeTranscriptionContext.statusEl, message || "Transcribing in browser...", "processing");
          if (message) {
            if (String(message).indexOf("Finalizing") !== -1) {
              startFakeProgress(getProgressValue(), 98, message);
            } else if (!progressInterval) {
              startFakeProgress(getProgressValue(), 90, message);
            }
          }
        } else if (activeTranslationContext && e.data.phase === "translation_loading") {
          setStatus(activeTranslationContext.statusEl, message || "Preparing translation model...", "processing");
        }
        setProgressMessage(message || "");
        if (typeof progress === "number") {
          setProgress(progress);
        }
        return;
      }

      if (e.data.type === "progress") {
        var percent = typeof e.data.value === "number"
          ? Math.round(e.data.value)
          : Math.round((e.data.current / e.data.total) * 100);
        var progressMessage = message || e.data.message || "Transcribing in browser...";
        if (activeTranscriptionContext) {
          setStatus(activeTranscriptionContext.statusEl, "Transcribing in browser... " + percent + "%", "processing");
          setProgressMessage(progressMessage);
          if (!progressInterval && percent < 100) {
            startFakeProgress(percent, percent >= 90 ? 98 : 90, progressMessage);
          }
        }
        setProgress(Math.max(0, Math.min(100, percent)));
        return;
      }

      if (type === "result") {
        stopFakeProgress();
        stopProgressMessages(false);
        var activeLanguage = activeTranscriptionContext && activeTranscriptionContext.language;
        const finalSegments = buildSubtitles(segments || [], activeLanguage);
        window.currentSegments = finalSegments;
        handleTranscriptionResult(
          normalizeTranscriptTextForDisplay(text, activeLanguage),
          finalSegments,
          e.data.warnings
        );
        scheduleIdleUnload(document.hidden ? IDLE_UNLOAD_HIDDEN_MS : IDLE_UNLOAD_VISIBLE_MS);
      }

      if (type === "error") {
        var context = activeTranscriptionContext;
        processingLocked = false;
        stopFakeProgress();
        stopProgressMessages();
        if (context) {
          setStatus(context.statusEl, message || "Transcription failed", "error");
          setProgressMessage("");
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
        modelWarmState = "error";
        setModelUiState(selectedTranscriptionModelKey, "error", message || "Transcription failed");
        stopLockHeartbeat();
        releaseModelLock();
        syncTranscribeReadyState();
        refreshTranscribeLayout();
        if (message) {
          console.error("Transcription worker error:", message);
        }
      }

      if (type === "translation_progress") {
        if (activeTranslationContext) {
          setStatus(activeTranslationContext.statusEl, "Translating transcript...", "processing");
          setProgress(50 + progress * 0.4);
        }
      }

      if (type === "translation_result") {
        stopProgressMessages(false);
        handleTranslationResult(text, e.data.texts);
        srtContent = e.data.srt || "";
        vttContent = e.data.vtt || "";
        var downloadSRTBtn = document.getElementById("downloadSRT");
        var downloadVTTBtn = document.getElementById("downloadVTT");
        if (downloadSRTBtn) downloadSRTBtn.disabled = false;
        if (downloadVTTBtn) downloadVTTBtn.disabled = false;
        scheduleIdleUnload(document.hidden ? IDLE_UNLOAD_HIDDEN_MS : IDLE_UNLOAD_VISIBLE_MS);
      }

      if (type === "translation_error") {
        if (activeTranslationContext) {
          processingLocked = false;
          stopProgressMessages();
          setTranslationButtonsState(activeTranslationContext.translateBtn, null, null, null, !!window.currentTranscript);
          updateTranscriptView(activeTranslationContext.transcriptEl, activeTranslationContext.originalTabBtn, activeTranslationContext.translatedTabBtn, activeTranslationContext.editBtn);
          updateExportLabels(activeTranslationContext.txtBtn, activeTranslationContext.srtBtn, activeTranslationContext.vttBtn);
          syncTranslationReadyState();
          setProgressMessage("");
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
  }

  async function startTranscription(modelKey, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, vttBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn, editBtn, input, afterRunCleanup) {
    var audio = window.transcriptionAudio;

    // Prevent concurrent processing
    if (!audio || !audio.data || processingLocked) {
      return;
    }

    if (!ensureModelOwnership(statusEl, startBtn)) {
      return;
    }

    clearIdleUnloadTimer();

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
            setStatus(statusEl, "Preparing audio...", "processing");
            setProgressMessage("Preparing audio...");
            processedData = normalizeAudio(processedData);
            if (!processedData || processedData.length === 0) {
              processedData = audio.data;
            }
          } catch (enhanceError) {
            console.error("Enhancement failed:", enhanceError);
            processedData = audio.data;
          }
        }

      setStatus(statusEl, "Preparing audio...", "processing");
      setProgressMessage("Preparing audio...");
      setProgress(0);
        var resampled = resampleTo16kHz(processedData, audio.sampleRate);
        activeTranscriptionContext = {
          modelKey: modelKey,
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

      var selectedLanguage = language || "auto";

      worker.postMessage(
    {
      type: "transcribe",
      modelKey: modelKey,
      audio: resampled.buffer,
      selectedLanguage: selectedLanguage
    },
    [resampled.buffer]
  );
      startFakeProgress(4, 90, "Transcribing in browser...");
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
    var input = document.getElementById("audioFileInput");
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
    var languagePicker = root.querySelector('[data-role="languagePicker"]');
    var languagePickerToggle = root.querySelector('[data-role="languagePickerToggle"]');
    var languagePickerCurrent = root.querySelector('[data-role="languagePickerCurrent"]');
    var languagePickerPanel = root.querySelector('[data-role="languagePickerPanel"]');
    var languagePickerSearch = root.querySelector('[data-role="languagePickerSearch"]');
    var languagePickerList = root.querySelector('[data-role="languagePickerList"]');
    var translateSourcePicker = root.querySelector('[data-role="translateSourcePicker"]');
    var translateSourcePickerToggle = root.querySelector('[data-role="translateSourcePickerToggle"]');
    var translateSourcePickerCurrent = root.querySelector('[data-role="translateSourcePickerCurrent"]');
    var translateSourcePickerPanel = root.querySelector('[data-role="translateSourcePickerPanel"]');
    var translateSourcePickerSearch = root.querySelector('[data-role="translateSourcePickerSearch"]');
    var translateSourcePickerList = root.querySelector('[data-role="translateSourcePickerList"]');
    var translateTargetPicker = root.querySelector('[data-role="translateTargetPicker"]');
    var translateTargetPickerToggle = root.querySelector('[data-role="translateTargetPickerToggle"]');
    var translateTargetPickerCurrent = root.querySelector('[data-role="translateTargetPickerCurrent"]');
    var translateTargetPickerPanel = root.querySelector('[data-role="translateTargetPickerPanel"]');
    var translateTargetPickerSearch = root.querySelector('[data-role="translateTargetPickerSearch"]');
    var translateTargetPickerList = root.querySelector('[data-role="translateTargetPickerList"]');
    var translateSourceLanguage = root.querySelector("#translate-source-language");
    var translateBtn = root.querySelector('[data-role="translateBtn"]');
    var toggleTranslateSetupBtn = root.querySelector('[data-role="toggleTranslateSetup"]');
    var translateLanguage = root.querySelector("#translate-language");
    var tabButtons = root.querySelectorAll(".tab");
    var originalTabBtn = root.querySelector('.tab[data-tab="original"]');
    var translatedTabBtn = root.querySelector('.tab[data-tab="translated"]');
    var editBtn = root.querySelector('[data-role="toggleEdit"]');
    var modelGrid = root.querySelector('[data-role="modelGrid"]');
    var changeFileBtn = root.querySelector('[data-role="changeFileBtn"]');
    var restartBtn = root.querySelector('[data-role="restartBtn"]');
    var timestampCheckbox = root.querySelector('#show-timestamps');
    var modeSelect = root.querySelector('#modeSelect');
    var polishToggle = root.querySelector('#polishToggle');
    var audioPlayer = document.getElementById("audio-player");
    if (!input || input.dataset.transcribeToolBound === "1") {
      return;
    }

    function renderLanguagePickerOptions(query) {
      if (!languagePickerList || !languageSelect) {
        return;
      }
      languagePickerList.innerHTML = buildTranscriptionLanguagePickerOptions(query, languageSelect.value);
    }

    function syncLanguagePickerSelection() {
      if (!languagePickerCurrent || !languagePickerToggle || !languageSelect) {
        return;
      }

      languagePickerCurrent.innerHTML = buildTranscriptionLanguageSelectionMarkup(languageSelect.value);
      languagePickerToggle.dataset.hasValue = languageSelect.value ? "true" : "false";
      renderLanguagePickerOptions(languagePickerSearch ? languagePickerSearch.value : "");
    }

    function closeLanguagePicker() {
      if (!languagePickerPanel || !languagePickerToggle) {
        return;
      }
      languagePickerPanel.classList.add("is-hidden");
      languagePickerToggle.setAttribute("aria-expanded", "false");
    }

    function openLanguagePicker() {
      if (!languagePickerPanel || !languagePickerToggle) {
        return;
      }
      renderLanguagePickerOptions(languagePickerSearch ? languagePickerSearch.value : "");
      languagePickerPanel.classList.remove("is-hidden");
      languagePickerToggle.setAttribute("aria-expanded", "true");
      if (languagePickerSearch) {
        window.requestAnimationFrame(function () {
          languagePickerSearch.focus();
          languagePickerSearch.select();
        });
      }
    }

    function toggleLanguagePicker(forceOpen) {
      if (!languagePickerPanel) {
        return;
      }

      if (typeof forceOpen === "boolean") {
        if (forceOpen) {
          openLanguagePicker();
        } else {
          closeLanguagePicker();
        }
        return;
      }

      if (languagePickerPanel.classList.contains("is-hidden")) {
        openLanguagePicker();
      } else {
        closeLanguagePicker();
      }
    }

    function selectTranscriptionLanguage(nextValue) {
      if (!languageSelect || languageSelect.value === nextValue) {
        closeLanguagePicker();
        syncLanguagePickerSelection();
        return;
      }

      languageSelect.value = nextValue;
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      closeLanguagePicker();
      if (languagePickerSearch) {
        languagePickerSearch.value = "";
      }
      syncLanguagePickerSelection();
    }

    function syncTranslationPickerSelections() {
      if (translateSourcePickerCurrent) {
        translateSourcePickerCurrent.innerHTML = buildTranslationLanguageSelectionMarkup(
          translateSourceLanguage ? translateSourceLanguage.value : "",
          "Select transcript language"
        );
      }
      if (translateSourcePickerToggle && translateSourceLanguage) {
        translateSourcePickerToggle.dataset.hasValue = translateSourceLanguage.value ? "true" : "false";
      }
      if (translateSourcePickerList) {
        translateSourcePickerList.innerHTML = buildTranslationLanguagePickerOptions(
          translateSourcePickerSearch ? translateSourcePickerSearch.value : "",
          translateSourceLanguage ? translateSourceLanguage.value : "",
          ""
        );
      }

      if (translateTargetPickerCurrent) {
        translateTargetPickerCurrent.innerHTML = buildTranslationLanguageSelectionMarkup(
          translateLanguage ? translateLanguage.value : "",
          "Select target language"
        );
      }
      if (translateTargetPickerToggle && translateLanguage) {
        translateTargetPickerToggle.dataset.hasValue = translateLanguage.value ? "true" : "false";
      }
      if (translateTargetPickerList) {
        translateTargetPickerList.innerHTML = buildTranslationLanguagePickerOptions(
          translateTargetPickerSearch ? translateTargetPickerSearch.value : "",
          translateLanguage ? translateLanguage.value : "",
          translateSourceLanguage ? translateSourceLanguage.value : ""
        );
      }
    }

    function closeTranslationSourcePicker() {
      if (!translateSourcePickerPanel || !translateSourcePickerToggle) {
        return;
      }
      translateSourcePickerPanel.classList.add("is-hidden");
      translateSourcePickerToggle.setAttribute("aria-expanded", "false");
    }

    function openTranslationSourcePicker() {
      if (!translateSourcePickerPanel || !translateSourcePickerToggle) {
        return;
      }
      syncTranslationPickerSelections();
      translateSourcePickerPanel.classList.remove("is-hidden");
      translateSourcePickerToggle.setAttribute("aria-expanded", "true");
      if (translateSourcePickerSearch) {
        window.requestAnimationFrame(function () {
          translateSourcePickerSearch.focus();
          translateSourcePickerSearch.select();
        });
      }
    }

    function toggleTranslationSourcePicker(forceOpen) {
      if (!translateSourcePickerPanel) {
        return;
      }
      if (typeof forceOpen === "boolean") {
        if (forceOpen) {
          openTranslationSourcePicker();
        } else {
          closeTranslationSourcePicker();
        }
        return;
      }
      if (translateSourcePickerPanel.classList.contains("is-hidden")) {
        openTranslationSourcePicker();
      } else {
        closeTranslationSourcePicker();
      }
    }

    function selectTranslationSourceLanguage(nextValue) {
      if (!translateSourceLanguage) {
        return;
      }
      translateSourceLanguage.value = nextValue;
      translateSourceLanguage.dispatchEvent(new Event("change", { bubbles: true }));
      closeTranslationSourcePicker();
      if (translateSourcePickerSearch) {
        translateSourcePickerSearch.value = "";
      }
      syncTranslationPickerSelections();
    }

    function closeTranslationTargetPicker() {
      if (!translateTargetPickerPanel || !translateTargetPickerToggle) {
        return;
      }
      translateTargetPickerPanel.classList.add("is-hidden");
      translateTargetPickerToggle.setAttribute("aria-expanded", "false");
    }

    function openTranslationTargetPicker() {
      if (!translateTargetPickerPanel || !translateTargetPickerToggle) {
        return;
      }
      syncTranslationPickerSelections();
      translateTargetPickerPanel.classList.remove("is-hidden");
      translateTargetPickerToggle.setAttribute("aria-expanded", "true");
      if (translateTargetPickerSearch) {
        window.requestAnimationFrame(function () {
          translateTargetPickerSearch.focus();
          translateTargetPickerSearch.select();
        });
      }
    }

    function toggleTranslationTargetPicker(forceOpen) {
      if (!translateTargetPickerPanel) {
        return;
      }
      if (typeof forceOpen === "boolean") {
        if (forceOpen) {
          openTranslationTargetPicker();
        } else {
          closeTranslationTargetPicker();
        }
        return;
      }
      if (translateTargetPickerPanel.classList.contains("is-hidden")) {
        openTranslationTargetPicker();
      } else {
        closeTranslationTargetPicker();
      }
    }

    function selectTranslationTargetLanguage(nextValue) {
      if (!translateLanguage) {
        return;
      }
      translateLanguage.value = nextValue;
      translateLanguage.dispatchEvent(new Event("change", { bubbles: true }));
      closeTranslationTargetPicker();
      if (translateTargetPickerSearch) {
        translateTargetPickerSearch.value = "";
      }
      syncTranslationPickerSelections();
    }

    function resetProcessingUi() {
      stopFakeProgress();
      stopProgressMessages();
      clearIdleUnloadTimer();
      setProgress(0);
      setProgressMessage("");
      processingLocked = false;
      activeTranscriptionContext = null;
      activeTranslationContext = null;
      input.disabled = false;
      setEnhanceToggleState(root.querySelector("#enhance-audio"), true);
    }

    function resetTranscriptState() {
      previewEditMode = false;
      root.__translationSetupOpen = false;
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
      syncTranslationSourceSelection(translateSourceLanguage, false);
      if (translateLanguage) {
        translateLanguage.value = "";
      }
      var chatgptBtn = document.getElementById("chatgptTranslateBtn");
      if (chatgptBtn) {
        chatgptBtn.disabled = true;
      }
      syncTranslationPickerSelections();
      syncTranslationReadyState();
    }

    function clearFileSelection() {
      if (root.__audioPreviewUrl) {
        URL.revokeObjectURL(root.__audioPreviewUrl);
        root.__audioPreviewUrl = "";
      }
      root.__translationSetupOpen = false;
      input.value = "";
      input.disabled = false;
      fileNameEl.textContent = "No file selected";
      if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.removeAttribute("src");
        audioPlayer.load();
        audioPlayer.style.display = "none";
      }
      updateFileIcon(root, null);
      if (toolRoot) {
        toolRoot.classList.remove("is-active");
      }
      window.transcriptionAudio = null;
      requestWorkerUnload("clear_file", true);
      updateToolLayout(root);
    }

    function resetForNextUpload(options) {
      var keepResults = !!(options && options.keepResults);

      resetProcessingUi();

      if (!keepResults) {
        clearFileSelection();
        setTranscribeButtonState(startBtn, false);
        updateRuntimeMessaging(root);
        resetTranscriptState();
      } else if (translateBtn) {
        input.disabled = false;
        translateBtn.disabled = !window.currentTranscript;
      }

      updateToolLayout(root);
    }

    initializeTranscriptionModelStates();
    applyTranscriptionCapabilityProfile(probeTranscriptionCapabilities());
    rebuildTranscribeWorker();
    setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
    setTranscribeButtonState(startBtn, false);
    setTranslationButtonsState(translateBtn, null, null, null, false);
    var chatgptBtnInit = document.getElementById("chatgptTranslateBtn");
    if (chatgptBtnInit) {
      chatgptBtnInit.disabled = true;
    }
    updateRuntimeMessaging(root);
    updateEditButton(editBtn);
    resetTranscriptState();
    updateToolLayout(root);
    refreshTranscriptionModelUi(root);
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
        resetProcessingUi();
        resetTranscriptState();
        clearFileSelection();
        document.dispatchEvent(new Event("converter:empty"));
        if (typeof window.initTranscribeTool === "function") {
          window.initTranscribeTool(root);
        }
      });
    }
    if (changeFileBtn) {
      changeFileBtn.addEventListener("click", function () {
        if (!processingLocked) {
          input.click();
        }
      });
    }
    if (modelGrid) {
      modelGrid.addEventListener("click", function (event) {
        var card = event.target && event.target.closest('[data-role="modelCard"]');
        if (!card) {
          return;
        }
        selectTranscriptionModel(card.getAttribute("data-model-key") || "");
      });
    }
    if (timestampCheckbox) {
      timestampCheckbox.checked = true;

      timestampCheckbox.addEventListener("change", function (e) {
        showTimestamps = e.target.checked;
        updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
      });
    }
    if (languageSelect) {
      var suggestedLanguage = getSuggestedTranscriptionLanguage();
      if (suggestedLanguage && !languageSelect.value) {
        languageSelect.value = suggestedLanguage;
      }

      syncLanguagePickerSelection();

      languageSelect.addEventListener("change", function () {
        syncLanguagePickerSelection();
        if (window.transcriptionAudio && !hasTranscriptResults() && !processingLocked) {
          var canStart = canStartTranscription(languageSelect.value);
          var statusState = canStart ? "ready" : (modelWarmState === "ready" ? "warning" : "processing");
          setStatus(statusEl, getAudioReadyStatus(languageSelect.value), statusState);
          syncTranscribeReadyState();
        }
      });
    }
    if (languagePickerToggle) {
      languagePickerToggle.addEventListener("click", function () {
        toggleLanguagePicker();
      });
    }
    if (languagePickerSearch) {
      languagePickerSearch.addEventListener("input", function () {
        renderLanguagePickerOptions(languagePickerSearch.value);
      });
      languagePickerSearch.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closeLanguagePicker();
          languagePickerToggle.focus();
        }
      });
    }
    if (languagePickerList) {
      languagePickerList.addEventListener("click", function (event) {
        var option = event.target && event.target.closest('[data-role="languagePickerOption"]');
        if (!option) {
          return;
        }
        selectTranscriptionLanguage(option.getAttribute("data-language-code") || "");
      });
    }
    if (translateSourcePickerToggle) {
      translateSourcePickerToggle.addEventListener("click", function () {
        toggleTranslationSourcePicker();
      });
    }
    if (translateSourcePickerSearch) {
      translateSourcePickerSearch.addEventListener("input", function () {
        syncTranslationPickerSelections();
      });
      translateSourcePickerSearch.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closeTranslationSourcePicker();
          translateSourcePickerToggle.focus();
        }
      });
    }
    if (translateSourcePickerList) {
      translateSourcePickerList.addEventListener("click", function (event) {
        var option = event.target && event.target.closest('[data-role="translationLanguagePickerOption"]');
        if (!option || option.disabled) {
          return;
        }
        selectTranslationSourceLanguage(option.getAttribute("data-language-code") || "");
      });
    }
    if (translateTargetPickerToggle) {
      translateTargetPickerToggle.addEventListener("click", function () {
        toggleTranslationTargetPicker();
      });
    }
    if (translateTargetPickerSearch) {
      translateTargetPickerSearch.addEventListener("input", function () {
        syncTranslationPickerSelections();
      });
      translateTargetPickerSearch.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closeTranslationTargetPicker();
          translateTargetPickerToggle.focus();
        }
      });
    }
    if (translateTargetPickerList) {
      translateTargetPickerList.addEventListener("click", function (event) {
        var option = event.target && event.target.closest('[data-role="translationLanguagePickerOption"]');
        if (!option || option.disabled) {
          return;
        }
        selectTranslationTargetLanguage(option.getAttribute("data-language-code") || "");
      });
    }
    document.addEventListener("click", function (event) {
      if (languagePicker && languagePickerPanel && !languagePickerPanel.classList.contains("is-hidden") && !languagePicker.contains(event.target)) {
        closeLanguagePicker();
      }
      if (translateSourcePicker && translateSourcePickerPanel && !translateSourcePickerPanel.classList.contains("is-hidden") && !translateSourcePicker.contains(event.target)) {
        closeTranslationSourcePicker();
      }
      if (translateTargetPicker && translateTargetPickerPanel && !translateTargetPickerPanel.classList.contains("is-hidden") && !translateTargetPicker.contains(event.target)) {
        closeTranslationTargetPicker();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeLanguagePicker();
        closeTranslationSourcePicker();
        closeTranslationTargetPicker();
      }
    });
    if (toggleTranslateSetupBtn) {
      toggleTranslateSetupBtn.addEventListener("click", function () {
        if (!hasTranscriptResults() || processingLocked) {
          return;
        }
        var mappedSourceCode = syncTranslationSourceSelection(translateSourceLanguage, true);
        syncTranslationPickerSelections();
        syncTranslationReadyState();
        root.__translationSetupOpen = !root.__translationSetupOpen;
        updateToolLayout(root);
        if (root.__translationSetupOpen && !mappedSourceCode) {
          setStatus(statusEl, "Choose the transcript language before translating. Edited transcript text will be used as the source.", "warning");
        }
      });
    }
    if (translateSourceLanguage) {
      syncTranslationSourceSelection(translateSourceLanguage, false);
      syncTranslationPickerSelections();
      translateSourceLanguage.addEventListener("change", function () {
        syncTranslationPickerSelections();
        syncTranslationReadyState();
      });
    }
    if (translateLanguage) {
      translateLanguage.addEventListener("change", function () {
        syncTranslationPickerSelections();
        syncTranslationReadyState();
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
          if (hasTranslatedSegments() || window.translatedTranscript) {
            clearTranslatedState();
          }
          activeSegments[index].editedText = nextText;
          window.currentTranscript = getSegmentsParagraphText(activeSegments);
          updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
          updateExportLabels(txtBtn, srtBtn, vttBtn);
          syncTranslationReadyState();
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

        var language = languageSelect ? languageSelect.value : "";
        var selectedModel = getSelectedTranscriptionMode();
        var selectedState = getSelectedModelState();

        if (!selectedState.enabled) {
          setStatus(statusEl, selectedModel.label + " is disabled on this device. " + selectedState.reason, "warning");
          syncTranscribeReadyState();
          return;
        }

        if (modelWarmState === "error") {
          requestModelWarmup();
          setStatus(statusEl, getSelectedModelLoadingText(), "processing");
          return;
        }

        if (!hasSelectedTranscriptionLanguage(language)) {
          setStatus(statusEl, "Choose the spoken language before transcribing for best accuracy.", "warning");
          syncTranscribeReadyState();
          return;
        }

        if (!canStartTranscription(language)) {
          setStatus(statusEl, getSelectedModelLoadingText(), "processing");
          requestModelWarmup();
          return;
        }

        await startTranscription(selectedModel.key, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, vttBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn, editBtn, input, resetForNextUpload);
        updateToolLayout(root);
      });
    }
    if (translateBtn) {
      translateBtn.addEventListener("click", async function () {
        if (processingLocked) {
          return;
        }
        var sourceCode = translateSourceLanguage ? translateSourceLanguage.value : "";
        var targetLang = translateLanguage ? translateLanguage.value : "";
        var sourceLang = getTranslationFloresCode(sourceCode);
        var mappedTarget = getTranslationFloresCode(targetLang);
        var targetItem = getTranslationLanguageByCode(targetLang);
        var selectedLanguageName = targetItem ? targetItem.name : "Translated";

        if (!window.currentSegments || !window.currentSegments.length || !targetLang) {
          return;
        }

        if (!sourceCode || !sourceLang) {
          setStatus(statusEl, "Choose the transcript language before translating.", "warning");
          syncTranslationReadyState();
          return;
        }

        if (!mappedTarget) {
          setStatus(statusEl, "Choose a supported target language.", "warning");
          return;
        }

        if (mappedTarget === sourceLang) {
          setStatus(statusEl, "Source and target languages are the same", "error");
          return;
        }

        var segmentsToTranslate = window.currentSegments || [];
        var linesToTranslate = segmentsToTranslate.map(function (segment) {
          var lineText = cleanText((segment && (segment.editedText || segment.originalText || segment.text)) || "");
          return lineText;
        }).filter(function (line) {
          return line.length > 0;
        });

        if (!linesToTranslate.length) {
          setStatus(statusEl, "No transcript lines are ready to translate.", "error");
          return;
        }

        setTranslationButtonsState(translateBtn, null, null, null, false);
        var chatgptBtn = document.getElementById("chatgptTranslateBtn");
        if (chatgptBtn) {
          chatgptBtn.disabled = true;
        }
        setStatus(statusEl, "Translating transcript...", "processing");
        setProgress(50);
        setProgressMessage("Translating transcript...");
        startProgressMessages([
          "Preparing translation model...",
          "Translating transcript...",
          "Finalizing translation..."
        ]);
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
        root.__translationSetupOpen = false;
        updateToolLayout(root);

        worker.postMessage({
          type: "translate_subtitles",
          texts: linesToTranslate,
          segments: window.currentSegments || [],
          sourceLang: sourceLang,
          targetLang: mappedTarget,
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

    async function handleSelectedFile(file) {
      if (processingLocked) {
        setStatus(statusEl, "Only one file can be processed at a time", "error");
        return;
      }

      if (!file) {
        resetForNextUpload({
          keepResults: false
        });
        return;
      }

      if (!isSupportedMediaFile(file)) {
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
      resetProcessingUi();
      fileNameEl.textContent = file.name;
      updateFileIcon(root, file);
      window.originalFileName = file.name.replace(/\.[^/.]+$/, "");
      root.__translationSetupOpen = false;
      transcriptEl.textContent = EMPTY_TRANSCRIPT_TEXT;

      if (audioPlayer) {
        if (root.__audioPreviewUrl) {
          URL.revokeObjectURL(root.__audioPreviewUrl);
        }
        root.__audioPreviewUrl = URL.createObjectURL(file);
        audioPlayer.src = root.__audioPreviewUrl;
        audioPlayer.style.display = "none";
      }
      resetTranscriptState();
      setTranscribeButtonState(startBtn, false);
      updateToolLayout(root);

      // Validate browser support
      if (!audioContext) {
        resetForNextUpload({
          keepResults: false
        });
        setStatus(statusEl, "Your browser does not support audio processing", "error");
        return;
      }

      setStatus(statusEl, "Preparing audio...", "processing");
      setProgressMessage("Preparing audio...");
      setProgress(10);

      try {
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        var arrayBuffer = await file.arrayBuffer();
        var audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

        // Validate duration - reject if too long
        if (audioBuffer.duration > MAX_DURATION_SECONDS) {
          resetForNextUpload({
            keepResults: false
          });
          setStatus(statusEl, "File must be under 180 seconds for now.", "error");
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

        var selectedLanguage = languageSelect ? languageSelect.value : "";
        var readyMessage = getAudioReadyStatus(selectedLanguage);
        var readyState = hasSelectedTranscriptionLanguage(selectedLanguage) && modelWarmState === "ready" ? "ready" : "warning";

        if (hasSelectedTranscriptionLanguage(selectedLanguage) && audioBuffer.duration > FRIENDLY_WARNING_SECONDS) {
          readyMessage = "Longer file detected. We support up to 180 seconds for now, and this one may take a little longer to transcribe.";
          readyState = "warning";
        }

        setStatus(statusEl, readyMessage, readyState);
        setProgress(30);
        updateToolLayout(root);
        requestModelWarmup();
        syncTranscribeReadyState();
      } catch (error) {
        resetForNextUpload({
          keepResults: false
        });
        console.error("Audio decoding error:", error);
        setStatus(statusEl, "Unsupported or corrupted file", "error");
      }
    }

    window.AudioVideoTranscriptionTool = {
      addFile: handleSelectedFile
    };
  }

  function initTranscribeTool(target) {
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
    updateRuntimeMessaging(root);
    updateFileIcon(root, null);
    bindTranscribeLifecycleEvents();
    bindTool(root, audioContext);
    return root;
  }

  window.initTranscribeTool = initTranscribeTool;
})();

