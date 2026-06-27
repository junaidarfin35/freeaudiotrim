let transcriber = null;
let activeTranscriptionModelKey = null;
let isLoading = false;
let isBusy = false;
let activeTranscriptionDiagnostics = null;
let activeWorkerSessionId = "";
let activeWorkerAttemptId = "";
let modernTransformersRuntimePromise = null;
let legacyTransformersRuntimePromise = null;
const DEBUG_TRANSCRIPTION = false;
const DEBUG_WHISPER_RAW = false;
const DEBUG_ARABIC_PROMPT = false;
const RAW_WHISPER_PASSTHROUGH = true;
const arabicPromptIdsByModel = new Map();
const whisperRuntimeInspectionLogged = new Set();
const ONNX_RUNTIME_NOISE_PATTERNS = [
  "VerifyEachNodeIsAssignedToAnEp",
  "Some nodes were not assigned to the preferred execution providers",
  "Rerunning with verbose output on a non-minimal build will show node assignments"
];
const NON_CRITICAL_TRANSCRIPTION_NOISE_PATTERNS = [
  "Unable to determine content-length from response headers. Will expand buffer when needed.",
  "Unable to add response to browser cache"
];
const WEAK_WEBGPU_TREX_PATTERNS = [
  "Invalid ComputePipeline",
  "Invalid BindGroupLayout",
  "\"Sqrt\"",
  "\"Div\"",
  "\"Mul\"",
  "WebGPU validation",
  "previous error"
];
const UNSTABLE_TREX_RUNTIME_PATTERNS = [
  "out of memory",
  "device lost",
  "device was lost",
  "context lost",
  "webgpu",
  "gpu",
  "aborted",
  "memory access out of bounds",
  "internal error"
];
const DEFAULT_TRANSCRIPTION_MODEL_KEY = "triceratop";
const DEFAULT_CHUNK_LENGTH_SECONDS = 29;
const SMALLER_TIMESTAMPED_CHUNK_LENGTH_SECONDS = 28;
const DESKTOP_STRIDE_LENGTH_SECONDS = 5;
const PHONE_CHUNK_LENGTH_SECONDS = 15;
const PHONE_STRIDE_LENGTH_SECONDS = 3;
const MIN_DESKTOP_VAD_CHUNK_SECONDS = 3;
const MAX_DESKTOP_VAD_MICRO_CHUNKS = 1;
const SPARSE_COVERAGE_MIN_SPEECH_SECONDS = 8;
const SPARSE_COVERAGE_SPLIT_OVERLAP_SECONDS = 1.5;
const TAIL_COVERAGE_MIN_CHUNK_SECONDS = 30;
const TAIL_COVERAGE_MIN_GAP_SECONDS = 6;
const TAIL_COVERAGE_MAX_GAP_RATIO = 0.18;
const TIMESTAMP_COLLAPSE_SECONDS = 29.98;
const TIMESTAMP_COLLAPSE_EPSILON = 0.18;
const TIMESTAMP_OVERRUN_EPSILON = 0.35;
const BAD_OVERLAP_EPSILON = 0.6;
const SAFE_NO_REPEAT_NGRAM_SIZE = 3;
const SAFE_REPETITION_PENALTY = 1.02;
const KNOWN_SILENCE_HALLUCINATION_PATTERNS = [
  /^\(?music\)?$/i,
  /^\[music\]$/i,
  /^thank you(?: very much)?(?: for watching)?[.!?]*$/i,
  /^thanks(?: very much)?(?: for watching)?[.!?]*$/i,
  /^subtitles by\b/i,
  /^bye[.!?]*$/i
];
const KNOWN_TRANSCRIPTION_ARTIFACT_PATTERNS = [
  /^subscribe\b/i,
  /^subscribe to (?:the )?channel[.!?]*$/i,
  /^Ø§Ø´ØªØ±Ùƒ(?:ÙˆØ§)?(?: ÙÙŠ)?(?: Ø§Ù„)?Ù‚Ù†Ø§Ø©[.!ØŸ?]*$/i,
  /^Ù„Ø§ ØªÙ†Ø³(?:ÙˆØ§)? Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ(?: ÙÙŠ Ø§Ù„Ù‚Ù†Ø§Ø©)?[.!ØŸ?]*$/i
];
const TRANSCRIPTION_MODELS = {
  "baby-raptor": {
    key: "baby-raptor",
    label: "Baby Raptor",
    modelId: "onnx-community/whisper-base_timestamped"
  },
  triceratop: {
    key: "triceratop",
    label: "Triceratops",
    modelId: "onnx-community/whisper-small_timestamped"
  },
  "t-rex": {
    key: "t-rex",
    label: "T-Rex",
    modelId: "onnx-community/whisper-large-v3-turbo_timestamped"
  }
};

const ARABIC_TRANSCRIPTION_PROMPT_TEXT = "\u0642\u0645 \u0628\u062a\u0641\u0631\u064a\u063a \u0627\u0644\u0646\u0635 \u0628\u062f\u0642\u0629 \u0645\u062b\u0644 \u0645\u0627 \u064a\u0646\u0642\u0627\u0644\u060c \u0628\u062f\u0648\u0646 \u062a\u0631\u062c\u0645\u0629 \u0623\u0648 \u062a\u0644\u062e\u064a\u0635\u060c \u0645\u0639 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0639\u0644\u0627\u0645\u0627\u062a \u0627\u0644\u062a\u0631\u0642\u064a\u0645 \u0639\u0646\u062f \u0627\u0644\u062d\u0627\u062c\u0629. \u0627\u0643\u062a\u0628 \u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a \u0643\u0645\u0627 \u0647\u0648\u060c \u0648\u0625\u0630\u0627 \u0641\u064a\u0647 \u0645\u0648\u0633\u064a\u0642\u0649 \u0627\u0643\u062a\u0628: (\u0645\u0648\u0633\u064a\u0642\u0649)";

function shouldSuppressOnnxRuntimeNoise(args) {
  const text = args.map((value) => {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Error) {
      return value.message || String(value);
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }).join(" ");

  return ONNX_RUNTIME_NOISE_PATTERNS.some((pattern) => text.includes(pattern));
}

function shouldSuppressTranscriptionConsoleNoise(args) {
  const text = args.map((value) => {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Error) {
      return value.message || String(value);
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }).join(" ");

  if (shouldSuppressOnnxRuntimeNoise(args)) {
    return true;
  }

  if (!DEBUG_TRANSCRIPTION) {
    if (text.includes("[transcribe-worker]")) {
      return true;
    }

    return NON_CRITICAL_TRANSCRIPTION_NOISE_PATTERNS.some((pattern) => text.includes(pattern));
  }

  return false;
}

function filterConsoleMethod(methodName) {
  if (typeof console === "undefined" || typeof console[methodName] !== "function") {
    return;
  }

  const originalMethod = console[methodName].bind(console);
  console[methodName] = (...args) => {
    if (shouldSuppressTranscriptionConsoleNoise(args)) {
      return;
    }
    originalMethod(...args);
  };
}

filterConsoleMethod("info");
filterConsoleMethod("warn");
filterConsoleMethod("error");

function isSafariLikeBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = String(navigator.userAgent || "");
  const vendor = String(navigator.vendor || "");

  return /Safari/i.test(userAgent)
    && /Apple/i.test(vendor)
    && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/i.test(userAgent);
}

function isMobileSafariLikeBrowser() {
  if (!isSafariLikeBrowser()) {
    return false;
  }

  const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  const coarsePointer = typeof self !== "undefined"
    && self.matchMedia
    && self.matchMedia("(pointer: coarse)").matches;

  return /iPhone|iPad|iPod/i.test(userAgent) || !!coarsePointer;
}

function getNormalizedLanguageCode(language) {
  const value = String(language || "").trim().toLowerCase();
  if (!value || value === "auto" || value === "detect" || value === "auto-detect") {
    return "";
  }
  return value.split("-")[0].split("_")[0];
}

function shouldUseArabicPrompt(language) {
  const normalized = getNormalizedLanguageCode(language);
  return normalized === "ar" || normalized === "ara";
}

function getSafeWasmThreadCount(safariLike = isSafariLikeBrowser()) {
  if (safariLike) {
    return 1;
  }

  const crossOriginIsolated = typeof self !== "undefined" && self.crossOriginIsolated === true;
  if (!crossOriginIsolated) {
    return 1;
  }

  const hardwareConcurrency = typeof navigator !== "undefined"
    ? Number(navigator.hardwareConcurrency)
    : NaN;
  return Math.max(
    1,
    Math.min(4, Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 2)
  );
}

