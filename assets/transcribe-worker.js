let transcriber = null;
let activeTranscriptionModelKey = null;
let isLoading = false;
let isBusy = false;
let translationModel = null;
let modernTransformersRuntimePromise = null;
let legacyTransformersRuntimePromise = null;
const DEFAULT_TRANSCRIPTION_MODEL_KEY = "triceratop";
const DEFAULT_CHUNK_LENGTH_SECONDS = 29;
const DEFAULT_STRIDE_LENGTH_SECONDS = 5;
const MIN_SPEECH_REGION_CLIP_SECONDS = 12;
const TRANSCRIPTION_MODELS = {
  "baby-raptor": {
    key: "baby-raptor",
    label: "Baby Raptor",
    modelId: "onnx-community/whisper-base_timestamped"
  },
  triceratop: {
    key: "triceratop",
    label: "Triceratop",
    modelId: "onnx-community/whisper-small_timestamped"
  },
  "t-rex": {
    key: "t-rex",
    label: "T-Rex",
    modelId: "onnx-community/whisper-large-v3-turbo_timestamped"
  }
};
const ARABIC_TRANSCRIPTION_PROMPT = "هذا تسجيل صوتي باللغة العربية. اكتب الكلام كما يُنطق بوضوح وبنصه الأصلي، مع الحفاظ على المعنى وتسلسل الجمل، من دون ترجمة أو تلخيص. إذا نطق المتحدث كلمات أو عبارات إنجليزية، فاكتبها بالإنجليزية كما قيلت ولا تعرّبها. إذا وُجدت موسيقى أو مؤثر صوتي واضح بلا كلام، فاكتب: (موسيقى). اكتب الأسماء والأماكن والمصطلحات كما تُسمع، واستخدم علامات ترقيم خفيفة عند الحاجة فقط.";

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
  const hardwareConcurrency = typeof navigator !== "undefined"
    ? Number(navigator.hardwareConcurrency)
    : NaN;
  const threadCount = safariLike
    ? 1
    : Math.max(1, Math.min(4, Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 2));

  runtimeEnv.allowLocalModels = false;

  if ("useBrowserCache" in runtimeEnv) {
    runtimeEnv.useBrowserCache = !safariLike;
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

function shouldUseExtendedArabicPrompt(modelKey) {
  return getTranscriptionModelConfig(modelKey).key === "t-rex";
}

function isSmallerTimestampedWhisper(modelKey) {
  const resolvedModel = getTranscriptionModelConfig(modelKey);
  return resolvedModel.key === "baby-raptor" || resolvedModel.key === "triceratop";
}

function getArabicDecodeProfile(modelKey) {
  const resolvedModel = getTranscriptionModelConfig(modelKey);

  if (resolvedModel.key === "t-rex") {
    return {
      chunk_length_s: 20,
      stride_length_s: 6,
      condition_on_prev_tokens: false,
      compression_ratio_threshold: 1.3,
      no_speech_threshold: 0.6,
      temperature: [0.0, 0.1, 0.2],
      num_beams: 2,
      useExtendedPrompt: true
    };
  }

  return null;
}

function getDefaultTranscriptionOptions(modelKey) {
  const useMobileLegacyDefaults = isMobileSafariLikeBrowser() && modelKey === "baby-raptor";
  return {
    chunk_length_s: useMobileLegacyDefaults ? 15 : DEFAULT_CHUNK_LENGTH_SECONDS,
    stride_length_s: useMobileLegacyDefaults ? 3 : DEFAULT_STRIDE_LENGTH_SECONDS,
    return_timestamps: true,
    task: "transcribe"
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
      loadState: "memory"
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
        loadState: "memory"
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
    transcriber = null;
    activeTranscriptionModelKey = null;
    postMessage({
      type: "model_error",
      modelKey: modelConfig.key,
      message: err && err.message ? err.message : "Model load failed"
    });
    throw err;
  } finally {
    isLoading = false;
  }

  activeTranscriptionModelKey = modelConfig.key;
  return {
    model: transcriber,
    modelKey: modelConfig.key,
    loadState: tracker && tracker.sawNetworkProgress() ? "downloaded" : "cached"
  };
}

async function loadTranslationModel() {
  if (!translationModel) {
    const modernRuntime = await getModernTransformersRuntime();
    translationModel = await modernRuntime.pipeline(
      "translation",
      "Xenova/nllb-200-distilled-600M"
    );
  }

  return translationModel;
}

async function disposePipelineInstance(instance) {
  if (!instance || typeof instance.dispose !== "function") {
    return;
  }

  await instance.dispose();
}

async function unloadModels(includeTranslation = true) {
  await disposePipelineInstance(transcriber);
  transcriber = null;
  activeTranscriptionModelKey = null;

  if (includeTranslation) {
    await disposePipelineInstance(translationModel);
    translationModel = null;
  }
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
      const promptIds = await buildPromptIds(source, ARABIC_TRANSCRIPTION_PROMPT);
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

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
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

function buildArabicSpeechAwareChunks(audio, sampleRate) {
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

  let lastEnd = target.length ? target[target.length - 1].timestamp[1] : -Infinity;

  sourceChunks.forEach((chunkResult) => {
    let start = Number(chunkResult && chunkResult.timestamp && chunkResult.timestamp[0]);
    const end = Number(chunkResult && chunkResult.timestamp && chunkResult.timestamp[1]);
    const text = normalizeText(chunkResult && chunkResult.text);

    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }

    start += offsetSeconds;
    const absoluteEnd = end + offsetSeconds;

    if (absoluteEnd <= lastEnd + 0.02) {
      return;
    }

    if (start < lastEnd && absoluteEnd > lastEnd) {
      start = lastEnd;
    }

    if (absoluteEnd <= start) {
      return;
    }

    target.push({
      text,
      timestamp: [start, absoluteEnd]
    });
    lastEnd = absoluteEnd;
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
    ...getDefaultTranscriptionOptions(modelLoad.modelKey)
  };

  if (selectedLanguage && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  let fullText = "";
  let fullChunks = [];
  const useSpeechAwareChunks = audio.length > sampleRate * MIN_SPEECH_REGION_CLIP_SECONDS;
  const chunkPlan = useSpeechAwareChunks ? buildArabicSpeechAwareChunks(audio, sampleRate) : [{
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

    const result = await model(chunk.audio, {
      ...options,
      monitor_progress: (state) => {
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
      }
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

    if (result && Array.isArray(result.chunks) && result.chunks.length) {
      appendTimedChunks(fullChunks, result.chunks, chunkOffsetSeconds);
    } else if (result && result.text) {
      const fallbackText = normalizeText(result.text);
      if (fallbackText) {
        fullChunks.push({
          text: fallbackText,
          timestamp: [chunkOffsetSeconds, chunkOffsetSeconds + (chunk.audio.length / sampleRate)]
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

  postMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 99
  });
  postMessage({ type: "progress", value: 100, current: 100, total: 100 });
  postMessage({
    type: "result",
    text: fullText.trim(),
    segments: fullChunks
  });
}

async function handleTranslation(data) {
  data.mode = "full";
  if (!data.sourceLang || !data.targetLang) {
    throw new Error("Translation requires both source and target languages.");
  }
  const model = await loadTranslationModel();
  let preparedText = improveSpeechStructure(data.text);
  preparedText = normalizeText(preparedText);

  const sentences = splitSentences(preparedText);
  const chunkSize = data.mode === "improved" ? 200 : 300;
  const chunks = buildChunks(sentences, chunkSize);
  const results = [];

  if (!chunks.length) {
    throw new Error("Translation could not be completed. Try a shorter or clearer input.");
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];

    if (!chunk || !chunk.trim()) {
      continue;
    }

    const output = await model(chunk, {
      src_lang: data.sourceLang,
      tgt_lang: data.targetLang
    });

    results.push(output && output[0] ? output[0].translation_text : "");

    postMessage({
      type: "translation_progress",
      progress: Math.round(((i + 1) / chunks.length) * 100)
    });
  }

  postMessage({
    type: "translation_result",
    text: cleanTranslation(results.join(" "))
  });
}

async function handleSubtitleTranslation(data) {
  data.mode = "subtitle";
  const texts = Array.isArray(data.texts) ? data.texts : [];

  if (!data.sourceLang || !data.targetLang) {
    throw new Error("Translation requires both source and target languages.");
  }

  if (false && data.useWhisperTranslate) {
    // Use Whisper translation
    const audioBuffer = data.audio;
    if (!audioBuffer) {
      postMessage({
        type: "translation_result",
        texts: texts
      });
      return;
    }

    const audio = new Float32Array(audioBuffer);
    if (!audio.length) {
      postMessage({
        type: "translation_result",
        texts: texts
      });
      return;
    }

    const translationModelKey = data.modelKey || DEFAULT_TRANSCRIPTION_MODEL_KEY;
    const modelLoad = await loadTranscriptionModel(translationModelKey);
    const model = modelLoad.model;

    postMessage({
      type: "model_ready",
      modelKey: modelLoad.modelKey,
      loadState: modelLoad.loadState
    });
    const sampleRate = 16000;
    const chunkSize = sampleRate * 25;
    const chunks = [];

    for (let i = 0; i < audio.length; i += chunkSize) {
      chunks.push(audio.slice(i, i + chunkSize));
    }

    let fullText = "";
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const progress = Math.max(10, Math.round((i / chunks.length) * 100));
      postMessage({ type: "progress", value: progress, current: progress, total: 100 });

      const result = await model(chunk, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        task: "translate"
      });

      if (result && result.text) {
        fullText += (fullText ? " " : "") + normalizeText(result.text);
      }
    }

    const translatedTexts = fullText ? fullText.split(/\r?\n/) : texts;
    postMessage({
      type: "translation_result",
      texts: translatedTexts
    });
  } else {
    const model = await loadTranslationModel();
    const translatedTexts = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      try {
        const result = await model(text, {
          src_lang: data.sourceLang,
          tgt_lang: data.targetLang
        });

        const outputText = result && result[0]
          ? normalizeText(result[0].translation_text)
          : "";

        let refined = cleanTranslation(outputText);
        const prev = translatedTexts[translatedTexts.length - 1] || "";
        refined = smoothWithContext(prev, refined);

        translatedTexts.push(refined);

      } catch (err) {
        translatedTexts.push(text);
      }

      postMessage({
        type: "translation_progress",
        progress: Math.round(((i + 1) / texts.length) * 100)
      });
    }

    postMessage({
      type: "translation_result",
      texts: translatedTexts
    });
  }
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
      await unloadModels(data.includeTranslation !== false);
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
      type: requestType === "transcribe" ? "error" : "translation_error",
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

    if (requestType === "translate") {
      await handleTranslation(data);
      return;
    }

    if (requestType === "translate_subtitles") {
      await handleSubtitleTranslation(data);
      return;
    }

    throw new Error("Unsupported worker message");
  } catch (err) {
    postMessage({
      type: requestType === "transcribe" ? "error" : "translation_error",
      message: err && err.message ? err.message : "Worker request failed"
    });
  } finally {
    isBusy = false;
  }
};
