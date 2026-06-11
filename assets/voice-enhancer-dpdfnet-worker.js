import * as ort from "/assets/vendor/ort/ort.wasm.min.mjs";

const MODEL_VARIANTS = {
  creator: {
    key: "baseline",
    displayName: "Fast Clean",
    modelUrl: "/assets/vendor/dpdfnet/baseline.onnx",
    metadataUrl: "/assets/vendor/dpdfnet/baseline.metadata.json",
  },
  podcast: {
    key: "dpdfnet4",
    displayName: "Balanced Clean",
    modelUrl: "/assets/vendor/dpdfnet/dpdfnet4.onnx",
    metadataUrl: "/assets/vendor/dpdfnet/dpdfnet4.metadata.json",
  },
  cinematic: {
    key: "dpdfnet2_48khz_hr",
    displayName: "Studio Clean",
    modelUrl: "/assets/vendor/dpdfnet/dpdfnet2_48khz_hr.onnx",
    metadataUrl: "/assets/vendor/dpdfnet/dpdfnet2_48khz_hr.metadata.json",
    fallbackPresetKey: "__studioFallback",
  },
  __studioFallback: {
    key: "dpdfnet2",
    displayName: "Studio Clean Fallback",
    modelUrl: "/assets/vendor/dpdfnet/dpdfnet2.onnx",
    metadataUrl: "/assets/vendor/dpdfnet/dpdfnet2.metadata.json",
  },
};

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = "/assets/vendor/ort/";

const DEBUG_LATENCY_COMPENSATION = true;
const DEBUG_LATENCY_MULTIPLIER = 2;
const bundlePromises = new Map();
const runtimeDebugFlags = {
  bypassModel: false,
};

self.addEventListener("message", async (event) => {
  const payload = event.data || {};
  if (payload.type === "init") {
    try {
      const variant = resolveVariant(payload.presetKey);
      const runtime = await loadVariantRuntime(variant);
      const bundle = runtime.bundle;
      self.postMessage({
        id: payload.id,
        type: "init-ready",
        runtime: "DPDFNet ONNX WASM",
        frameSize: bundle.config.hopLength,
        modelSampleRate: bundle.config.sampleRate,
        modelName: runtime.displayName,
        modelVariant: runtime.activeVariant.key,
        fallbackUsed: runtime.fallbackUsed,
      });
    } catch (error) {
      self.postMessage({
        id: payload.id,
        type: "error",
        error: error instanceof Error ? error.message : "DPDFNet runtime unavailable.",
      });
    }
    return;
  }

  if (payload.type === "config") {
    runtimeDebugFlags.bypassModel = !!payload.debugBypassModel;
    self.postMessage({
      id: payload.id,
      type: "config-ready",
      debugBypassModel: runtimeDebugFlags.bypassModel,
    });
    return;
  }

  if (payload.type !== "process") {
    return;
  }

  try {
    const samples = new Float32Array(payload.samples || 0);
    const sampleRate = Math.max(8000, Number(payload.sampleRate) || 48000);
    const processed = await denoiseSamples(samples, sampleRate, payload.presetKey);
    self.postMessage({
      id: payload.id,
      type: "processed",
      samples: processed.samples.buffer,
      meta: processed.meta,
    }, [processed.samples.buffer]);
  } catch (error) {
    console.error("[DPDFNet Worker]", error);
    self.postMessage({
      id: payload.id,
      type: "error",
      error: error instanceof Error ? error.message : "DPDFNet processing failed.",
    });
  }
});

async function denoiseSamples(inputSamples, inputSampleRate, presetKey) {
  const variant = resolveVariant(presetKey);
  const runtime = await loadVariantRuntime(variant);
  const bundle = runtime.bundle;
  const { session, config } = bundle;
  const resampledInput = inputSampleRate !== config.sampleRate;
  const resamplerName = "linear";

  const modelInput = resampledInput
    ? resampleForModel(inputSamples, inputSampleRate, config.sampleRate)
    : new Float32Array(inputSamples);

  const enhanced = await enhanceAtModelRate(modelInput, session, config);

  const output = resampledInput
    ? resampleForModel(enhanced, config.sampleRate, inputSampleRate)
    : new Float32Array(enhanced);

  return {
    samples: output,
    meta: {
      modelName: config.modelName,
      displayName: runtime.displayName,
      presetKey: variant.presetKey,
      modelVariant: runtime.activeVariant.key,
      requestedModelVariant: variant.key,
      fallbackUsed: runtime.fallbackUsed,
      fallbackReason: runtime.fallbackReason,
      debugBypassModel: runtimeDebugFlags.bypassModel,
      resampledInput,
      resampler: resamplerName,
      resamplerQuality: "linear",
      inputSampleRate,
      modelSampleRate: config.sampleRate,
      inputLength: inputSamples.length,
      modelInputLength: modelInput.length,
      outputLength: output.length,
      frameSize: config.hopLength,
    },
  };
}

