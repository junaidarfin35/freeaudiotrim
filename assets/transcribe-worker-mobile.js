let transcriber = null;
let isLoading = false;
let isBusy = false;
let runtimePromise = null;
const ONNX_RUNTIME_NOISE_PATTERNS = [
  "VerifyEachNodeIsAssignedToAnEp",
  "Some nodes were not assigned to the preferred execution providers",
  "Rerunning with verbose output on a non-minimal build will show node assignments"
];

const MOBILE_MODEL_KEY = "baby-raptor";
const MOBILE_MODEL_ID = "Xenova/whisper-base";
const MOBILE_CHUNK_LENGTH_SECONDS = 30;
const MOBILE_STRIDE_LENGTH_SECONDS = 5;
const MOBILE_QUANTIZED = false;

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

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSegments(chunks, durationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return [];
  }

  return chunks.reduce((result, chunk) => {
    const text = normalizeText(chunk && chunk.text);
    const timestamp = chunk && chunk.timestamp;
    const hasTimestamp = Array.isArray(timestamp)
      && Number.isFinite(timestamp[0])
      && Number.isFinite(timestamp[1]);

    if (!text) {
      return result;
    }

    if (hasTimestamp) {
      result.push({
        text,
        timestamp: [timestamp[0], Math.max(timestamp[0], timestamp[1])]
      });
      return result;
    }

    result.push({
      text,
      timestamp: [0, Math.max(0, durationSeconds || 0)]
    });
    return result;
  }, []);
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

      if (info.status !== "progress" && info.status !== "done") {
        return;
      }

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
  };
}

function configureRuntimeEnvironment(runtimeEnv) {
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
    runtimeEnv.useBrowserCache = true;
  }
  if ("useWasmCache" in runtimeEnv) {
    runtimeEnv.useWasmCache = !isSafariLikeBrowser();
  }

  if (runtimeEnv.backends && runtimeEnv.backends.onnx && runtimeEnv.backends.onnx.wasm) {
    runtimeEnv.backends.onnx.wasm.proxy = false;
    runtimeEnv.backends.onnx.wasm.numThreads = 1;
  }
}

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.1");
  }

  const runtime = await runtimePromise;
  configureRuntimeEnvironment(runtime.env);
  return runtime;
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
}

async function loadTranscriptionModel(progressCallback) {
  if (transcriber) {
    return {
      model: transcriber,
      modelKey: MOBILE_MODEL_KEY,
      loadState: "memory"
    };
  }

  if (isLoading) {
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (transcriber) {
      return {
        model: transcriber,
        modelKey: MOBILE_MODEL_KEY,
        loadState: "memory"
      };
    }
  }

  isLoading = true;
  const tracker = createModelProgressTracker(MOBILE_MODEL_KEY);

  try {
    const runtime = await getRuntime();
    postMessage({ type: "model_loading", modelKey: MOBILE_MODEL_KEY });
    transcriber = await runtime.pipeline(
      "automatic-speech-recognition",
      MOBILE_MODEL_ID,
      {
        quantized: MOBILE_QUANTIZED,
        progress_callback: (info) => {
          tracker.update(info);
          if (typeof progressCallback === "function") {
            progressCallback(info);
          }
        },
        revision: MOBILE_MODEL_ID.includes("/whisper-medium") ? "no_attentions" : "main"
      }
    );
  } catch (error) {
    transcriber = null;
    postMessage({
      type: "model_error",
      modelKey: MOBILE_MODEL_KEY,
      message: error && error.message ? error.message : "Model load failed"
    });
    throw error;
  } finally {
    isLoading = false;
  }

  return {
    model: transcriber,
    modelKey: MOBILE_MODEL_KEY,
    loadState: tracker.sawNetworkProgress() ? "downloaded" : "cached"
  };
}