function hasBrowserCacheSupport() {
  try {
    if (typeof caches === "undefined" || !caches || typeof caches.open !== "function") {
      return false;
    }

    const locationHost = typeof self !== "undefined" && self.location
      ? String(self.location.hostname || "").toLowerCase()
      : "";
    const isLocalhostLike = locationHost === "localhost"
      || locationHost === "127.0.0.1"
      || locationHost === "::1";
    const secureContextKnown = typeof self !== "undefined" && "isSecureContext" in self;

    if (secureContextKnown && !self.isSecureContext && !isLocalhostLike) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

async function getLegacyTransformersRuntime() {
  if (!legacyTransformersRuntimePromise) {
    legacyTransformersRuntimePromise = import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.1");
  }

  return legacyTransformersRuntimePromise;
}

async function getModernTransformersRuntime() {
  if (!modernTransformersRuntimePromise) {
    modernTransformersRuntimePromise = import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.6.1");
  }

  const modernRuntime = await modernTransformersRuntimePromise;
  configureTransformersEnvironment(modernRuntime.env, isSafariLikeBrowser());
  return modernRuntime;
}

function configureTransformersEnvironment(runtimeEnv, safariLike = isSafariLikeBrowser()) {
  const threadCount = getSafeWasmThreadCount(safariLike);

  runtimeEnv.allowLocalModels = false;

  if (runtimeEnv.backends && runtimeEnv.backends.onnx) {
    if ("logLevel" in runtimeEnv.backends.onnx) {
      runtimeEnv.backends.onnx.logLevel = "error";
    }
    if (runtimeEnv.backends.onnx.env && "logLevel" in runtimeEnv.backends.onnx.env) {
      runtimeEnv.backends.onnx.env.logLevel = "error";
    }
  }

  if ("useBrowserCache" in runtimeEnv) {
    runtimeEnv.useBrowserCache = !safariLike && hasBrowserCacheSupport();
  }
  if ("useWasmCache" in runtimeEnv) {
    runtimeEnv.useWasmCache = !safariLike;
  }

  if (runtimeEnv.backends && runtimeEnv.backends.onnx && runtimeEnv.backends.onnx.wasm) {
    runtimeEnv.backends.onnx.wasm.numThreads = threadCount;
    runtimeEnv.backends.onnx.wasm.proxy = false;
  }
}

async function getTranscriptionRuntime(modelKey) {
  if (isMobileSafariLikeBrowser() && modelKey === "baby-raptor") {
    const legacyRuntime = await getLegacyTransformersRuntime();
    configureTransformersEnvironment(legacyRuntime.env, true);
    return {
      pipeline: legacyRuntime.pipeline,
      WhisperTextStreamer: legacyRuntime.WhisperTextStreamer,
      legacy: true
    };
  }

  const modernRuntime = await getModernTransformersRuntime();
  return {
    pipeline: modernRuntime.pipeline,
    WhisperTextStreamer: modernRuntime.WhisperTextStreamer,
    legacy: false
  };
}

function getTranscriptionModelConfig(modelKey) {
  return TRANSCRIPTION_MODELS[modelKey] || TRANSCRIPTION_MODELS[DEFAULT_TRANSCRIPTION_MODEL_KEY];
}

function getRuntimeTranscriptionModelId(modelKey, useLegacyRuntime) {
  if (useLegacyRuntime) {
    if (modelKey === "baby-raptor") {
      return "Xenova/whisper-base";
    }
    if (modelKey === "triceratop") {
      return "Xenova/whisper-small";
    }
    return "Xenova/whisper-large-v3-turbo";
  }

  return getTranscriptionModelConfig(modelKey).modelId;
}

function hasWebGPU() {
  return !!(typeof navigator !== "undefined" && navigator.gpu);
}

function getErrorText(error) {
  if (!error) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error.message || error.stack || error);
}

function createTranscriptionDiagnostics(modelKey) {
  return {
    modelKey: modelKey || DEFAULT_TRANSCRIPTION_MODEL_KEY,
    backendRequested: "",
    backendConfirmed: "",
    fallbackOccurred: false,
    fallbackReason: "",
    loadState: "",
    modelLoadMs: 0,
    lastWorkerCallMs: 0,
    retryCount: 0,
    retryFailureCount: 0,
    chunkCount: 0,
    usedVad: false,
    legacyRuntime: false,
    chunkingMode: "",
    chunkLengthSec: 0,
    strideLengthSec: 0,
    coveragePercent: 0,
    decodeAsrUsed: false,
    progressivePath: "",
    windowFinalizeCount: 0,
    firstWindowFinalizeMs: 0,
    lastWindowFinalizeMs: 0,
    avgWindowFinalizeMs: 0,
    slowestWindowFinalizeMs: 0,
    firstWindowFinalizeAvgMs: 0,
    lastWindowFinalizeAvgMs: 0,
    windowFinalizeSlowdownRatio: 0,
    windowFinalizeEvents: [],
    _transcriptionStartedAt: 0,
    _lastWindowFinalizedAt: 0
  };
}

function getActiveTranscriptionDiagnostics(modelKey) {
  if (!activeTranscriptionDiagnostics) {
    activeTranscriptionDiagnostics = createTranscriptionDiagnostics(modelKey);
  }
  if (modelKey) {
    activeTranscriptionDiagnostics.modelKey = modelKey;
  }
  return activeTranscriptionDiagnostics;
}

function getDiagnosticsSnapshot(diagnostics) {
  const source = diagnostics || activeTranscriptionDiagnostics;
  if (!source) {
    return null;
  }

  return {
    modelKey: source.modelKey || "",
    backendRequested: source.backendRequested || "",
    backendConfirmed: source.backendConfirmed || "",
    fallbackOccurred: !!source.fallbackOccurred,
    fallbackReason: source.fallbackReason || "",
    loadState: source.loadState || "",
    modelLoadMs: Math.max(0, Math.round(Number(source.modelLoadMs) || 0)),
    lastWorkerCallMs: Math.max(0, Math.round(Number(source.lastWorkerCallMs || source.transcriptionMs) || 0)),
    retryCount: Math.max(0, Math.round(Number(source.retryCount) || 0)),
    retryFailureCount: Math.max(0, Math.round(Number(source.retryFailureCount) || 0)),
    chunkCount: Math.max(0, Math.round(Number(source.chunkCount) || 0)),
    usedVad: !!source.usedVad,
    legacyRuntime: !!source.legacyRuntime,
    chunkingMode: source.chunkingMode || "",
    chunkLengthSec: Math.max(0, Number(source.chunkLengthSec) || 0),
    strideLengthSec: Math.max(0, Number(source.strideLengthSec) || 0),
    coveragePercent: Math.max(0, Math.min(100, Number(source.coveragePercent) || 0)),
    decodeAsrUsed: !!source.decodeAsrUsed,
    progressivePath: source.progressivePath || "",
    windowFinalizeCount: Math.max(0, Math.round(Number(source.windowFinalizeCount) || 0)),
    firstWindowFinalizeMs: Math.max(0, Math.round(Number(source.firstWindowFinalizeMs) || 0)),
    lastWindowFinalizeMs: Math.max(0, Math.round(Number(source.lastWindowFinalizeMs) || 0)),
    avgWindowFinalizeMs: Math.max(0, Math.round(Number(source.avgWindowFinalizeMs) || 0)),
    slowestWindowFinalizeMs: Math.max(0, Math.round(Number(source.slowestWindowFinalizeMs) || 0)),
    firstWindowFinalizeAvgMs: Math.max(0, Math.round(Number(source.firstWindowFinalizeAvgMs) || 0)),
    lastWindowFinalizeAvgMs: Math.max(0, Math.round(Number(source.lastWindowFinalizeAvgMs) || 0)),
    windowFinalizeSlowdownRatio: Number.isFinite(Number(source.windowFinalizeSlowdownRatio))
      ? Math.max(0, Number(source.windowFinalizeSlowdownRatio))
      : 0,
    windowFinalizeEvents: Array.isArray(source.windowFinalizeEvents)
      ? source.windowFinalizeEvents.map((item) => ({
          index: Math.max(0, Math.round(Number(item && item.index) || 0)),
          sinceStartMs: Math.max(0, Math.round(Number(item && item.sinceStartMs) || 0)),
          sincePreviousMs: Math.max(0, Math.round(Number(item && item.sincePreviousMs) || 0)),
          textLength: Math.max(0, Math.round(Number(item && item.textLength) || 0))
        }))
      : []
  };
}

function recordWindowFinalizeTiming(diagnostics, chunkIndex, textLength) {
  if (!diagnostics) {
    return;
  }

  const now = Date.now();
  if (!diagnostics._transcriptionStartedAt) {
    diagnostics._transcriptionStartedAt = now;
  }

  const sinceStartMs = Math.max(0, now - diagnostics._transcriptionStartedAt);
  const sincePreviousMs = diagnostics._lastWindowFinalizedAt
    ? Math.max(0, now - diagnostics._lastWindowFinalizedAt)
    : sinceStartMs;

  diagnostics._lastWindowFinalizedAt = now;
  if (!Array.isArray(diagnostics.windowFinalizeEvents)) {
    diagnostics.windowFinalizeEvents = [];
  }

  diagnostics.windowFinalizeEvents.push({
    index: Math.max(0, Number(chunkIndex) || 0),
    sinceStartMs,
    sincePreviousMs,
    textLength: Math.max(0, Number(textLength) || 0)
  });

  const events = diagnostics.windowFinalizeEvents;
  diagnostics.windowFinalizeCount = events.length;
  diagnostics.firstWindowFinalizeMs = events.length ? events[0].sincePreviousMs : 0;
  diagnostics.lastWindowFinalizeMs = events.length ? events[events.length - 1].sincePreviousMs : 0;
  diagnostics.slowestWindowFinalizeMs = events.reduce((max, item) => Math.max(max, item.sincePreviousMs || 0), 0);
  diagnostics.avgWindowFinalizeMs = events.length
    ? events.reduce((sum, item) => sum + (item.sincePreviousMs || 0), 0) / events.length
    : 0;

  const firstSlice = events.slice(0, Math.min(3, events.length));
  const lastSlice = events.slice(Math.max(0, events.length - 3));
  const firstAvg = firstSlice.length
    ? firstSlice.reduce((sum, item) => sum + (item.sincePreviousMs || 0), 0) / firstSlice.length
    : 0;
  const lastAvg = lastSlice.length
    ? lastSlice.reduce((sum, item) => sum + (item.sincePreviousMs || 0), 0) / lastSlice.length
    : 0;

  diagnostics.firstWindowFinalizeAvgMs = firstAvg;
  diagnostics.lastWindowFinalizeAvgMs = lastAvg;
  diagnostics.windowFinalizeSlowdownRatio = firstAvg > 0 ? (lastAvg / firstAvg) : 0;
}

function emitBackendStatus(diagnostics) {
  const snapshot = getDiagnosticsSnapshot(diagnostics);
  if (!snapshot) {
    return;
  }

  emitWorkerMessage({
    type: "backend_status",
    modelKey: snapshot.modelKey,
    diagnostics: snapshot
  });
}

function emitWorkerMessage(payload, transfer) {
  const message = payload && typeof payload === "object"
    ? { ...payload }
    : payload;
  if (message && typeof message === "object" && activeWorkerSessionId) {
    message.sessionId = activeWorkerSessionId;
  }
  if (message && typeof message === "object" && activeWorkerAttemptId) {
    message.attemptId = activeWorkerAttemptId;
  }
  if (Array.isArray(transfer) && transfer.length) {
    postMessage(message, transfer);
    return;
  }
  postMessage(message);
}

function classifyTranscriptionModelLoadFailure(error, modelKey) {
  if (getTranscriptionModelConfig(modelKey).key !== "t-rex" || !hasWebGPU()) {
    return null;
  }

  const text = getErrorText(error);
  const matchesWeakWebGpu = WEAK_WEBGPU_TREX_PATTERNS.some((pattern) => text.includes(pattern));

  if (!matchesWeakWebGpu) {
    return null;
  }

  return {
    errorCode: "WEBGPU_TREX_UNSUPPORTED",
    failedModelKey: "t-rex",
    fallbackModelKey: "triceratop",
    userMessage: "T-Rex could not start its WebGPU backend on this device. Switching to Triceratops for a safer local run. If needed, try Baby Raptor next."
  };
}

function classifyTranscriptionRuntimeFailure(error, modelKey) {
  if (getTranscriptionModelConfig(modelKey).key !== "t-rex") {
    return null;
  }

  const text = getErrorText(error).toLowerCase();
  const matchesUnstableRuntime = UNSTABLE_TREX_RUNTIME_PATTERNS.some((pattern) => text.includes(pattern));

  if (!matchesUnstableRuntime) {
    return null;
  }

  return {
    errorCode: "TREX_RUNTIME_UNSTABLE",
    failedModelKey: "t-rex",
    fallbackModelKey: "triceratop",
    userMessage: "T-Rex became unstable on this device during transcription. Switching to Triceratops for a safer local run."
  };
}

function isSmallerTimestampedWhisper(modelKey) {
  const resolvedModel = getTranscriptionModelConfig(modelKey);
  return resolvedModel.key === "baby-raptor" || resolvedModel.key === "triceratop";
}

function getDefaultTranscriptionOptions(modelKey, useLegacyRuntime = false) {
  const useConservativeLegacyDefaults = useLegacyRuntime && modelKey === "baby-raptor";
  if (useConservativeLegacyDefaults) {
    return {
      chunk_length_s: PHONE_CHUNK_LENGTH_SECONDS,
      stride_length_s: PHONE_STRIDE_LENGTH_SECONDS,
      return_timestamps: true,
      force_full_sequences: false,
      top_k: 0,
      do_sample: false,
      task: "transcribe"
    };
  }

  const resolvedModelKey = getTranscriptionModelConfig(modelKey).key;
  const useSmallerTimestampedDesktopDefaults = isSmallerTimestampedWhisper(modelKey);
  const useBabyRaptorStockDesktopDefaults = resolvedModelKey === "baby-raptor";
  const useTrexCodeSwitchingTuning = resolvedModelKey === "t-rex";
  if (useBabyRaptorStockDesktopDefaults) {
    return {
      chunk_length_s: 29,
      stride_length_s: DESKTOP_STRIDE_LENGTH_SECONDS,
      return_timestamps: true,
      force_full_sequences: false,
      top_k: 0,
      do_sample: false,
      task: "transcribe"
    };
  }

  return {
    chunk_length_s: useTrexCodeSwitchingTuning ? 29 : DEFAULT_CHUNK_LENGTH_SECONDS,
    stride_length_s: useTrexCodeSwitchingTuning ? 5 : DESKTOP_STRIDE_LENGTH_SECONDS,
    return_timestamps: true,
    force_full_sequences: false,
    top_k: 0,
    do_sample: false,
    task: "transcribe",
    temperature: useSmallerTimestampedDesktopDefaults
      ? [0, 0.2, 0.4, 0.6, 0.8, 1.0]
      : 0.2,
    compression_ratio_threshold: useSmallerTimestampedDesktopDefaults ? 1.35 : 2.0,
    logprob_threshold: -1.0,
    ...(useTrexCodeSwitchingTuning ? { no_speech_threshold: 0.4 } : {}),
    ...(useTrexCodeSwitchingTuning ? { condition_on_prev_tokens: true } : {})
  };
}

function applyTranscriptionOptionOverrides(baseOptions, overrides) {
  if (!baseOptions || !overrides || typeof overrides !== "object") {
    return baseOptions;
  }

  const allowedKeys = [
    "chunk_length_s",
    "stride_length_s",
    "return_timestamps",
    "force_full_sequences",
    "top_k",
    "do_sample",
    "task",
    "temperature",
    "compression_ratio_threshold",
    "logprob_threshold",
    "no_speech_threshold",
    "condition_on_prev_tokens",
    "no_repeat_ngram_size",
    "repetition_penalty",
    "language",
    "prompt_ids"
  ];
  const nextOptions = {
    ...baseOptions
  };

  allowedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      if (overrides[key] == null) {
        delete nextOptions[key];
      } else {
        nextOptions[key] = overrides[key];
      }
    }
  });

  return nextOptions;
}

function getPreferredWhisperLoadConfig(modelKey) {
  const resolvedModel = getTranscriptionModelConfig(modelKey);
  if (hasWebGPU()) {
    if (resolvedModel.key === "t-rex") {
      return {
        device: "webgpu",
        dtype: {
          encoder_model: "q4f16",
          decoder_model_merged: "q4f16"
        },
        use_external_data_format: false
      };
    }

    if (isSmallerTimestampedWhisper(resolvedModel.key)) {
      return {
        device: "webgpu",
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "q4"
        },
        use_external_data_format: false
      };
    }

    return {
      device: "webgpu",
      dtype: "fp16",
      use_external_data_format: false
    };
  }

  if (isSmallerTimestampedWhisper(resolvedModel.key)) {
    return {
      device: "wasm",
      dtype: "q8",
      use_external_data_format: false
    };
  }

  return {
    device: "wasm",
    dtype: "int8",
    use_external_data_format: false
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function getMonitorProgressPercent(progressState) {
  if (Array.isArray(progressState) || ArrayBuffer.isView(progressState)) {
    const current = Number(progressState[0]);
    const total = Number(progressState[1]);
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      return clampPercent((current / total) * 100);
    }
  } else if (progressState && typeof progressState === "object") {
    const current = Number(progressState.current ?? progressState.loaded ?? progressState.value ?? progressState[0]);
    const total = Number(progressState.total ?? progressState.max ?? progressState[1]);
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      return clampPercent((current / total) * 100);
    }
  }

  return null;
}

function createModelProgressTracker(modelKey) {
  const fileProgress = new Map();
  let lastPercent = -1;
  let sawNetworkProgress = false;

  return {
    sawNetworkProgress() {
      return sawNetworkProgress;
    },
    update(info) {
      if (!info || typeof info !== "object") {
        return;
      }

      if (typeof info.progress === "number" && info.status === "progress_total") {
        sawNetworkProgress = true;
        const percent = clampPercent(info.progress);
        if (percent !== lastPercent) {
          lastPercent = percent;
          emitWorkerMessage({ type: "model_download_progress", modelKey, progress: percent });
        }
        return;
      }

      if (info.status === "progress" || info.status === "done") {
        const fileKey = info.file || info.name || "model";
        const currentEntry = fileProgress.get(fileKey) || {};
        let nextProgress = typeof info.progress === "number" ? info.progress : currentEntry.progress;
        let nextLoaded = typeof info.loaded === "number" ? info.loaded : currentEntry.loaded;
        let nextTotal = typeof info.total === "number" ? info.total : currentEntry.total;

        if (nextProgress == null && Number.isFinite(nextLoaded) && Number.isFinite(nextTotal) && nextTotal > 0) {
          nextProgress = (nextLoaded / nextTotal) * 100;
        }

        if (info.status === "done") {
          nextProgress = 100;
          if (!Number.isFinite(nextLoaded)) {
            nextLoaded = 1;
          }
          if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
            nextTotal = nextLoaded;
          } else {
            nextLoaded = nextTotal;
          }
        }

        if (nextProgress == null && !Number.isFinite(nextLoaded) && !Number.isFinite(nextTotal)) {
          return;
        }

        sawNetworkProgress = true;
        fileProgress.set(fileKey, {
          progress: clampPercent(nextProgress == null ? 0 : nextProgress),
          loaded: Number.isFinite(nextLoaded) ? nextLoaded : null,
          total: Number.isFinite(nextTotal) ? nextTotal : null
        });

        const values = Array.from(fileProgress.values());
        if (!values.length) {
          return;
        }

        const weightedEntries = values.filter((entry) => Number.isFinite(entry.loaded) && Number.isFinite(entry.total) && entry.total > 0);
        let percent;

        if (weightedEntries.length) {
          const loadedSum = weightedEntries.reduce((sum, entry) => sum + entry.loaded, 0);
          const totalSum = weightedEntries.reduce((sum, entry) => sum + entry.total, 0);
          percent = clampPercent((loadedSum / totalSum) * 100);
        } else {
          const averageProgress = values.reduce((sum, entry) => sum + entry.progress, 0) / values.length;
          percent = clampPercent(averageProgress);
        }

        if (percent !== lastPercent) {
          lastPercent = percent;
          emitWorkerMessage({ type: "model_download_progress", modelKey, progress: percent });
        }
      }
    }
  };
}