async function loadVariantRuntime(variant) {
  try {
    return {
      bundle: await getBundle(variant),
      activeVariant: variant,
      displayName: variant.displayName,
      fallbackUsed: false,
      fallbackReason: "",
    };
  } catch (error) {
    if (!variant.fallbackPresetKey) {
      throw error;
    }
    const fallbackVariant = resolveVariant(variant.fallbackPresetKey);
    return {
      bundle: await getBundle(fallbackVariant),
      activeVariant: fallbackVariant,
      displayName: variant.displayName,
      fallbackUsed: true,
      fallbackReason: `${variant.displayName} primary model unavailable. Using internal DPDFNet fallback.`,
    };
  }
}

async function getBundle(variant) {
  if (!bundlePromises.has(variant.key)) {
    const bundlePromise = Promise.all([
      loadMetadata(variant.metadataUrl),
      ort.InferenceSession.create(variant.modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      }),
    ])
      .then(([metadata, session]) => ({
        session,
        config: createModelConfig(metadata, session, variant),
      }))
      .catch((error) => {
        bundlePromises.delete(variant.key);
        throw error;
      });
    bundlePromises.set(variant.key, bundlePromise);
  }

  return bundlePromises.get(variant.key);
}

function resampleForModel(input, fromRate, toRate) {
  if (!input.length || fromRate === toRate) {
    return new Float32Array(input);
  }

  return resampleLinear(input, fromRate, toRate);
}

async function loadMetadata(metadataUrl) {
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(`DPDFNet metadata missing (${response.status}).`);
  }
  return response.json();
}

function createModelConfig(metadata, session, variant) {
  const sampleRate = Math.max(8000, Number(metadata.sampleRate) || 48000);
  const windowLength = Math.max(2, Number(metadata.windowLength) || 960);
  const hopLength = Math.max(1, Number(metadata.hopLength) || Math.floor(windowLength / 2));
  const freqBins = Math.max(2, Number(metadata.freqBins) || ((windowLength / 2) + 1));
  const stateSize = Math.max(1, Number(metadata.stateSize) || 1);
  const initialState = new Float32Array(stateSize);
  const erb = Array.isArray(metadata.erbNormInit) ? metadata.erbNormInit : [];
  const spec = Array.isArray(metadata.specNormInit) ? metadata.specNormInit : [];

  for (let i = 0; i < erb.length && i < initialState.length; i += 1) {
    initialState[i] = Number(erb[i]) || 0;
  }

  for (let i = 0; i < spec.length && (erb.length + i) < initialState.length; i += 1) {
    initialState[erb.length + i] = Number(spec[i]) || 0;
  }

  return {
    modelName: String(metadata.modelName || variant.key || "DPDFNet"),
    displayName: variant.displayName,
    sampleRate,
    windowLength,
    hopLength,
    freqBins,
    stateSize,
    initialState,
    inputNames: {
      spec: session.inputNames[0],
      state: session.inputNames[1],
    },
    outputNames: {
      spec: session.outputNames[0],
      state: session.outputNames[1],
    },
    fftPlan: createBluesteinPlan(windowLength),
    window: createVorbisWindow(windowLength),
    specShape: [1, 1, freqBins, 2],
    stateShape: [stateSize],
  };
}

function resolveVariant(presetKey) {
  const key = MODEL_VARIANTS[presetKey] ? presetKey : "creator";
  return {
    ...MODEL_VARIANTS[key],
    presetKey: key,
  };
}

