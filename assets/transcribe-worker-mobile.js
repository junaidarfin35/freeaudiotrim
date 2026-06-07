let transcriber = null;
let transcriberProfile = null;
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
const MOBILE_CHUNK_LENGTH_SECONDS = 30;
const MOBILE_STRIDE_LENGTH_SECONDS = 5;
const MOBILE_SAFARI_CHUNK_LENGTH_SECONDS = 29;
const MOBILE_SAFARI_STRIDE_LENGTH_SECONDS = 5;
const MIN_SPEECH_REGION_CLIP_SECONDS = 12;
const TIMESTAMP_COLLAPSE_SECONDS = 29.98;
const TIMESTAMP_COLLAPSE_EPSILON = 0.18;
const TIMESTAMP_OVERRUN_EPSILON = 0.35;
const BAD_OVERLAP_EPSILON = 0.6;
const SAFE_NO_REPEAT_NGRAM_SIZE = 3;
const SAFE_REPETITION_PENALTY = 1.02;
const MOBILE_DEVICE_LIMIT_MESSAGE = "Local transcription could not complete on this device. Try a newer device or use the desktop site.";
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
const ARABIC_TRANSCRIPTION_PROMPT = "\u0642\u0645 \u0628\u062a\u0641\u0631\u064a\u063a \u0627\u0644\u0646\u0635 \u0628\u062f\u0642\u0629 \u0645\u062b\u0644 \u0645\u0627 \u064a\u0646\u0642\u0627\u0644\u060c \u0628\u062f\u0648\u0646 \u062a\u0631\u062c\u0645\u0629 \u0623\u0648 \u062a\u0644\u062e\u064a\u0635\u060c \u0645\u0639 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0639\u0644\u0627\u0645\u0627\u062a \u0627\u0644\u062a\u0631\u0642\u064a\u0645 \u0639\u0646\u062f \u0627\u0644\u062d\u0627\u062c\u0629. \u0627\u0643\u062a\u0628 \u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a \u0643\u0645\u0627 \u0647\u0648\u060c \u0648\u0625\u0630\u0627 \u0641\u064a\u0647 \u0645\u0648\u0633\u064a\u0642\u0649 \u0627\u0643\u062a\u0628: (\u0645\u0648\u0633\u064a\u0642\u0649)";
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

  if (safariLike) {
    return {
      modelId: "Xenova/whisper-base",
      chunkLengthSeconds: MOBILE_SAFARI_CHUNK_LENGTH_SECONDS,
      strideLengthSeconds: MOBILE_SAFARI_STRIDE_LENGTH_SECONDS,
      quantized: true,
      partialUpdates: true,
      timestampsEnabled: true,
      pathLabel: "mobile-safari-base",
      preferredModelId: "Xenova/whisper-base"
    };
  }

  return {
    modelId: "Xenova/whisper-base",
    chunkLengthSeconds: MOBILE_CHUNK_LENGTH_SECONDS,
    strideLengthSeconds: MOBILE_STRIDE_LENGTH_SECONDS,
    quantized: false,
    partialUpdates: true,
    timestampsEnabled: true,
    pathLabel: "mobile-browser-base",
    preferredModelId: "Xenova/whisper-base"
  };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function pushUnique(target, value) {
  if (!value || !Array.isArray(target) || target.includes(value)) {
    return;
  }

  target.push(value);
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

function logWorkerEvent(eventName, payload) {
  try {
    console.info("[transcribe-worker-mobile]", eventName, payload);
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

function createGenerationControlState(model, runtimeProfile) {
  const state = {
    modelKey: MOBILE_MODEL_KEY,
    modelId: runtimeProfile && runtimeProfile.modelId ? runtimeProfile.modelId : "",
    preferredModelId: runtimeProfile && runtimeProfile.preferredModelId ? runtimeProfile.preferredModelId : "",
    fallbackFromModelId: runtimeProfile && runtimeProfile.fallbackFromModelId ? runtimeProfile.fallbackFromModelId : "",
    pathLabel: runtimeProfile && runtimeProfile.pathLabel
      ? runtimeProfile.pathLabel
      : (runtimeProfile && runtimeProfile.quantized ? "mobile-safari-legacy" : "mobile-browser-legacy"),
    runtimeHints: getGenerationConfigHints(model),
    controlsRejected: false,
    plannedApplied: [],
    skipped: [],
    hasLoggedInitialReport: false
  };

  pushUnique(state.skipped, "mobile repetition controls disabled for accuracy testing");

  return state;
}

function getGenerationControlReport(state) {
  return {
    modelKey: state.modelKey,
    modelId: state.modelId,
    preferredModelId: state.preferredModelId,
    fallbackFromModelId: state.fallbackFromModelId,
    path: state.pathLabel,
    runtimeHints: state.runtimeHints.slice(),
    applied: state.controlsRejected ? [] : state.plannedApplied.slice(),
    skipped: state.skipped.slice(),
    controlsRejected: state.controlsRejected
  };
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
  const cacheKey = modelKey || MOBILE_MODEL_KEY;
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
    } catch (error) {
    }
  }

  return null;
}

function getGenerationControlOverrides(state) {
  return {};
}

function isUnsupportedGenerationControlError(error) {
  return /no_repeat_ngram_size|repetition_penalty|unsupported|unexpected|unknown|invalid/i.test(getErrorText(error));
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

function hasRepetitionLoop(text, language) {
  if (hasRepeatedPhraseLoop(text)) {
    return true;
  }

  if (shouldUseArabicPrompt(language)) {
    return false;
  }

  return hasArabicSyllableLoop(text);
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

function inspectBadTranscriptionOutput(text, audio, language) {
  const reasons = [];
  const audioStats = getAudioSignalStats(audio);
  const useRepetitionGuards = !shouldUseArabicPrompt(language);
  if (useRepetitionGuards && hasRepetitionLoop(text, language)) {
    reasons.push("repetition_loop");
  }
  if (useRepetitionGuards && hasRepeatedShortTokenLoop(text)) {
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

function inspectTimestampQuality(chunks, clipDurationSeconds) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return {
      ok: false,
      reason: "missing_timestamps"
    };
  }

  let validCount = 0;
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
    if (Math.abs(end - TIMESTAMP_COLLAPSE_SECONDS) <= TIMESTAMP_COLLAPSE_EPSILON) {
      collapsedCount += 1;
    }
  }

  if (!validCount) {
    return { ok: false, reason: "missing_timestamps" };
  }
  if (validCount >= 3 && collapsedCount >= Math.max(3, Math.floor(validCount * 0.5)) && clipDurationSeconds >= 10) {
    return { ok: false, reason: "timestamps_collapsed_29_98" };
  }

  return { ok: true, reason: "" };
}

function getPercentile(values, percentile) {
  if (!values || !values.length) {
    return 0;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index] || 0;
}

function buildSpeechAwareChunks(audio, sampleRate, chunkLengthSeconds, strideLengthSeconds) {
  if (!audio || !audio.length || audio.length <= sampleRate * MIN_SPEECH_REGION_CLIP_SECONDS) {
    return [{
      startSample: 0,
      endSample: audio.length
    }];
  }

  const frameMs = 30;
  const frameSize = Math.max(160, Math.floor(sampleRate * (frameMs / 1000)));
  const minSpeechFrames = Math.max(3, Math.round(120 / frameMs));
  const mergePauseFrames = Math.max(6, Math.round(420 / frameMs));
  const packPauseFrames = Math.max(14, Math.round(900 / frameMs));
  const paddingFrames = Math.max(9, Math.round(320 / frameMs));
  const maxChunkFrames = Math.max(
    1,
    Math.round(((chunkLengthSeconds - strideLengthSeconds) * 1000) / frameMs)
  );
  const rms = [];
  let totalEnergy = 0;
  let totalCount = 0;

  for (let index = 0; index < audio.length; index += frameSize) {
    let sum = 0;
    let count = 0;

    for (let inner = 0; inner < frameSize && index + inner < audio.length; inner += 1) {
      const sample = audio[index + inner];
      sum += sample * sample;
      count += 1;
    }

    totalEnergy += sum;
    totalCount += count;
    rms.push(Math.sqrt(sum / Math.max(1, count)));
  }

  const globalRms = Math.sqrt(totalEnergy / Math.max(1, totalCount));
  const noiseFloor = getPercentile(rms, 0.2);
  const threshold = Math.max(0.0045, Math.min(0.025, Math.max(globalRms * 0.4, noiseFloor * 2.0)));
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
      startSample,
      endSample
    };
  }).filter((chunk) => chunk.endSample > chunk.startSample);

  return chunks.length ? chunks : [{
    startSample: 0,
    endSample: audio.length
  }];
}