async function loadTranscriptionModel(modelKey) {
  const modelConfig = getTranscriptionModelConfig(modelKey);
  const diagnostics = getActiveTranscriptionDiagnostics(modelConfig.key);
  const runtime = await getTranscriptionRuntime(modelConfig.key);
  const runtimeModelId = getRuntimeTranscriptionModelId(modelConfig.key, runtime.legacy);
  const loadStart = Date.now();

  if (transcriber && activeTranscriptionModelKey === modelConfig.key) {
    diagnostics.backendRequested = diagnostics.backendRequested || (hasWebGPU() ? "webgpu" : "wasm");
    diagnostics.backendConfirmed = diagnostics.backendConfirmed || diagnostics.backendRequested;
    diagnostics.loadState = "memory";
    diagnostics.legacyRuntime = !!runtime.legacy;
    return {
      model: transcriber,
      modelKey: modelConfig.key,
      loadState: "memory",
      legacy: runtime.legacy,
      runtime
    };
  }

  if (isLoading) {
    while (isLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (transcriber && activeTranscriptionModelKey === modelConfig.key) {
      diagnostics.backendRequested = diagnostics.backendRequested || (hasWebGPU() ? "webgpu" : "wasm");
      diagnostics.backendConfirmed = diagnostics.backendConfirmed || diagnostics.backendRequested;
      diagnostics.loadState = "memory";
      diagnostics.legacyRuntime = !!runtime.legacy;
      return {
        model: transcriber,
        modelKey: modelConfig.key,
        loadState: "memory",
        legacy: runtime.legacy,
        runtime
      };
    }
  }

  isLoading = true;
  let tracker = null;

  try {
    if (transcriber && activeTranscriptionModelKey !== modelConfig.key) {
      await disposePipelineInstance(transcriber);
      transcriber = null;
      activeTranscriptionModelKey = null;
    }

    const config = getPreferredWhisperLoadConfig(modelConfig.key);
    diagnostics.backendRequested = runtime.legacy
      ? "legacy"
      : (config && config.device ? config.device : "wasm");
    diagnostics.legacyRuntime = !!runtime.legacy;
    tracker = createModelProgressTracker(modelConfig.key);
    const loadOptions = runtime.legacy
      ? {
          quantized: true,
          progress_callback: (info) => {
            tracker.update(info);
          }
        }
      : {
          ...config,
          progress_callback: (info) => {
            tracker.update(info);
          }
        };

    emitWorkerMessage({ type: "model_loading", modelKey: modelConfig.key });

    try {
      transcriber = await runtime.pipeline(
        "automatic-speech-recognition",
        runtimeModelId,
        loadOptions
      );
      diagnostics.backendConfirmed = diagnostics.backendRequested || (runtime.legacy ? "legacy" : "");
    } catch (primaryError) {
      if (runtime.legacy || !hasWebGPU() || modelConfig.key === "t-rex") {
        throw primaryError;
      }

      diagnostics.fallbackOccurred = true;
      diagnostics.fallbackReason = getErrorText(primaryError);
      transcriber = await runtime.pipeline(
        "automatic-speech-recognition",
        runtimeModelId,
        {
          device: "wasm",
          dtype: "int8",
          use_external_data_format: modelConfig.key === "t-rex",
          progress_callback: (info) => {
            tracker.update(info);
          }
        }
      );
      diagnostics.backendConfirmed = "wasm";
    }
  } catch (err) {
    const failureMeta = classifyTranscriptionModelLoadFailure(err, modelConfig.key);
    transcriber = null;
    activeTranscriptionModelKey = null;
    diagnostics.modelLoadMs = Date.now() - loadStart;
    emitWorkerMessage({
      type: "model_error",
      modelKey: modelConfig.key,
      message: failureMeta ? failureMeta.userMessage : (err && err.message ? err.message : "Model load failed"),
      errorCode: failureMeta ? failureMeta.errorCode : "",
      failedModelKey: failureMeta ? failureMeta.failedModelKey : modelConfig.key,
      fallbackModelKey: failureMeta ? failureMeta.fallbackModelKey : ""
    });
    emitBackendStatus(diagnostics);
    if (failureMeta) {
      err.errorCode = failureMeta.errorCode;
      err.failedModelKey = failureMeta.failedModelKey;
      err.fallbackModelKey = failureMeta.fallbackModelKey;
      err.message = failureMeta.userMessage;
    }
    throw err;
  } finally {
    isLoading = false;
  }

  activeTranscriptionModelKey = modelConfig.key;
  diagnostics.modelLoadMs = Date.now() - loadStart;
  diagnostics.loadState = tracker && tracker.sawNetworkProgress() ? "downloaded" : "cached";
  diagnostics.backendConfirmed = diagnostics.backendConfirmed || diagnostics.backendRequested || (runtime.legacy ? "legacy" : "");
  if (!whisperRuntimeInspectionLogged.has(modelConfig.key)) {
    whisperRuntimeInspectionLogged.add(modelConfig.key);
    logArabicPromptStatus({
      inspectionType: "runtime_capabilities",
      ...inspectWhisperPromptCapabilities(transcriber, runtime, modelConfig.key)
    });
  }
  emitBackendStatus(diagnostics);
  return {
    model: transcriber,
    modelKey: modelConfig.key,
    loadState: diagnostics.loadState,
    legacy: runtime.legacy,
    runtime
  };
}

async function disposePipelineInstance(instance) {
  if (!instance || typeof instance.dispose !== "function") {
    return;
  }

  await instance.dispose();
}

async function unloadModels() {
  await disposePipelineInstance(transcriber);
  transcriber = null;
  activeTranscriptionModelKey = null;
}

async function buildPromptIds(source, promptText) {
  if (!source) {
    return null;
  }

  if (typeof source.get_prompt_ids === "function") {
    return await source.get_prompt_ids(promptText);
  }

  return null;
}

function getPromptSourceLabel(source, model) {
  if (!source) {
    return "unknown";
  }

  if (model && source === model.processor) {
    return "model.processor";
  }

  if (model && source === model.tokenizer) {
    return "model.tokenizer";
  }

  if (model && model.processor && source === model.processor.tokenizer) {
    return "model.processor.tokenizer";
  }

  return "unknown";
}

function getArabicPromptRuntimeInspection(model) {
  return {
    hasProcessor: !!(model && model.processor),
    hasTokenizer: !!(model && model.tokenizer),
    hasProcessorTokenizer: !!(model && model.processor && model.processor.tokenizer),
    processorHasGetPromptIds: !!(model && model.processor && typeof model.processor.get_prompt_ids === "function"),
    tokenizerHasGetPromptIds: !!(model && model.tokenizer && typeof model.tokenizer.get_prompt_ids === "function"),
    processorTokenizerHasGetPromptIds: !!(model && model.processor && model.processor.tokenizer && typeof model.processor.tokenizer.get_prompt_ids === "function")
  };
}

async function getArabicPromptIds(model, modelKey) {
  const cacheKey = modelKey || activeTranscriptionModelKey || DEFAULT_TRANSCRIPTION_MODEL_KEY;
  if (arabicPromptIdsByModel.has(cacheKey)) {
    const cachedPromptIds = arabicPromptIdsByModel.get(cacheKey);
    logArabicPromptStatus({
      modelKey: cacheKey,
      cacheHit: true,
      promptIdsBuilt: !!(cachedPromptIds && cachedPromptIds.length),
      promptIdsCount: Array.isArray(cachedPromptIds) ? cachedPromptIds.length : 0
    });
    return arabicPromptIdsByModel.get(cacheKey);
  }

  logArabicPromptStatus({
    modelKey: cacheKey,
    inspection: getArabicPromptRuntimeInspection(model)
  });

  const promptSources = [
    model && model.processor,
    model && model.tokenizer,
    model && model.processor && model.processor.tokenizer
  ].filter(Boolean);

  for (const source of promptSources) {
    const sourceLabel = getPromptSourceLabel(source, model);
    try {
      logArabicPromptStatus({
        modelKey: cacheKey,
        source: sourceLabel,
        attemptingGetPromptIds: typeof source.get_prompt_ids === "function"
      });
      const promptIds = await buildPromptIds(source, ARABIC_TRANSCRIPTION_PROMPT_TEXT);
      if (promptIds) {
        arabicPromptIdsByModel.set(cacheKey, promptIds);
        logArabicPromptStatus({
          modelKey: cacheKey,
          source: sourceLabel,
          promptIdsBuilt: true,
          promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0
        });
        return promptIds;
      }
    } catch (err) {
      logArabicPromptStatus({
        modelKey: cacheKey,
        source: sourceLabel,
        promptIdsBuilt: false,
        error: getErrorText(err)
      });
    }
  }

  logArabicPromptStatus({
    modelKey: cacheKey,
    promptIdsBuilt: false,
    reason: "no_prompt_source_succeeded"
  });

  return null;
}

function createTranscriptionAttemptOptions(baseOptions, progressHandler, overrides) {
  return {
    ...baseOptions,
    ...(overrides || {}),
    monitor_progress: progressHandler
  };
}

function pushUnique(target, value) {
  if (!value || !Array.isArray(target) || target.includes(value)) {
    return;
  }

  target.push(value);
}

function logWorkerEvent(eventName, payload) {
  if (!DEBUG_TRANSCRIPTION) {
    return;
  }
  try {
    console.info("[transcribe-worker]", eventName, payload);
  } catch (error) {
  }
}

function logWhisperRawChunk(payload) {
  if (!DEBUG_WHISPER_RAW) {
    return;
  }

  try {
    console.log("[whisper-raw-chunk]", payload);
  } catch (error) {
  }
}

function logArabicPromptStatus(payload) {
  if (!DEBUG_ARABIC_PROMPT) {
    return;
  }
  try {
    postMessage({
      type: "arabic_prompt_debug",
      payload: payload
    });
    console.info("[arabic-prompt]", payload);
  } catch (error) {
    // Ignore logging failures.
  }
}

function inspectWhisperPromptCapabilities(model, runtime, modelKey) {
  const pipelineModel = model && model.model;
  const tokenizer = model && model.tokenizer;
  const processorTokenizer = model && model.processor && model.processor.tokenizer;
  return {
    modelKey: modelKey || "",
    runtimeLegacy: !!(runtime && runtime.legacy),
    pipelineType: model && model.constructor ? model.constructor.name : "",
    modelType: pipelineModel && pipelineModel.constructor ? pipelineModel.constructor.name : "",
    hasPipelineGenerate: !!(model && typeof model.generate === "function"),
    hasPipelineCall: !!(model && typeof model._call === "function"),
    hasPipelineForward: !!(model && typeof model.forward === "function"),
    hasUnderlyingModel: !!pipelineModel,
    hasUnderlyingGenerate: !!(pipelineModel && typeof pipelineModel.generate === "function"),
    hasUnderlyingForward: !!(pipelineModel && typeof pipelineModel.forward === "function"),
    hasProcessor: !!(model && model.processor),
    hasTokenizer: !!(model && model.tokenizer),
    hasProcessorTokenizer: !!processorTokenizer,
    processorHasGetPromptIds: !!(model && model.processor && typeof model.processor.get_prompt_ids === "function"),
    tokenizerHasGetPromptIds: !!(tokenizer && typeof tokenizer.get_prompt_ids === "function"),
    processorTokenizerHasGetPromptIds: !!(processorTokenizer && typeof processorTokenizer.get_prompt_ids === "function"),
    tokenizerHasEncode: !!(tokenizer && typeof tokenizer.encode === "function"),
    tokenizerHasCall: !!(tokenizer && typeof tokenizer._call === "function"),
    tokenizerHasApplyChatTemplate: !!(tokenizer && typeof tokenizer.apply_chat_template === "function"),
    processorTokenizerHasEncode: !!(processorTokenizer && typeof processorTokenizer.encode === "function"),
    processorTokenizerHasCall: !!(processorTokenizer && typeof processorTokenizer._call === "function")
  };
}

function logChunkingMode(payload) {
  if (!DEBUG_TRANSCRIPTION) {
    return;
  }

  try {
    console.info("[chunking-mode]", payload);
  } catch (error) {
  }
}

function logOfficialStyleProgressiveUpdate(payload) {
  if (!DEBUG_WHISPER_RAW) {
    return;
  }

  try {
    console.info("[official-style-progressive-update]", payload);
  } catch (error) {
  }
}

function logOfficialWindowChunk(payload) {
  if (!DEBUG_WHISPER_RAW) {
    return;
  }

  try {
    console.log("[whisper-window-chunk]", payload);
  } catch (error) {
  }
}

function logWhisperFinalCompare(payload) {
  if (!DEBUG_WHISPER_RAW) {
    return;
  }

  try {
    console.log("[whisper-final-compare]", payload);
  } catch (error) {
  }
}

function joinWindowChunkTexts(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return "";
  }

  return chunks
    .map((chunk) => typeof chunk === "string" ? chunk.trim() : "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeWindowChunkTexts(chunks) {
  const safeChunks = Array.isArray(chunks) ? chunks.filter((chunk) => typeof chunk === "string" && chunk.trim()) : [];
  return {
    text: joinWindowChunkTexts(safeChunks),
    chunkCount: safeChunks.length
  };
}

function getGenerationConfigHints(model) {
  const hints = [];
  const sources = [
    model && model.generation_config,
    model && model.model && model.model.generation_config,
    model && model.model && model.model.config,
    model && model.config
  ];

  sources.forEach((source) => {
    if (!source || typeof source !== "object") {
      return;
    }

    if ("no_repeat_ngram_size" in source) {
      pushUnique(hints, "no_repeat_ngram_size");
    }
    if ("repetition_penalty" in source) {
      pushUnique(hints, "repetition_penalty");
    }
  });

  return hints;
}

function createGenerationControlState(model, modelKey, useLegacyRuntime) {
  const pathLabel = useLegacyRuntime
    ? "legacy-whisper"
    : (modelKey === "baby-raptor" ? "baby-raptor-modern" : "default-whisper");
  const state = {
    modelKey,
    pathLabel,
    useLegacyRuntime: !!useLegacyRuntime,
    runtimeHints: getGenerationConfigHints(model),
    controlsRejected: false,
    attemptedControls: false,
    plannedApplied: [],
    skipped: [],
    hasLoggedInitialReport: false
  };

  pushUnique(state.skipped, "desktop repetition controls disabled for accuracy testing");

  return state;
}

function getGenerationControlReport(state) {
  return {
    modelKey: state.modelKey,
    path: state.pathLabel,
    runtimeHints: state.runtimeHints.slice(),
    applied: state.controlsRejected ? [] : state.plannedApplied.slice(),
    skipped: state.skipped.slice(),
    controlsRejected: state.controlsRejected
  };
}

function getGenerationControlOverrides(state) {
  return {};
}

function removeUnsupportedWhisperFallbackOptions(options) {
  if (!options || typeof options !== "object") {
    return options;
  }

  const sanitized = {
    ...options
  };

  delete sanitized.temperature;
  delete sanitized.compression_ratio_threshold;
  delete sanitized.logprob_threshold;
  delete sanitized.no_speech_threshold;
  delete sanitized.condition_on_prev_tokens;
  delete sanitized.repetition_penalty;
  delete sanitized.no_repeat_ngram_size;
  delete sanitized.streamer;
  delete sanitized.callback_function;
  delete sanitized.chunk_callback;

  return sanitized;
}

function isUnsupportedGenerationControlError(error) {
  const text = getErrorText(error);
  return /no_repeat_ngram_size|repetition_penalty|compression_ratio_threshold|logprob_threshold|no_speech_threshold|condition_on_prev_tokens|temperature|streamer|callback_function|chunk_callback|unsupported|unexpected|unknown|invalid/i.test(text);
}

function markGenerationControlsUnsupported(state, error) {
  if (!state) {
    return;
  }

  state.controlsRejected = true;
  pushUnique(
    state.skipped,
    "runtime rejected conservative repetition controls: " + getErrorText(error)
  );
}

async function runWhisperTranscriptionAttempt(model, audio, baseOptions, progressHandler, generationState, attemptLabel) {
  const controlOverrides = getGenerationControlOverrides(generationState);
  const primaryAttemptOptions = createTranscriptionAttemptOptions(baseOptions, progressHandler, controlOverrides);

  if (generationState && !generationState.hasLoggedInitialReport) {
    generationState.hasLoggedInitialReport = true;
    logWorkerEvent("generation_controls", {
      attempt: attemptLabel,
      ...getGenerationControlReport(generationState)
    });
  }

  try {
    return await model(audio, primaryAttemptOptions);
  } catch (error) {
    if (!generationState || !Object.keys(controlOverrides).length || !isUnsupportedGenerationControlError(error)) {
      if (!isUnsupportedGenerationControlError(error)) {
        throw error;
      }

      logWorkerEvent("whisper_fallback_options_unsupported", {
        attempt: attemptLabel,
        modelKey: generationState ? generationState.modelKey : "",
        error: getErrorText(error)
      });
      return await model(audio, createTranscriptionAttemptOptions(removeUnsupportedWhisperFallbackOptions(baseOptions), progressHandler));
    }

    markGenerationControlsUnsupported(generationState, error);
    logWorkerEvent("generation_controls_fallback", {
      attempt: attemptLabel,
      ...getGenerationControlReport(generationState)
    });
    return await model(audio, createTranscriptionAttemptOptions(removeUnsupportedWhisperFallbackOptions(baseOptions), progressHandler));
  }
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function countConsecutiveRepeats(tokens) {
  let maxRun = 1;
  let currentRun = 1;

  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === tokens[index - 1]) {
      currentRun += 1;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 1;
    }
  }

  return maxRun;
}

function hasRepeatedPhraseLoop(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length >= 3 && countConsecutiveRepeats(tokens) >= 5) {
    return true;
  }

  const joined = tokens.join(" ");
  for (let phraseLength = 1; phraseLength <= Math.min(6, Math.floor(tokens.length / 3)); phraseLength += 1) {
    for (let start = 0; start + (phraseLength * 3) <= tokens.length; start += 1) {
      const phrase = tokens.slice(start, start + phraseLength).join(" ");
      if (!phrase) {
        continue;
      }

      const repeated = `${phrase} ${phrase} ${phrase}`;
      if (joined.includes(repeated)) {
        return true;
      }
    }
  }

  return /(.)\1{7,}/.test(normalized);
}

function hasArabicSyllableLoop(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < 12) {
    return false;
  }

  if (/([\u0600-\u06FF]{2,4})\1{4,}/u.test(compact)) {
    return true;
  }

  return /([\u0600-\u06FF]{2,3})(?:ÙŠ|Ø§|Ùˆ|Øª)?\1(?:ÙŠ|Ø§|Ùˆ|Øª)?\1(?:ÙŠ|Ø§|Ùˆ|Øª)?\1/u.test(compact);
}

function hasRepetitionLoop(text) {
  return hasRepeatedPhraseLoop(text) || hasArabicSyllableLoop(text);
}

function hasRepeatedShortTokenLoop(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 6) {
    return false;
  }

  let currentRun = 1;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previousToken = tokens[index - 1];
    if (token === previousToken && token.length <= 3) {
      currentRun += 1;
      if (currentRun >= 6) {
        return true;
      }
    } else {
      currentRun = 1;
    }
  }

  return false;
}

function getAudioSignalStats(audio) {
  if (!audio || !audio.length) {
    return {
      rms: 0,
      peak: 0
    };
  }

  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < audio.length; index += 1) {
    const sample = Number(audio[index]) || 0;
    const magnitude = Math.abs(sample);
    sumSquares += sample * sample;
    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  return {
    rms: Math.sqrt(sumSquares / audio.length),
    peak
  };
}

