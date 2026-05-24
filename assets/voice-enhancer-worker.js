import { Rnnoise } from "/assets/vendor/rnnoise.js";

let runtimePromise = null;

self.addEventListener("message", async (event) => {
  const payload = event.data || {};
  if (payload.type === "init") {
    try {
      log("worker init start");
      const runtime = await getRuntime();
      log("worker init success", {
        runtime: "RNNoise WASM",
        frameSize: runtime.frameSize,
      });
      self.postMessage({
        id: payload.id,
        type: "init-ready",
        runtime: "RNNoise WASM",
        frameSize: runtime.frameSize,
      });
    } catch (error) {
      warn("worker init failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      self.postMessage({
        id: payload.id,
        type: "error",
        error: error instanceof Error ? error.message : "RNNoise runtime unavailable.",
      });
    }
    return;
  }

  if (payload.type !== "process") {
    return;
  }

  try {
    const samples = new Float32Array(payload.samples || 0);
    const sampleRate = Math.max(8000, Number(payload.sampleRate) || 48000);
    log("worker response processing request", {
      id: payload.id,
      sampleRate,
      sampleCount: samples.length,
    });
    const processed = await denoiseSamples(samples, sampleRate);
    self.postMessage({
      id: payload.id,
      type: "processed",
      samples: processed.buffer,
    }, [processed.buffer]);
    log("worker response sent", {
      id: payload.id,
      sampleRate,
      sampleCount: samples.length,
    });
  } catch (error) {
    errorLog("rnnoise failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    self.postMessage({
      id: payload.id,
      type: "error",
      error: error instanceof Error ? error.message : "RNNoise processing failed.",
    });
  }
});

async function denoiseSamples(inputSamples, sampleRate) {
  const startedAt = performance.now();
  const runtime = await getRuntime();
  const targetRate = 48000;
  const resampled = sampleRate === targetRate ? inputSamples : resampleLinear(inputSamples, sampleRate, targetRate);
  const denoiseState = runtime.createDenoiseState();
  const frameSize = runtime.frameSize;
  rnnoiseLog("processing started", {
    inputSampleRate: sampleRate,
    targetSampleRate: targetRate,
    frameSize,
    inputSamples: inputSamples.length,
    resampledSamples: resampled.length,
  });
  const pcm = floatToPcmFloat(resampled);
  const denoised = new Float32Array(pcm.length);
  const frame = new Float32Array(frameSize);

  for (let offset = 0; offset < pcm.length; offset += frameSize) {
    frame.fill(0);
    frame.set(pcm.subarray(offset, Math.min(pcm.length, offset + frameSize)));
    denoiseState.processFrame(frame);
    denoised.set(frame.subarray(0, Math.min(frameSize, pcm.length - offset)), offset);
  }

  const floatOut = pcmFloatToUnit(denoised);
  const output = sampleRate === targetRate ? floatOut : resampleLinear(floatOut, targetRate, sampleRate);
  rnnoiseLog("processing completed", {
    outputSamples: output.length,
    durationMs: round(performance.now() - startedAt),
  });
  return output;
}

async function getRuntime() {
  if (!runtimePromise) {
    rnnoiseLog("runtime load start");
    runtimePromise = Rnnoise.load()
      .then((runtime) => {
        rnnoiseLog("runtime detected", {
          frameSize: runtime.frameSize,
        });
        return runtime;
      })
      .catch((error) => {
        warn("runtime unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
  }
  return runtimePromise;
}

function floatToPcmFloat(input) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    out[i] = clamp(input[i] || 0, -1, 1) * 32768;
  }
  return out;
}

function pcmFloatToUnit(input) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    out[i] = clamp((input[i] || 0) / 32768, -1, 1);
  }
  return out;
}

function resampleLinear(input, fromRate, toRate) {
  if (!input.length || fromRate === toRate) {
    return new Float32Array(input);
  }

  const ratio = toRate / fromRate;
  const outputLength = Math.max(1, Math.round(input.length * ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const position = i / ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = input[clampIndex(index, input.length)] || 0;
    const b = input[clampIndex(index + 1, input.length)] || 0;
    output[i] = a + ((b - a) * frac);
  }

  return output;
}

function clampIndex(index, length) {
  return Math.min(length - 1, Math.max(0, index));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function log(message, data) {
  void message;
  void data;
}

function rnnoiseLog(message, data) {
  void message;
  void data;
}

function warn(message, data) {
  void message;
  void data;
}

function errorLog(message, data) {
  void message;
  void data;
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}