function buildSpeechAwareChunksFromSpans(audio, sampleRate, spans, chunkLengthSeconds, strideLengthSeconds) {
  if (!audio || !audio.length || !Array.isArray(spans) || !spans.length) {
    return [{
      startSample: 0,
      endSample: audio ? audio.length : 0
    }];
  }

  const minSpeechSamples = Math.max(1, Math.round(sampleRate * 0.12));
  const mergeGapSamples = Math.max(1, Math.round(sampleRate * 0.35));
  const packGapSamples = Math.max(1, Math.round(sampleRate * 0.9));
  const paddingSamples = Math.max(1, Math.round(sampleRate * 0.12));
  const maxChunkSamples = Math.max(
    sampleRate,
    Math.round(Math.max(1, chunkLengthSeconds - strideLengthSeconds) * sampleRate)
  );
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

  const expandedSpans = mergedSpans.map((span) => ({
    startSample: Math.max(0, span.startSample - paddingSamples),
    endSample: Math.min(audio.length, span.endSample + paddingSamples)
  }));

  const packedChunks = [];
  expandedSpans.forEach((span) => {
    if (!packedChunks.length) {
      packedChunks.push({
        startSample: span.startSample,
        endSample: span.endSample
      });
      return;
    }

    const current = packedChunks[packedChunks.length - 1];
    const gapSamples = span.startSample - current.endSample;
    const nextDuration = span.endSample - current.startSample;

    if (gapSamples <= packGapSamples && nextDuration <= maxChunkSamples) {
      current.endSample = span.endSample;
    } else {
      packedChunks.push({
        startSample: span.startSample,
        endSample: span.endSample
      });
    }
  });

  const chunks = packedChunks.map((chunk) => ({
    startSample: chunk.startSample,
    endSample: chunk.endSample
  })).filter((chunk) => chunk.endSample > chunk.startSample);

  return chunks.length ? chunks : [{
    startSample: 0,
    endSample: audio.length
  }];
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

async function runWhisperTranscriptionAttempt(model, audio, baseOptions, generationState) {
  const controlOverrides = getGenerationControlOverrides(generationState);

  if (generationState && !generationState.hasLoggedInitialReport) {
    generationState.hasLoggedInitialReport = true;
    logWorkerEvent("generation_controls", getGenerationControlReport(generationState));
  }

  try {
    return await model(audio, {
      ...baseOptions,
      ...controlOverrides
    });
  } catch (error) {
    if (!generationState || !Object.keys(controlOverrides).length || !isUnsupportedGenerationControlError(error)) {
      throw error;
    }

    markGenerationControlsUnsupported(generationState, error);
    logWorkerEvent("generation_controls_fallback", getGenerationControlReport(generationState));
    return await model(audio, {
      ...baseOptions
    });
  }
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
  transcriberProfile = null;
}

function runtimeProfilesMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.modelId === right.modelId
    && !!left.quantized === !!right.quantized
    && left.pathLabel === right.pathLabel;
}

