let transcriber = null;
let activeTranscriptionModelKey = null;
let isLoading = false;
let isBusy = false;
let modernTransformersRuntimePromise = null;
let legacyTransformersRuntimePromise = null;
const arabicPromptIdsByModel = new Map();
const ONNX_RUNTIME_NOISE_PATTERNS = [
  "VerifyEachNodeIsAssignedToAnEp",
  "Some nodes were not assigned to the preferred execution providers",
  "Rerunning with verbose output on a non-minimal build will show node assignments"
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
const DEFAULT_STRIDE_LENGTH_SECONDS = 5;
const PHONE_CHUNK_LENGTH_SECONDS = 15;
const PHONE_STRIDE_LENGTH_SECONDS = 3;
const MIN_SPEECH_REGION_CLIP_SECONDS = 12;
const ENABLE_DESKTOP_SPEECH_AWARE_CHUNKING = false;
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
  /^اشترك(?:وا)?(?: في)?(?: ال)?قناة[.!؟?]*$/i,
  /^لا تنس(?:وا)? الاشتراك(?: في القناة)?[.!؟?]*$/i
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
const ARABIC_TRANSCRIPTION_PROMPT = "قم بتفريغ النص بدقة مثل ما ينقال، بدون ترجمة أو تلخيص، مع استخدام علامات الترقيم عند الحاجة. اكتب الإنجليزي كما هو، وإذا فيه موسيقى اكتب: (موسيقى)";

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

function filterConsoleMethod(methodName) {
  if (typeof console === "undefined" || typeof console[methodName] !== "function") {
    return;
  }

  const originalMethod = console[methodName].bind(console);
  console[methodName] = (...args) => {
    if (shouldSuppressOnnxRuntimeNoise(args)) {
      return;
    }
    originalMethod(...args);
  };
}

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
      legacy: true
    };
  }

  const modernRuntime = await getModernTransformersRuntime();
  return {
    pipeline: modernRuntime.pipeline,
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
  return {
    chunk_length_s: useConservativeLegacyDefaults ? PHONE_CHUNK_LENGTH_SECONDS : DEFAULT_CHUNK_LENGTH_SECONDS,
    stride_length_s: useConservativeLegacyDefaults ? PHONE_STRIDE_LENGTH_SECONDS : DEFAULT_STRIDE_LENGTH_SECONDS,
    return_timestamps: true,
    task: "transcribe",
    force_full_sequences: false,
    top_k: 0,
    do_sample: false
  };
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
          postMessage({ type: "model_download_progress", modelKey, progress: percent });
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
          postMessage({ type: "model_download_progress", modelKey, progress: percent });
        }
      }
    }
  };
}