async function handleTranscription(audioBuffer, selectedLanguage) {
  if (!audioBuffer) {
    throw new Error("Missing audio data");
  }

  const audio = new Float32Array(audioBuffer);
  if (!audio.length) {
    throw new Error("Missing audio data");
  }

  const modelLoad = await loadTranscriptionModel();
  const model = modelLoad.model;

  postMessage({
    type: "model_ready",
    modelKey: modelLoad.modelKey,
    loadState: modelLoad.loadState
  });

  postMessage({
    type: "status",
    message: "Transcribing in browser...",
    progress: 8
  });

  const sampleRate = 16000;
  const durationSeconds = audio.length / sampleRate;
  const timePrecision = model
    && model.processor
    && model.processor.feature_extractor
    && model.processor.feature_extractor.config
    && model.model
    && model.model.config
    && Number.isFinite(model.processor.feature_extractor.config.chunk_length)
    && Number.isFinite(model.model.config.max_source_positions)
    && model.model.config.max_source_positions > 0
    ? model.processor.feature_extractor.config.chunk_length / model.model.config.max_source_positions
    : null;
  let callbackChunks = [{ tokens: [], finalised: false }];

  function chunkCallback(data) {
    const activeChunk = callbackChunks[callbackChunks.length - 1];
    Object.assign(activeChunk, data);
    activeChunk.finalised = true;

    if (!data.is_last) {
      callbackChunks.push({ tokens: [], finalised: false });
    }
  }

  function callbackFunction(data) {
    const activeChunk = callbackChunks[callbackChunks.length - 1];
    if (data && data[0] && Array.isArray(data[0].output_token_ids)) {
      activeChunk.tokens = data[0].output_token_ids.slice();
    }

    if (timePrecision && model && model.tokenizer && typeof model.tokenizer._decode_asr === "function") {
      try {
        const partial = model.tokenizer._decode_asr(callbackChunks, {
          time_precision: timePrecision,
          return_timestamps: true,
          force_full_sequences: false
        });
        const partialText = normalizeText(partial && partial[0]);
        const partialMeta = partial && partial[1];
        const partialChunks = partialMeta && Array.isArray(partialMeta.chunks) ? partialMeta.chunks : [];
        postMessage({
          type: "update",
          text: partialText,
          segments: normalizeSegments(partialChunks, durationSeconds)
        });
      } catch (error) {
      }
    }

    postMessage({
      type: "status",
      message: "Transcribing in browser...",
      progress: 45
    });
  }

  const options = {
    top_k: 0,
    do_sample: false,
    chunk_length_s: MOBILE_CHUNK_LENGTH_SECONDS,
    stride_length_s: MOBILE_STRIDE_LENGTH_SECONDS,
    return_timestamps: true,
    force_full_sequences: false,
    callback_function: callbackFunction,
    chunk_callback: chunkCallback,
    task: "transcribe",
    sampling_rate: sampleRate
  };

  if (selectedLanguage && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  const result = await model(audio, options);

  postMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 96
  });
  postMessage({ type: "progress", value: 100, current: 100, total: 100 });

  const text = normalizeText(result && result.text);
  let segments = normalizeSegments(result && result.chunks, durationSeconds);

  if (!segments.length && text) {
    segments = [{
      text,
      timestamp: [0, durationSeconds]
    }];
  }

  postMessage({
    type: "result",
    text,
    segments
  });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const requestType = data.type;
  const modelKey = data.modelKey || MOBILE_MODEL_KEY;

  if (requestType === "translate_subtitles") {
    postMessage({
      type: "translation_error",
      message: "Built-in translation is not available in phone mode yet. Use Refine with ChatGPT or switch to a desktop or laptop."
    });
    return;
  }

  if (modelKey !== MOBILE_MODEL_KEY) {
    postMessage({
      type: requestType === "transcribe" ? "error" : "model_error",
      modelKey,
      message: "This phone worker only supports Baby Raptor."
    });
    return;
  }

  if (requestType === "preload_model") {
    if (isBusy) {
      postMessage({
        type: "model_error",
        modelKey,
        message: "Worker is busy"
      });
      return;
    }

    try {
      const modelLoad = await loadTranscriptionModel();
      postMessage({
        type: "model_ready",
        modelKey: modelLoad.modelKey,
        loadState: modelLoad.loadState
      });
    } catch (error) {
      postMessage({
        type: "model_error",
        modelKey,
        message: error && error.message ? error.message : "Model warmup failed"
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
      await unloadModels();
      postMessage({ type: "unloaded", modelKey: MOBILE_MODEL_KEY });
    } catch (error) {
      postMessage({
        type: "unload_error",
        message: error && error.message ? error.message : "Unload failed"
      });
    }
    return;
  }

  if (isBusy) {
    postMessage({
      type: requestType === "transcribe" ? "error" : "model_error",
      message: "Worker is busy"
    });
    return;
  }

  isBusy = true;

  try {
    if (requestType === "transcribe") {
      await handleTranscription(data.audio, data.selectedLanguage);
      return;
    }

    throw new Error("Unsupported worker message");
  } catch (error) {
    postMessage({
      type: "error",
      message: error && error.message ? error.message : "Worker request failed"
    });
  } finally {
    isBusy = false;
  }
};