function hasKnownSilenceHallucination(text, audioStats) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const safeStats = audioStats || { rms: 0, peak: 0 };
  const likelyNearSilence = safeStats.rms < 0.0045 && safeStats.peak < 0.06;
  if (!likelyNearSilence || normalized.length > 80) {
    return false;
  }

  return KNOWN_SILENCE_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasKnownTranscriptArtifact(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return KNOWN_TRANSCRIPTION_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function inspectBadTranscriptionOutput(text, audio) {
  const reasons = [];
  const audioStats = getAudioSignalStats(audio);

  if (hasRepetitionLoop(text)) {
    reasons.push("repetition_loop");
  }
  if (hasRepeatedShortTokenLoop(text)) {
    reasons.push("short_token_loop");
  }
  if (hasKnownSilenceHallucination(text, audioStats)) {
    reasons.push("silence_hallucination");
  }
  if (hasKnownTranscriptArtifact(text)) {
    reasons.push("known_artifact");
  }

  return {
    ok: !reasons.length,
    reasons,
    audioStats
  };
}

function getRetryPolicyForModel(modelKey) {
  const resolvedModel = getTranscriptionModelConfig(modelKey);

  if (resolvedModel.key === "baby-raptor") {
    return {
      allowTimestampRetry: true,
      allowRepetitionRetry: false
    };
  }

  if (resolvedModel.key === "triceratop") {
    return {
      allowTimestampRetry: true,
      allowRepetitionRetry: false
    };
  }

  return {
    allowTimestampRetry: true,
    allowRepetitionRetry: true
  };
}

function shouldRetryChunk(modelKey, timestampCheck, badOutputCheck) {
  const retryPolicy = getRetryPolicyForModel(modelKey);
  const resolvedModel = getTranscriptionModelConfig(modelKey);
  const hasTimestampIssue = !!(timestampCheck && !timestampCheck.ok);
  const badReasons = badOutputCheck && Array.isArray(badOutputCheck.reasons)
    ? badOutputCheck.reasons
    : [];
  const hasBadOutput = badReasons.length > 0;

  if (hasTimestampIssue) {
    const hasRepetitionIssue = badReasons.includes("repetition_loop") || badReasons.includes("short_token_loop");

    if (resolvedModel.key === "baby-raptor" && hasRepetitionIssue) {
      return {
        shouldRetry: false,
        retryReason: timestampCheck.reason || badReasons.join(",") || "timestamp_issue",
        policy: retryPolicy
      };
    }

    return {
      shouldRetry: !!retryPolicy.allowTimestampRetry,
      retryReason: timestampCheck.reason || "timestamp_issue",
      policy: retryPolicy
    };
  }

  if (!hasBadOutput) {
    return {
      shouldRetry: false,
      retryReason: "",
      policy: retryPolicy
    };
  }

  const repetitionOnly = badReasons.every((reason) =>
    reason === "repetition_loop" || reason === "short_token_loop"
  );

  if (repetitionOnly && !retryPolicy.allowRepetitionRetry) {
    return {
      shouldRetry: false,
      retryReason: badReasons.join(",") || "bad_output",
      policy: retryPolicy
    };
  }

  return {
    shouldRetry: !!retryPolicy.allowRepetitionRetry,
    retryReason: badReasons.join(",") || "bad_output",
    policy: retryPolicy
  };
}

function getChunkSpeechSeconds(chunk, clipDurationSeconds) {
  if (!chunk || !Array.isArray(chunk.vadSpansRelative) || !chunk.vadSpansRelative.length) {
    return Math.max(0, Number(clipDurationSeconds) || 0);
  }

  let totalSeconds = 0;
  chunk.vadSpansRelative.forEach((span) => {
    const startSec = Number(span && span.startSec);
    const endSec = Number(span && span.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      return;
    }
    totalSeconds += endSec - startSec;
  });

  return Math.max(0, totalSeconds);
}

function getTimestampCoverageSeconds(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return 0;
  }

  let coveredSeconds = 0;
  chunks.forEach((chunk) => {
    const timestamp = chunk && chunk.timestamp;
    if (!Array.isArray(timestamp) || timestamp.length < 2) {
      return;
    }
    const start = Number(timestamp[0]);
    const end = Number(timestamp[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }
    coveredSeconds += end - start;
  });

  return Math.max(0, coveredSeconds);
}

function inspectSparseTranscriptCoverage(text, chunks, chunkMeta, clipDurationSeconds) {
  const normalizedText = normalizeText(text);
  const textLength = normalizedText.length;
  const segmentCount = Array.isArray(chunks) ? chunks.length : 0;
  const speechSeconds = getChunkSpeechSeconds(chunkMeta, clipDurationSeconds);
  const timestampCoverageSeconds = getTimestampCoverageSeconds(chunks);
  const chunkDurationSeconds = Math.max(0, Number(clipDurationSeconds) || 0);

  const hasSparseSingleSegment = speechSeconds >= SPARSE_COVERAGE_MIN_SPEECH_SECONDS
    && segmentCount <= 1
    && textLength <= 48
    && timestampCoverageSeconds <= Math.min(4.5, speechSeconds * 0.4);
  const hasSparseShortTranscript = speechSeconds >= 10
    && segmentCount <= 2
    && textLength <= 20
    && timestampCoverageSeconds <= Math.min(3.5, speechSeconds * 0.3);
  const hasSparseLongChunkByDuration = chunkDurationSeconds >= 12
    && segmentCount <= 1
    && textLength <= 48
    && timestampCoverageSeconds <= Math.min(4.5, chunkDurationSeconds * 0.35);

  const sparseReason = hasSparseSingleSegment
    ? "sparse_single_segment"
    : (hasSparseShortTranscript
      ? "sparse_short_transcript"
      : (hasSparseLongChunkByDuration ? "sparse_long_chunk_duration" : ""));

  return {
    ok: !sparseReason,
    reason: sparseReason,
    textLength,
    segmentCount,
    chunkDurationSeconds: roundDiagnostic(chunkDurationSeconds),
    speechSeconds: roundDiagnostic(speechSeconds),
    timestampCoverageSeconds: roundDiagnostic(timestampCoverageSeconds)
  };
}

function inspectTailTranscriptCoverage(text, chunks, chunkMeta, clipDurationSeconds, audio, sampleRate = 16000) {
  const normalizedText = normalizeText(text);
  const safeClipDurationSeconds = Math.max(0, Number(clipDurationSeconds) || 0);
  const segmentCount = Array.isArray(chunks) ? chunks.length : 0;
  const timestampCoverageSeconds = getTimestampCoverageSeconds(chunks);
  const speechSpans = chunkMeta && Array.isArray(chunkMeta.vadSpansRelative)
    ? chunkMeta.vadSpansRelative
    : [];
  let targetEndSeconds = safeClipDurationSeconds;
  let lastSegmentEndSeconds = 0;
  let tailSignalStats = { rms: 0, peak: 0 };
  let hasLikelyTailSpeech = false;

  if (!normalizedText || !segmentCount || safeClipDurationSeconds < TAIL_COVERAGE_MIN_CHUNK_SECONDS) {
    return {
      ok: true,
      reason: "",
      textLength: normalizedText.length,
      segmentCount,
      targetEndSeconds: roundDiagnostic(targetEndSeconds),
      lastSegmentEndSeconds: roundDiagnostic(lastSegmentEndSeconds),
      tailGapSeconds: roundDiagnostic(targetEndSeconds),
      timestampCoverageSeconds: roundDiagnostic(timestampCoverageSeconds),
      tailRms: 0,
      tailPeak: 0,
      likelyTailSpeech: false
    };
  }

  if (speechSpans.length) {
    const lastSpeechSpan = speechSpans[speechSpans.length - 1];
    const speechEndSeconds = Number(lastSpeechSpan && lastSpeechSpan.endSec);
    if (Number.isFinite(speechEndSeconds) && speechEndSeconds > 0) {
      targetEndSeconds = Math.min(safeClipDurationSeconds, speechEndSeconds);
    }
  }

  (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
    const timestamp = chunk && chunk.timestamp;
    const end = Array.isArray(timestamp) ? Number(timestamp[1]) : NaN;
    if (Number.isFinite(end) && end > lastSegmentEndSeconds) {
      lastSegmentEndSeconds = Math.min(targetEndSeconds, end);
    }
  });

  const tailGapSeconds = Math.max(0, targetEndSeconds - lastSegmentEndSeconds);
  const requiredTailGapSeconds = Math.max(TAIL_COVERAGE_MIN_GAP_SECONDS, targetEndSeconds * TAIL_COVERAGE_MAX_GAP_RATIO);

  if (tailGapSeconds <= requiredTailGapSeconds) {
    return {
      ok: true,
      reason: "",
      textLength: normalizedText.length,
      segmentCount,
      targetEndSeconds: roundDiagnostic(targetEndSeconds),
      lastSegmentEndSeconds: roundDiagnostic(lastSegmentEndSeconds),
      tailGapSeconds: roundDiagnostic(tailGapSeconds),
      timestampCoverageSeconds: roundDiagnostic(timestampCoverageSeconds),
      tailRms: 0,
      tailPeak: 0,
      likelyTailSpeech: false
    };
  }

  if (speechSpans.length) {
    hasLikelyTailSpeech = true;
  } else if (audio && audio.length) {
    const safeSampleRate = Math.max(1, Number(sampleRate) || 16000);
    const tailStartSample = Math.max(0, Math.min(audio.length, Math.floor(lastSegmentEndSeconds * safeSampleRate)));
    const tailAudio = tailStartSample < audio.length ? audio.slice(tailStartSample) : new Float32Array(0);
    const overallStats = getAudioSignalStats(audio);
    tailSignalStats = getAudioSignalStats(tailAudio);
    hasLikelyTailSpeech = tailSignalStats.rms >= Math.max(0.0045, overallStats.rms * 0.22)
      || tailSignalStats.peak >= Math.max(0.06, overallStats.peak * 0.18);
  }

  return {
    ok: !hasLikelyTailSpeech,
    reason: hasLikelyTailSpeech ? (speechSpans.length ? "tail_gap_after_last_vad_span" : "tail_gap_with_likely_speech") : "",
    textLength: normalizedText.length,
    segmentCount,
    targetEndSeconds: roundDiagnostic(targetEndSeconds),
    lastSegmentEndSeconds: roundDiagnostic(lastSegmentEndSeconds),
    tailGapSeconds: roundDiagnostic(tailGapSeconds),
    timestampCoverageSeconds: roundDiagnostic(timestampCoverageSeconds),
    tailRms: roundDiagnostic(tailSignalStats.rms, 6),
    tailPeak: roundDiagnostic(tailSignalStats.peak, 6),
    likelyTailSpeech: hasLikelyTailSpeech
  };
}

function buildSparseChunkSplitPlan(chunkMeta, clipDurationSeconds, sampleRate) {
  const safeDurationSeconds = Math.max(0, Number(clipDurationSeconds) || 0);
  const overlapSeconds = Math.min(SPARSE_COVERAGE_SPLIT_OVERLAP_SECONDS, Math.max(0.4, safeDurationSeconds * 0.12));
  const halfOverlap = overlapSeconds / 2;
  const midpointSeconds = safeDurationSeconds / 2;
  let splitPointSeconds = midpointSeconds;

  if (chunkMeta && Array.isArray(chunkMeta.vadSpansRelative) && chunkMeta.vadSpansRelative.length > 1) {
    let bestGapMidpoint = midpointSeconds;
    let bestGapDistance = Number.POSITIVE_INFINITY;

    for (let index = 1; index < chunkMeta.vadSpansRelative.length; index += 1) {
      const previous = chunkMeta.vadSpansRelative[index - 1];
      const current = chunkMeta.vadSpansRelative[index];
      const previousEnd = Number(previous && previous.endSec);
      const currentStart = Number(current && current.startSec);
      if (!Number.isFinite(previousEnd) || !Number.isFinite(currentStart) || currentStart < previousEnd) {
        continue;
      }
      const gapMidpoint = previousEnd + ((currentStart - previousEnd) / 2);
      const gapDistance = Math.abs(gapMidpoint - midpointSeconds);
      if (gapDistance < bestGapDistance) {
        bestGapDistance = gapDistance;
        bestGapMidpoint = gapMidpoint;
      }
    }

    splitPointSeconds = bestGapMidpoint;
  }

  const firstEndSeconds = Math.min(safeDurationSeconds, Math.max(2, splitPointSeconds + halfOverlap));
  const secondStartSeconds = Math.max(0, Math.min(safeDurationSeconds - 2, splitPointSeconds - halfOverlap));
  const firstEndSample = Math.max(1, Math.min(Math.round(firstEndSeconds * sampleRate), Math.round(safeDurationSeconds * sampleRate)));
  const secondStartSample = Math.max(0, Math.min(Math.round(secondStartSeconds * sampleRate), firstEndSample - 1));
  const totalSamples = Math.round(safeDurationSeconds * sampleRate);

  return [
    {
      startSample: 0,
      endSample: Math.max(1, firstEndSample)
    },
    {
      startSample: Math.max(0, secondStartSample),
      endSample: Math.max(secondStartSample + 1, totalSamples)
    }
  ];
}

async function transcribeSparseChunkFallback(
  model,
  chunkAudio,
  chunkMeta,
  sampleRate,
  options,
  generationControlState
) {
  const clipDurationSeconds = chunkAudio.length / sampleRate;
  const splitPlan = buildSparseChunkSplitPlan(chunkMeta, clipDurationSeconds, sampleRate);
  const combinedChunks = [];
  const combinedTexts = [];

  for (let index = 0; index < splitPlan.length; index += 1) {
    const split = splitPlan[index];
    const splitAudio = extractChunkAudio(chunkAudio, split);
    const splitDurationSeconds = splitAudio.length / sampleRate;
    if (!splitAudio.length || splitDurationSeconds <= 0) {
      continue;
    }

    const splitResult = await runWhisperTranscriptionAttempt(
      model,
      splitAudio,
      options,
      null,
      generationControlState,
      "sparse-fallback-" + (index + 1)
    );
    const splitText = normalizeText(splitResult && splitResult.text);
    const splitChunks = sanitizeTimedChunks(splitResult && splitResult.chunks, splitDurationSeconds);
    const splitTimestampCheck = inspectTimestampQuality(splitResult && splitResult.chunks, splitDurationSeconds);
    const splitBadOutputCheck = inspectBadTranscriptionOutput(splitText, splitAudio);

    if (splitTimestampCheck.ok && splitChunks.length) {
      appendTimedChunks(combinedChunks, splitChunks, split.startSample / sampleRate);
      continue;
    }

    if (splitText && splitBadOutputCheck.ok) {
      combinedChunks.push({
        text: splitText,
        timestamp: [
          split.startSample / sampleRate,
          split.endSample / sampleRate
        ]
      });
      combinedTexts.push(splitText);
    }
  }

  const combinedText = normalizeText(
    combinedChunks.length
      ? combinedChunks.map((chunk) => chunk.text).join(" ")
      : combinedTexts.join(" ")
  );

  return {
    text: combinedText,
    chunks: combinedChunks
  };
}

function hasTimestampCollapseAtBoundary(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length || clipDurationSeconds < 10) {
    return false;
  }

  let collapsedCount = 0;
  let validCount = 0;
  for (const chunk of chunks) {
    const timestamp = chunk && chunk.timestamp;
    if (!Array.isArray(timestamp) || !Number.isFinite(timestamp[1])) {
      continue;
    }

    validCount += 1;
    if (Math.abs(timestamp[1] - TIMESTAMP_COLLAPSE_SECONDS) <= TIMESTAMP_COLLAPSE_EPSILON) {
      collapsedCount += 1;
    }
  }

  return validCount >= 3 && collapsedCount >= Math.max(3, Math.floor(validCount * 0.5));
}

function inspectTimestampQuality(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return {
      ok: false,
      reason: "missing_timestamps"
    };
  }

  let validCount = 0;

  for (const chunk of chunks) {
    const timestamp = chunk && chunk.timestamp;
    if (!Array.isArray(timestamp) || timestamp.length < 2) {
      continue;
    }

    let start = Number(timestamp[0]);
    let end = Number(timestamp[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    validCount += 1;
    if (end > clipDurationSeconds + TIMESTAMP_OVERRUN_EPSILON || start < -TIMESTAMP_OVERRUN_EPSILON) {
      return {
        ok: false,
        reason: "timestamps_exceed_duration"
      };
    }

    if (end <= start) {
      return {
        ok: false,
        reason: "timestamps_invalid_order"
      };
    }

  }

  if (!validCount) {
    return {
      ok: false,
      reason: "missing_timestamps"
    };
  }

  if (hasTimestampCollapseAtBoundary(chunks, clipDurationSeconds)) {
    return {
      ok: false,
      reason: "timestamps_collapsed_29_98"
    };
  }

  return {
    ok: true,
    reason: ""
  };
}

function findFirstInvalidTimestampSegment(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return {
      firstInvalidSegmentIndex: -1,
      previousSegmentEnd: null,
      invalidSegmentStart: null,
      invalidSegmentEnd: null
    };
  }

  let previousValidEnd = null;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const timestamp = chunk && chunk.timestamp;
    if (!Array.isArray(timestamp) || timestamp.length < 2) {
      return {
        firstInvalidSegmentIndex: index,
        previousSegmentEnd: previousValidEnd,
        invalidSegmentStart: null,
        invalidSegmentEnd: null
      };
    }

    const start = Number(timestamp[0]);
    const end = Number(timestamp[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return {
        firstInvalidSegmentIndex: index,
        previousSegmentEnd: previousValidEnd,
        invalidSegmentStart: Number.isFinite(start) ? start : null,
        invalidSegmentEnd: Number.isFinite(end) ? end : null
      };
    }

    if (end > clipDurationSeconds + TIMESTAMP_OVERRUN_EPSILON || start < -TIMESTAMP_OVERRUN_EPSILON || end <= start) {
      return {
        firstInvalidSegmentIndex: index,
        previousSegmentEnd: previousValidEnd,
        invalidSegmentStart: start,
        invalidSegmentEnd: end
      };
    }

    previousValidEnd = end;
  }

  return {
    firstInvalidSegmentIndex: -1,
    previousSegmentEnd: previousValidEnd,
    invalidSegmentStart: null,
    invalidSegmentEnd: null
  };
}