async function createTranscriber(runtime, runtimeProfile, tracker, progressCallback) {
  return runtime.pipeline(
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
}

async function loadTranscriptionModel(progressCallback) {
  const runtimeProfile = getMobileRuntimeProfile();

  if (transcriber && runtimeProfilesMatch(transcriberProfile, runtimeProfile)) {
    return {
      model: transcriber,
      modelKey: MOBILE_MODEL_KEY,
      loadState: "memory",
      runtimeProfile: transcriberProfile || runtimeProfile
    };
  }

  if (isLoading) {
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (transcriber && runtimeProfilesMatch(transcriberProfile, runtimeProfile)) {
      return {
        model: transcriber,
        modelKey: MOBILE_MODEL_KEY,
        loadState: "memory",
        runtimeProfile: transcriberProfile || runtimeProfile
      };
    }
  }

  if (transcriber && !runtimeProfilesMatch(transcriberProfile, runtimeProfile)) {
    await unloadModels();
  }

  isLoading = true;
  const tracker = createModelProgressTracker(MOBILE_MODEL_KEY);

  try {
    const runtime = await getRuntime();
    postMessage({ type: "model_loading", modelKey: MOBILE_MODEL_KEY });
    transcriber = await createTranscriber(runtime, runtimeProfile, tracker, progressCallback);
    transcriberProfile = runtimeProfile;
    logWorkerEvent("mobile_model_profile_loaded", {
      modelKey: MOBILE_MODEL_KEY,
      path: runtimeProfile.pathLabel,
      modelId: runtimeProfile.modelId,
      preferredModelId: runtimeProfile.preferredModelId || runtimeProfile.modelId,
      quantized: runtimeProfile.quantized,
      partialUpdates: runtimeProfile.partialUpdates !== false,
      timestampsEnabled: runtimeProfile.timestampsEnabled !== false,
      fallbackUsed: false
    });
  } catch (error) {
    transcriber = null;
    transcriberProfile = null;
    postMessage({
      type: "model_error",
      modelKey: MOBILE_MODEL_KEY,
      message: MOBILE_DEVICE_LIMIT_MESSAGE
    });
    throw new Error(MOBILE_DEVICE_LIMIT_MESSAGE);
  } finally {
    isLoading = false;
  }

  return {
    model: transcriber,
    modelKey: MOBILE_MODEL_KEY,
    loadState: tracker.sawNetworkProgress() ? "downloaded" : "cached",
    runtimeProfile: transcriberProfile || runtimeProfile
  };
}

async function handleTranscription(audioBuffer, selectedLanguage, externalSpeechSpans) {
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
  const runtimeProfile = modelLoad.runtimeProfile || getMobileRuntimeProfile();
  function getTimePrecision(activeModel) {
    return activeModel
      && activeModel.processor
      && activeModel.processor.feature_extractor
      && activeModel.processor.feature_extractor.config
      && activeModel.model
      && activeModel.model.config
      && Number.isFinite(activeModel.processor.feature_extractor.config.chunk_length)
      && Number.isFinite(activeModel.model.config.max_source_positions)
      && activeModel.model.config.max_source_positions > 0
      ? activeModel.processor.feature_extractor.config.chunk_length / activeModel.model.config.max_source_positions
      : null;
  }

  async function createTranscriptionOptions(activeModel, activeRuntimeProfile) {
    const timePrecision = getTimePrecision(activeModel);
    const timestampsEnabled = !activeRuntimeProfile || activeRuntimeProfile.timestampsEnabled !== false;
    const allowPartialUpdates = !!(
      activeRuntimeProfile
      && activeRuntimeProfile.partialUpdates !== false
      && timestampsEnabled
      && timePrecision
      && activeModel
      && activeModel.tokenizer
      && typeof activeModel.tokenizer._decode_asr === "function"
    );
    let callbackChunks = allowPartialUpdates
      ? [{ tokens: [], finalised: false }]
      : null;

    function chunkCallback(data) {
      if (!callbackChunks) {
        return;
      }

      const activeChunk = callbackChunks[callbackChunks.length - 1];
      Object.assign(activeChunk, data);
      activeChunk.finalised = true;

      if (!data.is_last) {
        callbackChunks.push({ tokens: [], finalised: false });
      }
    }

    function callbackFunction(data) {
      if (!callbackChunks) {
        return;
      }

      const activeChunk = callbackChunks[callbackChunks.length - 1];
      if (data && data[0] && Array.isArray(data[0].output_token_ids)) {
        activeChunk.tokens = data[0].output_token_ids.slice();
      }

      try {
        const partial = activeModel.tokenizer._decode_asr(callbackChunks, {
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

      postMessage({
        type: "status",
        message: "Transcribing in browser...",
        progress: 45
      });
    }

    const options = {
      top_k: 0,
      do_sample: false,
      chunk_length_s: activeRuntimeProfile.chunkLengthSeconds,
      stride_length_s: activeRuntimeProfile.strideLengthSeconds,
      return_timestamps: timestampsEnabled,
      force_full_sequences: false,
      task: "transcribe"
    };

    if (allowPartialUpdates) {
      options.callback_function = callbackFunction;
      options.chunk_callback = chunkCallback;
    }

    if (selectedLanguage && selectedLanguage !== "auto") {
      options.language = selectedLanguage;
    }

    if (shouldUseArabicPrompt(selectedLanguage)) {
      const promptIds = await getArabicPromptIds(activeModel, MOBILE_MODEL_KEY);
      if (promptIds) {
        options.prompt_ids = promptIds;
        logWorkerEvent("mobile_arabic_prompt_ids", {
          modelKey: MOBILE_MODEL_KEY,
          path: activeRuntimeProfile && activeRuntimeProfile.pathLabel ? activeRuntimeProfile.pathLabel : "mobile",
          enabled: true
        });
      } else {
        logWorkerEvent("mobile_arabic_prompt_ids", {
          modelKey: MOBILE_MODEL_KEY,
          path: activeRuntimeProfile && activeRuntimeProfile.pathLabel ? activeRuntimeProfile.pathLabel : "mobile",
          enabled: false
        });
      }
    }

    return options;
  }

  async function runValidatedTranscription(activeModel, activeRuntimeProfile, allowDecodeFallback) {
    const generationControlState = createGenerationControlState(activeModel, activeRuntimeProfile);
    const options = await createTranscriptionOptions(activeModel, activeRuntimeProfile);
    const timestampsEnabled = !activeRuntimeProfile || activeRuntimeProfile.timestampsEnabled !== false;
    const shouldUseExternalSpeechSpans = Array.isArray(externalSpeechSpans) && externalSpeechSpans.length > 0;
    const useSpeechAwareChunks = shouldUseExternalSpeechSpans;
    const chunkPlan = shouldUseExternalSpeechSpans
      ? buildSpeechAwareChunksFromSpans(audio, sampleRate, externalSpeechSpans, activeRuntimeProfile.chunkLengthSeconds, activeRuntimeProfile.strideLengthSeconds)
      : [{
          startSample: 0,
          endSample: audio.length
        }];
    const combinedWarnings = [];
    const combinedSegments = [];
    const combinedTextParts = [];

    if (!timestampsEnabled) {
      logWorkerEvent("mobile_timestamp_mode", {
        modelKey: MOBILE_MODEL_KEY,
        path: generationControlState.pathLabel,
        mode: "text_first_no_timestamps"
      });
    }
    if (useSpeechAwareChunks && chunkPlan.length > 1) {
      postMessage({
        type: "status",
        message: "Analyzing speech regions...",
        progress: 14
      });
    }

    for (let index = 0; index < chunkPlan.length; index += 1) {
      const chunk = chunkPlan[index];
      const chunkAudio = extractChunkAudio(audio, chunk);
      const chunkOffsetSeconds = chunk.startSample / sampleRate;
      const clipDurationSeconds = chunkAudio.length / sampleRate;
      if (chunkPlan.length > 1) {
        const chunkProgress = 12 + Math.round(((index + 1) / chunkPlan.length) * 82);
        postMessage({
          type: "status",
          message: "Transcribing part " + (index + 1) + " of " + chunkPlan.length + "...",
          progress: chunkProgress
        });
      }

      let result = await runWhisperTranscriptionAttempt(activeModel, chunkAudio, options, generationControlState);
      let resultText = normalizeText(result && result.text);
      let rawResultChunks = sanitizeTimedChunks(result && result.chunks, clipDurationSeconds);
      let resultSegments = normalizeSegments(rawResultChunks, clipDurationSeconds);
      let timestampCheck = timestampsEnabled
        ? inspectTimestampQuality(rawResultChunks, clipDurationSeconds)
        : { ok: true, reason: "timestamps_disabled" };
      let badOutputCheck = inspectBadTranscriptionOutput(resultText, chunkAudio, selectedLanguage);
      const mobileWarnings = [];
      const hasUsableTimestampedSegments = timestampsEnabled && timestampCheck.ok && resultSegments.length > 0;

      if (!timestampCheck.ok || (!badOutputCheck.ok && !hasUsableTimestampedSegments)) {
        const retryOptions = {
          ...options,
          return_timestamps: timestampsEnabled
        };
        if (retryOptions.prompt_ids) {
          delete retryOptions.prompt_ids;
          logWorkerEvent("mobile_arabic_prompt_ids_retry_disabled", {
            modelKey: MOBILE_MODEL_KEY,
            path: generationControlState.pathLabel
          });
        }
        const retryReason = !timestampCheck.ok
          ? timestampCheck.reason
          : badOutputCheck.reasons.join(",") || "bad_output";
        logWorkerEvent("transcription_retry", {
          modelKey: MOBILE_MODEL_KEY,
          path: generationControlState.pathLabel,
          chunkIndex: index,
          retryReason
        });
        const retriedResult = await runWhisperTranscriptionAttempt(activeModel, chunkAudio, retryOptions, generationControlState);
        const retriedText = normalizeText(retriedResult && retriedResult.text);
        const retriedRawChunks = sanitizeTimedChunks(retriedResult && retriedResult.chunks, clipDurationSeconds);
        const retriedSegments = normalizeSegments(retriedRawChunks, clipDurationSeconds);
        const retriedTimestampCheck = timestampsEnabled
          ? inspectTimestampQuality(retriedRawChunks, clipDurationSeconds)
          : { ok: true, reason: "timestamps_disabled" };
        const retriedBadOutputCheck = inspectBadTranscriptionOutput(retriedText, chunkAudio, selectedLanguage);
        const retriedHasUsableTimestampedSegments = timestampsEnabled
          && retriedTimestampCheck.ok
          && retriedSegments.length > 0;

        if (retriedTimestampCheck.ok && retriedBadOutputCheck.ok) {
          result = retriedResult;
          resultText = retriedText;
          resultSegments = retriedSegments;
          timestampCheck = retriedTimestampCheck;
          badOutputCheck = retriedBadOutputCheck;
          pushUnique(mobileWarnings, "language_hint");
        } else {
          logWorkerEvent("transcription_retry_failed", {
            modelKey: MOBILE_MODEL_KEY,
            path: generationControlState.pathLabel,
            chunkIndex: index,
            retryReason,
            initialBadOutputReasons: badOutputCheck.reasons,
            retryBadOutputReasons: retriedBadOutputCheck.reasons,
            initialTimestampReason: timestampCheck.reason,
            retryTimestampReason: retriedTimestampCheck.reason
          });
          if (retriedHasUsableTimestampedSegments) {
            result = retriedResult;
            resultText = retriedText;
            resultSegments = retriedSegments;
            timestampCheck = retriedTimestampCheck;
            badOutputCheck = retriedBadOutputCheck;
          } else if (
            retriedBadOutputCheck.ok
            && retriedText
            && retriedText.trim()
          ) {
            result = retriedResult;
            resultText = retriedText;
            resultSegments = [];
            pushUnique(mobileWarnings, "weak_audio");
            pushUnique(mobileWarnings, "timestamp_fallback_text");
            logWorkerEvent("transcription_timestamp_fallback_text", {
              modelKey: MOBILE_MODEL_KEY,
              path: generationControlState.pathLabel,
              chunkIndex: index,
              retryReason,
              timestampReason: retriedTimestampCheck.reason
            });
          } else if (
            !timestampsEnabled
            && retriedText
            && retriedText.trim()
          ) {
            result = retriedResult;
            resultText = retriedText;
            resultSegments = [];
            pushUnique(mobileWarnings, "unstable_output");
            logWorkerEvent("transcription_unstable_output_fallback_text", {
              modelKey: MOBILE_MODEL_KEY,
              path: generationControlState.pathLabel,
              chunkIndex: index,
              retryReason,
              badOutputReasons: retriedBadOutputCheck.reasons
            });
          } else {
            throw new Error(MOBILE_DEVICE_LIMIT_MESSAGE);
          }
        }
      }

      if (resultText) {
        combinedTextParts.push(resultText);
      }
      if (timestampsEnabled && resultSegments.length && !badOutputCheck.ok) {
        pushUnique(mobileWarnings, "repetition");
        if (badOutputCheck.reasons.includes("silence_hallucination")) {
          pushUnique(mobileWarnings, "silence_hallucination");
        }
      }
      mobileWarnings.forEach((warning) => pushUnique(combinedWarnings, warning));

      if (timestampsEnabled && resultSegments.length) {
        appendTimedChunks(combinedSegments, resultSegments, chunkOffsetSeconds);
      } else if (resultText) {
        combinedSegments.push({
          text: resultText,
          timestamp: [chunkOffsetSeconds, chunkOffsetSeconds + clipDurationSeconds]
        });
      }
    }

    return {
      text: normalizeText(combinedTextParts.join(" ")),
      segments: combinedSegments,
      warnings: combinedWarnings,
      generationControls: getGenerationControlReport(generationControlState)
    };
  }

  const transcriptionOutcome = await runValidatedTranscription(model, runtimeProfile, true);

  postMessage({
    type: "status",
    message: "Finalizing transcript...",
    progress: 96
  });
  postMessage({ type: "progress", value: 100, current: 100, total: 100 });

  const text = transcriptionOutcome.text;
  let segments = transcriptionOutcome.segments;

  if (!segments.length && text) {
    segments = [{
      text,
      timestamp: [0, durationSeconds]
    }];
  }

  if (!segments.length && !text) {
    throw new Error(MOBILE_DEVICE_LIMIT_MESSAGE);
  }

  postMessage({
    type: "result",
    text,
    segments,
    warnings: Array.from(new Set(transcriptionOutcome.warnings)),
    generationControls: transcriptionOutcome.generationControls
  });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const requestType = data.type;
  const modelKey = data.modelKey || MOBILE_MODEL_KEY;

  if (modelKey !== MOBILE_MODEL_KEY) {
    postMessage({
      type: "error",
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
      type: requestType === "transcribe" || requestType === "transcribe_vad_chunks" ? "error" : "model_error",
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

    if (requestType === "transcribe_vad_chunks") {
      await handleTranscription(data.audio, data.selectedLanguage, data.speechSpans);
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