async function loadTranscriptionModel(modelKey) {
  const modelConfig = getTranscriptionModelConfig(modelKey);
  const runtime = await getTranscriptionRuntime(modelConfig.key);
  const runtimeModelId = getRuntimeTranscriptionModelId(modelConfig.key, runtime.legacy);

  if (transcriber && activeTranscriptionModelKey === modelConfig.key) {
    return {
      model: transcriber,
      modelKey: modelConfig.key,
      loadState: "memory",
      legacy: runtime.legacy
    };
  }

  if (isLoading) {
    while (isLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (transcriber && activeTranscriptionModelKey === modelConfig.key) {
      return {
        model: transcriber,
        modelKey: modelConfig.key,
        loadState: "memory",
        legacy: runtime.legacy
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

    postMessage({ type: "model_loading", modelKey: modelConfig.key });

    try {
      transcriber = await runtime.pipeline(
        "automatic-speech-recognition",
        runtimeModelId,
        loadOptions
      );
    } catch (primaryError) {
      if (runtime.legacy || !hasWebGPU() || modelConfig.key === "t-rex") {
        throw primaryError;
      }

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
    }
  } catch (err) {
    const failureMeta = classifyTranscriptionModelLoadFailure(err, modelConfig.key);
    transcriber = null;
    activeTranscriptionModelKey = null;
    postMessage({
      type: "model_error",
      modelKey: modelConfig.key,
      message: failureMeta ? failureMeta.userMessage : (err && err.message ? err.message : "Model load failed"),
      errorCode: failureMeta ? failureMeta.errorCode : "",
      failedModelKey: failureMeta ? failureMeta.failedModelKey : modelConfig.key,
      fallbackModelKey: failureMeta ? failureMeta.fallbackModelKey : ""
    });
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
  return {
    model: transcriber,
    modelKey: modelConfig.key,
    loadState: tracker && tracker.sawNetworkProgress() ? "downloaded" : "cached",
    legacy: runtime.legacy
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

async function getArabicPromptIds(model, modelKey) {
  const cacheKey = modelKey || activeTranscriptionModelKey || DEFAULT_TRANSCRIPTION_MODEL_KEY;
  if (arabicPromptIdsByModel.has(cacheKey)) {
    return arabicPromptIdsByModel.get(cacheKey);
  }

  const promptSources = [
    model && model.processor,
    model && model.tokenizer,
    model && model.processor && model.processor.tokenizer
  ].filter(Boolean);

  for (const source of promptSources) {
    try {
      const promptIds = await buildPromptIds(source, ARABIC_TRANSCRIPTION_PROMPT_TEXT);
      if (promptIds) {
        arabicPromptIdsByModel.set(cacheKey, promptIds);
        return promptIds;
      }
    } catch (err) {
      // Fall through to the next prompt source.
    }
  }

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
  try {
    console.info("[transcribe-worker]", eventName, payload);
  } catch (error) {
  }
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

function isUnsupportedGenerationControlError(error) {
  const text = getErrorText(error);
  return /no_repeat_ngram_size|repetition_penalty|unsupported|unexpected|unknown|invalid/i.test(text);
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

  if (generationState && !generationState.hasLoggedInitialReport) {
    generationState.hasLoggedInitialReport = true;
    logWorkerEvent("generation_controls", {
      attempt: attemptLabel,
      ...getGenerationControlReport(generationState)
    });
  }

  try {
    return await model(audio, createTranscriptionAttemptOptions(baseOptions, progressHandler, controlOverrides));
  } catch (error) {
    if (!generationState || !Object.keys(controlOverrides).length || !isUnsupportedGenerationControlError(error)) {
      throw error;
    }

    markGenerationControlsUnsupported(generationState, error);
    logWorkerEvent("generation_controls_fallback", {
      attempt: attemptLabel,
      ...getGenerationControlReport(generationState)
    });
    return await model(audio, createTranscriptionAttemptOptions(baseOptions, progressHandler));
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

  return /([\u0600-\u06FF]{2,3})(?:ي|ا|و|ت)?\1(?:ي|ا|و|ت)?\1(?:ي|ا|و|ت)?\1/u.test(compact);
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

function buildSpeechAwareChunks(audio, sampleRate) {
  if (!audio || !audio.length || audio.length <= sampleRate * MIN_SPEECH_REGION_CLIP_SECONDS) {
    return [{
      audio: audio,
      startSample: 0,
      endSample: audio.length
    }];
  }

  const frameMs = 30;
  const frameSize = Math.max(160, Math.floor(sampleRate * (frameMs / 1000)));
  const minSpeechFrames = Math.max(4, Math.round(180 / frameMs));
  const mergePauseFrames = Math.max(4, Math.round(240 / frameMs));
  const packPauseFrames = Math.max(10, Math.round(480 / frameMs));
  const paddingFrames = Math.max(4, Math.round(180 / frameMs));
  const maxChunkFrames = Math.max(
    1,
    Math.round(((DEFAULT_CHUNK_LENGTH_SECONDS - DEFAULT_STRIDE_LENGTH_SECONDS) * 1000) / frameMs)
  );
  const rms = [];
  let totalEnergy = 0;
  let totalCount = 0;

  for (let i = 0; i < audio.length; i += frameSize) {
    let sum = 0;
    let count = 0;

    for (let j = 0; j < frameSize && i + j < audio.length; j += 1) {
      const sample = audio[i + j];
      sum += sample * sample;
      count += 1;
    }

    totalEnergy += sum;
    totalCount += count;
    rms.push(Math.sqrt(sum / Math.max(1, count)));
  }

  const globalRms = Math.sqrt(totalEnergy / Math.max(1, totalCount));
  const noiseFloor = getPercentile(rms, 0.2);
  const threshold = Math.max(0.006, Math.min(0.03, Math.max(globalRms * 0.45, noiseFloor * 2.2)));
  const speechRegions = [];
  let idx = 0;

  while (idx < rms.length) {
    if (rms[idx] >= threshold) {
      const startFrame = idx;
      while (idx < rms.length && rms[idx] >= threshold) {
        idx += 1;
      }
      const endFrame = idx;
      if (endFrame - startFrame >= minSpeechFrames) {
        speechRegions.push({ startFrame, endFrame });
      }
    } else {
      idx += 1;
    }
  }

  if (!speechRegions.length) {
    return [{
      audio: audio,
      startSample: 0,
      endSample: audio.length
    }];
  }

  const mergedRegions = [];
  speechRegions.forEach((region) => {
    if (!mergedRegions.length) {
      mergedRegions.push({ startFrame: region.startFrame, endFrame: region.endFrame });
      return;
    }

    const previous = mergedRegions[mergedRegions.length - 1];
    if (region.startFrame - previous.endFrame <= mergePauseFrames) {
      previous.endFrame = region.endFrame;
    } else {
      mergedRegions.push({ startFrame: region.startFrame, endFrame: region.endFrame });
    }
  });

  const expandedRegions = mergedRegions.map((region) => ({
    startFrame: Math.max(0, region.startFrame - paddingFrames),
    endFrame: Math.min(rms.length, region.endFrame + paddingFrames)
  }));

  const packedChunks = [];
  expandedRegions.forEach((region) => {
    if (!packedChunks.length) {
      packedChunks.push({ startFrame: region.startFrame, endFrame: region.endFrame });
      return;
    }

    const current = packedChunks[packedChunks.length - 1];
    const gapFrames = region.startFrame - current.endFrame;
    const nextDuration = region.endFrame - current.startFrame;

    if (gapFrames <= packPauseFrames && nextDuration <= maxChunkFrames) {
      current.endFrame = region.endFrame;
    } else {
      packedChunks.push({ startFrame: region.startFrame, endFrame: region.endFrame });
    }
  });

  const chunks = packedChunks.map((chunk) => {
    const startSample = Math.max(0, chunk.startFrame * frameSize);
    const endSample = Math.min(audio.length, chunk.endFrame * frameSize);
    return {
      audio: audio.slice(startSample, endSample),
      startSample,
      endSample
    };
  }).filter((chunk) => chunk.audio && chunk.audio.length);

  return chunks.length ? chunks : [{
    audio: audio,
    startSample: 0,
    endSample: audio.length
  }];
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

async function handleTranscription(audioBuffer, selectedLanguage, timelineOffset = 0, modelKey = DEFAULT_TRANSCRIPTION_MODEL_KEY) {
  if (!audioBuffer) {
    throw new Error("Missing audio data");
  }

  const audio = new Float32Array(audioBuffer);

  if (!audio.length) {
    throw new Error("Missing audio data");
  }

  const modelLoad = await loadTranscriptionModel(modelKey);
  const model = modelLoad.model;

  postMessage({
    type: "model_ready",
    modelKey: modelLoad.modelKey,
    loadState: modelLoad.loadState
  });

  postMessage({ type: "progress", value: 10, current: 10, total: 100 });

  const sampleRate = 16000;
  const safeTimelineOffset = Number.isFinite(timelineOffset) ? Math.max(0, timelineOffset) : 0;
  const options = {
    sampling_rate: sampleRate,
    ...getDefaultTranscriptionOptions(modelLoad.modelKey, !!modelLoad.legacy)
  };
  const warnings = [];
  const generationControlState = createGenerationControlState(model, modelLoad.modelKey, !!modelLoad.legacy);

  if (selectedLanguage && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  if (shouldUseArabicPrompt(selectedLanguage)) {
    const promptIds = await getArabicPromptIds(model, modelLoad.modelKey);
    if (promptIds) {
      options.prompt_ids = promptIds;
    }
  }

  let fullText = "";
  let fullChunks = [];
  const useSpeechAwareChunks = ENABLE_DESKTOP_SPEECH_AWARE_CHUNKING
    && audio.length > sampleRate * MIN_SPEECH_REGION_CLIP_SECONDS;
  const chunkPlan = useSpeechAwareChunks ? buildSpeechAwareChunks(audio, sampleRate) : [{
    audio: audio,
    startSample: 0,
    endSample: audio.length
  }];

  if (useSpeechAwareChunks && chunkPlan.length > 1) {
    postMessage({
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

    postMessage({
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
        postMessage({
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
    const clipDurationSeconds = chunk.audio.length / sampleRate;
    let result = await runWhisperTranscriptionAttempt(
      model,
      chunk.audio,
      options,
      progressHandler,
      generationControlState,
      "initial"
    );
    let resultText = normalizeText(result && result.text);
    let resultChunks = sanitizeTimedChunks(result && result.chunks, clipDurationSeconds);
    let timestampCheck = inspectTimestampQuality(result && result.chunks, clipDurationSeconds);
    let badOutputCheck = inspectBadTranscriptionOutput(resultText, chunk.audio);

    if (!timestampCheck.ok || !badOutputCheck.ok) {
      const retryOptions = {
        ...options,
        return_timestamps: true
      };

      if (retryOptions.prompt_ids) {
        delete retryOptions.prompt_ids;
      }

      const retryReason = !timestampCheck.ok
        ? timestampCheck.reason
        : badOutputCheck.reasons.join(",") || "bad_output";
      logWorkerEvent("transcription_retry", {
        modelKey: modelLoad.modelKey,
        path: generationControlState.pathLabel,
        chunkIndex: i,
        retryReason
      });
      const retriedResult = await runWhisperTranscriptionAttempt(
        model,
        chunk.audio,
        retryOptions,
        progressHandler,
        generationControlState,
        "retry"
      );
      const retriedText = normalizeText(retriedResult && retriedResult.text);
      const retriedChunks = sanitizeTimedChunks(retriedResult && retriedResult.chunks, clipDurationSeconds);
      const retriedTimestampCheck = inspectTimestampQuality(retriedResult && retriedResult.chunks, clipDurationSeconds);
      const retriedBadOutputCheck = inspectBadTranscriptionOutput(retriedText, chunk.audio);

      if (retriedTimestampCheck.ok && retriedBadOutputCheck.ok) {
        result = retriedResult;
        resultText = retriedText;
        resultChunks = retriedChunks;
        timestampCheck = retriedTimestampCheck;
        badOutputCheck = retriedBadOutputCheck;
        warnings.push("language_hint");
      } else {
        logWorkerEvent("transcription_retry_failed", {
          modelKey: modelLoad.modelKey,
          path: generationControlState.pathLabel,
          chunkIndex: i,
          retryReason,
          initialBadOutputReasons: badOutputCheck.reasons,
          retryBadOutputReasons: retriedBadOutputCheck.reasons,
          initialTimestampReason: timestampCheck.reason,
          retryTimestampReason: retriedTimestampCheck.reason
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
    }

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

  fullText = normalizeText(fullChunks.map((chunk) => chunk.text).join(" "));

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

  postMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 99
  });
  postMessage({ type: "progress", value: 100, current: 100, total: 100 });
  postMessage({
    type: "result",
    text: fullText.trim(),
    segments: fullChunks,
    warnings: Array.from(new Set(warnings)),
    generationControls: getGenerationControlReport(generationControlState)
  });
}

self.onmessage = async (e) => {
  const data = e.data || {};
  const requestType = data.type;
  const modelConfig = getTranscriptionModelConfig(data.modelKey || DEFAULT_TRANSCRIPTION_MODEL_KEY);

  if (requestType === "preload_model") {
    if (isBusy) {
      postMessage({
        type: "model_error",
        modelKey: modelConfig.key,
        message: "Worker is busy"
      });
      return;
    }

    try {
      const modelLoad = await loadTranscriptionModel(modelConfig.key);
      postMessage({
        type: "model_ready",
        modelKey: modelLoad.modelKey,
        loadState: modelLoad.loadState
      });
    } catch (err) {
      postMessage({
        type: "model_error",
        modelKey: modelConfig.key,
        message: err && err.message ? err.message : "Model load failed"
      });
    }
    return;
  }

  if (requestType === "unload") {
    if (isBusy) {
      postMessage({ type: "unload_skipped" });
      return;
    }

    try {
      const unloadedModelKey = activeTranscriptionModelKey;
      await unloadModels();
      postMessage({ type: "unloaded", modelKey: unloadedModelKey });
    } catch (err) {
      postMessage({
        type: "unload_error",
        message: err && err.message ? err.message : "Unload failed"
      });
    }
    return;
  }

  if (isBusy) {
    postMessage({
      type: "error",
      message: "Worker is busy"
    });
    return;
  }

  isBusy = true;

  try {
    if (requestType === "transcribe") {
      await handleTranscription(data.audio, data.selectedLanguage, data.timelineOffset, modelConfig.key);
      return;
    }

    throw new Error("Unsupported worker message");
  } catch (err) {
    const runtimeFailureMeta = requestType === "transcribe"
      ? classifyTranscriptionRuntimeFailure(err, modelConfig.key)
      : null;
    postMessage({
      type: "error",
      message: runtimeFailureMeta
        ? runtimeFailureMeta.userMessage
        : (err && err.message ? err.message : "Worker request failed"),
      errorCode: runtimeFailureMeta
        ? runtimeFailureMeta.errorCode
        : (requestType === "transcribe" && err && err.errorCode ? err.errorCode : ""),
      failedModelKey: runtimeFailureMeta
        ? runtimeFailureMeta.failedModelKey
        : (requestType === "transcribe" && err && err.failedModelKey ? err.failedModelKey : modelConfig.key),
      fallbackModelKey: runtimeFailureMeta
        ? runtimeFailureMeta.fallbackModelKey
        : (requestType === "transcribe" && err && err.fallbackModelKey ? err.fallbackModelKey : "")
    });
  } finally {
    isBusy = false;
  }
};