function sanitizeTimedChunks(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return [];
  }

  const safeDuration = Math.max(0, Number(clipDurationSeconds) || 0);
  const result = [];

  chunks.forEach((chunk) => {
    const text = normalizeText(chunk && chunk.text);
    const timestamp = chunk && chunk.timestamp;
    if (!text || !Array.isArray(timestamp) || timestamp.length < 2) {
      return;
    }

    let start = Number(timestamp[0]);
    let end = Number(timestamp[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }

    start = Math.max(0, Math.min(safeDuration, start));
    end = Math.max(0, Math.min(safeDuration, end));

    if (end <= start) {
      return;
    }

    result.push({
      text,
      timestamp: [start, end]
    });
  });

  return result;
}

function applyTerminologyHints(text) {
  return String(text || "")
    .replace(/\bthrottle\b/gi, "accelerator pedal")
    .replace(/\bbrake\b/gi, "brake pedal");
}

function improveSpeechStructure(text) {
  return String(text || "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?\u061F])\s+/)
    .filter(Boolean);
}

function buildChunks(sentences, maxLength = 300) {
  const chunks = [];
  let current = "";

  for (let i = 0; i < sentences.length; i++) {
    const sentence = (sentences[i] || "").trim();
    if (!sentence) continue;

    if (current.length + sentence.length > maxLength) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }

  if (current) chunks.push(current.trim());

  return chunks;
}

function cleanTranslation(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s([.,!?])/g, "$1")
    .replace(/(\b\w+\b)( \1\b)+/gi, "$1")
    .trim();
}

function smoothWithContext(prev, curr) {
  if (!prev || !curr) return curr;

  const prevWords = prev.split(" ");
  const overlap = prevWords.slice(0, 2).join(" ");

  if (overlap && curr.startsWith(overlap)) {
    const trimmed = curr.slice(overlap.length).trim();

    if (trimmed.length > 5) {
      return trimmed;
    }
  }

  return curr;
}

function polishEnglish(text) {
  if (!text) return "";

  let value = text;

  value = value.replace(/\bthe most important thing is that\b/gi, "");
  value = value.replace(/\bfor you\b/gi, "");
  value = value.replace(/\bwhich is\b/gi, "that is");
  value = value.replace(/\bis here to\b/gi, "is here to help");
  value = value.replace(/\banswer all your questions\b/gi, "answer your questions");
  value = value.replace(/\b(\w+)( \1\b)+/gi, "$1");
  value = value.replace(/\s+/g, " ").trim();

  if (!value) {
    return "";
  }

  value = value.charAt(0).toUpperCase() + value.slice(1);

  if (!/[.!?]$/.test(value)) {
    value += ".";
  }

  return value;
}

function getPercentile(values, percentile) {
  if (!values || !values.length) {
    return 0;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index] || 0;
}

function roundDiagnostic(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function getDesktopVadChunkLimits(modelKey) {
  const resolvedModel = getTranscriptionModelConfig(modelKey);

  if (resolvedModel.key === "baby-raptor") {
    return {
      targetSeconds: 29.0,
      hardMaxSeconds: 28.0,
      emergencyMaxSeconds: 29.0
    };
  }

  return {
    targetSeconds: 28.5,
    hardMaxSeconds: 27.5,
    emergencyMaxSeconds: 28.5
  };
}

function getChunkSignalDiagnostics(audio) {
  if (!audio || !audio.length) {
    return {
      rmsMean: 0,
      rmsPeak: 0,
      zeroCrossingRate: 0
    };
  }

  let sumSquares = 0;
  let zeroCrossings = 0;
  let peak = 0;

  for (let index = 0; index < audio.length; index += 1) {
    const sample = Number(audio[index]) || 0;
    const magnitude = Math.abs(sample);
    sumSquares += sample * sample;
    if (magnitude > peak) {
      peak = magnitude;
    }

    if (index > 0) {
      const previous = Number(audio[index - 1]) || 0;
      if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) {
        zeroCrossings += 1;
      }
    }
  }

  return {
    rmsMean: roundDiagnostic(Math.sqrt(sumSquares / audio.length), 6),
    rmsPeak: roundDiagnostic(peak, 6),
    zeroCrossingRate: roundDiagnostic(zeroCrossings / Math.max(1, audio.length - 1), 6)
  };
}

function buildChunksFromSpeechSpans(audio, sampleRate, spans, chunkLengthSeconds, strideLengthSeconds, modelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY) {
  if (!audio || !audio.length || !Array.isArray(spans) || !spans.length) {
    return [{
      startSample: 0,
      endSample: audio ? audio.length : 0
    }];
  }

  const safeChunkLengthSeconds = Number.isFinite(chunkLengthSeconds) && chunkLengthSeconds > 0
    ? chunkLengthSeconds
    : DEFAULT_CHUNK_LENGTH_SECONDS;
  const safeStrideLengthSeconds = Number.isFinite(strideLengthSeconds) && strideLengthSeconds > 0
    ? strideLengthSeconds
    : (safeChunkLengthSeconds / 6);
  const chunkLimits = getDesktopVadChunkLimits(modelKey);
  const minSpeechSamples = Math.max(1, Math.round(sampleRate * 0.12));
  const mergeGapSamples = Math.max(1, Math.round(sampleRate * 0.35));
  const packGapSamples = Math.max(1, Math.round(sampleRate * 0.9));
  const paddingSamples = Math.max(1, Math.round(sampleRate * 0.12));
  const targetChunkSamples = Math.max(
    sampleRate,
    Math.round(Math.min(
      Math.max(1, safeChunkLengthSeconds - safeStrideLengthSeconds),
      chunkLimits.targetSeconds
    ) * sampleRate)
  );
  const hardMaxChunkSamples = Math.max(sampleRate, Math.round(chunkLimits.hardMaxSeconds * sampleRate));
  const emergencyMaxChunkSamples = Math.max(hardMaxChunkSamples, Math.round(chunkLimits.emergencyMaxSeconds * sampleRate));
  const normalizedSpans = spans.map((span) => {
    const startSample = Math.max(0, Math.min(audio.length, Math.floor(Number(span && span.startSample) || 0)));
    const endSample = Math.max(0, Math.min(audio.length, Math.ceil(Number(span && span.endSample) || 0)));
    return {
      startSample,
      endSample
    };
  }).filter((span) => span.endSample - span.startSample >= minSpeechSamples)
    .sort((left, right) => left.startSample - right.startSample);

  if (!normalizedSpans.length) {
    return [{
      startSample: 0,
      endSample: audio.length
    }];
  }

  const mergedSpans = [];
  normalizedSpans.forEach((span) => {
    if (!mergedSpans.length) {
      mergedSpans.push({
        startSample: span.startSample,
        endSample: span.endSample
      });
      return;
    }

    const previous = mergedSpans[mergedSpans.length - 1];
    if (span.startSample - previous.endSample <= mergeGapSamples) {
      previous.endSample = Math.max(previous.endSample, span.endSample);
    } else {
      mergedSpans.push({
        startSample: span.startSample,
        endSample: span.endSample
      });
    }
  });

  const expandedSpans = mergedSpans.map((span) => {
    const startSample = Math.max(0, span.startSample - paddingSamples);
    const endSample = Math.min(audio.length, span.endSample + paddingSamples);
    return {
      startSample,
      endSample,
      wasPaddedStart: startSample < span.startSample,
      wasPaddedEnd: endSample > span.endSample
    };
  });

  const packedChunks = [];
  expandedSpans.forEach((span) => {
    if (!packedChunks.length) {
      packedChunks.push({
        startSample: span.startSample,
        endSample: span.endSample,
        spans: [span]
      });
      return;
    }

    const current = packedChunks[packedChunks.length - 1];
    const gapSamples = span.startSample - current.endSample;
    const nextDuration = span.endSample - current.startSample;

    if (gapSamples <= packGapSamples && nextDuration <= targetChunkSamples) {
      current.endSample = span.endSample;
      current.spans.push(span);
    } else {
      packedChunks.push({
        startSample: span.startSample,
        endSample: span.endSample,
        spans: [span]
      });
    }
  });

  const finalizedPackedChunks = [];

  packedChunks.forEach((chunk) => {
    const chunkSpans = Array.isArray(chunk.spans) ? chunk.spans.slice() : [];
    const chunkDurationSamples = chunk.endSample - chunk.startSample;

    if (chunkDurationSamples <= hardMaxChunkSamples) {
      finalizedPackedChunks.push({
        startSample: chunk.startSample,
        endSample: chunk.endSample,
        spans: chunkSpans
      });
      return;
    }

    let currentChunk = null;

    const flushCurrentChunk = () => {
      if (!currentChunk) {
        return;
      }
      finalizedPackedChunks.push({
        startSample: currentChunk.startSample,
        endSample: currentChunk.endSample,
        spans: currentChunk.spans.slice()
      });
      currentChunk = null;
    };

    chunkSpans.forEach((span) => {
      const spanDurationSamples = span.endSample - span.startSample;

      if (spanDurationSamples > hardMaxChunkSamples) {
        flushCurrentChunk();
        let sliceStart = span.startSample;
        while (sliceStart < span.endSample) {
          const sliceEnd = Math.min(span.endSample, sliceStart + hardMaxChunkSamples);
          finalizedPackedChunks.push({
            startSample: sliceStart,
            endSample: sliceEnd,
            spans: [{
              startSample: sliceStart,
              endSample: sliceEnd,
              wasPaddedStart: sliceStart < span.startSample ? span.wasPaddedStart : false,
              wasPaddedEnd: sliceEnd > span.endSample ? span.wasPaddedEnd : false
            }]
          });
          sliceStart = sliceEnd;
        }
        return;
      }

      if (!currentChunk) {
        currentChunk = {
          startSample: span.startSample,
          endSample: span.endSample,
          spans: [span]
        };
        return;
      }

      const proposedDuration = span.endSample - currentChunk.startSample;
      if (proposedDuration <= targetChunkSamples) {
        currentChunk.endSample = span.endSample;
        currentChunk.spans.push(span);
        return;
      }

      flushCurrentChunk();
      currentChunk = {
        startSample: span.startSample,
        endSample: span.endSample,
        spans: [span]
      };
    });

    flushCurrentChunk();
  });

  const chunks = finalizedPackedChunks.map((chunk) => {
    const chunkStartSample = chunk.startSample;
    const chunkEndSample = Math.min(audio.length, Math.min(chunk.endSample, chunk.startSample + emergencyMaxChunkSamples));
    const chunkSpans = (Array.isArray(chunk.spans) ? chunk.spans : [])
      .filter((span) => span.endSample > chunkStartSample && span.startSample < chunkEndSample)
      .map((span) => ({
        startSample: Math.max(chunkStartSample, span.startSample),
        endSample: Math.min(chunkEndSample, span.endSample),
        wasPaddedStart: !!span.wasPaddedStart,
        wasPaddedEnd: !!span.wasPaddedEnd
      }));
    let largestInternalGapSamples = 0;
    for (let index = 1; index < chunkSpans.length; index += 1) {
      largestInternalGapSamples = Math.max(
        largestInternalGapSamples,
        chunkSpans[index].startSample - chunkSpans[index - 1].endSample
      );
    }
    const firstSpan = chunkSpans[0] || null;
    const lastSpan = chunkSpans[chunkSpans.length - 1] || null;

    return {
      startSample: chunkStartSample,
      endSample: chunkEndSample,
      vadSpanCount: chunkSpans.length,
      vadSpansRelative: chunkSpans.map((span) => ({
        startSec: roundDiagnostic((span.startSample - chunkStartSample) / sampleRate),
        endSec: roundDiagnostic((span.endSample - chunkStartSample) / sampleRate)
      })),
      largestInternalGapSec: roundDiagnostic(largestInternalGapSamples / sampleRate),
      leadingSilenceSec: firstSpan ? roundDiagnostic((firstSpan.startSample - chunkStartSample) / sampleRate) : 0,
      trailingSilenceSec: lastSpan ? roundDiagnostic((chunkEndSample - lastSpan.endSample) / sampleRate) : 0,
      wasPaddedStart: !!(firstSpan && firstSpan.wasPaddedStart),
      wasPaddedEnd: !!(lastSpan && lastSpan.wasPaddedEnd)
    };
  }).filter((chunk) => chunk.endSample > chunk.startSample);

  return chunks.length ? chunks : [{
    startSample: 0,
    endSample: audio.length
  }];
}

function shouldFallbackFromVadChunkPlan(chunkPlan, sampleRate, totalAudioSamples) {
  if (!Array.isArray(chunkPlan) || chunkPlan.length <= 1 || !sampleRate) {
    return {
      shouldFallback: false,
      reason: ""
    };
  }

  const chunkDurations = chunkPlan.map((chunk) =>
    Math.max(0, (Number(chunk.endSample) - Number(chunk.startSample)) / sampleRate)
  );
  const microChunkCount = chunkDurations.filter((duration) => duration > 0 && duration < MIN_DESKTOP_VAD_CHUNK_SECONDS).length;
  const longChunkCount = chunkDurations.filter((duration) => duration >= 12).length;
  const totalChunkedDuration = chunkDurations.reduce((sum, duration) => sum + duration, 0);
  const totalAudioSeconds = Math.max(0, Number(totalAudioSamples) || 0) / sampleRate;

  if (microChunkCount > MAX_DESKTOP_VAD_MICRO_CHUNKS && longChunkCount > 0) {
    return {
      shouldFallback: true,
      reason: "micro_chunks_with_long_chunks"
    };
  }

  if (microChunkCount > 0 && totalAudioSeconds >= 30 && totalChunkedDuration / totalAudioSeconds < 0.72) {
    return {
      shouldFallback: true,
      reason: "fragmented_low_coverage"
    };
  }

  return {
    shouldFallback: false,
    reason: ""
  };
}

function extractChunkAudio(audio, chunk) {
  if (!audio || !audio.length || !chunk) {
    return new Float32Array(0);
  }

  const startSample = Math.max(0, Math.min(audio.length, Math.floor(Number(chunk.startSample) || 0)));
  const endSample = Math.max(startSample, Math.min(audio.length, Math.ceil(Number(chunk.endSample) || 0)));

  return audio.slice(startSample, endSample);
}

function appendTimedChunks(target, sourceChunks, offsetSeconds) {
  if (!Array.isArray(sourceChunks) || !sourceChunks.length) {
    return;
  }

  sourceChunks.forEach((chunkResult) => {
    let start = Number(chunkResult && chunkResult.timestamp && chunkResult.timestamp[0]);
    const end = Number(chunkResult && chunkResult.timestamp && chunkResult.timestamp[1]);
    const text = normalizeText(chunkResult && chunkResult.text);

    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }

    start += offsetSeconds;
    const absoluteEnd = end + offsetSeconds;

    if (absoluteEnd <= start) {
      return;
    }

    target.push({
      text,
      timestamp: [start, absoluteEnd]
    });
  });
}

function sanitizeRawTimedChunks(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return [];
  }

  const safeDuration = Math.max(0, Number(clipDurationSeconds) || 0);
  const result = [];

  chunks.forEach((chunk) => {
    const text = chunk && typeof chunk.text === "string" ? chunk.text : "";
    const timestamp = chunk && chunk.timestamp;
    if (!text || !Array.isArray(timestamp) || timestamp.length < 2) {
      return;
    }

    let start = Number(timestamp[0]);
    let end = Number(timestamp[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }

    start = Math.max(0, Math.min(safeDuration, start));
    end = Math.max(0, Math.min(safeDuration, end));

    if (end <= start) {
      return;
    }

    result.push({
      text,
      timestamp: [start, end]
    });
  });

  return result;
}