async function enhanceAtModelRate(samples, session, config) {
  if (!samples.length) {
    return new Float32Array(0);
  }

  const hopCount = Math.ceil(samples.length / config.hopLength);
  const totalHops = hopCount + Math.ceil(config.windowLength / config.hopLength);
  const totalSamples = totalHops * config.hopLength;
  const output = new Float32Array(totalSamples);
  const stft = createStreamingStft(config);
  const istft = createStreamingIstft(config);
  let state = new Float32Array(config.initialState);

  for (let hopIndex = 0; hopIndex < totalHops; hopIndex += 1) {
    const start = hopIndex * config.hopLength;
    const chunk = new Float32Array(config.hopLength);
    if (start < samples.length) {
      chunk.set(samples.subarray(start, Math.min(samples.length, start + config.hopLength)));
    }

  const spec = stft.process(chunk);

  let enhancedSpec = spec;

  if (!runtimeDebugFlags.bypassModel) {
    const outputs = await session.run({
      [config.inputNames.spec]: new ort.Tensor("float32", spec, config.specShape),
      [config.inputNames.state]: new ort.Tensor("float32", state, config.stateShape),
    });

    state = new Float32Array(outputs[config.outputNames.state].data);
    enhancedSpec = outputs[config.outputNames.spec].data;
  }

  const enhancedChunk = istft.process(enhancedSpec);
  output.set(enhancedChunk, start);
  }

  if (!DEBUG_LATENCY_COMPENSATION) {
    return output.subarray(0, samples.length);
  }

  const latency = Math.max(0, Math.round(config.windowLength * DEBUG_LATENCY_MULTIPLIER));
  const compensated = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i += 1) {
    compensated[i] = output[i + latency] || 0;
  }

  return compensated;
}

function createStreamingStft(config) {
  const buffer = new Float32Array(config.windowLength);
  const frame = new Float32Array(config.windowLength);
  const frameImag = new Float32Array(config.windowLength);
  const spectrumReal = new Float32Array(config.windowLength);
  const spectrumImag = new Float32Array(config.windowLength);
  const interleaved = new Float32Array(config.freqBins * 2);

  return {
    process(chunk) {
      buffer.copyWithin(0, config.hopLength);
      buffer.set(chunk, config.windowLength - config.hopLength);

      for (let i = 0; i < config.windowLength; i += 1) {
        frame[i] = buffer[i] * config.window[i];
        frameImag[i] = 0;
      }

      fftComplex(config.fftPlan, frame, frameImag, spectrumReal, spectrumImag);

      for (let i = 0; i < config.freqBins; i += 1) {
        const offset = i * 2;
        interleaved[offset] = spectrumReal[i];
        interleaved[offset + 1] = spectrumImag[i];
      }

      return interleaved;
    },
  };
}

function createStreamingIstft(config) {
  const fullReal = new Float32Array(config.windowLength);
  const fullImag = new Float32Array(config.windowLength);
  const timeReal = new Float32Array(config.windowLength);
  const timeImag = new Float32Array(config.windowLength);
  const ola = new Float32Array(config.windowLength);
  const out = new Float32Array(config.hopLength);
  const olaNorm = new Float32Array(config.windowLength);

  return {
    process(interleavedSpec) {
      fullReal.fill(0);
      fullImag.fill(0);

      for (let i = 0; i < config.freqBins; i += 1) {
        const offset = i * 2;
        fullReal[i] = interleavedSpec[offset] || 0;
        fullImag[i] = interleavedSpec[offset + 1] || 0;
      }

      for (let i = 1; i < config.freqBins - 1; i += 1) {
        const mirror = config.windowLength - i;
        fullReal[mirror] = fullReal[i];
        fullImag[mirror] = -fullImag[i];
      }

      ifftComplex(config.fftPlan, fullReal, fullImag, timeReal, timeImag);

      for (let i = 0; i < config.windowLength - config.hopLength; i += 1) {
        ola[i] = ola[i + config.hopLength];
        olaNorm[i] = olaNorm[i + config.hopLength];
      }

      for (let i = config.windowLength - config.hopLength; i < config.windowLength; i += 1) {
        ola[i] = 0;
        olaNorm[i] = 0;
      }

      for (let i = 0; i < config.windowLength; i += 1) {
        const w = config.window[i];
        ola[i] += timeReal[i] * w;
        olaNorm[i] += w * w;
      }

      for (let i = 0; i < config.hopLength; i += 1) {
        const norm = olaNorm[i];
        out[i] = norm > 1e-8 ? ola[i] / norm : ola[i];
      }

      return out;
    },
  };
}

