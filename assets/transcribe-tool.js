(function () {
  "use strict";

  var srtContent = "";
  var vttContent = "";
  var DESKTOP_TRANSCRIBE_WORKER_URL = "/assets/transcribe-worker.js?v=2026-05-20-6";
  var MOBILE_TRANSCRIBE_WORKER_URL = "/assets/transcribe-worker-mobile.js?v=2026-05-20-5";
  var worker = null;
  var workerGeneration = 0;
  var processingLocked = false;
  var activeTranscriptionContext = null;
  var modelWarmState = "idle";
  var modelUnloadPending = false;
  var activePreparedModelKey = "";
  var pendingModelRequestKey = "";
  var progressInterval = null;
  var progressMessageInterval = null;
  var idleUnloadTimer = null;
  var lockHeartbeatTimer = null;
  var lockRetryTimer = null;
  var pendingTranscriptionStart = null;
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
      label: "Triceratops",
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
  var TRANSCRIPTION_DURATION_LIMITS = {
    phone: {
      "baby-raptor": 90,
      triceratop: 90,
      "t-rex": 90
    },
    low: {
      "baby-raptor": 180,
      triceratop: 150,
      "t-rex": 120
    },
    standard: {
      "baby-raptor": 300,
      triceratop: 240,
      "t-rex": 180
    },
    high: {
      "baby-raptor": 480,
      triceratop: 360,
      "t-rex": 240
    },
    ultra: {
      "baby-raptor": 720,
      triceratop: 480,
      "t-rex": 300
    }
  };
  var DEFAULT_TRANSCRIPTION_MODEL_KEY = "triceratop";
  var FALLBACK_TRANSCRIPTION_MODEL_KEY = "baby-raptor";
  var EXTRACT_AUDIO_TOOL_PATH = "/extract-audio-from-video.html";
  var TRANSCRIPTION_RECOVERY_STORAGE_KEY = "fat:transcribe:recovery:v1";
  var TRANSCRIPTION_RECOVERY_MAX_AGE_MS = 10 * 60 * 1000;
  var TRANSLATION_VIEW_STORAGE_PREFIX = "fat:translation-view:v1:";
  var TRANSLATION_VIEW_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  var TREX_WEBGPU_VERIFYING_REASON = "Checking whether this device can safely run T-Rex before enabling it.";
  var TREX_WEBGPU_DESKTOP_REASON = "T-Rex is not recommended on this device. Triceratops will be used instead for a safer local run.";
  var TREX_MIN_RECOMMENDED_MEMORY_GB = 12;
  var TREX_MIN_RECOMMENDED_CPU_THREADS = 10;
  var transcriptionCapabilityProfile = null;
  var tRexWebGpuAssessment = null;
  var tRexWebGpuAssessmentPromise = null;
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
  var LANGUAGE_NATIVE_NAMES = {
    en: "English",
    ar: "العربية",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
    hi: "हिन्दी",
    ur: "اردو",
    tr: "Türkçe",
    zh: "中文",
    pt: "Português",
    ru: "Русский",
    ja: "日本語",
    ko: "한국어",
    it: "Italiano",
    nl: "Nederlands",
    fa: "فارسی",
    bn: "বাংলা",
    pa: "ਪੰਜਾਬੀ",
    ta: "தமிழ்",
    te: "తెలుగు",
    vi: "Tiếng Việt",
    id: "Bahasa Indonesia",
    af: "Afrikaans",
    am: "አማርኛ",
    as: "অসমীয়া",
    az: "Azərbaycan dili",
    ba: "Башҡортса",
    be: "Беларуская",
    bg: "Български",
    bo: "བོད་ཡིག",
    br: "Brezhoneg",
    bs: "Bosanski",
    ca: "Català",
    cs: "Čeština",
    cy: "Cymraeg",
    da: "Dansk",
    el: "Ελληνικά",
    et: "Eesti",
    eu: "Euskara",
    fi: "Suomi",
    fo: "Føroyskt",
    gl: "Galego",
    gu: "ગુજરાતી",
    ha: "Hausa",
    haw: "ʻŌlelo Hawaiʻi",
    he: "עברית",
    hr: "Hrvatski",
    ht: "Kreyòl ayisyen",
    hu: "Magyar",
    hy: "Հայերեն",
    is: "Íslenska",
    jw: "Basa Jawa",
    ka: "ქართული",
    kk: "Қазақша",
    km: "ខ្មែរ",
    kn: "ಕನ್ನಡ",
    la: "Latina",
    lb: "Lëtzebuergesch",
    ln: "Lingála",
    lo: "ລາວ",
    lt: "Lietuvių",
    lv: "Latviešu",
    mg: "Malagasy",
    mi: "Māori",
    mk: "Македонски",
    ml: "മലയാളം",
    mn: "Монгол",
    mr: "मराठी",
    ms: "Bahasa Melayu",
    mt: "Malti",
    my: "မြန်မာ",
    ne: "नेपाली",
    nn: "Norsk nynorsk",
    no: "Norsk",
    oc: "Occitan",
    pl: "Polski",
    ps: "پښتو",
    ro: "Română",
    sa: "संस्कृतम्",
    sd: "سنڌي",
    si: "සිංහල",
    sk: "Slovenčina",
    sl: "Slovenščina",
    sn: "ChiShona",
    so: "Soomaali",
    sq: "Shqip",
    sr: "Српски",
    su: "Basa Sunda",
    sv: "Svenska",
    sw: "Kiswahili",
    tg: "Тоҷикӣ",
    th: "ไทย",
    tk: "Türkmen",
    tl: "Tagalog",
    tt: "Татарча",
    uk: "Українська",
    uz: "Oʻzbek",
    yi: "ייִדיש",
    yo: "Yorùbá",
    yue: "粵語"
  };
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

  function getLanguageDisplayName(item) {
    var code;
    if (!item) {
      return "";
    }

    code = String(item.code || "").toLowerCase();
    return LANGUAGE_NATIVE_NAMES[code] || item.name || code.toUpperCase();
  }

  function getLanguageSearchText(item) {
    if (!item) {
      return "";
    }

    return [
      item.name || "",
      getLanguageDisplayName(item),
      item.code || ""
    ].join(" ").toLowerCase();
  }
  var MODEL_LOCK_KEY = "fat:transcribe:model-lock:v1";
  var MODEL_LOCK_STALE_MS = 10000;
  var MODEL_LOCK_HEARTBEAT_MS = 5000;
  var IDLE_UNLOAD_VISIBLE_MS = 90000;
  var IDLE_UNLOAD_HIDDEN_MS = 15000;
  var TAB_ID = "tab-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  var lockChannel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("fat-transcribe-model")
    : null;

  function createTranscribeWorker() {
    workerGeneration += 1;
    worker = new Worker(getTranscribeWorkerUrl(), {
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

  function getTextDirectionFromLanguage(lang) {
    var value = String(lang || "").toLowerCase();
    var base;

    if (!value || value === "auto" || value === "detect" || value === "auto-detect") {
      return "auto";
    }

    base = value.split("-")[0].split("_")[0];
    return RTL_LANGS.has(base) ? "rtl" : "ltr";
  }

  function getLangCode(lang) {
    var value = String(lang || "").toLowerCase();

    if (!value || value === "auto" || value === "detect" || value === "auto-detect") {
      return "";
    }

    return value;
  }

  function getEffectiveTranscriptionContentLanguage() {
    return getLangCode(getSelectedTranscriptionLanguage())
      || getLangCode(window.transcriptionDetectedLanguage)
      || getLangCode(window.transcriptionSourceLanguage);
  }

  function getEffectiveTranslatedContentLanguage() {
    return getLangCode(window.translatedTranscriptLanguage)
      || getLangCode(window.transcriptionDetectedLanguage)
      || getLangCode(window.transcriptionSourceLanguage);
  }

  function getActiveTranscriptContentLanguage() {
    if (window.currentTab === "translated" && hasTranslatedSegments()) {
      return getEffectiveTranslatedContentLanguage() || getEffectiveTranscriptionContentLanguage();
    }

    return getEffectiveTranscriptionContentLanguage();
  }

  function applyTranscriptDirection(root, selectedLanguage) {
    var dir;
    var lang;

    if (!root) {
      return;
    }

    dir = getTextDirectionFromLanguage(selectedLanguage);
    lang = getLangCode(selectedLanguage);

    root.setAttribute("data-transcript-root", "1");
    root.setAttribute("dir", dir);
    root.style.direction = dir === "auto" ? "" : dir;

    if (lang) {
      root.setAttribute("lang", lang);
    } else {
      root.removeAttribute("lang");
    }

    Array.prototype.forEach.call(
      root.querySelectorAll(".ts-segment, .ts-paragraph, .ts-text, .ts-segment-text, [data-transcript-text]"),
      function (node) {
        node.setAttribute("dir", dir);

        if (lang) {
          node.setAttribute("lang", lang);
        } else {
          node.removeAttribute("lang");
        }
      }
    );
  }

  function clearTranscriptDirection(root) {
    if (!root) {
      return;
    }

    root.removeAttribute("data-transcript-root");
    root.removeAttribute("dir");
    root.removeAttribute("lang");
    root.style.direction = "";

    Array.prototype.forEach.call(
      root.querySelectorAll(".ts-segment, .ts-paragraph, .ts-text, .ts-segment-text, [data-transcript-text]"),
      function (node) {
        node.removeAttribute("dir");
        node.removeAttribute("lang");
      }
    );
  }

  function applyCurrentTranscriptDirection(root) {
    if (!root) {
      return;
    }

    if (window.currentTab === "translated" && hasTranslatedSegments()) {
      applyTranscriptDirection(root, getActiveTranscriptContentLanguage());
      return;
    }

    if (window.currentTranscript || getActiveSegments().length) {
      applyTranscriptDirection(root, getActiveTranscriptContentLanguage());
      return;
    }

    clearTranscriptDirection(root);
  }

  function applyExportDirectionMark(text, selectedLanguage) {
    var dir = getTextDirectionFromLanguage(selectedLanguage);

    if (dir === "rtl") {
      return "\u200F" + String(text || "");
    }

    if (dir === "ltr") {
      return "\u200E" + String(text || "");
    }

    return String(text || "");
  }

  function applyExportDirectionMarks(text, selectedLanguage) {
    return String(text || "")
      .split(/\r?\n/)
      .map(function (line) {
        return line ? applyExportDirectionMark(line, selectedLanguage) : line;
      })
      .join("\n");
  }

  function createCapabilityDecision(enabled, reason) {
    return {
      enabled: !!enabled,
      reason: enabled ? "" : reason
    };
  }

  function getViewportShortestSide() {
    var values = [
      window.screen && Number(window.screen.width),
      window.screen && Number(window.screen.height),
      Number(window.innerWidth),
      Number(window.innerHeight)
    ].filter(function (value) {
      return Number.isFinite(value) && value > 0;
    });

    return values.length ? Math.min.apply(Math, values) : 0;
  }

  function isPhoneOptimizedTranscriptionDevice() {
    var userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
    var isCoarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    var shortestSide = getViewportShortestSide();
    var mobileUserAgent = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile/i.test(userAgent);

    if (mobileUserAgent) {
      return true;
    }

    return isCoarsePointer && shortestSide > 0 && shortestSide <= 480;
  }

  function isPhoneTranscriptionModeActive() {
    if (transcriptionCapabilityProfile && transcriptionCapabilityProfile.phoneOptimized) {
      return true;
    }

    return isPhoneOptimizedTranscriptionDevice();
  }

  function getTranscribeWorkerUrl() {
    return isPhoneTranscriptionModeActive()
      ? MOBILE_TRANSCRIBE_WORKER_URL
      : DESKTOP_TRANSCRIBE_WORKER_URL;
  }

  function isBuiltInTranslationAllowed() {
    return true;
  }

  function createTranscriptionAudioContext(AudioContextCtor) {
    if (!AudioContextCtor) {
      return null;
    }

    if (isPhoneOptimizedTranscriptionDevice()) {
      try {
        return new AudioContextCtor({ sampleRate: 16000 });
      } catch (error) {
      }
    }

    return new AudioContextCtor();
  }

  function createDefaultTyrannosaurWebGpuAssessment() {
    var hasGpuApi = !!(typeof navigator !== "undefined" && navigator.gpu);
    return {
      status: hasGpuApi ? "checking" : "unsupported",
      eligible: false,
      reason: hasGpuApi ? TREX_WEBGPU_VERIFYING_REASON : TREX_WEBGPU_DESKTOP_REASON,
      score: 0,
      adapterSummary: "",
      maxBufferSize: 0,
      maxStorageBufferBindingSize: 0
    };
  }

  function getCachedTyrannosaurWebGpuAssessment() {
    return tRexWebGpuAssessment || createDefaultTyrannosaurWebGpuAssessment();
  }

  function readGpuAdapterInfo(adapter) {
    if (!adapter) {
      return Promise.resolve(null);
    }

    if (adapter.info) {
      return Promise.resolve(adapter.info);
    }

    if (typeof adapter.requestAdapterInfo === "function") {
      return adapter.requestAdapterInfo().catch(function () {
        return null;
      });
    }

    return Promise.resolve(null);
  }

  function readGpuLimit(limits, key) {
    var value = limits && typeof limits[key] === "number"
      ? limits[key]
      : 0;
    return Number.isFinite(value) ? value : 0;
  }

  function getGpuAdapterSummary(adapterInfo) {
    if (!adapterInfo) {
      return "";
    }

    return String(
      adapterInfo.description
      || adapterInfo.device
      || adapterInfo.vendor
      || adapterInfo.architecture
      || ""
    ).trim();
  }

  function buildTyrannosaurAssessmentReason(parts, fallbackReason) {
    if (!parts || !parts.length) {
      return fallbackReason || TREX_WEBGPU_DESKTOP_REASON;
    }

    return parts[0] + " Triceratops will be used instead for a safer local run.";
  }

  function requestTranscriptionCapabilityRefresh() {
    if (
      tRexWebGpuAssessmentPromise
      || !hasWebGPUAcceleration()
      || isPhoneOptimizedTranscriptionDevice()
    ) {
      return;
    }

    tRexWebGpuAssessmentPromise = (async function () {
      var assessment = createDefaultTyrannosaurWebGpuAssessment();

      try {
        var adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) {
          assessment.status = "unsupported";
          assessment.reason = TREX_WEBGPU_DESKTOP_REASON;
          return assessment;
        }

        var adapterInfo = await readGpuAdapterInfo(adapter);
        var adapterSummary = getGpuAdapterSummary(adapterInfo).toLowerCase();
        var maxBufferSize = readGpuLimit(adapter.limits, "maxBufferSize");
        var maxStorageBufferBindingSize = readGpuLimit(adapter.limits, "maxStorageBufferBindingSize");
        var score = 0;
        var reasonParts = [];
        var deviceMemory = typeof navigator !== "undefined" ? Number(navigator.deviceMemory) : NaN;
        var hardwareConcurrency = typeof navigator !== "undefined" ? Number(navigator.hardwareConcurrency) : NaN;
        var fallbackAdapter = !!(
          (adapterInfo
            && (
              adapterInfo.isFallbackAdapter === true
              || adapterInfo.fallback === true
            ))
          || adapter.isFallbackAdapter === true
        );
        var softwareLikeAdapter = /swiftshader|software|basic render|llvmpipe|fallback/i.test(adapterSummary);

        assessment.adapterSummary = adapterSummary;
        assessment.maxBufferSize = maxBufferSize;
        assessment.maxStorageBufferBindingSize = maxStorageBufferBindingSize;

        if (fallbackAdapter || softwareLikeAdapter) {
          assessment.status = "verified";
          assessment.eligible = false;
          assessment.reason = "T-Rex is disabled because this browser is exposing a fallback or software-style WebGPU adapter. Triceratops will be used instead for a safer local run.";
          return assessment;
        }

        if (Number.isFinite(deviceMemory)) {
          if (deviceMemory >= 16) {
            score += 2;
          } else if (deviceMemory >= TREX_MIN_RECOMMENDED_MEMORY_GB) {
            score += 1;
          } else {
            reasonParts.push("T-Rex needs more working memory for a stable local run on this device.");
          }
        }

        if (Number.isFinite(hardwareConcurrency)) {
          if (hardwareConcurrency >= 12) {
            score += 2;
          } else if (hardwareConcurrency >= TREX_MIN_RECOMMENDED_CPU_THREADS) {
            score += 1;
          } else if (qualifiesForAppleDesktopTyrannosaurCpuHeuristic(hardwareConcurrency)) {
            score += 2;
          } else {
            reasonParts.push("T-Rex needs a stronger CPU for comfortable local transcription on this machine.");
          }
        }

        if (maxBufferSize >= 512 * 1024 * 1024) {
          score += 2;
        } else if (maxBufferSize >= 256 * 1024 * 1024) {
          score += 1;
        } else {
          reasonParts.push("This WebGPU adapter reports limited buffer capacity for a safer T-Rex run.");
        }

        if (maxStorageBufferBindingSize >= 256 * 1024 * 1024) {
          score += 2;
        } else if (maxStorageBufferBindingSize >= 128 * 1024 * 1024) {
          score += 1;
        } else {
          reasonParts.push("This WebGPU adapter reports limited storage bandwidth for T-Rex.");
        }

        if (adapterSummary && /intel\(r\)\s+hd graphics|uhd graphics 6|uhd graphics 5/i.test(adapterSummary)) {
          score -= 1;
          reasonParts.push("This older integrated GPU looks better suited to the lighter transcription modes.");
        }

        assessment.status = "verified";
        assessment.score = score;
        assessment.eligible = score >= 6;
        assessment.reason = assessment.eligible
          ? ""
          : buildTyrannosaurAssessmentReason(reasonParts, TREX_WEBGPU_DESKTOP_REASON);
      } catch (error) {
        assessment.status = "unsupported";
        assessment.eligible = false;
        assessment.reason = "This browser exposed WebGPU, but the stronger T-Rex check did not pass safely on this device. Triceratops will be used instead for a safer local run.";
      }

      return assessment;
    })()
      .then(function (assessment) {
        tRexWebGpuAssessment = assessment;
        applyTranscriptionCapabilityProfile(probeTranscriptionCapabilities());
        var primaryRoot = getPrimaryTranscribeRoot();
        if (primaryRoot) {
          refreshTranscriptionModelUi(primaryRoot);
          updateRuntimeMessaging(primaryRoot);
          refreshTranscribeLayout();
        }
        syncTranscribeReadyState();
        return assessment;
      })
      .finally(function () {
        tRexWebGpuAssessmentPromise = null;
      });
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
    var phoneDesktopReason = "For more powerful models, switch to a desktop or laptop for the full transcription experience.";
    var balancedReason = "Needs a bit more memory or CPU for comfortable local use";
    var desktopReason = TREX_WEBGPU_DESKTOP_REASON;
    var modes = Object.create(null);
    var webGpuAssessment = getCachedTyrannosaurWebGpuAssessment();

    if (!baselineOk) {
      TRANSCRIPTION_MODELS.forEach(function (model) {
        modes[model.key] = createCapabilityDecision(false, browserReason);
      });
      return {
        baselineOk: false,
        isCoarsePointer: isCoarsePointer,
        phoneOptimized: false,
        deviceMemory: hasKnownMemory ? deviceMemory : null,
        hardwareConcurrency: hasKnownCpu ? hardwareConcurrency : null,
        modes: modes
      };
    }

    if (isPhoneOptimizedTranscriptionDevice()) {
      modes["baby-raptor"] = createCapabilityDecision(true, "");
      modes.triceratop = createCapabilityDecision(false, phoneDesktopReason);
      modes["t-rex"] = createCapabilityDecision(false, phoneDesktopReason);
      return {
        baselineOk: true,
        isCoarsePointer: isCoarsePointer,
        phoneOptimized: true,
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
    var hasTyrannosaurMemory = !hasKnownMemory || deviceMemory >= TREX_MIN_RECOMMENDED_MEMORY_GB;
    var hasTyrannosaurCpu = !hasKnownCpu
      || hardwareConcurrency >= TREX_MIN_RECOMMENDED_CPU_THREADS
      || qualifiesForAppleDesktopTyrannosaurCpuHeuristic(hardwareConcurrency);
    var tRexReason = desktopReason;
    if (webGpuAssessment.status === "checking") {
      tRexReason = webGpuAssessment.reason;
    } else if (webGpuAssessment.status === "verified" && webGpuAssessment.reason) {
      tRexReason = webGpuAssessment.reason;
    }
    modes["t-rex"] = createCapabilityDecision(
      baselineOk
        && hasWebGPU
        && !isCoarsePointer
        && hasTyrannosaurMemory
        && hasTyrannosaurCpu
        && webGpuAssessment.status === "verified"
        && webGpuAssessment.eligible,
      tRexReason
    );

    return {
      baselineOk: true,
      isCoarsePointer: isCoarsePointer,
      phoneOptimized: false,
      deviceMemory: hasKnownMemory ? deviceMemory : null,
      hardwareConcurrency: hasKnownCpu ? hardwareConcurrency : null,
      modes: modes
    };
  }

  function applyTranscriptionCapabilityProfile(profile) {
    transcriptionCapabilityProfile = profile || probeTranscriptionCapabilities();
    var previouslySelectedModelKey = selectedTranscriptionModelKey;

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

    var firstEnabledModel = TRANSCRIPTION_MODELS.find(function (model) {
      return ensureTranscriptionModelState(model.key).enabled;
    });

    if (previouslySelectedModelKey && ensureTranscriptionModelState(previouslySelectedModelKey).enabled) {
      selectedTranscriptionModelKey = previouslySelectedModelKey;
    } else if (ensureTranscriptionModelState(DEFAULT_TRANSCRIPTION_MODEL_KEY).enabled) {
      selectedTranscriptionModelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY;
    } else if (firstEnabledModel) {
      selectedTranscriptionModelKey = firstEnabledModel.key;
    } else {
      selectedTranscriptionModelKey = FALLBACK_TRANSCRIPTION_MODEL_KEY;
    }

    modelWarmState = getSelectedModelState().status;
  }

  function getModelAvailabilityLabel(modelKey) {
    var state = ensureTranscriptionModelState(modelKey);
    if (!state.enabled) {
      if (modelKey === "t-rex" && getCachedTyrannosaurWebGpuAssessment().status === "checking") {
        return "Checking";
      }
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
      return "Retry";
    }
    return "Available";
  }

  function disableModelForSession(modelKey, reason) {
    var state = ensureTranscriptionModelState(modelKey);
    state.enabled = false;
    state.reason = reason || state.reason || "Disabled for this session";
    state.status = "disabled";
    state.progress = 0;
    state.errorMessage = "";
  }

  function getSafeFallbackModelKey(failedModelKey) {
    var preferredOrder = failedModelKey === "t-rex"
      ? ["triceratop", "baby-raptor"]
      : [FALLBACK_TRANSCRIPTION_MODEL_KEY];
    var nextModel = preferredOrder.find(function (modelKey) {
      if (modelKey === failedModelKey) {
        return false;
      }
      return ensureTranscriptionModelState(modelKey).enabled;
    });

    return nextModel || "";
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

  function isAppleMobileBrowserEngine() {
    var userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
    return /iPhone|iPad|iPod/i.test(userAgent);
  }

  function isSafariLikeBrowser() {
    var userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
    var vendor = typeof navigator !== "undefined" ? String(navigator.vendor || "") : "";

    if (isAppleMobileBrowserEngine()) {
      return true;
    }

    return /Safari/i.test(userAgent)
      && /Apple/i.test(vendor)
      && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/i.test(userAgent);
  }

  function isAppleDesktopBrowserEngine() {
    var userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
    var platform = typeof navigator !== "undefined" ? String(navigator.platform || "") : "";

    return !isAppleMobileBrowserEngine()
      && isSafariLikeBrowser()
      && /Mac/i.test(userAgent + " " + platform);
  }

  function qualifiesForAppleDesktopTyrannosaurCpuHeuristic(hardwareConcurrency) {
    return isAppleDesktopBrowserEngine()
      && Number.isFinite(hardwareConcurrency)
      && hardwareConcurrency >= 8;
  }

  function getDeviceSupportLabel() {
    if (!transcriptionCapabilityProfile || !transcriptionCapabilityProfile.baselineOk) {
      return "Local transcription unavailable on this browser";
    }

    if (transcriptionCapabilityProfile.phoneOptimized) {
      return "Phone-optimized local AI available";
    }

    if (getCachedTyrannosaurWebGpuAssessment().eligible) {
      return "High-performance local AI available";
    }

    return hasWebGPUAcceleration()
      ? "Local AI available with safer desktop limits"
      : "Local AI available in compatibility mode";
  }

  function formatDurationSeconds(seconds) {
    var safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    var minutes = Math.floor(safeSeconds / 60);
    var remainder = safeSeconds % 60;

    if (!minutes) {
      return safeSeconds + " seconds";
    }

    if (!remainder) {
      return minutes + (minutes === 1 ? " minute" : " minutes");
    }

    return minutes + "m " + String(remainder).padStart(2, "0") + "s";
  }

  function formatFileSize(bytes) {
    var value = Math.max(0, Number(bytes) || 0);

    if (value >= 1024 * 1024) {
      return (value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1) + " MB";
    }

    if (value >= 1024) {
      return Math.round(value / 1024) + " KB";
    }

    return value + " B";
  }

  function isWaveAudioFile(file) {
    var type = String(file && file.type || "").toLowerCase();
    var extension = getFileExtension(file && file.name);

    return extension === ".wav"
      || type === "audio/wav"
      || type === "audio/wave"
      || type === "audio/x-wav"
      || type === "audio/vnd.wave";
  }

  function getPhoneFileRiskReason(file) {
    var size = Number(file && file.size) || 0;
    var isPhoneMode = isPhoneTranscriptionModeActive();
    var isSafariPhone = isPhoneMode && isSafariLikeBrowser();
    var wavMaxBytes = isSafariPhone ? 8 * 1024 * 1024 : 12 * 1024 * 1024;
    var genericMaxBytes = isSafariPhone ? 48 * 1024 * 1024 : 64 * 1024 * 1024;

    if (!file || !isPhoneMode) {
      return "";
    }

    if (isWaveAudioFile(file) && size > wavMaxBytes) {
      return "This WAV file is a bit large for reliable phone transcription (" + formatFileSize(size) + "). If you can, convert it to M4A or MP3, trim it shorter, or continue on desktop.";
    }

    if (size > genericMaxBytes) {
      if (isVideoMediaFile(file)) {
        return "This video is larger than this phone can reliably process for transcription (" + formatFileSize(size) + "). A good next step is to extract the audio first, then return here to transcribe it.";
      }
      return "This file is larger than this phone can reliably process for transcription (" + formatFileSize(size) + "). If you can, use a shorter clip or continue on desktop.";
    }

    return "";
  }

  function shouldOfferExtractAudioAction(audioRecord) {
    return !!(
      audioRecord
      && audioRecord.phoneRiskReason
      && audioRecord.file
      && isVideoMediaFile(audioRecord.file)
    );
  }

  function getDurationPolicyTier(profile) {
    var safeProfile = profile || transcriptionCapabilityProfile || probeTranscriptionCapabilities();
    var memory = safeProfile && Number.isFinite(safeProfile.deviceMemory) ? safeProfile.deviceMemory : 0;
    var cpu = safeProfile && Number.isFinite(safeProfile.hardwareConcurrency) ? safeProfile.hardwareConcurrency : 0;
    var coarsePointer = !!(safeProfile && safeProfile.isCoarsePointer);
    var hasStrongWebGPU = getCachedTyrannosaurWebGpuAssessment().eligible;
    var safariPenalty = isSafariLikeBrowser() ? 1 : 0;
    var score = 0;

    if (safeProfile && safeProfile.phoneOptimized) {
      return "phone";
    }

    if (memory >= 16) {
      score += 3;
    } else if (memory >= 8) {
      score += 2;
    } else if (memory >= 4) {
      score += 1;
    }

    if (cpu >= 12) {
      score += 3;
    } else if (cpu >= 8) {
      score += 2;
    } else if (cpu >= 4) {
      score += 1;
    }

    if (hasStrongWebGPU) {
      score += 1;
    }

    if (coarsePointer) {
      score -= 1;
    }

    score -= safariPenalty;

    if (score >= 6) {
      return "ultra";
    }

    if (score >= 4) {
      return "high";
    }

    if (score >= 2) {
      return "standard";
    }

    return "low";
  }

  function getTranscriptionDurationPolicy(modelKey) {
    var profile = transcriptionCapabilityProfile || probeTranscriptionCapabilities();
    var targetModelKey = modelKey || selectedTranscriptionModelKey;
    var model = getTranscriptionModeByKey(targetModelKey);
    var state = ensureTranscriptionModelState(targetModelKey);
    var tier = getDurationPolicyTier(profile);
    var tierLimits = TRANSCRIPTION_DURATION_LIMITS[tier] || TRANSCRIPTION_DURATION_LIMITS.standard;
    var limitSeconds = tierLimits[targetModelKey] || TRANSCRIPTION_DURATION_LIMITS.standard[targetModelKey] || 180;
    var runtimeReason = tier === "phone"
      ? "Phone mode uses shorter files so local transcription stays stable in mobile browser memory."
      : "Limits change by model size, browser memory, and device speed because transcription runs locally on your device.";

    return {
      modelKey: targetModelKey,
      modelLabel: model.label,
      enabled: !!state.enabled,
      tier: tier,
      seconds: limitSeconds,
      formattedLimit: formatDurationSeconds(limitSeconds),
      reason: runtimeReason
    };
  }

  function getLongerDurationFallback(modelKey) {
    var currentPolicy = getTranscriptionDurationPolicy(modelKey);
    var best = null;

    TRANSCRIPTION_MODELS.forEach(function (model) {
      var state = ensureTranscriptionModelState(model.key);
      if (!state.enabled || model.key === currentPolicy.modelKey) {
        return;
      }

      var policy = getTranscriptionDurationPolicy(model.key);
      if (policy.seconds <= currentPolicy.seconds) {
        return;
      }

      if (!best || policy.seconds > best.seconds) {
        best = policy;
      }
    });

    return best;
  }

  function buildFileTooLongMessage(error, modelKey) {
    var policy = getTranscriptionDurationPolicy(modelKey);
    var actualSeconds = error && Number.isFinite(error.actualDuration) ? error.actualDuration : 0;
    var currentFile = actualSeconds > 0 ? formatDurationSeconds(actualSeconds) : "This file";
    var fallback = getLongerDurationFallback(modelKey);
    var nextStep = fallback
      ? " Try " + fallback.modelLabel + " for up to " + fallback.formattedLimit + " on this device."
      : " Try a shorter file, split the recording, or switch to a stronger desktop.";

    return currentFile + " is over the " + policy.formattedLimit + " limit for " + policy.modelLabel + " on this device." + nextStep;
  }

  function getProcessingInfoCopy() {
    var selectedLanguage = getSelectedTranscriptionLanguage();
    var hasAudioReady = !!window.transcriptionAudio;
    var policy = getTranscriptionDurationPolicy(selectedTranscriptionModelKey);
    var selectedState = getSelectedModelState();

    if (!hasAudioReady) {
      return getDeviceSupportLabel() + ". Transcription runs entirely in your browser, so your media never leaves your device.";
    }

    if (!selectedState.enabled) {
      return policy.modelLabel + " is unavailable on this device. " + selectedState.reason;
    }

    if (window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason) {
      if (shouldOfferExtractAudioAction(window.transcriptionAudio)) {
        return "No problem. You can open the audio extractor below, save a lighter audio copy, and then upload that audio file here for a smoother transcription.";
      }
      return "This phone will do best with a shorter or lighter file. You can trim the recording, convert it to a lighter format, or continue on desktop.";
    }

    if (!hasSelectedTranscriptionLanguage(selectedLanguage)) {
      return "Choose the spoken language to reveal this device's current file limit for " + policy.modelLabel + ". " + policy.reason;
    }

    if (transcriptionCapabilityProfile && transcriptionCapabilityProfile.phoneOptimized) {
      return policy.modelLabel + " can handle up to " + policy.formattedLimit + " on this phone. " + policy.reason;
    }

    return policy.modelLabel + " can handle up to " + policy.formattedLimit + " on this device. " + policy.reason;
  }

  function getAudioReadyStatus(language) {
    var selectedModel = getSelectedTranscriptionMode();
    var selectedState = getSelectedModelState();
    var durationPolicy = getTranscriptionDurationPolicy(selectedModel.key);

    if (!selectedState.enabled) {
      return selectedModel.label + " is disabled on this device. " + selectedState.reason;
    }

    if (window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason) {
      return window.transcriptionAudio.phoneRiskReason;
    }

    if (modelWarmState === "loading") {
      return "Audio ready for transcription. " + getSelectedModelLoadingText();
    }

    if (!hasSelectedTranscriptionLanguage(language)) {
      return "Audio ready for transcription. Choose the spoken language to reveal the current file limit for " + selectedModel.label + ".";
    }

    if (modelWarmState === "error") {
      return selectedModel.label + " could not be prepared last time. Press Transcribe to retry.";
    }

    if (modelWarmState === "ready") {
      return selectedModel.label + " is ready. Current device limit: up to " + durationPolicy.formattedLimit + ".";
    }

    return "Audio ready for transcription. Press Transcribe to load " + selectedModel.label + " locally and start. Current device limit: up to " + durationPolicy.formattedLimit + ".";
  }

  function getAudioReadyStatusState() {
    var selectedState = getSelectedModelState();
    if (!selectedState.enabled) {
      return "warning";
    }
    if (window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason) {
      return "warning";
    }
    return modelWarmState === "ready" ? "ready" : "warning";
  }

  function getSelectedTranscriptionLanguage() {
    var languageSelect = document.querySelector("#language-select");
    return languageSelect ? languageSelect.value : "";
  }

  function hasLoadedTranscriptionFile(audioRecord) {
    return !!(audioRecord && audioRecord.file);
  }

  function readTranscriptionRecoveryState() {
    try {
      if (typeof window === "undefined" || !window.sessionStorage) {
        return null;
      }
      var raw = window.sessionStorage.getItem(TRANSCRIPTION_RECOVERY_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.timestamp || (Date.now() - parsed.timestamp) > TRANSCRIPTION_RECOVERY_MAX_AGE_MS) {
        window.sessionStorage.removeItem(TRANSCRIPTION_RECOVERY_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeTranscriptionRecoveryState(payload) {
    try {
      if (typeof window === "undefined" || !window.sessionStorage) {
        return;
      }
      window.sessionStorage.setItem(
        TRANSCRIPTION_RECOVERY_STORAGE_KEY,
        JSON.stringify({
          phase: payload && payload.phase ? payload.phase : "processing",
          fileName: payload && payload.fileName ? payload.fileName : "",
          language: payload && payload.language ? payload.language : "",
          modelKey: payload && payload.modelKey ? payload.modelKey : selectedTranscriptionModelKey,
          timestamp: Date.now()
        })
      );
    } catch (error) {
    }
  }

  function clearTranscriptionRecoveryState() {
    try {
      if (typeof window === "undefined" || !window.sessionStorage) {
        return;
      }
      window.sessionStorage.removeItem(TRANSCRIPTION_RECOVERY_STORAGE_KEY);
    } catch (error) {
    }
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
    return hasLoadedTranscriptionFile(window.transcriptionAudio)
      && !(window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason)
      && hasSelectedTranscriptionLanguage(language)
      && !processingLocked
      && getSelectedModelState().enabled
      && modelWarmState !== "loading"
      && modelWarmState !== "blocked";
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
      } else if (!hasLoadedTranscriptionFile(window.transcriptionAudio)) {
        startBtn.textContent = "Choose file again";
      } else if (!selectedState.enabled) {
        startBtn.textContent = "Transcribe unavailable";
      } else if (window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason) {
        startBtn.textContent = shouldOfferExtractAudioAction(window.transcriptionAudio)
          ? "Use audio extractor"
          : "Use smaller file";
      } else if (!hasSelectedTranscriptionLanguage(selectedLanguage)) {
        startBtn.textContent = "Select language first";
      } else if (modelWarmState === "blocked") {
        startBtn.textContent = "Waiting for model access";
      } else if (modelWarmState === "loading") {
        startBtn.textContent = getSelectedModelLoadingText();
      } else if (modelWarmState === "error") {
        startBtn.textContent = "Retry model load";
      } else if (modelWarmState === "ready") {
        startBtn.textContent = "Transcribe";
      } else {
        startBtn.textContent = "Load model and transcribe";
      }
    }
  }

  function setPendingTranscriptionStart(payload) {
    pendingTranscriptionStart = payload || null;
  }

  function clearPendingTranscriptionStart() {
    pendingTranscriptionStart = null;
  }

  async function resumePendingTranscriptionStart() {
    if (!pendingTranscriptionStart || processingLocked) {
      return;
    }

    var payload = pendingTranscriptionStart;
    clearPendingTranscriptionStart();
    await startTranscription(
      payload.modelKey,
      payload.language,
      payload.statusEl,
      payload.transcriptEl,
      payload.copyBtn,
      payload.txtBtn,
      payload.srtBtn,
      payload.vttBtn,
      payload.startBtn,
      payload.translateBtn,
      payload.originalTabBtn,
      payload.translatedTabBtn,
      payload.editBtn,
      payload.input,
      payload.audioContext,
      payload.afterRunCleanup
    );
  }

  function syncTranslationReadyState() {
    var translateBtn = document.querySelector('[data-role="translateBtn"]');
    var chatgptBtn = document.getElementById("chatgptTranslateBtn");
    var translateSourceLanguage = document.querySelector("#translate-source-language");
    var translateLanguage = document.querySelector("#translate-language");
    var hasSegments = !!(window.currentSegments && window.currentSegments.length);
    var hasResults = hasTranscriptResults() || hasTranslatedSegments();
    var sourceCode = translateSourceLanguage ? translateSourceLanguage.value : "";
    var builtInTranslationAllowed = isBuiltInTranslationAllowed();

    updateTranslationTargetOptions(translateLanguage, sourceCode);

    var targetCode = translateLanguage ? translateLanguage.value : "";
    var ready = hasSegments
      && !processingLocked
      && !!getTranslationFloresCode(sourceCode)
      && !!getTranslationFloresCode(targetCode)
      && sourceCode !== targetCode;

    if (translateBtn) {
      translateBtn.disabled = !ready || !builtInTranslationAllowed;
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
        escapeHtml(getLanguageDisplayName(item)) +
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
      '<span data-role="translationLanguagePickerName">' + escapeHtml(getLanguageDisplayName(item)) + "</span>",
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

      return getLanguageSearchText(item).indexOf(normalizedQuery) !== -1;
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
        '<span data-role="translationLanguagePickerOptionLabel">' + escapeHtml(getLanguageDisplayName(item)) + "</span>",
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
      hintEl.textContent = "Translation opens your edited transcript in a clean new tab for Google Translate. Only transcript lines are marked for translation, while the page UI stays in its original language.";
      return;
    }

    if (!targetItem) {
      hintEl.textContent = "Transcript language is set to " + getLanguageDisplayName(sourceItem) + ". Choose a target language to open your edited transcript in a browser-translation view.";
      return;
    }

    if (sourceCode === targetCode) {
      hintEl.textContent = "Choose a target language different from the transcript language.";
      return;
    }

    hintEl.textContent = "A clean transcript page will open in a new tab for Google Translate from " + getLanguageDisplayName(sourceItem) + " to " + getLanguageDisplayName(targetItem) + ". Only transcript lines are marked for translation, and your segment edits stay the source of truth.";
  }

  function getTranslationViewUiLanguage() {
    var htmlLang = document.documentElement ? String(document.documentElement.lang || "").toLowerCase() : "";
    if (htmlLang.indexOf("ar") === 0) {
      return "ar";
    }

    if (typeof window !== "undefined" && window.location && /^\/ar(\/|$)/.test(String(window.location.pathname || ""))) {
      return "ar";
    }

    return "en";
  }

  function pruneStoredTranslationViews() {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      var now = Date.now();
      var keysToRemove = [];

      for (var index = 0; index < localStorage.length; index += 1) {
        var key = localStorage.key(index);
        if (!key || key.indexOf(TRANSLATION_VIEW_STORAGE_PREFIX) !== 0) {
          continue;
        }

        try {
          var raw = localStorage.getItem(key);
          var payload = raw ? JSON.parse(raw) : null;
          var createdAt = payload && Number(payload.createdAt);
          if (!Number.isFinite(createdAt) || (now - createdAt) > TRANSLATION_VIEW_MAX_AGE_MS) {
            keysToRemove.push(key);
          }
        } catch (error) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (error) {
    }
  }

  function getTranslationViewPagePath() {
    return getTranslationViewUiLanguage() === "ar"
      ? "/ar/translate-transcript.html"
      : "/translate-transcript.html";
  }

  function buildTranslationViewUrl(sessionId) {
    return getTranslationViewPagePath() + "?session=" + encodeURIComponent(sessionId);
  }

  function buildAbsoluteUrl(path) {
    if (/^https?:\/\//i.test(String(path || ""))) {
      return String(path || "");
    }

    if (typeof window === "undefined" || !window.location) {
      return String(path || "");
    }

    return new URL(String(path || ""), window.location.origin).toString();
  }

  function isLocalDevTranslationHost() {
    if (typeof window === "undefined" || !window.location) {
      return false;
    }

    var host = String(window.location.hostname || "").toLowerCase();
    return host === "localhost"
      || host === "127.0.0.1"
      || host === "::1"
      || /^192\.168\./.test(host)
      || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  }

  function openEditedTranscriptTranslationView(options) {
    var config = options || {};
    var sourceCode = getLangCode(config.sourceCode || "");
    var targetCode = getLangCode(config.targetCode || "");
    var sourceItem = getTranslationLanguageByCode(sourceCode);
    var targetItem = getTranslationLanguageByCode(targetCode);
    var sourceLanguageName = sourceItem ? getLanguageDisplayName(sourceItem) : (sourceCode ? sourceCode.toUpperCase() : "Original");
    var targetLanguageName = targetItem ? getLanguageDisplayName(targetItem) : (targetCode ? targetCode.toUpperCase() : "Target");
    var segments = (window.currentSegments || []).reduce(function (result, segment) {
      var text = cleanText((segment && (segment.editedText || segment.originalText || segment.text)) || "");
      var timestamp = segment && Array.isArray(segment.timestamp) ? segment.timestamp : null;

      if (!text) {
        return result;
      }

      result.push({
        text: text,
        timestamp: timestamp && timestamp.length >= 2 ? [timestamp[0], timestamp[1]] : null
      });
      return result;
    }, []);
    var transcriptText = getSegmentsParagraphText(segments);
    var displayedFileName = "";
    var sessionId;
    var payload;
    if (!segments.length || !transcriptText) {
      if (config.statusEl) {
        setStatus(config.statusEl, "No transcript lines are ready to translate.", "error");
      }
      return false;
    }

    try {
      displayedFileName = (document.querySelector('[data-role="fileName"]') && document.querySelector('[data-role="fileName"]').textContent) || "";
    } catch (error) {
      displayedFileName = "";
    }
    displayedFileName = String(displayedFileName || "").trim();
    if (!displayedFileName || displayedFileName === "No file selected") {
      displayedFileName = window.transcriptionAudio && window.transcriptionAudio.file && window.transcriptionAudio.file.name
        ? window.transcriptionAudio.file.name
        : "";
    }
    if (!displayedFileName) {
      displayedFileName = window.originalFileName || "Transcript";
    }

    sessionId = "translation-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    payload = {
      createdAt: Date.now(),
      uiLang: getTranslationViewUiLanguage(),
      fileName: displayedFileName,
      title: displayedFileName,
      sourceLanguageCode: sourceCode,
      sourceLanguageName: sourceLanguageName,
      targetLanguageCode: targetCode,
      targetLanguageName: targetLanguageName,
      transcriptText: transcriptText,
      showTimestamps: !!config.showTimestamps,
      segments: segments
    };

    try {
      pruneStoredTranslationViews();
      localStorage.setItem(TRANSLATION_VIEW_STORAGE_PREFIX + sessionId, JSON.stringify(payload));
    } catch (error) {
      if (config.statusEl) {
        setStatus(config.statusEl, "Could not prepare the translation view in this browser. Please try again.", "error");
      }
      return false;
    }

    var sourceViewUrl = buildAbsoluteUrl(buildTranslationViewUrl(sessionId));
    var targetUrl = sourceViewUrl;
    var openedWindow = null;

    try {
      openedWindow = window.open(targetUrl, "_blank", "noopener");
    } catch (error) {
      openedWindow = null;
    }

    if (openedWindow) {
      return true;
    }

    try {
      var fallbackLink = document.createElement("a");
      fallbackLink.href = targetUrl;
      fallbackLink.target = "_blank";
      fallbackLink.rel = "noopener";
      fallbackLink.style.display = "none";
      document.body.appendChild(fallbackLink);
      fallbackLink.click();
      document.body.removeChild(fallbackLink);
      return true;
    } catch (error) {
    }

    if (config.statusEl) {
      setStatus(config.statusEl, "Could not open the translation view. Try allowing popups or opening it in a new tab.", "error");
    }
    return false;
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
      '<span data-role="languagePickerName">' + escapeHtml(getLanguageDisplayName(item)) + "</span>",
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

      return getLanguageSearchText(item).indexOf(normalizedQuery) !== -1;
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
        '<span data-role="languagePickerOptionLabel">' + escapeHtml(getLanguageDisplayName(item)) + "</span>",
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
        escapeHtml(item.flag + " " + getLanguageDisplayName(item)) +
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

    if (hasWarning("unstable_output")) {
      return {
        message: language === "auto"
          ? "Transcript ready in mobile test mode. Review the text carefully and choose the language manually if needed."
          : "Transcript ready in mobile test mode. Review the text carefully before exporting.",
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

    if (existing && !hasFreshModelLock(existing)) {
      removeModelLock();
      existing = null;
    }

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
      if (!processingLocked && window.transcriptionAudio && modelWarmState === "blocked" && pendingTranscriptionStart) {
        resumePendingTranscriptionStart();
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
      requestWorkerUnload("idle", false);
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
      if (modelWarmState !== "ready") {
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
            requestWorkerUnload("peer_request", false);
          }
          return;
        }

        if (data.type === "lock_released") {
          if (modelWarmState === "blocked" && window.transcriptionAudio && !processingLocked && pendingTranscriptionStart) {
            resumePendingTranscriptionStart();
          }
          syncTranscribeReadyState();
        }
      };
    }

    window.addEventListener("storage", function (event) {
      if (event.key !== MODEL_LOCK_KEY) {
        return;
      }

      if (!event.newValue && modelWarmState === "blocked" && window.transcriptionAudio && !processingLocked && pendingTranscriptionStart) {
        resumePendingTranscriptionStart();
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
      if (modelWarmState === "blocked" && window.transcriptionAudio && !processingLocked && pendingTranscriptionStart) {
        resumePendingTranscriptionStart();
      } else if (modelWarmState === "ready") {
        scheduleIdleUnload(IDLE_UNLOAD_VISIBLE_MS);
      }
      syncTranscribeReadyState();
    });

    window.addEventListener("pagehide", function () {
      try {
        if (typeof window.__transcribePageExitTeardown === "function") {
          window.__transcribePageExitTeardown();
        }
      } catch (error) {
      }
    });

    window.addEventListener("beforeunload", function () {
      try {
        if (typeof window.__transcribePageExitTeardown === "function") {
          window.__transcribePageExitTeardown();
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
      '    <button class="at-btn at-btn-soft is-hidden" type="button" data-role="extractAudioCta">Open audio extractor</button>',
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
      '  <div class="at-row is-hidden" data-role="transcriptPlayerRow">',
      '    <div class="at-transcript-player" data-role="transcriptPlayer">',
      '      <button class="at-transcript-player-toggle" type="button" data-role="transcriptPlaybackToggle" aria-pressed="false" aria-label="Play audio">',
      '        <span class="at-transcript-player-toggle-icon" aria-hidden="true"></span>',
      "      </button>",
      '      <div class="at-transcript-player-progress">',
      '        <input class="at-transcript-player-progress-slider" type="range" min="0" max="1000" step="1" value="0" data-role="transcriptPlaybackProgress" aria-label="Playback position">',
      "      </div>",
      '      <div class="at-transcript-player-time" data-role="transcriptPlaybackTime">0:00</div>',
      '      <div class="at-transcript-player-volume">',
      '        <i class="at-transcript-player-volume-icon" data-lucide="volume-2" aria-hidden="true"></i>',
      '        <input class="at-transcript-player-volume-slider" type="range" min="0" max="100" step="1" value="100" data-role="transcriptPlaybackVolume" aria-label="Playback volume">',
      "      </div>",
      "    </div>",
      "  </div>",
      '  <div class="at-row transcribe-controls is-hidden" data-role="translateEntryRow">',
      '    <button class="at-btn" type="button" data-role="toggleTranslateSetup" disabled>Translate transcript</button>',
      '    <button class="at-btn at-btn-soft" id="chatgptTranslateBtn" type="button" data-role="chatgptTranslateBtn" disabled>Refine with ChatGPT</button>',
      "  </div>",
      '  <div data-role="translationPanel" class="is-hidden">',
      '  <div class="at-row translation-section">',
      '    <select id="translate-source-language" class="is-hidden">' + buildTranslationLanguageOptions("Select transcript language") + "</select>",
      '    <div class="at-language-field at-language-field-wide">',
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
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <p class="translation-hint" data-role="translationHint">Translation opens your edited transcript in a clean new tab for Google Translate. Only transcript lines are marked for translation, while the page UI stays in its original language.</p>',
      "  </div>",
      '  <div class="at-row translation-section">',
      '    <button class="at-btn at-btn-primary" id="translate-btn" data-role="translateBtn" disabled>Open translation view</button>',
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
    var normalizedMessage;
    var phoneRiskMessage = "";
    if (typeof message === "string") {
      el = document.querySelector(".at-status");
    } else {
      el = message;
      message = state;
      state = arguments[2];
    }
    if (!el) return;
    normalizedMessage = normalizeIncomingText(message);
    el.textContent = normalizedMessage;
    if (window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason) {
      phoneRiskMessage = normalizeIncomingText(window.transcriptionAudio.phoneRiskReason);
    }
    if (phoneRiskMessage && normalizedMessage === phoneRiskMessage) {
      el.dataset.statusVariant = "phone-guidance";
    } else {
      delete el.dataset.statusVariant;
    }
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
    var extractAudioBtn = root.querySelector('[data-role="extractAudioCta"]');

    if (processingHintEl) {
      processingHintEl.textContent = getProcessingInfoCopy();
    }

    if (extractAudioBtn) {
      setElementVisible(extractAudioBtn, shouldOfferExtractAudioAction(window.transcriptionAudio));
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
    var activeRoot = root || getPrimaryTranscribeRoot();
    updateRuntimeMessaging(activeRoot);
    syncTranscriptionModelCards(activeRoot);
    syncTranscribeReadyState();
  }

  function tryKnownTranscriptionFallback(context, workerData) {
    var failedModelKey = workerData && workerData.failedModelKey
      ? workerData.failedModelKey
      : (context && context.modelKey) || selectedTranscriptionModelKey;
    var fallbackModelKey = workerData && workerData.fallbackModelKey
      ? workerData.fallbackModelKey
      : getSafeFallbackModelKey(failedModelKey);
    var fallbackModel = fallbackModelKey ? getTranscriptionModeByKey(fallbackModelKey) : null;
    var reason = workerData && workerData.message
      ? workerData.message
      : "The selected model is not stable on this device. Switching to a safer transcription mode.";

    if (
      !context
      || (workerData.errorCode !== "WEBGPU_TREX_UNSUPPORTED" && workerData.errorCode !== "TREX_RUNTIME_UNSTABLE")
      || !fallbackModelKey
      || !fallbackModel
    ) {
      return false;
    }

    stopFakeProgress();
    stopProgressMessages();
    setProgress(0);
    setProgressMessage("");
    processingLocked = false;
    modelUnloadPending = false;
    pendingModelRequestKey = "";
    activePreparedModelKey = "";
    stopLockHeartbeat();
    releaseModelLock();
    clearPendingTranscriptionStart();
    activeTranscriptionContext = null;
    setEnhanceToggleState(document.getElementById("enhance-audio"), true);
    if (context.input) {
      context.input.disabled = false;
    }

    disableModelForSession(failedModelKey, reason);
    selectedTranscriptionModelKey = fallbackModelKey;
    modelWarmState = ensureTranscriptionModelState(fallbackModelKey).enabled ? "idle" : "disabled";
    rebuildTranscribeWorker();
    refreshTranscriptionModelUi(getPrimaryTranscribeRoot());
    setStatus(context.statusEl, reason, "warning");

    window.setTimeout(function () {
      startTranscription(
        fallbackModel.key,
        context.language,
        context.statusEl,
        context.transcriptEl,
        context.copyBtn,
        context.txtBtn,
        context.srtBtn,
        context.vttBtn,
        context.startBtn,
        context.translateBtn,
        context.originalTabBtn,
        context.translatedTabBtn,
        context.editBtn,
        context.input,
        context.audioContext,
        context.afterRunCleanup
      );
    }, 0);

    return true;
  }

  function selectTranscriptionModel(modelKey, options) {
    var nextModel = getTranscriptionModeByKey(modelKey);
    var nextState = ensureTranscriptionModelState(nextModel.key);

    if (!nextState.enabled || processingLocked) {
      refreshTranscriptionModelUi(getPrimaryTranscribeRoot());
      return;
    }

    var changed = selectedTranscriptionModelKey !== nextModel.key;
    selectedTranscriptionModelKey = nextModel.key;
    modelWarmState = nextState.status;

    refreshTranscriptionModelUi(getPrimaryTranscribeRoot());

    if (window.transcriptionAudio && changed && !hasTranscriptResults()) {
      var statusEl = getPrimaryTranscribeStatusEl();
      if (statusEl) {
        setStatus(statusEl, getAudioReadyStatus(getSelectedTranscriptionLanguage()), getAudioReadyStatusState());
      }
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
    var audioPlayer = getTranscriptAudioPlayer();
    var hasAudioReady = hasLoadedTranscriptionFile(window.transcriptionAudio);
    var hasRecoveryState = !!(window.transcriptionAudio && window.transcriptionAudio.recoveryOnly);
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
    var builtInTranslationAllowed = isBuiltInTranslationAllowed();
    var showTranslateEntry = showResults && builtInTranslationAllowed;
    var showChatgptEntry = showResults;
    var hasTranscriptPlayback = !!(audioPlayer && audioPlayer.getAttribute("src"));

    if (!showResults) {
      root.__translationSetupOpen = false;
    }

    setElementVisible(root.querySelector('[data-role="progressRow"]'), isPreparing || isProcessing || isModelLoading);
    setElementVisible(root.querySelector('[data-role="processingInfo"]'), showSetup || isProcessing || isModelLoading);
    setElementVisible(root.querySelector('[data-role="modelRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="languageRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="enhanceRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="transcribeRow"]'), showSetup);
    setElementVisible(root.querySelector('[data-role="viewControlsRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="transcriptRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="transcriptPlayerRow"]'), showResults && hasTranscriptPlayback);
    setElementVisible(root.querySelector('[data-role="translateEntryRow"]'), showTranslateEntry || showChatgptEntry);
    setElementVisible(translateEntryBtn, showTranslateEntry);
    setElementVisible(chatgptEntryBtn, showChatgptEntry);
    setElementVisible(root.querySelector('[data-role="exportRow"]'), showResults);
    setElementVisible(root.querySelector('[data-role="restartBtn"]'), hasAudioReady || hasRecoveryState || isPreparing || isProcessing || showResults);
    setElementVisible(translationPanel, showResults && builtInTranslationAllowed && !!root.__translationSetupOpen && !isProcessing);
    updateTranslateEntryButton(translateEntryBtn, root, hasResults, hasTranslation, isProcessing);
    if (chatgptEntryBtn) {
      chatgptEntryBtn.disabled = !showResults || isProcessing;
    }
    updateRuntimeMessaging(root);
    syncTranscriptionModelCards(root);
    syncTranscriptPlaybackUi(root);
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
      ".mpga": true,
      ".mpeg": true,
      ".mpg": true
    };

    if (!file) {
      return false;
    }

    if (type.indexOf("audio/") === 0 || type.indexOf("video/") === 0) {
      return true;
    }

    return !!supportedExtensions[extension];
  }

  function isVideoMediaFile(file) {
    var type = String(file && file.type || "").toLowerCase();
    var extension = getFileExtension(file && file.name);
    var videoExtensions = {
      ".mp4": true,
      ".m4v": true,
      ".mov": true,
      ".webm": true,
      ".mpeg": true,
      ".mpg": true
    };

    if (!file) {
      return false;
    }

    if (type.indexOf("video/") === 0) {
      return true;
    }

    if (type.indexOf("audio/") === 0) {
      return false;
    }

    return !!videoExtensions[extension];
  }

  function getCurrentTranscriptDuration() {
    return window.currentTranscriptDuration || 0;
  }

  function convertToMono(buffer, options) {
    if (buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0);
    }

    var usePhoneMix = !!(options && options.phoneOptimized);
    var length = buffer.length;
    var result = new Float32Array(length);

    if (usePhoneMix && buffer.numberOfChannels >= 2) {
      var left = buffer.getChannelData(0);
      var right = buffer.getChannelData(1);
      for (var index = 0; index < length; index += 1) {
        result[index] = Math.SQRT2 * (left[index] + right[index]) * 0.5;
      }
      return result;
    }

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

  function createFileTooLongError(actualDuration, allowedDuration, modelKey) {
    var error = new Error("FILE_TOO_LONG");
    error.actualDuration = actualDuration;
    error.allowedDuration = allowedDuration;
    error.modelKey = modelKey || selectedTranscriptionModelKey;
    return error;
  }

  function createVideoAudioPreparationError(code, message) {
    var error = new Error(code || "VIDEO_AUDIO_PREP_FAILED");
    error.userMessage = message || "This iPhone video could not be prepared for local transcription on this device.";
    return error;
  }

  function enforceTranscriptionDurationLimit(audioRecord, modelKey) {
    if (!audioRecord) {
      return;
    }

    var policy = getTranscriptionDurationPolicy(modelKey);
    if ((Number(audioRecord.duration) || 0) > policy.seconds) {
      throw createFileTooLongError(audioRecord.duration, policy.seconds, modelKey);
    }
  }

  function extractAudioFromVideoFile(audioContext, audioRecord, modelKey) {
    return new Promise(function (resolve, reject) {
      var file = audioRecord && audioRecord.file;
      var objectUrl;
      var video;
      var sourceNode = null;
      var processorNode = null;
      var gainNode = null;
      var chunks = [];
      var totalFrames = 0;
      var settled = false;
      var started = false;
      var timeoutId = null;
      var startupTimeoutId = null;

      function cleanup() {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (startupTimeoutId) {
          window.clearTimeout(startupTimeoutId);
          startupTimeoutId = null;
        }
        if (video) {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          video.removeEventListener("canplay", startPlayback);
          video.removeEventListener("ended", handleEnded);
          video.removeEventListener("error", handleError);
          try {
            video.pause();
          } catch (error) {
          }
          video.removeAttribute("src");
          try {
            video.load();
          } catch (error) {
          }
          if (video.parentNode) {
            video.parentNode.removeChild(video);
          }
        }
        if (processorNode) {
          processorNode.onaudioprocess = null;
          try {
            processorNode.disconnect();
          } catch (error) {
          }
        }
        if (gainNode) {
          try {
            gainNode.disconnect();
          } catch (error) {
          }
        }
        if (sourceNode) {
          try {
            sourceNode.disconnect();
          } catch (error) {
          }
        }
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      }

      function fail(error) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }

      function finish() {
        var combined;
        var offset = 0;

        if (settled) {
          return;
        }

        if (!totalFrames) {
          fail(new Error("BAD_AUDIO"));
          return;
        }

        combined = new Float32Array(totalFrames);
        chunks.forEach(function (chunk) {
          combined.set(chunk, offset);
          offset += chunk.length;
        });

        settled = true;
        cleanup();
        resolve({
          sampleRate: audioContext.sampleRate,
          duration: Number(audioRecord.duration) || (combined.length / audioContext.sampleRate),
          data: combined
        });
      }

      function handleError() {
        fail(createVideoAudioPreparationError(
          "VIDEO_AUDIO_PREP_FAILED",
          "This video format opened, but Safari could not extract its audio track for local transcription. Try a saved video file from Photos, export/share it first, or use desktop."
        ));
      }

      function handleEnded() {
        finish();
      }

      function handleLoadedMetadata() {
        var duration = Number(video.duration) || 0;

        audioRecord.duration = duration;
        if (!Number.isFinite(duration) || duration < 1) {
          fail(createVideoAudioPreparationError(
            "VIDEO_AUDIO_PREP_FAILED",
            "This video did not expose a readable audio track for local transcription on this iPhone."
          ));
          return;
        }

        try {
          enforceTranscriptionDurationLimit(audioRecord, modelKey);
        } catch (error) {
          fail(error);
          return;
        }

        if (video.readyState >= 2) {
          startPlayback();
        }
      }

      function startPlayback() {
        var playPromise;

        if (settled || started) {
          return;
        }
        started = true;

        try {
          sourceNode = audioContext.createMediaElementSource(video);
          processorNode = audioContext.createScriptProcessor(4096, 2, 2);
          gainNode = audioContext.createGain();
          gainNode.gain.value = 0;

          processorNode.onaudioprocess = function (event) {
            var inputBuffer = event.inputBuffer;
            var monoChunk;
            var left;
            var right;
            var index;

            if (!inputBuffer || inputBuffer.numberOfChannels < 1) {
              return;
            }

            monoChunk = new Float32Array(inputBuffer.length);

            if (inputBuffer.numberOfChannels === 1) {
              monoChunk.set(inputBuffer.getChannelData(0));
            } else {
              left = inputBuffer.getChannelData(0);
              right = inputBuffer.getChannelData(1);
              for (index = 0; index < inputBuffer.length; index += 1) {
                monoChunk[index] = Math.SQRT2 * (left[index] + right[index]) * 0.5;
              }
            }

            totalFrames += monoChunk.length;
            chunks.push(monoChunk);
          };

          sourceNode.connect(processorNode);
          processorNode.connect(gainNode);
          gainNode.connect(audioContext.destination);

          timeoutId = window.setTimeout(function () {
            fail(createVideoAudioPreparationError(
              "VIDEO_AUDIO_PREP_TIMEOUT",
              "This iPhone video took too long to prepare for local transcription. Try sharing/exporting the video first, using a shorter clip, or switching to desktop."
            ));
          }, Math.max(15000, Math.ceil((audioRecord.duration || 0) * 1500)));

          playPromise = video.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise.catch(function () {
              fail(createVideoAudioPreparationError(
                "VIDEO_AUDIO_PREP_FAILED",
                "Safari blocked audio extraction for this recorded video. Try saving/exporting the clip first, then upload the saved file again."
              ));
            });
          }
        } catch (error) {
          fail(error);
        }
      }

      if (!file || typeof document === "undefined") {
        reject(new Error("BAD_AUDIO"));
        return;
      }

      try {
        objectUrl = URL.createObjectURL(file);
        video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        video.setAttribute("playsinline", "");
        video.style.position = "fixed";
        video.style.left = "-9999px";
        video.style.width = "1px";
        video.style.height = "1px";
        video.style.opacity = "0";
        video.src = objectUrl;
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("canplay", startPlayback);
        video.addEventListener("ended", handleEnded);
        video.addEventListener("error", handleError);
        document.body.appendChild(video);
        startupTimeoutId = window.setTimeout(function () {
          fail(createVideoAudioPreparationError(
            "VIDEO_AUDIO_PREP_TIMEOUT",
            "This iPhone video did not become ready for local transcription. Try saving/exporting the clip first, then upload it again, or use desktop."
          ));
        }, 10000);
        video.load();
      } catch (error) {
        fail(error);
      }
    });
  }

  async function decodeSelectedTranscriptionAudio(audioContext, audioRecord, modelKey) {
    if (!audioContext || !audioRecord || !audioRecord.file) {
      throw new Error("Missing audio source");
    }

    await ensureTranscriptionAudioContextReady(audioContext);

    var audioBuffer;
    var decodedVideoAudio;
    try {
      var arrayBuffer = await audioRecord.file.arrayBuffer();
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (decodeError) {
      if (!isVideoMediaFile(audioRecord.file)) {
        throw decodeError;
      }
      decodedVideoAudio = await extractAudioFromVideoFile(audioContext, audioRecord, modelKey);
      audioRecord.sampleRate = decodedVideoAudio.sampleRate;
      audioRecord.data = decodedVideoAudio.data;
      audioRecord.duration = decodedVideoAudio.duration;
      audioRecord.needsDecode = false;
      return audioRecord;
    }
    var policy = getTranscriptionDurationPolicy(modelKey);
    audioRecord.duration = audioBuffer.duration;

    if (audioBuffer.duration > policy.seconds) {
      throw createFileTooLongError(audioBuffer.duration, policy.seconds, modelKey);
    }

    if (audioBuffer.duration < 1) {
      throw new Error("BAD_AUDIO");
    }

    var monoData = convertToMono(audioBuffer, {
      phoneOptimized: !!audioRecord.phoneOptimized
    });

    audioRecord.sampleRate = audioBuffer.sampleRate;
    audioRecord.data = monoData;
    audioRecord.duration = audioBuffer.duration;
    audioRecord.needsDecode = false;

    return audioRecord;
  }

  async function ensureTranscriptionAudioContextReady(audioContext) {
    if (!audioContext || typeof audioContext.resume !== "function") {
      return;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
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

  function containsArabicScript(text) {
    return /[\u0600-\u06FF]/.test(String(text || ""));
  }

  function isKnownTranscriptArtifact(text, language) {
    var cleaned = cleanText(text);
    var useArabicRules = isArabicLanguage(language) || containsArabicScript(cleaned);
    if (!cleaned) {
      return false;
    }

    if (useArabicRules) {
      return /^(?:اشترك(?:وا)?(?: في)?(?: ال)?قناة|لا تنس(?:وا)? الاشتراك(?: في القناة)?)[.!؟?]*$/i.test(cleaned);
    }

    return /^(?:subscribe(?: to (?:the )?channel)?|subtitles by\b.*)[.!?]*$/i.test(cleaned);
  }

  function finalizeTranscriptSegmentText(text, language, isLastSegment) {
    var cleaned = fixPunctuation(cleanText(text));

    if (!cleaned || isKnownTranscriptArtifact(cleaned, language)) {
      return "";
    }

    return cleaned;
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

function generateSRT(segments, selectedLanguage) {
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
    const cueText = applyExportDirectionMark(seg.text || seg.editedText || seg.originalText || "", selectedLanguage);

    return `${i + 1}\n${start} --> ${end}\n${cueText}\n`;
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

  function getTranscriptAudioPlayer() {
    return document.getElementById("audio-player");
  }

  function getTranscriptSegmentTimeRange(segment) {
    var timestamp = segment && Array.isArray(segment.timestamp) ? segment.timestamp : null;
    var start = timestamp && Number.isFinite(timestamp[0])
      ? timestamp[0]
      : (segment && Number.isFinite(segment.start) ? segment.start : null);
    var end = timestamp && Number.isFinite(timestamp[1])
      ? timestamp[1]
      : (segment && Number.isFinite(segment.end) ? segment.end : start);

    if (!Number.isFinite(start)) {
      return null;
    }

    if (!Number.isFinite(end) || end < start) {
      end = start;
    }

    return {
      start: start,
      end: end
    };
  }

  function getActiveTranscriptPlaybackSegmentIndex(timeSeconds) {
    var segments = getActiveSegments();
    var time = Number(timeSeconds);
    var fallbackIndex = -1;
    var i;

    if (!Number.isFinite(time) || !segments.length) {
      return -1;
    }

    for (i = 0; i < segments.length; i++) {
      var range = getTranscriptSegmentTimeRange(segments[i]);
      var nextRange = i + 1 < segments.length ? getTranscriptSegmentTimeRange(segments[i + 1]) : null;

      if (!range) {
        continue;
      }

      if (time + 0.02 < range.start) {
        break;
      }

      fallbackIndex = i;

      if (time >= range.start && time <= range.end + 0.02) {
        return i;
      }

      if (nextRange && time >= range.start && time < nextRange.start) {
        return i;
      }
    }

    return fallbackIndex;
  }

  function setTranscriptPlaybackButtonState(root, isPlaying) {
    var toggleBtn = root ? root.querySelector('[data-role="transcriptPlaybackToggle"]') : null;
    if (!toggleBtn) {
      return;
    }

    toggleBtn.setAttribute("aria-pressed", isPlaying ? "true" : "false");
    toggleBtn.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
    toggleBtn.classList.toggle("is-playing", !!isPlaying);
  }

  function formatTranscriptPlaybackClock(timeSeconds) {
    var totalSeconds = Math.max(0, Math.floor(Number(timeSeconds) || 0));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;

    return String(minutes) + ":" + String(seconds).padStart(2, "0");
  }

  function setActiveTranscriptPlaybackSegment(root, nextIndex) {
    var previousIndex;
    var previousEl;
    var nextEl;

    if (!root) {
      return;
    }

    previousIndex = Number.isInteger(root.__activeTranscriptPlaybackIndex)
      ? root.__activeTranscriptPlaybackIndex
      : -1;

    if (previousIndex === nextIndex) {
      return;
    }

    if (previousIndex >= 0) {
      previousEl = root.querySelector('.ts-sentence[data-segment-index="' + previousIndex + '"]');
      if (previousEl) {
        previousEl.classList.remove("is-active");
      }
    }

    if (Number.isInteger(nextIndex) && nextIndex >= 0) {
      nextEl = root.querySelector('.ts-sentence[data-segment-index="' + nextIndex + '"]');
      if (nextEl) {
        nextEl.classList.add("is-active");
      }
    } else {
      nextIndex = -1;
    }

    root.__activeTranscriptPlaybackIndex = nextIndex;
  }

  function syncTranscriptPlaybackHighlight(root) {
    var audioPlayer;

    if (!root) {
      return;
    }

    audioPlayer = getTranscriptAudioPlayer();
    if (!audioPlayer || !audioPlayer.getAttribute("src")) {
      setActiveTranscriptPlaybackSegment(root, -1);
      return;
    }

    if (audioPlayer.ended || (audioPlayer.paused && !root.__transcriptPlaybackHasStarted)) {
      setActiveTranscriptPlaybackSegment(root, -1);
      return;
    }

    setActiveTranscriptPlaybackSegment(
      root,
      getActiveTranscriptPlaybackSegmentIndex(audioPlayer.currentTime)
    );
  }

  function syncTranscriptPlaybackUi(root) {
    var audioPlayer;
    var playerRow;
    var toggleBtn;
    var progressSlider;
    var timeLabel;
    var volumeSlider;
    var showPlayback;
    var activeVolume;
    var duration;
    var currentTime;

    if (!root) {
      return;
    }

    audioPlayer = getTranscriptAudioPlayer();
    playerRow = root.querySelector('[data-role="transcriptPlayerRow"]');
    toggleBtn = root.querySelector('[data-role="transcriptPlaybackToggle"]');
    progressSlider = root.querySelector('[data-role="transcriptPlaybackProgress"]');
    timeLabel = root.querySelector('[data-role="transcriptPlaybackTime"]');
    volumeSlider = root.querySelector('[data-role="transcriptPlaybackVolume"]');
    showPlayback = !!(
      audioPlayer
      && audioPlayer.getAttribute("src")
      && (hasTranscriptResults() || hasTranslatedSegments())
    );

    if (playerRow) {
      playerRow.classList.toggle("is-hidden", !showPlayback);
    }

    if (toggleBtn) {
      toggleBtn.disabled = !showPlayback;
    }

    if (progressSlider) {
      progressSlider.disabled = !showPlayback;
    }

    if (volumeSlider) {
      volumeSlider.disabled = !showPlayback;
    }

    if (!audioPlayer) {
      if (progressSlider) {
        progressSlider.value = "0";
      }
      if (timeLabel) {
        timeLabel.textContent = "0:00";
      }
      setActiveTranscriptPlaybackSegment(root, -1);
      setTranscriptPlaybackButtonState(root, false);
      return;
    }

    audioPlayer.controls = false;
    audioPlayer.style.display = "none";
    duration = Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0 ? audioPlayer.duration : 0;
    currentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    activeVolume = Number.isFinite(audioPlayer.volume) ? audioPlayer.volume : 1;
    if (volumeSlider && root.__transcriptPlaybackVolumeSync !== activeVolume) {
      volumeSlider.value = String(Math.round(activeVolume * 100));
      root.__transcriptPlaybackVolumeSync = activeVolume;
    }

    if (progressSlider) {
      progressSlider.value = duration > 0
        ? String(Math.max(0, Math.min(1000, Math.round((currentTime / duration) * 1000))))
        : "0";
    }

    if (timeLabel) {
      timeLabel.textContent = formatTranscriptPlaybackClock(duration > 0 ? currentTime : 0);
    }

    if (!showPlayback) {
      if (progressSlider) {
        progressSlider.value = "0";
      }
      if (timeLabel) {
        timeLabel.textContent = "0:00";
      }
      root.__transcriptPlaybackHasStarted = false;
      setActiveTranscriptPlaybackSegment(root, -1);
      setTranscriptPlaybackButtonState(root, false);
      return;
    }

    setTranscriptPlaybackButtonState(root, !audioPlayer.paused && !audioPlayer.ended);
    syncTranscriptPlaybackHighlight(root);
  }

  function bindTranscriptPlaybackUi(root) {
    var audioPlayer;
    var toggleBtn;
    var progressSlider;
    var volumeSlider;

    if (!root || root.__transcriptPlaybackBound) {
      return;
    }

    audioPlayer = getTranscriptAudioPlayer();
    if (!audioPlayer) {
      return;
    }

    toggleBtn = root.querySelector('[data-role="transcriptPlaybackToggle"]');
    progressSlider = root.querySelector('[data-role="transcriptPlaybackProgress"]');
    volumeSlider = root.querySelector('[data-role="transcriptPlaybackVolume"]');

    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        if (!audioPlayer.getAttribute("src")) {
          return;
        }

        if (audioPlayer.paused || audioPlayer.ended) {
          if (audioPlayer.ended) {
            audioPlayer.currentTime = 0;
          }
          audioPlayer.play().catch(function () {
          });
        } else {
          audioPlayer.pause();
        }
      });
    }

    if (progressSlider) {
      progressSlider.addEventListener("input", function () {
        var duration = Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0 ? audioPlayer.duration : 0;
        var nextTime;

        if (!duration) {
          progressSlider.value = "0";
          return;
        }

        nextTime = (Math.max(0, Math.min(1000, Number(progressSlider.value) || 0)) / 1000) * duration;
        audioPlayer.currentTime = nextTime;
        root.__transcriptPlaybackHasStarted = true;
        syncTranscriptPlaybackUi(root);
      });
    }

    if (volumeSlider) {
      volumeSlider.addEventListener("input", function () {
        var nextVolume = Math.max(0, Math.min(1, Number(volumeSlider.value) / 100));
        if (!Number.isFinite(nextVolume)) {
          nextVolume = 1;
        }
        audioPlayer.volume = nextVolume;
        root.__transcriptPlaybackVolumeSync = nextVolume;
        if (audioPlayer.muted && nextVolume > 0) {
          audioPlayer.muted = false;
        }
      });
    }

    audioPlayer.addEventListener("play", function () {
      root.__transcriptPlaybackHasStarted = true;
      setTranscriptPlaybackButtonState(root, true);
      syncTranscriptPlaybackHighlight(root);
    });

    audioPlayer.addEventListener("pause", function () {
      setTranscriptPlaybackButtonState(root, false);
      syncTranscriptPlaybackHighlight(root);
    });

    audioPlayer.addEventListener("timeupdate", function () {
      syncTranscriptPlaybackUi(root);
      syncTranscriptPlaybackHighlight(root);
    });

    audioPlayer.addEventListener("seeking", function () {
      root.__transcriptPlaybackHasStarted = true;
      syncTranscriptPlaybackUi(root);
      syncTranscriptPlaybackHighlight(root);
    });

    audioPlayer.addEventListener("ended", function () {
      root.__transcriptPlaybackHasStarted = false;
      setTranscriptPlaybackButtonState(root, false);
      setActiveTranscriptPlaybackSegment(root, -1);
      syncTranscriptPlaybackUi(root);
    });

    audioPlayer.addEventListener("loadedmetadata", function () {
      syncTranscriptPlaybackUi(root);
    });

    audioPlayer.addEventListener("durationchange", function () {
      syncTranscriptPlaybackUi(root);
    });

    root.__transcriptPlaybackBound = true;
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
    window.translatedTranscriptLanguage = "";
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
    var normalized = (segments || []).reduce(function (result, segment, index, source) {
      var timestamp = Array.isArray(segment && segment.timestamp)
        ? [segment.timestamp[0], segment.timestamp[1]]
        : (Number.isFinite(segment && segment.start) && Number.isFinite(segment && segment.end)
          ? [segment.start, segment.end]
          : null);
      var detectedLanguage = detectTranscriptLanguage((segment && (segment.originalText || segment.text || segment.editedText || segment.translatedText)) || "");
      var originalText = finalizeTranscriptSegmentText((segment && (segment.originalText || segment.text)) || "", detectedLanguage, index === source.length - 1);
      var editedText = finalizeTranscriptSegmentText((segment && segment.editedText) || "", detectedLanguage, index === source.length - 1);
      var translatedText = finalizeTranscriptSegmentText((segment && segment.translatedText) || "", detectedLanguage, index === source.length - 1);

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

    if (normalized.length) {
      normalized[normalized.length - 1].originalText = finalizeTranscriptSegmentText(normalized[normalized.length - 1].originalText, detectTranscriptLanguage(normalized[normalized.length - 1].originalText), true);
      if (normalized[normalized.length - 1].editedText) {
        normalized[normalized.length - 1].editedText = finalizeTranscriptSegmentText(normalized[normalized.length - 1].editedText, detectTranscriptLanguage(normalized[normalized.length - 1].editedText), true);
      }
      if (normalized[normalized.length - 1].translatedText) {
        normalized[normalized.length - 1].translatedText = finalizeTranscriptSegmentText(normalized[normalized.length - 1].translatedText, detectTranscriptLanguage(normalized[normalized.length - 1].translatedText), true);
      }
    }

    return normalized;
  }

  function formatTime(seconds) {
    var totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function buildSubtitles(chunks, language) {
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

    return normalizeIncomingSegments(chunks).reduce(function (result, chunk, index, source) {
      var text = normalizeSegmentText(chunk && chunk.text);
      var timestamp = chunk && chunk.timestamp;

      if (!text || isKnownTranscriptArtifact(text, language) || !isValidTimestamp(timestamp)) {
        return result;
      }

      var finalizedText = finalizeTranscriptSegmentText(text, language, index === source.length - 1);
      if (!finalizedText) {
        return result;
      }

      result.push({
        text: finalizedText,
        timestamp: [timestamp[0], timestamp[1]]
      });
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

  function renderSegments(container, heading, segments, useTranslatedText, contentLanguage) {
    var items = Array.isArray(segments) ? segments : [];

    container.textContent = "";
    applyTranscriptDirection(container, contentLanguage);

    if (heading) {
      var headingEl = document.createElement("div");
      headingEl.className = "ts-segment";

      var headingText = document.createElement("div");
      headingText.className = "ts-text";
      headingText.setAttribute("data-transcript-text", "1");
      headingText.textContent = heading;

      headingEl.appendChild(headingText);
      container.appendChild(headingEl);
    }

    var paragraphEl = document.createElement("div");
    paragraphEl.className = "ts-paragraph";
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
      wrapper.setAttribute("data-segment-index", String(index));

      textEl = document.createElement("span");
      textEl.className = "ts-segment-text";
      textEl.setAttribute("data-segment-editor", "1");
      textEl.setAttribute("data-transcript-text", "1");
      textEl.setAttribute("data-index", String(index));
      textEl.contentEditable = previewEditMode ? "true" : "false";
      textEl.spellcheck = false;
      if (showTimestamps && start !== null) {
        var timeEl = document.createElement("span");
        timeEl.className = "ts-time-inline";
        timeEl.textContent = "[" + formatTime(start) + "]";
        wrapper.appendChild(timeEl);
      }

      textEl.textContent = lineText;
      wrapper.appendChild(textEl);

      paragraphEl.appendChild(wrapper);
      paragraphEl.appendChild(document.createTextNode(" "));
    });

    container.appendChild(paragraphEl);
    applyTranscriptDirection(container, contentLanguage);
  }

  function updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn) {
    if (!transcriptEl) {
      return;
    }

    var root = transcriptEl.closest("#audio-tool");
    var builtInTranslationAllowed = isBuiltInTranslationAllowed();
    // Preserve audio player reference before updating transcript UI
    var audioPlayer = document.getElementById("audio-player");

    var hasTranslation = hasTranslatedSegments();
    if (translatedTabBtn) {
      translatedTabBtn.style.display = builtInTranslationAllowed && hasTranslation ? "" : "none";
    }
    if (!builtInTranslationAllowed && window.currentTab === "translated") {
      window.currentTab = "original";
    }
    if (originalTabBtn) {
      originalTabBtn.classList.toggle("active", (window.currentTab || "original") === "original");
    }
    if (translatedTabBtn) {
      translatedTabBtn.classList.toggle("active", builtInTranslationAllowed && (window.currentTab || "original") === "translated");
    }
    updateEditButton(editBtn);

    if (builtInTranslationAllowed && window.currentTab === "translated" && hasTranslation) {
      transcriptEl.setAttribute("data-state", "filled");
      renderSegments(
        transcriptEl,
        window.translatedTitle || "",
        getActiveSegments(),
        true,
        getEffectiveTranslatedContentLanguage() || getEffectiveTranscriptionContentLanguage()
      );
    } else if (builtInTranslationAllowed && window.currentTab === "translated" && !hasTranslation) {
      transcriptEl.setAttribute("data-state", "empty");
      clearTranscriptDirection(transcriptEl);
      transcriptEl.textContent = "Translate your transcript to view it here.";
    } else if (window.currentTranscript) {
      window.currentTab = "original";
      transcriptEl.setAttribute("data-state", "filled");
      renderSegments(
        transcriptEl,
        "",
        getActiveSegments(),
        false,
        getEffectiveTranscriptionContentLanguage()
      );
    } else {
      window.currentTab = "original";
      transcriptEl.setAttribute("data-state", "empty");
      clearTranscriptDirection(transcriptEl);
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
    var activeLanguage = getActiveTranscriptContentLanguage();
    if (!activeText) {
      return;
    }

    var type = window.currentTab === "translated" ? "Translation" : "Transcription";
    downloadBlob(buildExportFileName(type, "txt"), applyExportDirectionMarks(activeText, activeLanguage));
  }

  function downloadActiveSRT() {
    var activeText = getActiveTranscript();
    var activeSegments = getActiveSegments();
    var activeLanguage = getActiveTranscriptContentLanguage();
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
    }), activeLanguage);
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
      window.translatedTranscriptLanguage = "";
      window.transcriptionSourceLanguage = context.language;
      window.transcriptionDetectedLanguage = getLangCode(context.detectedLanguage || "");
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
      window.translatedTranscriptLanguage = "";
      window.transcriptionSourceLanguage = "";
      window.transcriptionDetectedLanguage = "";
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
    clearTranscriptionRecoveryState();
    if (typeof context.afterRunCleanup === "function") {
      context.afterRunCleanup({
        keepResults: !!formattedText
      });
    }
    setTranscribeButtonState(context.startBtn, false);
    setEnhanceToggleState(document.getElementById("enhance-audio"), true);
    activeTranscriptionContext = null;
  }

  function restoreAfterTranscriptionFailure(context, options) {
    var config = options || {};
    var failureMessage = config.message || "Transcription failed";
    var modelErrorMessage = config.modelErrorMessage || failureMessage;

    processingLocked = false;
    stopFakeProgress();
    stopProgressMessages();
    stopLockHeartbeat();
    releaseModelLock();
    clearPendingTranscriptionStart();
    clearTranscriptionRecoveryState();
    modelWarmState = "error";
    setProgress(0);
    setProgressMessage("");

    if (context) {
      setStatus(context.statusEl, failureMessage, "error");
      setTranscribeButtonState(context.startBtn, false);
      setEnhanceToggleState(document.getElementById("enhance-audio"), true);
      if (typeof context.afterRunCleanup === "function") {
        context.afterRunCleanup({
          keepResults: true
        });
      }
    }

    if (selectedTranscriptionModelKey) {
      setModelUiState(selectedTranscriptionModelKey, "error", modelErrorMessage);
    }

    activeTranscriptionContext = null;
    syncTranscribeReadyState();
    refreshTranscribeLayout();
  }

  function attachWorkerListeners(targetWorker, generation) {
    if (!targetWorker) {
      return;
    }

    targetWorker.onerror = function () {
      if (generation !== workerGeneration) {
        return;
      }

      modelUnloadPending = false;
      pendingModelRequestKey = "";
      activePreparedModelKey = "";
      restoreAfterTranscriptionFailure(activeTranscriptionContext, {
        message: isSafariLikeBrowser()
          ? "This phone ran out of memory during local transcription. File is still loaded. Try again, use a shorter file, or switch to desktop."
          : "The local transcription worker stopped unexpectedly. File is still loaded so you can retry.",
        modelErrorMessage: isSafariLikeBrowser()
          ? "Phone memory ran out during transcription. Try a shorter file or reload once."
          : "The local transcription worker stopped unexpectedly. Please try again."
      });
    };

    targetWorker.onmessageerror = function () {
      if (generation !== workerGeneration) {
        return;
      }

      modelUnloadPending = false;
      pendingModelRequestKey = "";
      activePreparedModelKey = "";
      restoreAfterTranscriptionFailure(activeTranscriptionContext, {
        message: "Worker communication failed. File is still loaded so you can retry.",
        modelErrorMessage: "Worker communication failed."
      });
    };

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
          var isFinalizingModel = downloadPercent >= 100;
          if (downloadStatusEl) {
            setStatus(
              downloadStatusEl,
              isFinalizingModel
                ? "Finalizing " + model.label + " in your browser..."
                : "Downloading " + model.label + "... " + downloadPercent + "%",
              "processing"
            );
          }
          setProgress(isFinalizingModel ? 95 : downloadPercent);
          setProgressMessage(isFinalizingModel ? "Model files downloaded. Finishing browser setup..." : FIRST_RUN_MODEL_COPY);
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
        if (pendingTranscriptionStart && !activeTranscriptionContext && processingLocked && pendingTranscriptionStart.modelKey === modelKey) {
          var pendingStart = pendingTranscriptionStart;
          if (pendingStart.statusEl) {
            setStatus(pendingStart.statusEl, getModelStartStatus(e.data.loadState), "processing");
          }
          stopFakeProgress();
          stopProgressMessages(false);
          setProgress(0);
          setProgressMessage("Preparing audio...");
          processingLocked = false;
          resumePendingTranscriptionStart().catch(function (error) {
            console.error("Failed to resume transcription after model load:", error);
          });
          syncTranscribeReadyState();
          refreshTranscribeLayout();
          return;
        }
        if (activeTranscriptionContext && activeTranscriptionContext.modelKey === modelKey) {
          setStatus(activeTranscriptionContext.statusEl, getModelStartStatus(e.data.loadState), "processing");
          setProgress(0);
          setProgressMessage("Transcribing in browser...");
          if (!progressInterval) {
            startFakeProgress(4, 90, "Transcribing in browser...");
          }
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

      if (type === "update") {
        if (activeTranscriptionContext) {
          var partialText = normalizeTranscriptTextForDisplay(text, activeTranscriptionContext.language);
          if (partialText && activeTranscriptionContext.transcriptEl) {
            activeTranscriptionContext.transcriptEl.textContent = partialText;
            applyTranscriptDirection(
              activeTranscriptionContext.transcriptEl,
              activeTranscriptionContext.language || window.transcriptionDetectedLanguage || window.transcriptionSourceLanguage
            );
          }
          setStatus(activeTranscriptionContext.statusEl, "Transcribing in browser...", "processing");
        }
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
        if (context && tryKnownTranscriptionFallback(context, e.data || {})) {
          return;
        }
        restoreAfterTranscriptionFailure(context, {
          message: message || "Transcription failed. File is still loaded so you can retry.",
          modelErrorMessage: message || "Transcription failed"
        });
      }

    };
  }
  async function startTranscription(modelKey, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, vttBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn, editBtn, input, audioContext, afterRunCleanup) {
    var audio = window.transcriptionAudio;
    var selectedModel = getTranscriptionModeByKey(modelKey) || getSelectedTranscriptionMode();
    var isPreparedModelReady = activePreparedModelKey === modelKey && modelWarmState === "ready";
    var keepLoadedAudioOnFailure = false;

    // Prevent concurrent processing
    if (!audio || activeTranscriptionContext || (processingLocked && !isPreparedModelReady)) {
      return;
    }

    writeTranscriptionRecoveryState({
      phase: "processing",
      fileName: audio && audio.file ? audio.file.name : "",
      language: language,
      modelKey: modelKey
    });

    setPendingTranscriptionStart({
      modelKey: modelKey,
      language: language,
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
      input: input,
      audioContext: audioContext,
      afterRunCleanup: afterRunCleanup
    });

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
      await ensureTranscriptionAudioContextReady(audioContext);

      if (!isPreparedModelReady) {
        setStatus(statusEl, "Preparing " + selectedModel.label + "...", "processing");
        setProgressMessage(FIRST_RUN_MODEL_COPY);
        setProgress(0);
        requestModelWarmup();
        return;
      }

      clearPendingTranscriptionStart();
      setStatus(statusEl, "Preparing audio...", "processing");
      setProgressMessage("Preparing audio...");
      setProgress(0);

      if (audio.needsDecode || !audio.data || !audio.sampleRate) {
        await decodeSelectedTranscriptionAudio(audioContext, audio, modelKey);
      } else {
        enforceTranscriptionDurationLimit(audio, modelKey);
      }

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

      var resampled = audio.phoneOptimized && audio.sampleRate === 16000
        ? processedData
        : resampleTo16kHz(processedData, audio.sampleRate);
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
        input: input,
        audioContext: audioContext,
        duration: audio.duration,
        afterRunCleanup: afterRunCleanup
      };

      var selectedLanguage = language || "auto";
      var shouldReleaseDecodedAudio = !!audio.phoneOptimized || isSafariLikeBrowser();
      var transferBuffer = resampled.buffer;

      worker.postMessage(
    {
      type: "transcribe",
      modelKey: modelKey,
      audio: transferBuffer,
      selectedLanguage: selectedLanguage
    },
    [transferBuffer]
  );
      if (shouldReleaseDecodedAudio) {
        audio.data = null;
        audio.sampleRate = 0;
        audio.needsDecode = true;
      }
      processedData = null;
      resampled = null;
      return;
    } catch (error) {
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.transcriptionSourceLanguage = "";
      setTranslationButtonsState(translateBtn, null, null, null, false);
      updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
      updateExportLabels(txtBtn, srtBtn, vttBtn);
      if (!error || (error.message !== "FILE_TOO_LONG" && error.message !== "BAD_AUDIO")) {
        console.error("Transcription error:", error);
      }
      if (error && error.message === "FILE_TOO_LONG") {
        keepLoadedAudioOnFailure = true;
        setStatus(statusEl, buildFileTooLongMessage(error, modelKey), "error");
      } else if (error && error.userMessage) {
        setStatus(statusEl, error.userMessage, "error");
      } else if (error && error.message === "BAD_AUDIO") {
        setStatus(statusEl, "Unsupported or corrupted file", "error");
      } else if (error && error.message === "MODEL_LOAD_FAILED") {
        setStatus(statusEl, "Failed to load AI model. Check your internet connection.", "error");
      } else {
        setStatus(statusEl, "Transcription failed. Try a shorter or clearer file.", "error");
      }
    } finally {
      // Unlock processing if transcription context not set (error occurred)
      var waitingForModelPreparation = !!pendingTranscriptionStart && !activeTranscriptionContext && processingLocked && (modelWarmState === "loading" || modelWarmState === "blocked");
      if (!activeTranscriptionContext && !waitingForModelPreparation) {
        clearPendingTranscriptionStart();
        processingLocked = false;
        setTranscribeButtonState(startBtn, false);
        setEnhanceToggleState(document.getElementById("enhance-audio"), true);
        if (keepLoadedAudioOnFailure) {
          clearTranscriptionRecoveryState();
          stopFakeProgress();
          stopProgressMessages();
          setProgress(0);
          setProgressMessage("");
          input.disabled = false;
          syncTranscribeReadyState();
          refreshTranscribeLayout();
        } else if (typeof afterRunCleanup === "function") {
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
    var restartBtn = root.querySelector('[data-role="restartBtn"]');
    var extractAudioCta = root.querySelector('[data-role="extractAudioCta"]');
    var transcriptPlayerRow = root.querySelector('[data-role="transcriptPlayerRow"]');
    var transcriptPlaybackToggle = root.querySelector('[data-role="transcriptPlaybackToggle"]');
    var transcriptPlaybackProgress = root.querySelector('[data-role="transcriptPlaybackProgress"]');
    var transcriptPlaybackTime = root.querySelector('[data-role="transcriptPlaybackTime"]');
    var transcriptPlaybackVolume = root.querySelector('[data-role="transcriptPlaybackVolume"]');
    var timestampCheckbox = root.querySelector('#show-timestamps');
    var modeSelect = root.querySelector('#modeSelect');
    var polishToggle = root.querySelector('#polishToggle');
    var audioPlayer = document.getElementById("audio-player");
    if (!input || input.dataset.transcribeToolBound === "1") {
      return;
    }

    bindTranscriptPlaybackUi(root);
    if (audioPlayer) {
      audioPlayer.controls = false;
      audioPlayer.style.display = "none";
    }
    if (transcriptPlayerRow) {
      transcriptPlayerRow.classList.add("is-hidden");
    }
    if (transcriptPlaybackToggle) {
      transcriptPlaybackToggle.disabled = true;
    }
    if (transcriptPlaybackProgress) {
      transcriptPlaybackProgress.disabled = true;
      transcriptPlaybackProgress.value = "0";
    }
    if (transcriptPlaybackTime) {
      transcriptPlaybackTime.textContent = "0:00";
    }
    if (transcriptPlaybackVolume) {
      transcriptPlaybackVolume.disabled = true;
    }
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
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
      if (lockRetryTimer) {
        window.clearTimeout(lockRetryTimer);
        lockRetryTimer = null;
      }
      setProgress(0);
      setProgressMessage("");
      processingLocked = false;
      activeTranscriptionContext = null;
      input.disabled = false;
      setEnhanceToggleState(root.querySelector("#enhance-audio"), true);
    }

    function resetTranscriptState() {
      previewEditMode = false;
      root.__translationSetupOpen = false;
      srtContent = "";
      vttContent = "";
      window.currentTranscript = "";
      window.currentSegments = [];
      window.translatedTranscript = "";
      window.translatedTitle = "";
      window.translatedSubtitles = [];
      window.transcriptionSourceLanguage = "";
      window.transcriptionDetectedLanguage = "";
      window.translatedTranscriptLanguage = "";
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

    function resetSessionWorker(options) {
      var shouldRebuild = !options || options.rebuild !== false;

      clearIdleUnloadTimer();
      stopLockHeartbeat();
      releaseModelLock();
      modelUnloadPending = false;
      pendingModelRequestKey = "";
      activePreparedModelKey = "";
      resetOtherModelStates("");
      modelWarmState = getSelectedModelState().enabled ? "idle" : "disabled";

      if (selectedTranscriptionModelKey) {
        setModelUiState(selectedTranscriptionModelKey, getSelectedModelState().enabled ? "idle" : "disabled");
      }

      if (worker) {
        try {
          worker.terminate();
        } catch (error) {
        }
        worker = null;
      }

      if (shouldRebuild) {
        var generation = createTranscribeWorker();
        attachWorkerListeners(worker, generation);
      }
    }

    function clearFileSelection(options) {
      var preserveInputValue = !!(options && options.preserveInputValue);

      if (root.__audioPreviewUrl) {
        URL.revokeObjectURL(root.__audioPreviewUrl);
        root.__audioPreviewUrl = "";
      }
      root.__translationSetupOpen = false;
      if (!preserveInputValue) {
        input.value = "";
      }
      input.disabled = false;
      fileNameEl.textContent = "No file selected";
      if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.removeAttribute("src");
        audioPlayer.load();
        audioPlayer.style.display = "none";
      }
      root.__transcriptPlaybackHasStarted = false;
      root.__transcriptPlaybackVolumeSync = 1;
      setActiveTranscriptPlaybackSegment(root, -1);
      setTranscriptPlaybackButtonState(root, false);
      updateFileIcon(root, null);
      if (toolRoot) {
        toolRoot.classList.remove("is-active");
      }
      window.transcriptionAudio = null;
      updateToolLayout(root);
    }

    function setPrimaryTranscriptionShellVisible(showTool) {
      var uploadShell = document.getElementById("upload-shell");
      var toolShell = document.getElementById("tool-shell");

      if (uploadShell) {
        uploadShell.classList.toggle("is-hidden", !!showTool);
      }

      if (toolShell) {
        toolShell.classList.toggle("is-hidden", !showTool);
      }
    }

    function showPrimaryTranscriptionUploadShell() {
      if (typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new Event("converter:empty"));
        return;
      }

      setPrimaryTranscriptionShellVisible(false);
      if (input) {
        input.value = "";
      }
    }

    function hasReusablePreparedModel() {
      return !!(
        worker
        && activePreparedModelKey
        && activePreparedModelKey === selectedTranscriptionModelKey
        && modelWarmState === "ready"
        && getSelectedModelState().enabled
      );
    }

    function schedulePreservedModelIdleUnload() {
      if (!hasReusablePreparedModel()) {
        return;
      }

      scheduleIdleUnload(document.hidden ? IDLE_UNLOAD_HIDDEN_MS : IDLE_UNLOAD_VISIBLE_MS);
    }

    function softResetTranscriptionShell(options) {
      var config = options || {};
      var preserveInputValue = !!config.preserveInputValue;
      var resetStatusText = config.resetStatusText !== false;

      resetProcessingUi();
      resetTranscriptState();
      clearFileSelection({
        preserveInputValue: preserveInputValue
      });
      showTimestamps = true;
      if (timestampCheckbox) {
        timestampCheckbox.checked = true;
      }
      closeLanguagePicker();
      closeTranslationSourcePicker();
      closeTranslationTargetPicker();
      transcriptEl.textContent = EMPTY_TRANSCRIPT_TEXT;
      setTranscribeButtonState(startBtn, false);
      setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
      setTranslationButtonsState(translateBtn, null, null, null, false);
      setEnhanceToggleState(root.querySelector("#enhance-audio"), true);
      if (resetStatusText) {
        setStatus(statusEl, "Upload a file to begin transcription", "idle");
      }
      updateRuntimeMessaging(root);
      syncTranscribeReadyState();
      refreshTranscribeLayout();
      updateToolLayout(root);
      clearPendingTranscriptionStart();
      clearTranscriptionRecoveryState();
      schedulePreservedModelIdleUnload();
    }

    function hardResetTranscriptionShell(options) {
      var config = options || {};
      var resetStatusText = config.resetStatusText !== false;
      var rebuildWorker = config.rebuildWorker !== false;

      teardownTranscriptionSession({
        hideShell: false,
        preserveInputValue: false,
        resetStatusText: resetStatusText,
        rebuildWorker: rebuildWorker
      });
      showPrimaryTranscriptionUploadShell();
      if (!worker && rebuildWorker) {
        rebuildTranscribeWorker();
      }
      clearTranscriptionRecoveryState();
      updateToolLayout(root);
      syncTranscribeReadyState();
    }

    function teardownTranscriptionSession(options) {
      var config = options || {};
      var hideShell = !!config.hideShell;
      var preserveInputValue = !!config.preserveInputValue;
      var rebuildWorker = config.rebuildWorker !== false;
      var resetStatusText = config.resetStatusText !== false;
      var preserveRecoveryState = !!config.preserveRecoveryState;

      resetProcessingUi();
      resetTranscriptState();
      clearFileSelection({
        preserveInputValue: preserveInputValue
      });
      resetSessionWorker({
        rebuild: rebuildWorker
      });
      showTimestamps = true;
      if (timestampCheckbox) {
        timestampCheckbox.checked = true;
      }
      closeLanguagePicker();
      closeTranslationSourcePicker();
      closeTranslationTargetPicker();
      transcriptEl.textContent = EMPTY_TRANSCRIPT_TEXT;
      setTranscribeButtonState(startBtn, false);
      setExportButtonsState(copyBtn, txtBtn, srtBtn, vttBtn, false);
      setTranslationButtonsState(translateBtn, null, null, null, false);
      setEnhanceToggleState(root.querySelector("#enhance-audio"), true);

      if (resetStatusText) {
        setStatus(statusEl, "Upload a file to begin transcription", "idle");
      }

      updateRuntimeMessaging(root);
      syncTranscribeReadyState();
      refreshTranscribeLayout();
      updateToolLayout(root);
      clearPendingTranscriptionStart();
      if (!preserveRecoveryState) {
        clearTranscriptionRecoveryState();
      }

      if (hideShell) {
        document.dispatchEvent(new Event("converter:empty"));
      }
    }

    function resetForNextUpload(options) {
      var keepResults = !!(options && options.keepResults);

      if (!keepResults) {
        teardownTranscriptionSession({
          hideShell: false,
          resetStatusText: true,
          rebuildWorker: true
        });
      } else if (translateBtn) {
        resetProcessingUi();
        input.disabled = false;
        translateBtn.disabled = !window.currentTranscript;
        updateToolLayout(root);
      }
    }

    function restoreInterruptedTranscriptionShell() {
      var recoveryState = readTranscriptionRecoveryState();
      if (!recoveryState || recoveryState.phase !== "processing" || hasLoadedTranscriptionFile(window.transcriptionAudio)) {
        return;
      }
      hardResetTranscriptionShell({
        resetStatusText: true,
        rebuildWorker: true
      });
      clearTranscriptionRecoveryState();
    }

    initializeTranscriptionModelStates();
    applyTranscriptionCapabilityProfile(probeTranscriptionCapabilities());
    requestTranscriptionCapabilityRefresh();
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
    restoreInterruptedTranscriptionShell();
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
        softResetTranscriptionShell({
          resetStatusText: true,
          preserveInputValue: false
        });
        showPrimaryTranscriptionUploadShell();
      });
    }
    if (extractAudioCta) {
      extractAudioCta.addEventListener("click", function () {
        window.location.assign(EXTRACT_AUDIO_TOOL_PATH);
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
      syncLanguagePickerSelection();

      languageSelect.addEventListener("change", function () {
        syncLanguagePickerSelection();
        updateRuntimeMessaging(root);
        applyCurrentTranscriptDirection(transcriptEl);
        if (window.transcriptionAudio && !hasTranscriptResults() && !processingLocked) {
          setStatus(statusEl, getAudioReadyStatus(languageSelect.value), getAudioReadyStatusState());
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
          updateExportLabels(txtBtn, srtBtn, vttBtn);
        } else {
          if (hasTranslatedSegments() || window.translatedTranscript) {
            clearTranslatedState();
          }
          activeSegments[index].editedText = nextText;
          window.currentTranscript = getSegmentsParagraphText(activeSegments);
          updateExportLabels(txtBtn, srtBtn, vttBtn);
          syncTranslationReadyState();
          updateToolLayout(root);
        }
      });
    }

    if (tabButtons && tabButtons.length) {
      tabButtons.forEach(function (tabBtn) {
        tabBtn.addEventListener("click", function () {
          var nextTab = tabBtn.dataset.tab || "original";
          if (nextTab === "translated" && !isBuiltInTranslationAllowed()) {
            window.currentTab = "original";
            updateTranscriptView(transcriptEl, originalTabBtn, translatedTabBtn, editBtn);
            updateExportLabels(txtBtn, srtBtn, vttBtn);
            return;
          }
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

        if (!hasSelectedTranscriptionLanguage(language)) {
          setStatus(statusEl, "Choose the spoken language before transcribing for best accuracy.", "warning");
          syncTranscribeReadyState();
          return;
        }

        if (window.transcriptionAudio && window.transcriptionAudio.phoneRiskReason) {
          setStatus(statusEl, window.transcriptionAudio.phoneRiskReason, "warning");
          syncTranscribeReadyState();
          return;
        }

        await startTranscription(selectedModel.key, language, statusEl, transcriptEl, copyBtn, txtBtn, srtBtn, vttBtn, startBtn, translateBtn, originalTabBtn, translatedTabBtn, editBtn, input, audioContext, resetForNextUpload);
        updateToolLayout(root);
      });
    }
    if (translateBtn && isBuiltInTranslationAllowed()) {
      translateBtn.addEventListener("click", async function () {
        if (processingLocked) {
          return;
        }
        var sourceCode = translateSourceLanguage ? translateSourceLanguage.value : "";
        var targetLang = translateLanguage ? translateLanguage.value : "";
        var sourceLang = getTranslationFloresCode(sourceCode);
        var mappedTarget = getTranslationFloresCode(targetLang);

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

        root.__translationSetupOpen = false;
        updateToolLayout(root);
        openEditedTranscriptTranslationView({
          sourceCode: sourceCode,
          sourceFloresCode: sourceLang,
          targetCode: targetLang,
          targetFloresCode: mappedTarget,
          statusEl: statusEl,
          showTimestamps: !!(timestampCheckbox && timestampCheckbox.checked)
        });
      });
    } else if (translateBtn) {
      translateBtn.disabled = true;
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
        softResetTranscriptionShell({
          resetStatusText: true,
          preserveInputValue: false
        });
        showPrimaryTranscriptionUploadShell();
        setStatus(statusEl, "Unsupported or corrupted file", "error");
        return;
      }
      softResetTranscriptionShell({
        preserveInputValue: true,
        resetStatusText: false
      });
      if (toolRoot) {
        toolRoot.classList.add("is-active");
      }
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
        audioPlayer.currentTime = 0;
        audioPlayer.volume = 1;
        root.__transcriptPlaybackHasStarted = false;
        root.__transcriptPlaybackVolumeSync = 1;
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

      window.transcriptionAudio = {
        file: file,
        sampleRate: 0,
        data: null,
        duration: 0,
        needsDecode: true,
        phoneOptimized: isPhoneTranscriptionModeActive(),
        phoneRiskReason: getPhoneFileRiskReason(file)
      };

      var selectedLanguage = languageSelect ? languageSelect.value : "";
      var readyMessage = getAudioReadyStatus(selectedLanguage);
      var readyState = getAudioReadyStatusState();

      setStatus(statusEl, readyMessage, readyState);
      setProgress(0);
      updateToolLayout(root);
      syncTranscribeReadyState();
    }

    root.__audioToolController = {
      destroy: function () {
        teardownTranscriptionSession({
          hideShell: false,
          resetStatusText: true,
          rebuildWorker: false
        });
      }
    };
    window.__transcribePageExitTeardown = function () {
      var shouldPreserveRecovery = !!(processingLocked || pendingTranscriptionStart || activeTranscriptionContext);
      if (shouldPreserveRecovery) {
        writeTranscriptionRecoveryState({
          phase: "processing",
          fileName: window.transcriptionAudio && window.transcriptionAudio.file ? window.transcriptionAudio.file.name : "",
          language: getSelectedTranscriptionLanguage(),
          modelKey: selectedTranscriptionModelKey
        });
      }
      teardownTranscriptionSession({
        hideShell: true,
        resetStatusText: true,
        rebuildWorker: false,
        preserveRecoveryState: shouldPreserveRecovery
      });
    };

    window.addEventListener("pageshow", function () {
      var toolShell = document.getElementById("tool-shell");
      var hasStaleToolShell = !!(toolShell && !toolShell.classList.contains("is-hidden") && !hasLoadedTranscriptionFile(window.transcriptionAudio) && !hasTranscriptResults());
      var hasRecoveryState = !!readTranscriptionRecoveryState();

      if (hasStaleToolShell || hasRecoveryState) {
        hardResetTranscriptionShell({
          resetStatusText: true,
          rebuildWorker: true
        });
      } else if (!worker) {
        rebuildTranscribeWorker();
      }
    });

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
      audioContext = createTranscriptionAudioContext(AudioContextCtor);
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