function applyAbsoluteOffsetToChunks(chunks, offsetSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return [];
  }

  const safeOffset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  return chunks.map((chunk) => ({
    text: chunk && typeof chunk.text === "string" ? chunk.text : "",
    timestamp: [
      Number(chunk && chunk.timestamp && chunk.timestamp[0]) + safeOffset,
      Number(chunk && chunk.timestamp && chunk.timestamp[1]) + safeOffset
    ],
    rawTimestamp: Array.isArray(chunk && chunk.timestamp)
      ? [Number(chunk.timestamp[0]), Number(chunk.timestamp[1])]
      : null,
    timestampSource: "whisper",
    windowStartSec: safeOffset,
    localTimestampOffsetApplied: true
  })).filter((chunk) => chunk.text && Number.isFinite(chunk.timestamp[0]) && Number.isFinite(chunk.timestamp[1]) && chunk.timestamp[1] > chunk.timestamp[0]);
}

function buildSafeTimelineFallbackChunks(text, durationSeconds, offsetSeconds) {
  const safeText = typeof text === "string" ? text : "";
  const safeDuration = Math.max(0, Number(durationSeconds) || 0);
  const safeOffset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;

  if (!safeText) {
    return [];
  }

  return [{
    text: safeText,
    timestamp: [safeOffset, safeOffset + safeDuration],
    rawTimestamp: null,
    timestampSource: "safe_timeline_fallback",
    windowStartSec: safeOffset,
    firstSegmentWasClampedToWindowStart: true,
    localTimestampOffsetApplied: false
  }];
}

function buildAcceptedWhisperOutput(result, clipDurationSeconds, offsetSeconds, preserveRawText = false) {
  const rawText = result && typeof result.text === "string" ? result.text : "";
  const acceptedText = preserveRawText ? rawText : normalizeText(rawText);
  const rawChunks = Array.isArray(result && result.chunks) ? result.chunks : [];
  const timestampCheck = inspectTimestampQuality(rawChunks, clipDurationSeconds);
  const acceptedRelativeChunks = preserveRawText
    ? sanitizeRawTimedChunks(rawChunks, clipDurationSeconds)
    : sanitizeTimedChunks(rawChunks, clipDurationSeconds);
  const acceptedChunks = acceptedRelativeChunks.length
    ? applyAbsoluteOffsetToChunks(acceptedRelativeChunks, offsetSeconds)
    : buildSafeTimelineFallbackChunks(acceptedText, clipDurationSeconds, offsetSeconds);
  const firstRawChunk = rawChunks.length ? rawChunks[0] : null;
  const firstAcceptedChunk = acceptedChunks.length ? acceptedChunks[0] : null;

  return {
    text: acceptedText,
    chunks: acceptedChunks,
    timestampCheck,
    timestampDiagnostics: {
      firstSegmentRawStart: Array.isArray(firstRawChunk && firstRawChunk.timestamp)
        ? Number(firstRawChunk.timestamp[0])
        : null,
      firstSegmentRawEnd: Array.isArray(firstRawChunk && firstRawChunk.timestamp)
        ? Number(firstRawChunk.timestamp[1])
        : null,
      firstSegmentFinalStart: Array.isArray(firstAcceptedChunk && firstAcceptedChunk.timestamp)
        ? Number(firstAcceptedChunk.timestamp[0])
        : null,
      firstSegmentWasClampedToWindowStart: !!(firstAcceptedChunk && firstAcceptedChunk.firstSegmentWasClampedToWindowStart),
      firstSpeechTimestampFromWorker: Array.isArray(firstRawChunk && firstRawChunk.timestamp)
        ? Number(firstRawChunk.timestamp[0])
        : null,
      firstWindowStartSec: Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0,
      localTimestampOffsetApplied: !!(firstAcceptedChunk && firstAcceptedChunk.localTimestampOffsetApplied),
      timestampFallbackUsed: !!(firstAcceptedChunk && firstAcceptedChunk.timestampSource === "safe_timeline_fallback"),
      timestampFallbackReason: acceptedRelativeChunks.length ? "" : (timestampCheck.reason || "missing_reliable_timestamps")
    }
  };
}

function chooseOfficialSlidingWindowAcceptedText(result, finalizedWindowText, finalizedWindowChunkCount) {
  const rawText = result && typeof result.text === "string" ? result.text : "";
  const normalizedRawText = normalizeText(rawText);
  const normalizedFinalizedText = normalizeText(finalizedWindowText);
  const rawQuality = inspectBadTranscriptionOutput(rawText, null);
  const finalizedQuality = inspectBadTranscriptionOutput(normalizedFinalizedText, null);
  const rawReasons = Array.isArray(rawQuality && rawQuality.reasons) ? rawQuality.reasons : [];
  const finalizedReasons = Array.isArray(finalizedQuality && finalizedQuality.reasons) ? finalizedQuality.reasons : [];
  const rawHasLoop = rawReasons.includes("repetition_loop") || rawReasons.includes("short_token_loop");
  const finalizedHasLoop = finalizedReasons.includes("repetition_loop") || finalizedReasons.includes("short_token_loop");
  const finalizedIsPresent = !!normalizedFinalizedText && Number(finalizedWindowChunkCount) > 0;
  const finalizedTooShort = normalizedRawText.length > 0
    && normalizedFinalizedText.length < Math.max(120, Math.round(normalizedRawText.length * 0.55));
  const shouldPreferFinalized = finalizedIsPresent
    && rawHasLoop
    && !finalizedHasLoop
    && !finalizedTooShort
    && normalizedFinalizedText.length < normalizedRawText.length;

  return {
    text: shouldPreferFinalized ? finalizedWindowText : rawText,
    usedFinalizedWindowText: shouldPreferFinalized,
    reason: shouldPreferFinalized ? "raw_final_text_repetition_loop" : "",
    rawReasons,
    finalizedReasons,
    rawTextLength: normalizedRawText.length,
    finalizedTextLength: normalizedFinalizedText.length
  };
}

function estimateSlidingWindowChunkCount(durationSeconds, chunkLengthSeconds, strideLengthSeconds) {
  const safeDuration = Math.max(0, Number(durationSeconds) || 0);
  const safeChunkLength = Math.max(1, Number(chunkLengthSeconds) || 1);
  const safeStride = Math.max(0, Number(strideLengthSeconds) || 0);

  if (safeDuration <= safeChunkLength) {
    return 1;
  }

  const effectiveAdvance = Math.max(1, safeChunkLength - safeStride);
  return Math.max(1, Math.ceil((safeDuration - safeChunkLength) / effectiveAdvance) + 1);
}

function getWhisperProgressiveDecoder(model) {
  if (!model || !model.tokenizer || typeof model.tokenizer._decode_asr !== "function") {
    return null;
  }

  const featureExtractor = model.processor && model.processor.feature_extractor;
  const modelConfig = model.model && model.model.config;
  const chunkLength = Number(featureExtractor && featureExtractor.config && featureExtractor.config.chunk_length);
  const maxSourcePositions = Number(modelConfig && modelConfig.max_source_positions);

  if (!Number.isFinite(chunkLength) || !Number.isFinite(maxSourcePositions) || maxSourcePositions <= 0) {
    return null;
  }

  return {
    decode: model.tokenizer._decode_asr.bind(model.tokenizer),
    timePrecision: chunkLength / maxSourcePositions
  };
}

function createOfficialProgressHandlers(model, runtime, diagnostics, options, timelineOffset, clipDurationSeconds) {
  const decoder = getWhisperProgressiveDecoder(model);
  diagnostics.decodeAsrUsed = !!decoder;
  diagnostics.progressivePath = "none";
  const progressiveState = {
    text: "",
    completedChunks: 0,
    previewSuppressed: false,
    finalizedWindowTexts: []
  };

  const streamerCtor = runtime && runtime.WhisperTextStreamer;
  if (typeof streamerCtor === "function" && model && model.tokenizer) {
    diagnostics.progressivePath = "streamer";
    let lastLoggedProgressiveText = "";
    const streamer = new streamerCtor(model.tokenizer, {
      skip_prompt: true,
      time_precision: decoder ? decoder.timePrecision : undefined,
      callback_function: (text) => {
        if (typeof text === "string" && text) {
          progressiveState.text += text;
          const progressiveQuality = inspectBadTranscriptionOutput(progressiveState.text, null);
          const hasProgressiveRepetition = progressiveQuality.reasons.includes("repetition_loop")
            || progressiveQuality.reasons.includes("short_token_loop");
          if (hasProgressiveRepetition) {
            progressiveState.previewSuppressed = true;
          }
          logOfficialStyleProgressiveUpdate({
            modelKey: diagnostics.modelKey,
            textLength: progressiveState.text.length,
            chunkCount: progressiveState.completedChunks,
            decodeAsrUsed: !!decoder,
            streamer: true,
            previewSuppressed: progressiveState.previewSuppressed,
            badReasons: progressiveQuality.reasons
          });
          if (!progressiveState.previewSuppressed) {
            emitWorkerMessage({
              type: "update",
              text: progressiveState.text,
              segments: []
            });
          }
        }
      },
      on_chunk_start: () => {
        emitWorkerMessage({
          type: "status",
          message: "Receiving live transcript..."
        });
      },
      on_chunk_end: () => {
        const fullText = typeof progressiveState.text === "string" ? progressiveState.text : "";
        const incrementalText = fullText.startsWith(lastLoggedProgressiveText)
          ? fullText.slice(lastLoggedProgressiveText.length).trim()
          : fullText.trim();
        progressiveState.completedChunks += 1;
        recordWindowFinalizeTiming(
          diagnostics,
          Math.max(0, progressiveState.completedChunks - 1),
          incrementalText.length
        );
        logOfficialWindowChunk({
          modelKey: diagnostics.modelKey,
          chunkIndex: Math.max(0, progressiveState.completedChunks - 1),
          textLength: incrementalText.length,
          text: incrementalText,
          aggregateTextLength: fullText.length,
          decodeAsrUsed: !!decoder,
          streamer: true
        });
        if (incrementalText) {
          progressiveState.finalizedWindowTexts.push(incrementalText);
        }
        lastLoggedProgressiveText = fullText;
        emitWorkerMessage({
          type: "status",
          message: "Still transcribing..."
        });
      },
      on_finalize: () => {
        emitWorkerMessage({
          type: "status",
          message: "Finalizing transcript..."
        });
      }
    });

    return {
      streamer,
      callback_function: null,
      chunk_callback: null,
      getFinalizedWindowSummary: () => summarizeWindowChunkTexts(progressiveState.finalizedWindowTexts)
    };
  }

  if (!decoder) {
    return {
      streamer: null,
      callback_function: null,
      chunk_callback: null
    };
  }

  const chunksToProcess = [{
    tokens: [],
    finalised: false
  }];
  const finalizedWindowTexts = [];
  diagnostics.progressivePath = "decode_asr";

  function chunk_callback(chunk) {
    const last = chunksToProcess[chunksToProcess.length - 1];
    Object.assign(last, chunk);
    last.finalised = true;

    if (chunk && typeof chunk.text === "string" && chunk.text.trim()) {
      const finalizedText = chunk.text.trim();
      finalizedWindowTexts.push(finalizedText);
      recordWindowFinalizeTiming(
        diagnostics,
        Math.max(0, finalizedWindowTexts.length - 1),
        finalizedText.length
      );
      logOfficialWindowChunk({
        modelKey: diagnostics.modelKey,
        chunkIndex: Math.max(0, finalizedWindowTexts.length - 1),
        textLength: finalizedText.length,
        text: finalizedText,
        aggregateTextLength: joinWindowChunkTexts(finalizedWindowTexts).length,
        decodeAsrUsed: true,
        streamer: false
      });
    }

    if (!chunk.is_last) {
      chunksToProcess.push({
        tokens: [],
        finalised: false
      });
    }
  }

  function callback_function(item) {
    if (!Array.isArray(item) || !item.length) {
      return;
    }

    const last = chunksToProcess[chunksToProcess.length - 1];
    if (!last) {
      return;
    }

    const tokenIds = item[0] && item[0].output_token_ids;
    if (!Array.isArray(tokenIds)) {
      return;
    }

    last.tokens = tokenIds.slice();

    let partialResult;
    try {
      partialResult = decoder.decode(chunksToProcess, {
        time_precision: decoder.timePrecision,
        return_timestamps: true,
        force_full_sequences: false
      });
    } catch (error) {
      return;
    }

    const acceptedPartial = buildAcceptedWhisperOutput(
      partialResult,
      clipDurationSeconds,
      timelineOffset,
      RAW_WHISPER_PASSTHROUGH
    );

    logOfficialStyleProgressiveUpdate({
      modelKey: diagnostics.modelKey,
      textLength: acceptedPartial.text.length,
      chunkCount: acceptedPartial.chunks.length,
      decodeAsrUsed: true
    });

    emitWorkerMessage({
      type: "update",
      text: acceptedPartial.text,
      segments: acceptedPartial.chunks
    });
  }

  return {
    streamer: null,
    callback_function,
    chunk_callback,
    getFinalizedWindowSummary: () => summarizeWindowChunkTexts(finalizedWindowTexts)
  };
}

function appendRawTimedChunks(target, sourceChunks, offsetSeconds) {
  if (!Array.isArray(sourceChunks) || !sourceChunks.length) {
    return;
  }

  sourceChunks.forEach((chunkResult) => {
    const timestamp = chunkResult && chunkResult.timestamp;
    const rawText = chunkResult && typeof chunkResult.text === "string" ? chunkResult.text : "";
    const start = Array.isArray(timestamp) ? Number(timestamp[0]) : NaN;
    const end = Array.isArray(timestamp) ? Number(timestamp[1]) : NaN;

    if (!rawText || !Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }

    target.push({
      text: rawText,
      timestamp: [start + offsetSeconds, end + offsetSeconds]
    });
  });
}

