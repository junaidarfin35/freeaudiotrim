import * as ort from "/assets/vendor/ort/ort.wasm.min.mjs";

const MODEL_URL = "/assets/models/silero-vad/model_int8.onnx";
const TARGET_SAMPLE_RATE = 16000;
const WINDOW_SIZE = 512;
const CONTEXT_SIZE = 64;
const STATE_SIZE = 2 * 1 * 128;
const SPEECH_THRESHOLD = 0.5;
const SILENCE_THRESHOLD = 0.35;
const MIN_SPEECH_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.25);
const MIN_SILENCE_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.2);
const SPEECH_PAD_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.12);
const MERGE_GAP_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.35);

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = "/assets/vendor/ort/";

let sessionPromise = null;

function createFallbackResult(totalSamples) {
  return {
    spans: [],
    stats: {
      totalSamples: Math.max(0, Number(totalSamples) || 0),
      speechSamples: 0,
      speechRatio: 0,
      chunkCount: 0,
      windowCount: 0
    }
  };
}

function mergeSpeechSpans(spans, totalSamples) {
  if (!Array.isArray(spans) || !spans.length) {
    return [];
  }

  const normalized = spans.map((span) => ({
    startSample: Math.max(0, Math.min(totalSamples, Math.floor(Number(span && span.startSample) || 0))),
    endSample: Math.max(0, Math.min(totalSamples, Math.ceil(Number(span && span.endSample) || 0)))
  })).filter((span) => span.endSample - span.startSample >= MIN_SPEECH_SAMPLES)
    .sort((left, right) => left.startSample - right.startSample);

  if (!normalized.length) {
    return [];
  }

  const merged = [];
  normalized.forEach((span) => {
    const padded = {
      startSample: Math.max(0, span.startSample - SPEECH_PAD_SAMPLES),
      endSample: Math.min(totalSamples, span.endSample + SPEECH_PAD_SAMPLES)
    };

    if (!merged.length) {
      merged.push(padded);
      return;
    }

    const previous = merged[merged.length - 1];
    if (padded.startSample - previous.endSample <= MERGE_GAP_SAMPLES) {
      previous.endSample = Math.max(previous.endSample, padded.endSample);
    } else {
      merged.push(padded);
    }
  });

  return merged.filter((span) => span.endSample - span.startSample >= MIN_SPEECH_SAMPLES);
}

async function getVadSession() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    }).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }

  return sessionPromise;
}

async function detectSpeech(audioBuffer, sampleRate) {
  if (sampleRate !== TARGET_SAMPLE_RATE) {
    throw new Error("Silero VAD expects 16 kHz audio.");
  }

  const audio = new Float32Array(audioBuffer);
  if (!audio.length) {
    return createFallbackResult(0);
  }

  const session = await getVadSession();
  const srTensor = new ort.Tensor("int64", new BigInt64Array([BigInt(TARGET_SAMPLE_RATE)]), []);
  let stateData = new Float32Array(STATE_SIZE);
  let contextData = new Float32Array(CONTEXT_SIZE);
  let triggered = false;
  let currentStart = -1;
  let pendingSilenceStart = -1;
  const rawSpans = [];
  const totalWindows = Math.ceil(audio.length / WINDOW_SIZE);

  for (let windowIndex = 0; windowIndex < totalWindows; windowIndex += 1) {
    const startSample = windowIndex * WINDOW_SIZE;
    const endSample = Math.min(audio.length, startSample + WINDOW_SIZE);
    const chunkData = new Float32Array(WINDOW_SIZE);
    chunkData.set(audio.subarray(startSample, endSample));

    const inputData = new Float32Array(CONTEXT_SIZE + WINDOW_SIZE);
    inputData.set(contextData, 0);
    inputData.set(chunkData, CONTEXT_SIZE);

    const feeds = {
      input: new ort.Tensor("float32", inputData, [1, CONTEXT_SIZE + WINDOW_SIZE]),
      state: new ort.Tensor("float32", stateData, [2, 1, 128]),
      sr: srTensor
    };
    const outputs = await session.run(feeds);
    const speechProb = Number(outputs.output && outputs.output.data && outputs.output.data[0]) || 0;
    const nextState = outputs.stateN && outputs.stateN.data ? outputs.stateN.data : null;

    if (nextState) {
      stateData = new Float32Array(nextState);
    }

    contextData = chunkData.slice(WINDOW_SIZE - CONTEXT_SIZE);

    if (speechProb >= SPEECH_THRESHOLD) {
      if (!triggered) {
        triggered = true;
        currentStart = startSample;
      }
      pendingSilenceStart = -1;
      continue;
    }

    if (!triggered) {
      continue;
    }

    if (speechProb > SILENCE_THRESHOLD) {
      pendingSilenceStart = -1;
      continue;
    }

    if (pendingSilenceStart < 0) {
      pendingSilenceStart = startSample;
      continue;
    }

    if (startSample - pendingSilenceStart >= MIN_SILENCE_SAMPLES) {
      const endBoundary = pendingSilenceStart;
      if (endBoundary - currentStart >= MIN_SPEECH_SAMPLES) {
        rawSpans.push({
          startSample: currentStart,
          endSample: endBoundary
        });
      }
      triggered = false;
      currentStart = -1;
      pendingSilenceStart = -1;
    }
  }

  if (triggered && currentStart >= 0) {
    rawSpans.push({
      startSample: currentStart,
      endSample: audio.length
    });
  }

  const spans = mergeSpeechSpans(rawSpans, audio.length);
  const speechSamples = spans.reduce((sum, span) => sum + Math.max(0, span.endSample - span.startSample), 0);

  return {
    spans,
    stats: {
      totalSamples: audio.length,
      speechSamples,
      speechRatio: audio.length ? speechSamples / audio.length : 0,
      chunkCount: spans.length,
      windowCount: totalWindows
    }
  };
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const requestId = data.requestId;

  if (data.type !== "detect_speech") {
    self.postMessage({
      type: "vad_error",
      requestId,
      message: "Unsupported VAD worker message."
    });
    return;
  }

  try {
    const result = await detectSpeech(data.audio, Number(data.sampleRate) || 0);
    self.postMessage({
      type: "speech_spans",
      requestId,
      spans: result.spans,
      stats: result.stats
    });
  } catch (error) {
    self.postMessage({
      type: "vad_error",
      requestId,
      message: error && error.message ? error.message : "Silero VAD failed."
    });
  }
};
