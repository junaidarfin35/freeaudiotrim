let transcriber = null;
let isLoading = false;
let isBusy = false;
let runtimePromise = null;
const arabicPromptIdsByModel = new Map();
const ONNX_RUNTIME_NOISE_PATTERNS = [
  "VerifyEachNodeIsAssignedToAnEp",
  "Some nodes were not assigned to the preferred execution providers",
  "Rerunning with verbose output on a non-minimal build will show node assignments"
];

const MOBILE_MODEL_KEY = "baby-raptor";
const MOBILE_CHUNK_LENGTH_SECONDS = 15;
const MOBILE_STRIDE_LENGTH_SECONDS = 3;
const TIMESTAMP_COLLAPSE_SECONDS = 29.98;
const TIMESTAMP_COLLAPSE_EPSILON = 0.18;
const TIMESTAMP_OVERRUN_EPSILON = 0.35;
const BAD_OVERLAP_EPSILON = 0.6;
const ARABIC_TRANSCRIPTION_PROMPT = "\u0642\u0645 \u0628\u062a\u0641\u0631\u064a\u063a \u0627\u0644\u0646\u0635 \u0628\u062f\u0642\u0629 \u0645\u062b\u0644 \u0645\u0627 \u064a\u0646\u0642\u0627\u0644\u060c \u0628\u062f\u0648\u0646 \u062a\u0631\u062c\u0645\u0629 \u0623\u0648 \u062a\u0644\u062e\u064a\u0635\u060c \u0645\u0639 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0639\u0644\u0627\u0645\u0627\u062a \u0627\u0644\u062a\u0631\u0642\u064a\u0645 \u0639\u0646\u062f \u0627\u0644\u062d\u0627\u062c\u0629. \u0627\u0643\u062a\u0628 \u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a \u0643\u0645\u0627 \u0647\u0648\u060c \u0648\u0625\u0630\u0627 \u0641\u064a\u0647 \u0645\u0648\u0633\u064a\u0642\u0649 \u0627\u0643\u062a\u0628: (\u0645\u0648\u0633\u064a\u0642\u0649)";

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

function isAppleMobileBrowserEngine() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = String(navigator.userAgent || "");
  return /iPhone|iPad|iPod/i.test(userAgent);
}

function isSafariLikeBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = String(navigator.userAgent || "");
  const vendor = String(navigator.vendor || "");

  if (isAppleMobileBrowserEngine()) {
    return true;
  }

  return /Safari/i.test(userAgent)
    && /Apple/i.test(vendor)
    && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/i.test(userAgent);
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