async function handleOfficialSlidingWindowTranscription(
  audioBuffer,
  selectedLanguage,
  timelineOffset = 0,
  modelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY,
  requestConfig = null
) {
  if (!audioBuffer) {
    throw new Error("Missing audio data");
  }

  activeTranscriptionDiagnostics = createTranscriptionDiagnostics(modelKey);
  const diagnostics = getActiveTranscriptionDiagnostics(modelKey);
  const transcriptionStart = Date.now();
  diagnostics._transcriptionStartedAt = transcriptionStart;
  diagnostics._lastWindowFinalizedAt = 0;
  diagnostics.windowFinalizeEvents = [];
  const audio = new Float32Array(audioBuffer);

  if (!audio.length) {
    throw new Error("Missing audio data");
  }

  const modelLoad = await loadTranscriptionModel(modelKey);
  const model = modelLoad.model;

  emitWorkerMessage({
    type: "model_ready",
    modelKey: modelLoad.modelKey,
    loadState: modelLoad.loadState
  });

  emitWorkerMessage({ type: "progress", value: 10, current: 10, total: 100 });

  const sampleRate = 16000;
  const safeTimelineOffset = Number.isFinite(timelineOffset) ? Math.max(0, timelineOffset) : 0;
  const clipDurationSeconds = audio.length / sampleRate;
  let options = {
    sampling_rate: sampleRate,
    ...getDefaultTranscriptionOptions(modelLoad.modelKey, !!modelLoad.legacy)
  };
  options = applyTranscriptionOptionOverrides(options, requestConfig && requestConfig.overrides);

  diagnostics.usedVad = false;
  diagnostics.chunkCount = 1;
  diagnostics.chunkingMode = requestConfig && requestConfig.chunkingMode
    ? String(requestConfig.chunkingMode)
    : "transformers_sliding_window";
  diagnostics.chunkLengthSec = Number(options.chunk_length_s) || 0;
  diagnostics.strideLengthSec = Number(options.stride_length_s) || 0;
  diagnostics.coveragePercent = 100;

  if (selectedLanguage && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  if (!requestConfig || !requestConfig.disablePromptIds) {
    if (shouldUseArabicPrompt(selectedLanguage)) {
      const promptIds = await getArabicPromptIds(model, modelLoad.modelKey);
      logArabicPromptStatus({
        path: "transformers_sliding_window",
        modelKey: modelLoad.modelKey,
        requestedLanguage: selectedLanguage,
        promptRequested: true,
        promptIdsBuilt: !!(promptIds && promptIds.length),
        promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0
      });
      if (promptIds) {
        options.prompt_ids = promptIds;
        logArabicPromptStatus({
          path: "transformers_sliding_window",
          modelKey: modelLoad.modelKey,
          requestedLanguage: selectedLanguage,
          promptAttachedToRequest: true,
          promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0
        });
      }
    }
  }

  logChunkingMode({
    mode: diagnostics.chunkingMode,
    vadUsed: false,
    chunkLengthSec: diagnostics.chunkLengthSec,
    strideLengthSec: diagnostics.strideLengthSec,
    coveragePercent: 100
  });

  const progressHandlers = createOfficialProgressHandlers(
    model,
    modelLoad.runtime,
    diagnostics,
    options,
    safeTimelineOffset,
    clipDurationSeconds
  );

  const progressHandler = (state) => {
    return state;
  };

  emitWorkerMessage({
    type: "status",
    message: "Transcribing in browser...",
    progress: 12
  });

  const transcriptionOptions = {
    ...options,
    streamer: progressHandlers.streamer || undefined,
    callback_function: typeof progressHandlers.callback_function === "function"
      ? progressHandlers.callback_function
      : undefined,
    chunk_callback: typeof progressHandlers.chunk_callback === "function"
      ? progressHandlers.chunk_callback
      : undefined
  };

  const result = await runWhisperTranscriptionAttempt(
    model,
    audio,
    transcriptionOptions,
    progressHandler,
    createGenerationControlState(model, modelLoad.modelKey, !!modelLoad.legacy),
    "official-sliding-window"
  );

  const finalizedWindowSummary = progressHandlers && typeof progressHandlers.getFinalizedWindowSummary === "function"
    ? progressHandlers.getFinalizedWindowSummary()
    : { text: "", chunkCount: 0 };
  const finalizedWindowText = finalizedWindowSummary.text;
  const finalizedWindowChunkCount = finalizedWindowSummary.chunkCount;

  if (shouldUseArabicPrompt(selectedLanguage) && options.prompt_ids) {
    logArabicPromptStatus({
      path: "transformers_sliding_window",
      modelKey: modelLoad.modelKey,
      requestedLanguage: selectedLanguage,
      promptCallCompleted: true,
      promptIdsCount: Array.isArray(options.prompt_ids) ? options.prompt_ids.length : 0
    });
  }

  logWhisperRawChunk({
    attempt: "initial",
    modelKey: modelLoad.modelKey,
    chunkIndex: 0,
    absoluteStartSec: roundDiagnostic(safeTimelineOffset),
    absoluteEndSec: roundDiagnostic(safeTimelineOffset + clipDurationSeconds),
    rawText: result && typeof result.text === "string" ? result.text : "",
    rawSegmentsCount: Array.isArray(result && result.chunks) ? result.chunks.length : 0,
    rawSegmentTimestamps: Array.isArray(result && result.chunks)
      ? result.chunks.map((item) => Array.isArray(item && item.timestamp)
        ? [item.timestamp[0], item.timestamp[1]]
        : null)
      : []
  });

  logWhisperFinalCompare({
    modelKey: modelLoad.modelKey,
    finalRawTextLength: result && typeof result.text === "string" ? result.text.length : 0,
    finalizedWindowTextLength: finalizedWindowText.length,
    finalRawText: result && typeof result.text === "string" ? result.text : "",
    finalizedWindowText,
    finalChunkCount: Array.isArray(result && result.chunks) ? result.chunks.length : 0,
    finalizedWindowChunkCount
  });

  const acceptedTextChoice = chooseOfficialSlidingWindowAcceptedText(
    result,
    finalizedWindowText,
    finalizedWindowChunkCount
  );
  if (acceptedTextChoice.usedFinalizedWindowText) {
    logWorkerEvent("official_sliding_window_text_override", {
      modelKey: modelLoad.modelKey,
      reason: acceptedTextChoice.reason,
      rawReasons: acceptedTextChoice.rawReasons,
      finalizedReasons: acceptedTextChoice.finalizedReasons,
      rawTextLength: acceptedTextChoice.rawTextLength,
      finalizedTextLength: acceptedTextChoice.finalizedTextLength,
      finalizedWindowChunkCount
    });
  }

  const acceptedResult = buildAcceptedWhisperOutput(
    acceptedTextChoice.usedFinalizedWindowText
      ? {
          ...result,
          text: acceptedTextChoice.text
        }
      : result,
    clipDurationSeconds,
    safeTimelineOffset,
    RAW_WHISPER_PASSTHROUGH
  );
  const warnings = [];

  if (!acceptedResult.timestampCheck.ok && acceptedResult.text) {
    warnings.push("weak_audio");
  }
  Object.assign(diagnostics, acceptedResult.timestampDiagnostics || {});
  diagnostics.officialSlidingWindowTextOverrideUsed = !!acceptedTextChoice.usedFinalizedWindowText;
  diagnostics.officialSlidingWindowTextOverrideReason = acceptedTextChoice.reason || "";
  diagnostics.officialSlidingWindowRawReasons = acceptedTextChoice.rawReasons || [];
  diagnostics.officialSlidingWindowFinalizedReasons = acceptedTextChoice.finalizedReasons || [];

  emitWorkerMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 99
  });
  emitWorkerMessage({ type: "progress", value: 100, current: 100, total: 100 });

  diagnostics.lastWorkerCallMs = Date.now() - transcriptionStart;
  emitBackendStatus(diagnostics);

  emitWorkerMessage({
    type: "result",
    text: acceptedResult.text.trim(),
    segments: acceptedResult.chunks,
    warnings: Array.from(new Set(warnings)),
    generationControls: {
      modelKey: modelLoad.modelKey,
      path: "transformers_sliding_window",
      runtimeHints: [],
      applied: [],
      skipped: [],
      controlsRejected: false
    },
    diagnostics: getDiagnosticsSnapshot(diagnostics)
  });
}