function createBluesteinPlan(size) {
  const convolutionSize = nextPowerOfTwo((size * 2) - 1);
  const chirpCos = new Float32Array(size);
  const chirpSin = new Float32Array(size);
  const kernelReal = new Float32Array(convolutionSize);
  const kernelImag = new Float32Array(convolutionSize);

  for (let i = 0; i < size; i += 1) {
    const angle = (Math.PI * ((i * i) % (size * 2))) / size;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    chirpCos[i] = cos;
    chirpSin[i] = sin;
    kernelReal[i] = cos;
    kernelImag[i] = sin;
    if (i > 0) {
      kernelReal[convolutionSize - i] = cos;
      kernelImag[convolutionSize - i] = sin;
    }
  }

  fftRadix2(kernelReal, kernelImag, false);

  return {
    size,
    convolutionSize,
    chirpCos,
    chirpSin,
    kernelReal,
    kernelImag,
    workReal: new Float32Array(convolutionSize),
    workImag: new Float32Array(convolutionSize),
  };
}

function fftComplex(plan, inputReal, inputImag, outputReal, outputImag) {
  const { size, convolutionSize, chirpCos, chirpSin, kernelReal, kernelImag, workReal, workImag } = plan;
  workReal.fill(0);
  workImag.fill(0);

  for (let i = 0; i < size; i += 1) {
    const cos = chirpCos[i];
    const sin = chirpSin[i];
    const xr = inputReal[i] || 0;
    const xi = inputImag[i] || 0;
    workReal[i] = (xr * cos) + (xi * sin);
    workImag[i] = (xi * cos) - (xr * sin);
  }

  fftRadix2(workReal, workImag, false);

  for (let i = 0; i < convolutionSize; i += 1) {
    const ar = workReal[i];
    const ai = workImag[i];
    const br = kernelReal[i];
    const bi = kernelImag[i];
    workReal[i] = (ar * br) - (ai * bi);
    workImag[i] = (ar * bi) + (ai * br);
  }

  fftRadix2(workReal, workImag, true);

  for (let i = 0; i < size; i += 1) {
    const cos = chirpCos[i];
    const sin = chirpSin[i];
    const cr = workReal[i];
    const ci = workImag[i];
    outputReal[i] = (cr * cos) + (ci * sin);
    outputImag[i] = (ci * cos) - (cr * sin);
  }
}

function ifftComplex(plan, inputReal, inputImag, outputReal, outputImag) {
  const { size } = plan;

  for (let i = 0; i < size; i += 1) {
    outputReal[i] = inputReal[i] || 0;
    outputImag[i] = -(inputImag[i] || 0);
  }

  fftComplex(plan, outputReal, outputImag, outputReal, outputImag);

  for (let i = 0; i < size; i += 1) {
    outputReal[i] /= size;
    outputImag[i] = -outputImag[i] / size;
  }
}

function fftRadix2(real, imag, inverse) {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tempReal = real[i];
      const tempImag = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = tempReal;
      imag[j] = tempImag;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (inverse ? 2 : -2) * Math.PI / size;
    for (let start = 0; start < n; start += size) {
      for (let i = 0; i < half; i += 1) {
        const angle = step * i;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const evenIndex = start + i;
        const oddIndex = evenIndex + half;
        const tr = (wr * real[oddIndex]) - (wi * imag[oddIndex]);
        const ti = (wr * imag[oddIndex]) + (wi * real[oddIndex]);
        real[oddIndex] = real[evenIndex] - tr;
        imag[oddIndex] = imag[evenIndex] - ti;
        real[evenIndex] += tr;
        imag[evenIndex] += ti;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

function createVorbisWindow(size) {
  const window = new Float32Array(size);
  const half = size / 2;
  for (let i = 0; i < size; i += 1) {
    const sine = Math.sin((0.5 * Math.PI * (i + 0.5)) / half);
    window[i] = Math.sin(0.5 * Math.PI * sine * sine);
  }
  return window;
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

function nextPowerOfTwo(value) {
  let n = 1;
  while (n < value) {
    n <<= 1;
  }
  return n;
}