function getMobileRuntimeProfile() {
  const safariLike = isSafariLikeBrowser();

  return {
    modelId: safariLike ? "Xenova/whisper-tiny" : "Xenova/whisper-base",
    chunkLengthSeconds: MOBILE_CHUNK_LENGTH_SECONDS,
    strideLengthSeconds: MOBILE_STRIDE_LENGTH_SECONDS,
    quantized: safariLike,
    partialUpdates: !safariLike
  };
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

async function buildPromptIds(source, promptText) {
  if (!source) {
    return null;
  }

  if (typeof source.get_prompt_ids === "function") {
    return await source.get_prompt_ids(promptText);
  }

  return null;
}

async function getArabicPromptIds(model) {
  if (arabicPromptIdsByModel.has(MOBILE_MODEL_KEY)) {
    return arabicPromptIdsByModel.get(MOBILE_MODEL_KEY);
  }

  const promptSources = [
    model && model.processor,
    model && model.tokenizer,
    model && model.processor && model.processor.tokenizer
  ].filter(Boolean);

  for (const source of promptSources) {
    try {
      const promptIds = await buildPromptIds(source, ARABIC_TRANSCRIPTION_PROMPT);
      if (promptIds) {
        arabicPromptIdsByModel.set(MOBILE_MODEL_KEY, promptIds);
        return promptIds;
      }
    } catch (error) {
    }
  }

  return null;
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

function inspectTimestampQuality(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return {
      ok: false,
      reason: "missing_timestamps"
    };
  }

  let validCount = 0;
  let overlapCount = 0;
  let lastEnd = -Infinity;
  let collapsedCount = 0;

  for (const chunk of chunks) {
    const timestamp = chunk && chunk.timestamp;
    if (!Array.isArray(timestamp) || timestamp.length < 2) {
      continue;
    }

    const start = Number(timestamp[0]);
    const end = Number(timestamp[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    validCount += 1;
    if (end > clipDurationSeconds + TIMESTAMP_OVERRUN_EPSILON || start < -TIMESTAMP_OVERRUN_EPSILON) {
      return { ok: false, reason: "timestamps_exceed_duration" };
    }
    if (end <= start) {
      return { ok: false, reason: "timestamps_invalid_order" };
    }
    if (lastEnd > -Infinity && start < lastEnd - BAD_OVERLAP_EPSILON) {
      overlapCount += 1;
    }
    if (Math.abs(end - TIMESTAMP_COLLAPSE_SECONDS) <= TIMESTAMP_COLLAPSE_EPSILON) {
      collapsedCount += 1;
    }
    lastEnd = Math.max(lastEnd, end);
  }

  if (!validCount) {
    return { ok: false, reason: "missing_timestamps" };
  }
  if (overlapCount >= Math.max(2, Math.floor(validCount * 0.25))) {
    return { ok: false, reason: "timestamps_overlap_badly" };
  }
  if (validCount >= 3 && collapsedCount >= Math.max(3, Math.floor(validCount * 0.5)) && clipDurationSeconds >= 10) {
    return { ok: false, reason: "timestamps_collapsed_29_98" };
  }

  return { ok: true, reason: "" };
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
    runtimeEnv.useBrowserCache = false;
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
  const runtimeProfile = getMobileRuntimeProfile();

  try {
    const runtime = await getRuntime();
    postMessage({ type: "model_loading", modelKey: MOBILE_MODEL_KEY });
    transcriber = await runtime.pipeline(
      "automatic-speech-recognition",
      runtimeProfile.modelId,
      {
        quantized: runtimeProfile.quantized,
        progress_callback: (info) => {
          tracker.update(info);
          if (typeof progressCallback === "function") {
            progressCallback(info);
          }
        },
        revision: runtimeProfile.modelId.includes("/whisper-medium") ? "no_attentions" : "main"
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
  const runtimeProfile = getMobileRuntimeProfile();
  const warnings = [];
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

    if (runtimeProfile.partialUpdates && timePrecision && model && model.tokenizer && typeof model.tokenizer._decode_asr === "function") {
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
    chunk_length_s: runtimeProfile.chunkLengthSeconds,
    stride_length_s: runtimeProfile.strideLengthSeconds,
    return_timestamps: true,
    force_full_sequences: false,
    task: "transcribe",
    sampling_rate: sampleRate
  };

  if (runtimeProfile.partialUpdates) {
    options.callback_function = callbackFunction;
    options.chunk_callback = chunkCallback;
  }

  if (selectedLanguage && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  if (shouldUseArabicPrompt(selectedLanguage)) {
    const promptIds = await getArabicPromptIds(model);
    if (promptIds) {
      options.prompt_ids = promptIds;
    }
  }

  let result = await model(audio, options);
  let resultText = normalizeText(result && result.text);
  let resultSegments = normalizeSegments(result && result.chunks, durationSeconds);
  let timestampCheck = inspectTimestampQuality(result && result.chunks, durationSeconds);
  let repetitionDetected = hasRepetitionLoop(resultText);

  if (!timestampCheck.ok || repetitionDetected) {
    const retryOptions = {
      ...options,
      return_timestamps: true
    };

    if (retryOptions.prompt_ids) {
      delete retryOptions.prompt_ids;
    }

    const retriedResult = await model(audio, retryOptions);
    const retriedText = normalizeText(retriedResult && retriedResult.text);
    const retriedSegments = normalizeSegments(retriedResult && retriedResult.chunks, durationSeconds);
    const retriedTimestampCheck = inspectTimestampQuality(retriedResult && retriedResult.chunks, durationSeconds);
    const retriedRepetitionDetected = hasRepetitionLoop(retriedText);

    if (retriedTimestampCheck.ok && !retriedRepetitionDetected) {
      result = retriedResult;
      resultText = retriedText;
      resultSegments = retriedSegments;
      timestampCheck = retriedTimestampCheck;
      repetitionDetected = false;
      warnings.push("language_hint");
    } else {
      if (!timestampCheck.ok || !retriedTimestampCheck.ok) {
        warnings.push("weak_audio");
      }
      if (repetitionDetected || retriedRepetitionDetected) {
        warnings.push("repetition");
        resultText = "";
        resultSegments = [];
      }
      if (!resultText && !retriedText) {
        resultText = "";
        resultSegments = [];
      }
    }
  }

  postMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 96
  });
  postMessage({ type: "progress", value: 100, current: 100, total: 100 });

  const text = resultText;
  let segments = resultSegments;

  if (!segments.length && text) {
    segments = [{
      text,
      timestamp: [0, durationSeconds]
    }];
  }

  postMessage({
    type: "result",
    text,
    segments,
    warnings: Array.from(new Set(warnings))
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