async function handleTranscription(
  audioBuffer,
  selectedLanguage,
  timelineOffset = 0,
  modelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY,
  externalSpeechSpans = null
) {
  if (!audioBuffer) {
    throw new Error("Missing audio data");
  }

  activeTranscriptionDiagnostics = createTranscriptionDiagnostics(modelKey);
  const diagnostics = getActiveTranscriptionDiagnostics(modelKey);
  const transcriptionStart = Date.now();

  const audio = new Float32Array(audioBuffer);

  if (!audio.length) {
    throw new Error("Missing audio data");
  }

  const modelLoad = await loadTranscriptionModel(modelKey);
  const model = modelLoad.model;

  emitWorkerMessage({
    type: "model_ready",
    modelKey: modelLoad.modelKey,
    loadState: modelLoad.loadState
  });

  emitWorkerMessage({ type: "progress", value: 10, current: 10, total: 100 });

  const sampleRate = 16000;
  const safeTimelineOffset = Number.isFinite(timelineOffset) ? Math.max(0, timelineOffset) : 0;
  const options = {
    sampling_rate: sampleRate,
    ...getDefaultTranscriptionOptions(modelLoad.modelKey, !!modelLoad.legacy)
  };
  const warnings = [];
  const generationControlState = createGenerationControlState(model, modelLoad.modelKey, !!modelLoad.legacy);
  const useExternalSpeechSpans = Array.isArray(externalSpeechSpans) && externalSpeechSpans.length > 0;

  if (selectedLanguage && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  if (shouldUseArabicPrompt(selectedLanguage)) {
    const promptIds = await getArabicPromptIds(model, modelLoad.modelKey);
    logArabicPromptStatus({
      path: useExternalSpeechSpans ? "experimental_vad_selected_chunks" : "manual_full_audio_chunk",
      modelKey: modelLoad.modelKey,
      requestedLanguage: selectedLanguage,
      promptRequested: true,
      promptIdsBuilt: !!(promptIds && promptIds.length),
      promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0
    });
    if (promptIds) {
      options.prompt_ids = promptIds;
      logArabicPromptStatus({
        path: useExternalSpeechSpans ? "experimental_vad_selected_chunks" : "manual_full_audio_chunk",
        modelKey: modelLoad.modelKey,
        requestedLanguage: selectedLanguage,
        promptAttachedToRequest: true,
        promptIdsCount: Array.isArray(promptIds) ? promptIds.length : 0
      });
    }
  }

  let fullText = "";
  let fullChunks = [];
  diagnostics.usedVad = useExternalSpeechSpans;
  diagnostics.chunkingMode = useExternalSpeechSpans
    ? "experimental_vad_selected_chunks"
    : "manual_full_audio_chunk";
  diagnostics.chunkLengthSec = Number(options.chunk_length_s) || 0;
  diagnostics.strideLengthSec = Number(options.stride_length_s) || 0;
  diagnostics.coveragePercent = useExternalSpeechSpans ? 0 : 100;
  let chunkPlan = useExternalSpeechSpans
    ? buildChunksFromSpeechSpans(
      audio,
      sampleRate,
      externalSpeechSpans,
      options.chunk_length_s,
      options.stride_length_s,
      modelLoad.modelKey
    )
    : [{
      startSample: 0,
      endSample: audio.length
    }];
  if (useExternalSpeechSpans) {
    const vadFallbackDecision = shouldFallbackFromVadChunkPlan(chunkPlan, sampleRate, audio.length);
    if (vadFallbackDecision.shouldFallback) {
      logWorkerEvent("vad_chunk_plan_fallback", {
        modelKey: modelLoad.modelKey,
        reason: vadFallbackDecision.reason,
        chunkCount: chunkPlan.length,
        chunkDurationsSec: chunkPlan.map((chunk) =>
          roundDiagnostic((Math.max(0, Number(chunk.endSample) - Number(chunk.startSample))) / sampleRate)
        )
      });
      diagnostics.usedVad = false;
      return handleOfficialSlidingWindowTranscription(audioBuffer, selectedLanguage, timelineOffset, modelKey);
    }
  }
  if (useExternalSpeechSpans) {
    const coveredSamples = chunkPlan.reduce((sum, chunk) =>
      sum + Math.max(0, Number(chunk.endSample) - Number(chunk.startSample)), 0);
    diagnostics.coveragePercent = clampPercent((coveredSamples / audio.length) * 100);
  }
  diagnostics.chunkCount = chunkPlan.length;

  logChunkingMode({
    mode: diagnostics.chunkingMode,
    vadUsed: diagnostics.usedVad,
    chunkLengthSec: diagnostics.chunkLengthSec,
    strideLengthSec: diagnostics.strideLengthSec,
    coveragePercent: diagnostics.coveragePercent
  });

  if (useExternalSpeechSpans && chunkPlan.length > 1) {
    emitWorkerMessage({
      type: "status",
      message: "Analyzing speech regions...",
      progress: 14
    });
  }

  for (let i = 0; i < chunkPlan.length; i += 1) {
    const chunk = chunkPlan[i];
    const chunkOffsetSeconds = safeTimelineOffset + (chunk.startSample / sampleRate);
    const progressBase = 12;
    const progressSpan = 84;
    const chunkStartProgress = progressBase + Math.round((i / chunkPlan.length) * progressSpan);
    const chunkEndProgress = progressBase + Math.round(((i + 1) / chunkPlan.length) * progressSpan);
    let lastChunkProgress = chunkStartProgress;

    emitWorkerMessage({
      type: "status",
      message: chunkPlan.length > 1
        ? "Transcribing part " + (i + 1) + " of " + chunkPlan.length + "..."
        : "Transcribing in browser...",
      progress: chunkStartProgress
    });

    const progressHandler = (state) => {
      const internalPercent = getMonitorProgressPercent(state);
      if (internalPercent == null) {
        return;
      }

      const liveProgress = chunkStartProgress + Math.round(((chunkEndProgress - chunkStartProgress) * internalPercent) / 100);
      if (liveProgress > lastChunkProgress) {
        lastChunkProgress = liveProgress;
        emitWorkerMessage({
          type: "progress",
          value: liveProgress,
          current: liveProgress,
          total: 100,
          message: chunkPlan.length > 1
            ? "Transcribing part " + (i + 1) + " of " + chunkPlan.length + "..."
            : "Transcribing in browser..."
        });
      }
    };
    const chunkAudio = extractChunkAudio(audio, chunk);
    const clipDurationSeconds = chunkAudio.length / sampleRate;
    const chunkSignalDiagnostics = getChunkSignalDiagnostics(chunkAudio);
    logWorkerEvent("chunk_diagnostics", {
      chunkIndex: i,
      absoluteStartSec: roundDiagnostic(chunkOffsetSeconds),
      absoluteEndSec: roundDiagnostic(chunkOffsetSeconds + clipDurationSeconds),
      durationSec: roundDiagnostic(clipDurationSeconds),
      audioSamples: chunkAudio.length,
      vadSpanCount: Number.isFinite(chunk.vadSpanCount) ? chunk.vadSpanCount : 0,
      vadSpansRelative: Array.isArray(chunk.vadSpansRelative) ? chunk.vadSpansRelative : [],
      largestInternalGapSec: roundDiagnostic(Number(chunk.largestInternalGapSec) || 0),
      leadingSilenceSec: roundDiagnostic(Number(chunk.leadingSilenceSec) || 0),
      trailingSilenceSec: roundDiagnostic(Number(chunk.trailingSilenceSec) || 0),
      wasPaddedStart: !!chunk.wasPaddedStart,
      wasPaddedEnd: !!chunk.wasPaddedEnd,
      rmsMean: chunkSignalDiagnostics.rmsMean,
      rmsPeak: chunkSignalDiagnostics.rmsPeak,
      zeroCrossingRate: chunkSignalDiagnostics.zeroCrossingRate,
      selectedModel: modelLoad.modelKey,
      chunk_length_s: Number(options.chunk_length_s) || 0,
      stride_length_s: Number(options.stride_length_s) || 0,
      return_timestamps: options.return_timestamps !== false
    });
    const firstAttemptStart = Date.now();
    let result = await runWhisperTranscriptionAttempt(
      model,
      chunkAudio,
      options,
      progressHandler,
      generationControlState,
      "initial"
    );
    if (shouldUseArabicPrompt(selectedLanguage) && options.prompt_ids) {
      logArabicPromptStatus({
        path: generationControlState.pathLabel,
        modelKey: modelLoad.modelKey,
        requestedLanguage: selectedLanguage,
        chunkIndex: i,
        promptCallCompleted: true,
        promptIdsCount: Array.isArray(options.prompt_ids) ? options.prompt_ids.length : 0
      });
    }
    let resultText = normalizeText(result && result.text);
    let resultChunks = sanitizeTimedChunks(result && result.chunks, clipDurationSeconds);
    let timestampCheck = inspectTimestampQuality(result && result.chunks, clipDurationSeconds);
    let badOutputCheck = inspectBadTranscriptionOutput(resultText, chunkAudio);
    const retryDecision = shouldRetryChunk(modelLoad.modelKey, timestampCheck, badOutputCheck);
    const firstAttemptTimestampDetail = findFirstInvalidTimestampSegment(result && result.chunks, clipDurationSeconds);
    logWhisperRawChunk({
      attempt: "initial",
      modelKey: modelLoad.modelKey,
      chunkIndex: i,
      absoluteStartSec: roundDiagnostic(chunkOffsetSeconds),
      absoluteEndSec: roundDiagnostic(chunkOffsetSeconds + clipDurationSeconds),
      rawText: result && typeof result.text === "string" ? result.text : "",
      rawSegmentsCount: Array.isArray(result && result.chunks) ? result.chunks.length : 0,
      rawSegmentTimestamps: Array.isArray(result && result.chunks)
        ? result.chunks.map((item) => Array.isArray(item && item.timestamp)
          ? [item.timestamp[0], item.timestamp[1]]
          : null)
        : []
    });

    if (RAW_WHISPER_PASSTHROUGH) {
      if (Array.isArray(result && result.chunks) && result.chunks.length) {
        appendRawTimedChunks(fullChunks, result.chunks, chunkOffsetSeconds);
      } else if (result && typeof result.text === "string" && result.text) {
        fullChunks.push({
          text: result.text,
          timestamp: [chunkOffsetSeconds, chunkOffsetSeconds + clipDurationSeconds]
        });
      }

      emitWorkerMessage({
        type: "progress",
        value: chunkEndProgress,
        current: chunkEndProgress,
        total: 100,
        message: chunkPlan.length > 1
          ? "Finishing part " + (i + 1) + " of " + chunkPlan.length + "..."
          : "Finalizing transcript..."
      });
      continue;
    }

    if (retryDecision.shouldRetry) {
      const retryOptions = {
        ...options,
        return_timestamps: true
      };

      if (retryOptions.prompt_ids) {
        delete retryOptions.prompt_ids;
      }

      const retryReason = retryDecision.retryReason;
      diagnostics.retryCount += 1;
      logWorkerEvent("transcription_retry", {
        modelKey: modelLoad.modelKey,
        path: generationControlState.pathLabel,
        chunkIndex: i,
        retryReason
      });
      const retriedResult = await runWhisperTranscriptionAttempt(
        model,
        chunkAudio,
        retryOptions,
        progressHandler,
        generationControlState,
        "retry"
      );
      const retriedText = normalizeText(retriedResult && retriedResult.text);
      const retriedChunks = sanitizeTimedChunks(retriedResult && retriedResult.chunks, clipDurationSeconds);
      const retriedTimestampCheck = inspectTimestampQuality(retriedResult && retriedResult.chunks, clipDurationSeconds);
      const retriedBadOutputCheck = inspectBadTranscriptionOutput(retriedText, chunkAudio);
      const retriedTimestampDetail = findFirstInvalidTimestampSegment(retriedResult && retriedResult.chunks, clipDurationSeconds);
      const retryMs = Date.now() - firstAttemptStart;
      logWhisperRawChunk({
        attempt: "retry",
        modelKey: modelLoad.modelKey,
        chunkIndex: i,
        absoluteStartSec: roundDiagnostic(chunkOffsetSeconds),
        absoluteEndSec: roundDiagnostic(chunkOffsetSeconds + clipDurationSeconds),
        rawText: retriedResult && typeof retriedResult.text === "string" ? retriedResult.text : "",
        rawSegmentsCount: Array.isArray(retriedResult && retriedResult.chunks) ? retriedResult.chunks.length : 0,
        rawSegmentTimestamps: Array.isArray(retriedResult && retriedResult.chunks)
          ? retriedResult.chunks.map((item) => Array.isArray(item && item.timestamp)
            ? [item.timestamp[0], item.timestamp[1]]
            : null)
          : []
      });

      if (retriedTimestampCheck.ok && retriedBadOutputCheck.ok) {
        result = retriedResult;
        resultText = retriedText;
        resultChunks = retriedChunks;
        timestampCheck = retriedTimestampCheck;
        badOutputCheck = retriedBadOutputCheck;
        warnings.push("language_hint");
      } else {
        diagnostics.retryFailureCount += 1;
        logWorkerEvent("transcription_retry_failed", {
          modelKey: modelLoad.modelKey,
          path: generationControlState.pathLabel,
          chunkIndex: i,
          retryReason,
          initialBadOutputReasons: badOutputCheck.reasons,
          retryBadOutputReasons: retriedBadOutputCheck.reasons,
          initialTimestampReason: timestampCheck.reason,
          retryTimestampReason: retriedTimestampCheck.reason,
          firstInvalidSegmentIndex: retriedTimestampDetail.firstInvalidSegmentIndex,
          previousSegmentEnd: retriedTimestampDetail.previousSegmentEnd,
          invalidSegmentStart: retriedTimestampDetail.invalidSegmentStart,
          invalidSegmentEnd: retriedTimestampDetail.invalidSegmentEnd,
          retryMs
        });
        if (!timestampCheck.ok || !retriedTimestampCheck.ok) {
          warnings.push("weak_audio");
        }
        if (!badOutputCheck.ok || !retriedBadOutputCheck.ok) {
          warnings.push("repetition");
        }
        if (
          badOutputCheck.reasons.includes("silence_hallucination")
          || retriedBadOutputCheck.reasons.includes("silence_hallucination")
        ) {
          warnings.push("silence_hallucination");
        }
        if (
          (badOutputCheck.reasons.length || retriedBadOutputCheck.reasons.length)
          && !retriedText
          && !resultText
        ) {
          continue;
        }
      }
    } else if (!timestampCheck.ok || !badOutputCheck.ok) {
      logWorkerEvent("transcription_retry_skipped", {
        modelKey: modelLoad.modelKey,
        path: generationControlState.pathLabel,
        chunkIndex: i,
        skipReason: retryDecision.retryReason || (!timestampCheck.ok ? timestampCheck.reason : badOutputCheck.reasons.join(",") || "bad_output"),
        initialBadOutputReasons: badOutputCheck.reasons,
        initialTimestampReason: timestampCheck.reason
      });
    }

    let sparseCoverageCheck = inspectSparseTranscriptCoverage(resultText, resultChunks, chunk, clipDurationSeconds);
    let tailCoverageCheck = inspectTailTranscriptCoverage(resultText, resultChunks, chunk, clipDurationSeconds, chunkAudio, sampleRate);
    if (timestampCheck.ok && (sparseCoverageCheck.reason || tailCoverageCheck.reason)) {
      logWorkerEvent("coverage_gap_detected", {
        modelKey: modelLoad.modelKey,
        path: generationControlState.pathLabel,
        chunkIndex: i,
        sparseReason: sparseCoverageCheck.reason,
        tailReason: tailCoverageCheck.reason,
        chunkDurationSeconds: sparseCoverageCheck.chunkDurationSeconds,
        speechSeconds: sparseCoverageCheck.speechSeconds,
        timestampCoverageSeconds: sparseCoverageCheck.timestampCoverageSeconds,
        rawSegmentsCount: sparseCoverageCheck.segmentCount,
        textLength: sparseCoverageCheck.textLength,
        tailTargetEndSeconds: tailCoverageCheck.targetEndSeconds,
        lastSegmentEndSeconds: tailCoverageCheck.lastSegmentEndSeconds,
        tailGapSeconds: tailCoverageCheck.tailGapSeconds,
        tailRms: tailCoverageCheck.tailRms,
        tailPeak: tailCoverageCheck.tailPeak,
        likelyTailSpeech: tailCoverageCheck.likelyTailSpeech
      });

      const sparseFallbackResult = await transcribeSparseChunkFallback(
        model,
        chunkAudio,
        chunk,
        sampleRate,
        options,
        generationControlState
      );
      const sparseFallbackText = normalizeText(sparseFallbackResult && sparseFallbackResult.text);
      const sparseFallbackChunks = Array.isArray(sparseFallbackResult && sparseFallbackResult.chunks)
        ? sparseFallbackResult.chunks
        : [];
      const fallbackSparseCoverageCheck = inspectSparseTranscriptCoverage(sparseFallbackText, sparseFallbackChunks, chunk, clipDurationSeconds);
      const fallbackTailCoverageCheck = inspectTailTranscriptCoverage(sparseFallbackText, sparseFallbackChunks, chunk, clipDurationSeconds, chunkAudio, sampleRate);
      const fallbackLooksBetter = sparseFallbackChunks.length > resultChunks.length
        || sparseFallbackText.length > (resultText.length + 20)
        || (!!sparseCoverageCheck.reason && !fallbackSparseCoverageCheck.reason)
        || (!!tailCoverageCheck.reason && !fallbackTailCoverageCheck.reason)
        || ((Number(tailCoverageCheck.tailGapSeconds) || 0) - (Number(fallbackTailCoverageCheck.tailGapSeconds) || 0) >= 3);

      logWorkerEvent("coverage_gap_fallback_result", {
        modelKey: modelLoad.modelKey,
        path: generationControlState.pathLabel,
        chunkIndex: i,
        sparseReason: sparseCoverageCheck.reason,
        tailReason: tailCoverageCheck.reason,
        originalSegmentsCount: resultChunks.length,
        fallbackSegmentsCount: sparseFallbackChunks.length,
        originalTextLength: resultText.length,
        fallbackTextLength: sparseFallbackText.length,
        fallbackSparseReason: fallbackSparseCoverageCheck.reason,
        fallbackTailReason: fallbackTailCoverageCheck.reason,
        originalTailGapSeconds: tailCoverageCheck.tailGapSeconds,
        fallbackTailGapSeconds: fallbackTailCoverageCheck.tailGapSeconds,
        accepted: fallbackLooksBetter
      });

      if (fallbackLooksBetter && sparseFallbackChunks.length) {
        resultText = sparseFallbackText;
        resultChunks = sparseFallbackChunks;
        timestampCheck = {
          ok: true,
          reason: ""
        };
        badOutputCheck = inspectBadTranscriptionOutput(resultText, chunkAudio);
        sparseCoverageCheck = inspectSparseTranscriptCoverage(resultText, resultChunks, chunk, clipDurationSeconds);
        tailCoverageCheck = inspectTailTranscriptCoverage(resultText, resultChunks, chunk, clipDurationSeconds, chunkAudio, sampleRate);
      }
    }

    logWorkerEvent("chunk_transcription_result", {
      chunkIndex: i,
      rawText: result && typeof result.text === "string" ? result.text : "",
      rawSegmentsCount: Array.isArray(result && result.chunks) ? result.chunks.length : 0,
      rawSegmentTimestamps: Array.isArray(result && result.chunks)
        ? result.chunks.map((item) => Array.isArray(item && item.timestamp)
          ? [item.timestamp[0], item.timestamp[1]]
          : null)
        : [],
      timestampValidationResult: !!timestampCheck.ok,
      failureReason: !timestampCheck.ok
        ? timestampCheck.reason
        : (!badOutputCheck.ok ? badOutputCheck.reasons.join(",") || "bad_output" : ""),
      firstInvalidSegmentIndex: firstAttemptTimestampDetail.firstInvalidSegmentIndex,
      previousSegmentEnd: firstAttemptTimestampDetail.previousSegmentEnd,
      invalidSegmentStart: firstAttemptTimestampDetail.invalidSegmentStart,
      invalidSegmentEnd: firstAttemptTimestampDetail.invalidSegmentEnd,
      retryMs: retryDecision.shouldRetry ? Math.max(0, Date.now() - firstAttemptStart) : 0,
      sparseCoverageReason: sparseCoverageCheck.reason || "",
      sparseChunkDurationSeconds: sparseCoverageCheck.chunkDurationSeconds,
      sparseSpeechSeconds: sparseCoverageCheck.speechSeconds,
      sparseTimestampCoverageSeconds: sparseCoverageCheck.timestampCoverageSeconds,
      tailCoverageReason: tailCoverageCheck.reason || "",
      tailTargetEndSeconds: tailCoverageCheck.targetEndSeconds,
      lastSegmentEndSeconds: tailCoverageCheck.lastSegmentEndSeconds,
      tailGapSeconds: tailCoverageCheck.tailGapSeconds,
      tailRms: tailCoverageCheck.tailRms,
      tailPeak: tailCoverageCheck.tailPeak,
      likelyTailSpeech: tailCoverageCheck.likelyTailSpeech
    });

    postMessage({
      type: "progress",
      value: chunkEndProgress,
      current: chunkEndProgress,
      total: 100,
      message: chunkPlan.length > 1
        ? "Finishing part " + (i + 1) + " of " + chunkPlan.length + "..."
        : "Finalizing transcript..."
    });

    if (timestampCheck.ok && resultChunks.length) {
      appendTimedChunks(fullChunks, resultChunks, chunkOffsetSeconds);
    } else if (resultText) {
      if (!timestampCheck.ok) {
        warnings.push("weak_audio");
      }
      if (!badOutputCheck.ok) {
        warnings.push("repetition");
        if (badOutputCheck.reasons.includes("silence_hallucination")) {
          warnings.push("silence_hallucination");
        }
        continue;
      }
      fullChunks.push({
        text: resultText,
        timestamp: [chunkOffsetSeconds, chunkOffsetSeconds + clipDurationSeconds]
      });
    } else if (result && result.text) {
      const fallbackText = normalizeText(result.text);
      if (fallbackText) {
        fullChunks.push({
          text: fallbackText,
          timestamp: [chunkOffsetSeconds, chunkOffsetSeconds + clipDurationSeconds]
        });
      }
    }
  }

  fullText = RAW_WHISPER_PASSTHROUGH
    ? fullChunks.map((chunk) => String(chunk && chunk.text || "")).join(" ")
    : normalizeText(fullChunks.map((chunk) => chunk.text).join(" "));

  if (!fullChunks.length && fullText) {
    fullChunks = [{
      text: fullText,
      timestamp: [safeTimelineOffset, safeTimelineOffset + (audio.length / sampleRate)]
    }];
  }

  if (!fullChunks.length && !fullText) {
    const error = new Error("Local transcription produced unstable repeated or silent output. Try a shorter clip, clearer speech, or another model.");
    error.errorCode = "BAD_OUTPUT_RETRY_EXHAUSTED";
    logWorkerEvent("transcription_rejected", {
      modelKey: modelLoad.modelKey,
      path: generationControlState.pathLabel,
      warnings: Array.from(new Set(warnings)),
      generationControls: getGenerationControlReport(generationControlState)
    });
    throw error;
  }

  emitWorkerMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 99
  });
  emitWorkerMessage({ type: "progress", value: 100, current: 100, total: 100 });
  diagnostics.lastWorkerCallMs = Date.now() - transcriptionStart;
  emitBackendStatus(diagnostics);
  emitWorkerMessage({
    type: "result",
    text: fullText.trim(),
    segments: fullChunks,
    warnings: Array.from(new Set(warnings)),
    generationControls: getGenerationControlReport(generationControlState),
    diagnostics: getDiagnosticsSnapshot(diagnostics)
  });
}

self.onmessage = async (e) => {
  const data = e.data || {};
  const requestType = data.type;
  const modelConfig = getTranscriptionModelConfig(data.modelKey || DEFAULT_TRANSCRIPTION_MODEL_KEY);
  activeWorkerSessionId = requestType === "transcribe" || requestType === "transcribe_vad_chunks"
    ? String(data.sessionId || "")
    : "";
  activeWorkerAttemptId = requestType === "transcribe" || requestType === "transcribe_vad_chunks"
    ? String(data.attemptId || "")
    : "";

  if (requestType === "preload_model") {
    if (isBusy) {
      emitWorkerMessage({
        type: "model_error",
        modelKey: modelConfig.key,
        message: "Worker is busy"
      });
      return;
    }

    try {
      const modelLoad = await loadTranscriptionModel(modelConfig.key);
      emitWorkerMessage({
        type: "model_ready",
        modelKey: modelLoad.modelKey,
        loadState: modelLoad.loadState
      });
    } catch (err) {
      emitWorkerMessage({
        type: "model_error",
        modelKey: modelConfig.key,
        message: err && err.message ? err.message : "Model load failed"
      });
    }
    return;
  }

  if (requestType === "unload") {
    if (isBusy) {
      emitWorkerMessage({ type: "unload_skipped" });
      return;
    }

    try {
      const unloadedModelKey = activeTranscriptionModelKey;
      await unloadModels();
      emitWorkerMessage({ type: "unloaded", modelKey: unloadedModelKey });
    } catch (err) {
      emitWorkerMessage({
        type: "unload_error",
        message: err && err.message ? err.message : "Unload failed"
      });
    }
    return;
  }

  if (isBusy) {
    emitWorkerMessage({
      type: "error",
      message: "Worker is busy"
    });
    return;
  }

  isBusy = true;

  try {
    if (requestType === "transcribe") {
      await handleOfficialSlidingWindowTranscription(
        data.audio,
        data.selectedLanguage,
        data.timelineOffset,
        modelConfig.key,
        data.requestConfig || null
      );
      return;
    }

    if (requestType === "transcribe_vad_chunks") {
      await handleTranscription(
        data.audio,
        data.selectedLanguage,
        data.timelineOffset,
        modelConfig.key,
        data.speechSpans
      );
      return;
    }

    throw new Error("Unsupported worker message");
  } catch (err) {
    const runtimeFailureMeta = (requestType === "transcribe" || requestType === "transcribe_vad_chunks")
      ? classifyTranscriptionRuntimeFailure(err, modelConfig.key)
      : null;
    emitWorkerMessage({
      type: "error",
      message: runtimeFailureMeta
        ? runtimeFailureMeta.userMessage
        : (err && err.message ? err.message : "Worker request failed"),
      errorCode: runtimeFailureMeta
        ? runtimeFailureMeta.errorCode
        : ((requestType === "transcribe" || requestType === "transcribe_vad_chunks") && err && err.errorCode ? err.errorCode : ""),
      failedModelKey: runtimeFailureMeta
        ? runtimeFailureMeta.failedModelKey
        : ((requestType === "transcribe" || requestType === "transcribe_vad_chunks") && err && err.failedModelKey ? err.failedModelKey : modelConfig.key),
      fallbackModelKey: runtimeFailureMeta
        ? runtimeFailureMeta.fallbackModelKey
        : ((requestType === "transcribe" || requestType === "transcribe_vad_chunks") && err && err.fallbackModelKey ? err.fallbackModelKey : ""),
      diagnostics: getDiagnosticsSnapshot(activeTranscriptionDiagnostics)
    });
  } finally {
    isBusy = false;
    if (requestType === "transcribe" || requestType === "transcribe_vad_chunks") {
      activeWorkerSessionId = "";
      activeWorkerAttemptId = "";
    }
  }
};
