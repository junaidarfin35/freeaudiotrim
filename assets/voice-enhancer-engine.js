(() => {
  "use strict";

  const DB_FLOOR = -48;
  const LUFS_OFFSET = -0.691;
  const MODEL_WORKER = {
    key: "dpdfnet",
    label: "DPDFNet",
    url: "/assets/voice-enhancer-dpdfnet-worker.js?v=2026-06-05-1647",
    type: "module",
  };
  const DEFAULT_PRESET_KEY = "creator";
  const LOG_PREFIX = "[AI Voice Studio]";
  const MODEL_PREFIX = "[AI Voice Studio Models]";
  const PRESETS = {
    creator: {
      key: "creator",
      label: "Fast Clean",
      modelVariant: "baseline",
      targetLufsEstimate: -14.2,
      ceilingDb: -1.1,
      lowShelf: 0.6,
      mudCut: -2.2,
      presence: 2.8,
      air: 2.2,
      compThreshold: -24,
      compRatio: 3.8,
      makeupDb: 1.5,
      compAttack: 0.005,
      compRelease: 0.09,
    },
    podcast: {
      key: "podcast",
      label: "Balanced Clean",
      modelVariant: "dpdfnet2_48khz_hr",
      targetLufsEstimate: -15.8,
      ceilingDb: -1.4,
      lowShelf: 1.6,
      mudCut: -1.4,
      presence: 1.4,
      air: 1.0,
      compThreshold: -24,
      compRatio: 2.8,
      makeupDb: 1.0,
      compAttack: 0.007,
      compRelease: 0.12,
    },
    cinematic: {
      key: "cinematic",
      label: "Studio Clean",
      modelVariant: "dpdfnet8_48khz_hr",
      targetLufsEstimate: -14.8,
      ceilingDb: -1.2,
      lowShelf: 2.0,
      mudCut: -2.0,
      presence: 1.9,
      air: 1.6,
      compThreshold: -24.5,
      compRatio: 3.4,
      makeupDb: 1.7,
      compAttack: 0.006,
      compRelease: 0.11,
    },
  };

  let workerClientPromise = null;
  const workerWarmupPromises = new Map();

  function createProcessor(options = {}) {
    return {
      analyzeOriginal(buffer, settings) {
        return analyzeVoice(buffer, settings);
      },
      async renderProcessedBuffer(ctx, buffer, settings) {
        const result = await enhanceVoice(ctx, buffer, settings);
        if (typeof options.onRenderInfo === "function") {
          options.onRenderInfo(result.meta);
        }
        return result.buffer;
      },
      getProcessedCacheKey(settings, buffer) {
        return JSON.stringify({
          settings,
          sampleRate: buffer ? buffer.sampleRate : 0,
          length: buffer ? buffer.length : 0,
        });
      },
    };
  }

  function prewarmWorker(presetKey = DEFAULT_PRESET_KEY) {
    if (!workerWarmupPromises.has(presetKey)) {
      info("worker init start");
      const warmupPromise = getWorkerClient()
        .then((client) => client.init(presetKey))
        .then((runtimeInfo) => {
          info("worker init success", runtimeInfo);
          return runtimeInfo;
        })
        .catch((error) => {
          workerWarmupPromises.delete(presetKey);
          warn("worker init failure", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        });
      workerWarmupPromises.set(presetKey, warmupPromise);
    }
    return workerWarmupPromises.get(presetKey);
  }

  async function enhanceVoice(ctxOrBuffer, bufferOrSettings, maybeSettings) {
    const hasContext = !!ctxOrBuffer && typeof ctxOrBuffer.createBuffer === "function";
    const ctx = hasContext ? ctxOrBuffer : null;
    const sourceBuffer = hasContext ? bufferOrSettings : ctxOrBuffer;
    const incomingSettings = hasContext ? maybeSettings : bufferOrSettings;
    const analysisProfile = incomingSettings?.analysisProfile || analyzeVoice(sourceBuffer, {
      ...incomingSettings,
      analysisProfile: null,
    });
    const settings = {
      ...(incomingSettings || {}),
      analysisProfile,
    };
    const resolved = resolveSettings(settings);
    const pipelineStartedAt = performance.now();
    const stageDurations = {};
    info("enhancement requested", {
      preset: resolved.preset.label,
      targetLufsEstimate: resolved.targetLufsEstimate,
      sourceDuration: sourceBuffer?.duration || 0,
      sampleRate: sourceBuffer?.sampleRate || 0,
      channelCount: sourceBuffer?.numberOfChannels || 0,
    });

    try {
      info("speech prep start");
      const speechPrepStartedAt = performance.now();
      const prepared = speechPrep(sourceBuffer);
      stageDurations.speechPrepMs = round(performance.now() - speechPrepStartedAt);
      info("speech prep end", {
        durationMs: stageDurations.speechPrepMs,
        sampleRate: prepared.sampleRate,
        sampleCount: prepared.samples.length,
      });

      const denoised = await runDenoiseStage(prepared.samples, prepared.sampleRate, resolved, stageDurations);
      const roomControlled = applyRoomControlStage(denoised.samples, prepared.sampleRate, resolved, stageDurations);
      const denoisedBuffer = createMonoBuffer(ctx, roomControlled.samples, prepared.sampleRate);
      const mastered = await applyMasterChain(denoisedBuffer, resolved, stageDurations);
      const deEssed = applyDeEsser(ctx, mastered, resolved, stageDurations);
      const detailed = applyDetailEnhancer(ctx, deEssed, resolved, stageDurations);
      const normalized = applyFinalNormalize(ctx, detailed, resolved, stageDurations);

      const meta = {
        aiDenoiseActive: denoised.meta.aiDenoiseActive,
        fallbackReason: denoised.meta.fallbackReason,
        processingMode: denoised.meta.processingMode,
        modelName: denoised.meta.modelName,
        denoiseMix: denoised.meta.denoiseMix,
        workerMeta: denoised.meta.workerMeta || null,
        roomControlActive: roomControlled.active,
        adaptiveProfile: resolved.adaptiveProfile,
        presetLabel: resolved.preset.label,
        targetLufsEstimate: resolved.targetLufsEstimate,
        stageDurations,
        totalDurationMs: round(performance.now() - pipelineStartedAt),
        processingPath: denoised.meta.processingPath || (denoised.meta.aiDenoiseActive ? denoised.meta.processingMode : "fallback"),
      };

      info("final render success", meta);

      return {
        buffer: normalized.buffer,
        meta,
      };
    } catch (error) {
      errorLog("final render failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  function analyzeVoice(buffer, settings) {
    const resolved = resolveSettings(settings);
    const mono = mergeToMono(buffer);
    const measured = measureVoice(mono, buffer.sampleRate);
    const estimated = {
      noiseLevel: estimateNoiseScore(mono, buffer.sampleRate),
      harshness: estimateHarshnessScore(mono, buffer.sampleRate),
      lowMidBuildup: estimateBandRatioScore(mono, buffer.sampleRate, 180, 450, 120, 2200),
      roomEcho: estimateRoomEchoScore(mono, buffer.sampleRate),
    };
    const heuristic = {
      clarityHint: describeClarity(estimated.harshness, estimated.noiseLevel, measured.dynamicRangeDb),
      recommendedPreset: recommendPreset(measured, estimated, resolved),
      suggestedFocus: pickSuggestedFocus(measured, estimated),
    };
    const adaptiveProfile = deriveAdaptiveProfile(measured, estimated, heuristic, resolved);
    const issues = buildIssues(measured, estimated, heuristic);

    info("diagnostics measured values", measured);
    info("diagnostics estimated values", estimated);
    info("diagnostics heuristic values", heuristic);
    info("diagnostics recommended preset", {
      recommendedPreset: heuristic.recommendedPreset,
      activePreset: resolved.preset.label,
    });

    return {
      measured: {
        peakDb: measured.peakDb,
        loudnessEstimate: measured.loudnessEstimate,
        clippingCount: measured.clippingCount,
        dynamicRangeDb: measured.dynamicRangeDb,
        duration: buffer.duration,
      },
      estimated,
      heuristic,
      adaptiveProfile,
      issues,
      issueSummary: issues.length ? issues[0] : "Voice looks ready for enhancement.",
    };
  }

  function resolveSettings(settings = {}) {
    const preset = PRESETS[settings.preset] || PRESETS[DEFAULT_PRESET_KEY];
    const adaptiveProfile = normalizeAdaptiveProfile(settings.analysisProfile?.adaptiveProfile);
    const noiseReduction = clamp01((Number(settings.noiseReduction) || 88) / 100);
    const clarity = ((Number(settings.clarityFocus) || 58) - 50) / 50;
    const depth = ((Number(settings.voiceDepth) || 56) - 50) / 50;
    const broadcast = clamp01((Number(settings.broadcastReady) || 62) / 100);
    const adaptiveNoiseReduction = clamp01(noiseReduction + adaptiveProfile.noiseReductionBoost);
    const effectiveClarity = clamp(clarity + adaptiveProfile.clarityShift, -1, 1);
    const effectiveDepth = clamp(depth + adaptiveProfile.depthShift, -1, 1);
    const effectiveBroadcast = clamp01(broadcast + adaptiveProfile.broadcastBoost);
    const denoiseMix = resolveDenoiseMix(adaptiveNoiseReduction);
    const residualCleanupAmount = clamp01((adaptiveNoiseReduction * 0.58) + Math.max(0, effectiveBroadcast - 0.45) * 0.24 + adaptiveProfile.residualCleanupBoost);
    const roomControlAmount = clamp01(((adaptiveNoiseReduction - 0.24) / 0.76) * (0.82 + (effectiveBroadcast * 0.18)) + adaptiveProfile.roomControlBoost);
    const deEssAmount = clamp01(0.28 + Math.max(0, effectiveClarity) * 0.18 + (effectiveBroadcast * 0.1) + adaptiveProfile.deEssBoost);
    const detailAmount = clamp01(0.36 + Math.max(0, effectiveClarity) * 0.34 + adaptiveProfile.detailBoost);

    return {
      preset,
      noiseReduction: adaptiveNoiseReduction,
      denoiseMix,
      residualCleanupAmount,
      roomControlAmount,
      clarity: effectiveClarity,
      depth: effectiveDepth,
      broadcast: effectiveBroadcast,
      adaptiveProfile,
      targetLufsEstimate: preset.targetLufsEstimate + (effectiveBroadcast * 0.8) + adaptiveProfile.loudnessBiasDb,
      ceilingDb: preset.ceilingDb,
      eq: {
        highPassHz: 94,
        lowShelfHz: 170,
        lowShelfGain: preset.lowShelf + (effectiveDepth * 3.5) - Math.max(0, effectiveClarity) * 0.5 + adaptiveProfile.lowShelfBias,
        mudCutHz: 320,
        mudCutGain: preset.mudCut - Math.max(0, effectiveDepth) * 0.8 - adaptiveProfile.mudCutBoost,
        presenceHz: 3500,
        presenceGain: preset.presence + (effectiveClarity * 3.2) + adaptiveProfile.presenceBias,
        airHz: 11000,
        airGain: preset.air + Math.max(0, effectiveClarity) * 1.7 - adaptiveProfile.airTrim,
      },
      compressor: {
        threshold: preset.compThreshold - (effectiveBroadcast * 4.5) - adaptiveProfile.compressorThresholdShift,
        ratio: preset.compRatio + (effectiveBroadcast * 1.4) + adaptiveProfile.compressorRatioBoost,
        knee: 24,
        attack: preset.compAttack + Math.max(0, effectiveClarity) * 0.0015,
        release: preset.compRelease,
        makeupDb: preset.makeupDb + (effectiveBroadcast * 1.6) + adaptiveProfile.makeupBoost,
      },
      deEsser: {
        crossoverHz: 6200 + Math.max(0, effectiveClarity) * 420 + adaptiveProfile.deEssCrossoverShiftHz,
        thresholdRatio: 0.36 - Math.max(0, effectiveClarity) * 0.03 - adaptiveProfile.deEssThresholdShift,
        maxReductionDb: 2.6 + (deEssAmount * 2.4),
        sensitivity: deEssAmount,
      },
      detailEnhancer: {
        presenceHz: 3500,
        airHz: 11000,
        presenceAmount: detailAmount * (1.65 + adaptiveProfile.detailPresenceBias),
        airAmount: detailAmount * (0.95 + adaptiveProfile.detailAirBias),
        transientAmount: detailAmount * (0.5 + adaptiveProfile.detailTransientBias),
      },
    };
  }

  function speechPrep(buffer) {
    const mono = mergeToMono(buffer);
    removeDcOffsetInPlace(mono);
    applySpeechHighPassInPlace(mono, buffer.sampleRate, 82);
    applyGainSanityInPlace(mono);
    return {
      samples: mono,
      sampleRate: buffer.sampleRate,
    };
  }

  async function runDenoiseStage(samples, sampleRate, settings, stageDurations) {
    if (settings.noiseReduction < 0.02) {
      warn("fallback activated because model disabled by noise reduction control", {
        noiseReduction: settings.noiseReduction,
      });
      return {
        samples,
        meta: {
          aiDenoiseActive: false,
          fallbackReason: "Noise reduction dial set low. Voice chain used without AI denoise.",
          processingMode: "compatibility",
          modelName: "Voice Mastering Chain",
          denoiseMix: 0,
        },
      };
    }

    try {
      const presetKey = settings.preset?.key || DEFAULT_PRESET_KEY;
      modelInfo("path selected", {
        preset: settings.preset?.label || PRESETS[DEFAULT_PRESET_KEY].label,
        modelVariant: settings.preset?.modelVariant || PRESETS[DEFAULT_PRESET_KEY].modelVariant,
        sampleRate,
        noiseReduction: settings.noiseReduction,
      });
      modelInfo("worker init check");
      const client = await getWorkerClient();
      const startedAt = performance.now();
      const processed = await client.process(samples, sampleRate, presetKey);
      stageDurations.dpdfnetMs = round(performance.now() - startedAt);
      const denoised = settings.denoiseMix >= 0.995
        ? processed.samples
        : blendSignals(samples, processed.samples, settings.denoiseMix);
      const residualCleaned = applyResidualCleanupStage(denoised, sampleRate, settings, stageDurations);
      modelInfo("worker response received", {
        durationMs: stageDurations.dpdfnetMs,
        sampleRate,
        sampleCount: processed.samples.length,
        denoiseMix: settings.denoiseMix,
      });
      return {
        samples: residualCleaned.samples,
        meta: {
          aiDenoiseActive: true,
          fallbackReason: "",
          processingMode: "neural-onnx",
          processingPath: presetKey,
          modelName: processed.meta?.displayName || processed.meta?.modelName || settings.preset?.label || MODEL_WORKER.label,
          denoiseMix: settings.denoiseMix,
          residualCleanupActive: residualCleaned.active,
          workerMeta: processed.meta || null,
        },
      };
    } catch (error) {
      warn("fallback activated because model unavailable/failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        samples,
        meta: {
          aiDenoiseActive: false,
          fallbackReason: "AI voice model unavailable. Studio chain still active.",
          processingMode: "compatibility",
          processingPath: "fallback",
          modelName: "Voice Mastering Chain",
          denoiseMix: 0,
          workerMeta: null,
        },
      };
    }
  }

  function applyRoomControlStage(samples, sampleRate, settings, stageDurations) {
    info("mild room control start", {
      amount: settings.roomControlAmount,
    });
    const startedAt = performance.now();
    const roomControlled = applyMildRoomControl(samples, sampleRate, settings);
    stageDurations.roomControlMs = round(performance.now() - startedAt);
    info("mild room control end", {
      durationMs: stageDurations.roomControlMs,
      active: roomControlled.active,
      averageReductionDb: roomControlled.averageReductionDb,
      maxReductionDb: roomControlled.maxReductionDb,
    });
    return roomControlled;
  }

  function applyResidualCleanupStage(samples, sampleRate, settings, stageDurations) {
    info("residual cleanup start", {
      amount: settings.residualCleanupAmount,
    });
    const startedAt = performance.now();
    const cleaned = applyResidualNoiseCleanup(samples, sampleRate, settings);
    stageDurations.residualCleanupMs = round(performance.now() - startedAt);
    info("residual cleanup end", {
      durationMs: stageDurations.residualCleanupMs,
      active: cleaned.active,
      averageReductionDb: cleaned.averageReductionDb,
      maxReductionDb: cleaned.maxReductionDb,
    });
    return cleaned;
  }

  async function applyMasterChain(buffer, settings, stageDurations) {
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) {
      return buffer;
    }

    const startedAt = performance.now();
    info("eq stage start", {
      preset: settings.preset.label,
    });
    info("compressor stage start", {
      threshold: settings.compressor.threshold,
      ratio: settings.compressor.ratio,
    });

    const offline = new OfflineCtx(1, buffer.length, buffer.sampleRate);
    const source = offline.createBufferSource();
    source.buffer = buffer;

    const highPass = offline.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = settings.eq.highPassHz;
    highPass.Q.value = 0.707;

    const lowShelf = offline.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = settings.eq.lowShelfHz;
    lowShelf.gain.value = settings.eq.lowShelfGain;

    const mudCut = offline.createBiquadFilter();
    mudCut.type = "peaking";
    mudCut.frequency.value = settings.eq.mudCutHz;
    mudCut.Q.value = 1.1;
    mudCut.gain.value = settings.eq.mudCutGain;

    const presence = offline.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = settings.eq.presenceHz;
    presence.Q.value = 0.95;
    presence.gain.value = settings.eq.presenceGain;

    const air = offline.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = settings.eq.airHz;
    air.gain.value = settings.eq.airGain;

    const compressor = offline.createDynamicsCompressor();
    compressor.threshold.value = settings.compressor.threshold;
    compressor.knee.value = settings.compressor.knee;
    compressor.ratio.value = settings.compressor.ratio;
    compressor.attack.value = settings.compressor.attack;
    compressor.release.value = settings.compressor.release;

    const makeup = offline.createGain();
    makeup.gain.value = dbToGain(settings.compressor.makeupDb);

    source.connect(highPass);
    highPass.connect(lowShelf);
    lowShelf.connect(mudCut);
    mudCut.connect(presence);
    presence.connect(air);
    air.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(offline.destination);

    source.start(0);
    const rendered = await offline.startRendering();
    const durationMs = round(performance.now() - startedAt);
    stageDurations.eqMs = durationMs;
    stageDurations.compressorMs = durationMs;
    info("eq stage end", {
      durationMs,
      sharedOfflineRender: true,
    });
    info("compressor stage end", {
      durationMs,
      sharedOfflineRender: true,
    });
    return rendered;
  }

  function applyDeEsser(ctx, buffer, settings, stageDurations) {
    info("de-esser start", {
      crossoverHz: settings.deEsser.crossoverHz,
      maxReductionDb: settings.deEsser.maxReductionDb,
    });
    const startedAt = performance.now();
    const mono = mergeToMono(buffer);
    const deEssed = applyDeEsserToSamples(mono, buffer.sampleRate, settings.deEsser);
    stageDurations.deEsserMs = round(performance.now() - startedAt);
    info("de-esser end", {
      durationMs: stageDurations.deEsserMs,
      active: deEssed.active,
      averageReductionDb: deEssed.averageReductionDb,
      maxReductionDb: deEssed.maxReductionDb,
    });
    return createMonoBuffer(ctx, deEssed.samples, buffer.sampleRate);
  }

  function applyDetailEnhancer(ctx, buffer, settings, stageDurations) {
    info("detail enhancer start", {
      presenceAmount: settings.detailEnhancer.presenceAmount,
      airAmount: settings.detailEnhancer.airAmount,
      transientAmount: settings.detailEnhancer.transientAmount,
    });
    const startedAt = performance.now();
    const mono = mergeToMono(buffer);
    const enhanced = applyDetailEnhancerToSamples(mono, buffer.sampleRate, settings.detailEnhancer);
    stageDurations.detailEnhancerMs = round(performance.now() - startedAt);
    info("detail enhancer end", {
      durationMs: stageDurations.detailEnhancerMs,
      active: enhanced.active,
      averageBoostDb: enhanced.averageBoostDb,
      maxBoostDb: enhanced.maxBoostDb,
    });
    return createMonoBuffer(ctx, enhanced.samples, buffer.sampleRate);
  }

  function applyFinalNormalize(ctx, buffer, settings, stageDurations) {
    info("limiter start", {
      ceilingDb: settings.ceilingDb,
    });
    const limiterStartedAt = performance.now();
    const limited = applySoftLimiter(ctx, buffer, settings.ceilingDb);
    stageDurations.limiterMs = round(performance.now() - limiterStartedAt);
    info("limiter end", {
      durationMs: stageDurations.limiterMs,
      ceilingDb: settings.ceilingDb,
    });

    const mono = mergeToMono(limited);
    const analysis = measureVoice(mono, limited.sampleRate);
    const loudnessGainDb = settings.targetLufsEstimate - analysis.loudnessEstimate;
    const peakSafeGainDb = settings.ceilingDb - analysis.peakDb;
    const appliedGainDb = Math.min(loudnessGainDb, peakSafeGainDb);
    info("loudness normalize start", {
      currentLoudnessEstimate: analysis.loudnessEstimate,
      targetLufsEstimate: settings.targetLufsEstimate,
      appliedGainDb,
    });
    const loudnessStartedAt = performance.now();
    const gained = applyGain(ctx, limited, appliedGainDb);
    stageDurations.loudnessNormalizeMs = round(performance.now() - loudnessStartedAt);
    info("loudness normalize end", {
      durationMs: stageDurations.loudnessNormalizeMs,
      appliedGainDb,
    });

    return {
      buffer: gained,
      gainDb: appliedGainDb,
    };
  }

  function applyGain(ctx, buffer, gainDb) {
    const gain = dbToGain(gainDb);
    const out = createBufferLike(ctx, buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const src = buffer.getChannelData(channel);
      const dst = out.getChannelData(channel);
      for (let i = 0; i < src.length; i += 1) {
        dst[i] = clamp(src[i] * gain, -1, 1);
      }
    }

    return out;
  }

  function applySoftLimiter(ctx, buffer, ceilingDb) {
    const ceiling = dbToGain(ceilingDb);
    const drive = 1.8;
    const normalizer = Math.tanh(drive);
    const out = createBufferLike(ctx, buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const src = buffer.getChannelData(channel);
      const dst = out.getChannelData(channel);
      for (let i = 0; i < src.length; i += 1) {
        const limited = Math.tanh((src[i] / Math.max(ceiling, 1e-4)) * drive) / normalizer;
        dst[i] = clamp(limited * ceiling, -1, 1);
      }
    }

    return out;
  }

  function measureVoice(samples, sampleRate) {
    let peak = 0;
    let sumSquares = 0;
    let clippingCount = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i] || 0;
      const abs = Math.abs(sample);
      if (abs > peak) {
        peak = abs;
      }
      if (abs >= 0.995) {
        clippingCount += 1;
      }
      sumSquares += sample * sample;
    }

    const meanSquare = sumSquares / Math.max(1, samples.length);
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : DB_FLOOR;
    const loudnessEstimate = meanSquare > 0 ? LUFS_OFFSET + 10 * Math.log10(meanSquare) : DB_FLOOR;
    const rmsDb = meanSquare > 0 ? 10 * Math.log10(meanSquare) : DB_FLOOR;

    return {
      peakDb,
      loudnessEstimate,
      clippingCount,
      dynamicRangeDb: peakDb - rmsDb,
      duration: sampleRate > 0 ? samples.length / sampleRate : 0,
    };
  }

  function estimateNoiseScore(samples, sampleRate) {
    const frames = frameRms(samples, sampleRate, 0.04);
    if (!frames.length) {
      return 0;
    }
    const sorted = frames.slice().sort((a, b) => a - b);
    const floor = sorted[Math.max(0, Math.floor(sorted.length * 0.15) - 1)] || 0;
    const median = sorted[Math.floor(sorted.length * 0.5)] || floor;
    const floorDb = floor > 0 ? 20 * Math.log10(floor) : DB_FLOOR;
    const spreadDb = Math.max(0, (median > 0 ? 20 * Math.log10(median) : floorDb) - floorDb);
    const raw = ((floorDb + 56) * 2.4) - (spreadDb * 0.8);
    return clamp(Math.round(raw), 0, 100);
  }

  function estimateHarshnessScore(samples, sampleRate) {
    return estimateBandRatioScore(samples, sampleRate, 2500, 6500, 120, 2500);
  }

  function estimateBandRatioScore(samples, sampleRate, focusLow, focusHigh, refLow, refHigh) {
    const windows = sampleWindows(samples, 4096, 3);
    if (!windows.length) {
      return 0;
    }

    let total = 0;
    for (let i = 0; i < windows.length; i += 1) {
      const spectrum = fftMagnitudes(windows[i]);
      const focus = bandEnergy(spectrum, sampleRate, focusLow, focusHigh);
      const reference = bandEnergy(spectrum, sampleRate, refLow, refHigh);
      const ratio = reference > 0 ? focus / reference : 0;
      total += ratio;
    }

    const average = total / windows.length;
    return clamp(Math.round(average * 180), 0, 100);
  }

  function estimateRoomEchoScore(samples, sampleRate) {
    const frames = frameRms(samples, sampleRate, 0.02);
    if (frames.length < 6) {
      return 0;
    }

    let evidence = 0;
    let checks = 0;
    for (let i = 1; i < frames.length - 4; i += 1) {
      const peak = frames[i];
      if (peak <= 1e-4 || peak < frames[i - 1] * 1.08 || peak < frames[i + 1] * 1.04) {
        continue;
      }
      const late = (frames[i + 2] + frames[i + 3] + frames[i + 4]) / 3;
      const sustain = late / Math.max(peak, 1e-5);
      evidence += sustain;
      checks += 1;
    }

    if (!checks) {
      return 0;
    }

    return clamp(Math.round((evidence / checks) * 180), 0, 100);
  }

  function deriveAdaptiveProfile(measured, estimated, heuristic, resolved) {
    const noiseBoost = clamp01((estimated.noiseLevel - 38) / 62) * 0.16;
    const roomBoost = clamp01((estimated.roomEcho - 24) / 76) * 0.28;
    const harshnessTrim = clamp01((estimated.harshness - 52) / 48) * 0.32;
    const mudBoost = clamp01((estimated.lowMidBuildup - 50) / 50) * 1.8;
    const dynamicControl = clamp01((measured.dynamicRangeDb - 10) / 12);
    const quietBoost = clamp01((-18 - measured.loudnessEstimate) / 12);
    const clippingControl = clamp01(measured.clippingCount / 96);
    const presenceHelp = clamp01((estimated.lowMidBuildup - estimated.harshness + 12) / 90) * 0.45;
    const detailBias = clamp01((50 - estimated.harshness + Math.max(0, 62 - estimated.noiseLevel)) / 90);
    const presetDetailWeight = resolved.preset.key === "creator" ? 1 : resolved.preset.key === "cinematic" ? 0.82 : 0.68;

    return {
      recommendedPreset: heuristic.recommendedPreset,
      qualityBand: noiseBoost > 0.08 || roomBoost > 0.1 ? "recovery" : "standard",
      noiseReductionBoost: round(noiseBoost),
      residualCleanupBoost: round(clamp((noiseBoost * 0.8) + (roomBoost * 0.35), 0, 0.22)),
      roomControlBoost: round(roomBoost),
      clarityShift: round(presenceHelp - harshnessTrim),
      depthShift: round(clamp((dynamicControl * 0.18) - (mudBoost * 0.08), -0.22, 0.2)),
      broadcastBoost: round(clamp((quietBoost * 0.16) + (dynamicControl * 0.1), 0, 0.24)),
      lowShelfBias: round(clamp(dynamicControl * 0.8, 0, 0.9)),
      mudCutBoost: round(mudBoost),
      presenceBias: round(clamp(presenceHelp * 1.6, 0, 1.4)),
      airTrim: round(clamp(harshnessTrim * 1.2, 0, 1.1)),
      compressorThresholdShift: round(clamp((dynamicControl * 1.6) + (clippingControl * 1.1), 0, 2.8)),
      compressorRatioBoost: round(clamp((dynamicControl * 0.45) + (clippingControl * 0.4), 0, 0.85)),
      makeupBoost: round(clamp(quietBoost * 1.4, 0, 1.6)),
      deEssBoost: round(clamp((harshnessTrim * 0.9) + (clippingControl * 0.25), 0, 0.36)),
      deEssThresholdShift: round(clamp(harshnessTrim * 0.04, 0, 0.04)),
      deEssCrossoverShiftHz: Math.round(clamp((estimated.harshness - 40) * 11, -250, 420)),
      detailBoost: round(clamp(detailBias * 0.26 * presetDetailWeight, 0, 0.28)),
      detailPresenceBias: round(clamp(detailBias * 0.44 * presetDetailWeight, 0, 0.48)),
      detailAirBias: round(clamp((1 - harshnessTrim) * 0.2 * presetDetailWeight, 0, 0.22)),
      detailTransientBias: round(clamp((dynamicControl * 0.12) + (detailBias * 0.22 * presetDetailWeight), 0, 0.22)),
      loudnessBiasDb: round(clamp((quietBoost * 0.8) - (clippingControl * 0.4), -0.5, 0.8)),
    };
  }

  function normalizeAdaptiveProfile(profile) {
    const safe = profile && typeof profile === "object" ? profile : {};
    return {
      recommendedPreset: typeof safe.recommendedPreset === "string" ? safe.recommendedPreset : "",
      qualityBand: typeof safe.qualityBand === "string" ? safe.qualityBand : "standard",
      noiseReductionBoost: clamp(Number(safe.noiseReductionBoost) || 0, 0, 0.2),
      residualCleanupBoost: clamp(Number(safe.residualCleanupBoost) || 0, 0, 0.24),
      roomControlBoost: clamp(Number(safe.roomControlBoost) || 0, 0, 0.3),
      clarityShift: clamp(Number(safe.clarityShift) || 0, -0.5, 0.5),
      depthShift: clamp(Number(safe.depthShift) || 0, -0.4, 0.4),
      broadcastBoost: clamp(Number(safe.broadcastBoost) || 0, 0, 0.3),
      lowShelfBias: clamp(Number(safe.lowShelfBias) || 0, -1.2, 1.2),
      mudCutBoost: clamp(Number(safe.mudCutBoost) || 0, 0, 2.2),
      presenceBias: clamp(Number(safe.presenceBias) || 0, -1.5, 1.6),
      airTrim: clamp(Number(safe.airTrim) || 0, 0, 1.4),
      compressorThresholdShift: clamp(Number(safe.compressorThresholdShift) || 0, 0, 4),
      compressorRatioBoost: clamp(Number(safe.compressorRatioBoost) || 0, 0, 1.4),
      makeupBoost: clamp(Number(safe.makeupBoost) || 0, 0, 1.8),
      deEssBoost: clamp(Number(safe.deEssBoost) || 0, 0, 0.4),
      deEssThresholdShift: clamp(Number(safe.deEssThresholdShift) || 0, 0, 0.05),
      deEssCrossoverShiftHz: clamp(Number(safe.deEssCrossoverShiftHz) || 0, -300, 450),
      detailBoost: clamp(Number(safe.detailBoost) || 0, 0, 0.28),
      detailPresenceBias: clamp(Number(safe.detailPresenceBias) || 0, 0, 0.45),
      detailAirBias: clamp(Number(safe.detailAirBias) || 0, 0, 0.24),
      detailTransientBias: clamp(Number(safe.detailTransientBias) || 0, 0, 0.28),
      loudnessBiasDb: clamp(Number(safe.loudnessBiasDb) || 0, -0.7, 0.9),
    };
  }

  function recommendPreset(measured, estimated, resolved) {
    if (estimated.harshness > 62 || estimated.lowMidBuildup > 64) {
      return PRESETS.creator.label;
    }
    if (measured.dynamicRangeDb > 16 && estimated.noiseLevel < 48) {
      return PRESETS.podcast.label;
    }
    if (estimated.lowMidBuildup > 54 && estimated.noiseLevel < 58) {
      return PRESETS.cinematic.label;
    }
    return resolved.preset.label || PRESETS.creator.label;
  }

  function pickSuggestedFocus(measured, estimated) {
    if (estimated.noiseLevel >= 58) {
      return "Push Noise Reduction first.";
    }
    if (estimated.harshness >= 58) {
      return "Raise Clarity Focus gently, not hard.";
    }
    if (measured.loudnessEstimate < -20) {
      return "Broadcast Ready can safely carry more weight.";
    }
    return "Current preset already close to publish-ready.";
  }

  function describeClarity(harshness, noiseLevel, dynamicRangeDb) {
    if (noiseLevel > 58) {
      return "Estimated clarity held back by background noise.";
    }
    if (harshness > 60) {
      return "Estimated clarity present, but upper mids feel sharp.";
    }
    if (dynamicRangeDb < 10) {
      return "Voice already controlled. Small polish should go far.";
    }
    return "Voice has good enhancement headroom.";
  }

  function buildIssues(measured, estimated, heuristic) {
    const issues = [];

    if (estimated.noiseLevel >= 58) {
      issues.push("Estimated background noise detected.");
    }
    if (estimated.lowMidBuildup >= 62) {
      issues.push("Voice sounds slightly muddy.");
    }
    if (estimated.harshness >= 60) {
      issues.push("Upper-mid harshness detected.");
    }
    if (measured.clippingCount >= 24) {
      issues.push("Input clipping detected.");
    }
    if (measured.loudnessEstimate <= -20) {
      issues.push("Voice level looks low for publish-ready output.");
    }
    if (!issues.length) {
      issues.push(`Suggested preset: ${heuristic.recommendedPreset}.`);
    }

    return issues;
  }

  async function getWorkerClient() {
    if (!workerClientPromise) {
      workerClientPromise = Promise.resolve().then(() => {
        modelInfo("worker init start", {
          backend: MODEL_WORKER.label,
          workerUrl: MODEL_WORKER.url,
        });
        const workerOptions = MODEL_WORKER.type === "module" ? { type: "module" } : undefined;
        const worker = new Worker(MODEL_WORKER.url, workerOptions);
        let nextId = 1;
        const pending = new Map();
        let isAlive = true;

        worker.addEventListener("message", (event) => {
          const payload = event.data || {};
          const ticket = pending.get(payload.id);
          if (!ticket) {
            return;
          }
          pending.delete(payload.id);

          if (payload.type === "init-ready") {
            modelInfo("worker init success", {
              backend: MODEL_WORKER.label,
              runtime: payload.runtime,
              frameSize: payload.frameSize,
            });
            ticket.resolve({
              runtime: payload.runtime,
              frameSize: payload.frameSize,
              modelName: payload.modelName || "",
            });
            return;
          }

          if (payload.type === "processed") {
            ticket.resolve({
              samples: new Float32Array(payload.samples),
              meta: payload.meta || null,
            });
            return;
          }

          warn("worker response failure", {
            backend: MODEL_WORKER.label,
            type: payload.type,
            error: payload.error || `${MODEL_WORKER.label} worker failed.`,
          });
          ticket.reject(new Error(payload.error || `${MODEL_WORKER.label} worker failed.`));
        });

        worker.addEventListener("error", (event) => {
          const error = new Error(event.message || `${MODEL_WORKER.label} worker crashed.`);
          isAlive = false;
          workerClientPromise = null;
          workerWarmupPromises.clear();
          errorLog("worker init failure", {
            backend: MODEL_WORKER.label,
            error: error.message,
          });
          pending.forEach((ticket) => ticket.reject(error));
          pending.clear();
        });

        function sendRequest(type, body, transferList = []) {
          if (!isAlive) {
            return Promise.reject(new Error(`${MODEL_WORKER.label} worker crashed.`));
          }
          const id = nextId += 1;
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            worker.postMessage({
              id,
              type,
              ...body,
            }, transferList);
          });
        }

        return {
          init(presetKey = DEFAULT_PRESET_KEY) {
            return sendRequest("init", { presetKey });
          },
          async process(samples, sampleRate, presetKey = DEFAULT_PRESET_KEY) {
            modelInfo("worker message sent", {
              backend: MODEL_WORKER.label,
              sampleRate,
              sampleCount: samples.length,
              presetKey,
            });
            const transfer = new Float32Array(samples);
            return sendRequest("process", {
              presetKey,
              sampleRate,
              samples: transfer.buffer,
            }, [transfer.buffer]);
          },
          destroy() {
            isAlive = false;
            worker.terminate();
            pending.clear();
          },
        };
      });
    }

    return workerClientPromise;
  }

  function mergeToMono(buffer) {
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < buffer.length; i += 1) {
        mono[i] += data[i] / buffer.numberOfChannels;
      }
    }
    return mono;
  }

  function removeDcOffsetInPlace(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      sum += samples[i] || 0;
    }
    const mean = sum / Math.max(1, samples.length);
    if (Math.abs(mean) < 1e-4) {
      return;
    }
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] -= mean;
    }
  }

  function applySpeechHighPassInPlace(samples, sampleRate, cutoffHz) {
    if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return;
    }

    const cutoff = clamp(Number(cutoffHz) || 80, 40, Math.min(220, sampleRate * 0.45));
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / sampleRate;
    const alpha = rc / (rc + dt);
    let previousInput = samples[0] || 0;
    let previousOutput = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const input = samples[i] || 0;
      const output = alpha * (previousOutput + input - previousInput);
      samples[i] = output;
      previousInput = input;
      previousOutput = output;
    }
  }

  function applyGainSanityInPlace(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i] || 0));
    }
    if (peak < 1e-5) {
      return;
    }

    let gain = 1;
    if (peak > 0.98) {
      gain = 0.92 / peak;
    } else if (peak < 0.12) {
      gain = Math.min(2.2, 0.22 / peak);
    }

    if (Math.abs(gain - 1) < 0.01) {
      return;
    }

    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = clamp(samples[i] * gain, -1, 1);
    }
  }

  function applyMildRoomControl(samples, sampleRate, settings) {
    const output = new Float32Array(samples);
    if (!samples.length || settings.roomControlAmount < 0.08) {
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const frameSize = Math.max(256, Math.floor(sampleRate * 0.024));
    const frameLevels = [];
    for (let start = 0; start < samples.length; start += frameSize) {
      frameLevels.push(frameLevel(samples, start, frameSize));
    }

    if (!frameLevels.length) {
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const sorted = frameLevels.slice().sort((a, b) => a - b);
    const floor = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.18))] || 0;
    const speechRef = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.72))] || floor;
    const maxReductionDb = round(2.4 + (settings.roomControlAmount * 5.1));

    if (floor <= 1e-5 || speechRef <= floor * 1.15) {
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const fastAttack = Math.exp(-1 / Math.max(1, sampleRate * 0.004));
    const fastRelease = Math.exp(-1 / Math.max(1, sampleRate * 0.028));
    const slowAttack = Math.exp(-1 / Math.max(1, sampleRate * 0.03));
    const slowRelease = Math.exp(-1 / Math.max(1, sampleRate * 0.22));
    let fastEnv = 0;
    let slowEnv = 0;
    let totalReductionDb = 0;
    let maxAppliedReductionDb = 0;

    for (let i = 0; i < output.length; i += 1) {
      const sampleAbs = Math.abs(output[i] || 0);
      fastEnv = sampleAbs > fastEnv
        ? (fastAttack * fastEnv) + ((1 - fastAttack) * sampleAbs)
        : (fastRelease * fastEnv) + ((1 - fastRelease) * sampleAbs);
      slowEnv = sampleAbs > slowEnv
        ? (slowAttack * slowEnv) + ((1 - slowAttack) * sampleAbs)
        : (slowRelease * slowEnv) + ((1 - slowRelease) * sampleAbs);

      const sustainRatio = fastEnv / Math.max(slowEnv, 1e-5);
      const activity = clamp01((slowEnv - (floor * 1.55)) / Math.max((speechRef * 0.48), (floor * 4.0), 1e-4));
      const tailAmount = clamp01((0.9 - sustainRatio) / 0.38) * activity * settings.roomControlAmount;
      const reductionDb = tailAmount * maxReductionDb;
      const gain = dbToGain(-reductionDb);
      output[i] *= gain;
      totalReductionDb += reductionDb;
      if (reductionDb > maxAppliedReductionDb) {
        maxAppliedReductionDb = reductionDb;
      }
    }

    return {
      samples: output,
      active: maxAppliedReductionDb > 0.25,
      averageReductionDb: round(totalReductionDb / Math.max(1, output.length)),
      maxReductionDb: round(maxAppliedReductionDb),
    };
  }

  function applyResidualNoiseCleanup(samples, sampleRate, settings) {
    const output = new Float32Array(samples);
    if (!samples.length || settings.residualCleanupAmount < 0.08) {
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const frames = frameRms(samples, sampleRate, 0.03);
    if (!frames.length) {
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const sorted = frames.slice().sort((a, b) => a - b);
    const floor = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.18))] || 0;
    const speechRef = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.7))] || floor;
    if (floor <= 1e-5 || speechRef <= floor * 1.08) {
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const fastAttack = Math.exp(-1 / Math.max(1, sampleRate * 0.003));
    const fastRelease = Math.exp(-1 / Math.max(1, sampleRate * 0.04));
    const slowAttack = Math.exp(-1 / Math.max(1, sampleRate * 0.025));
    const slowRelease = Math.exp(-1 / Math.max(1, sampleRate * 0.18));
    const maxReductionDb = round(1.2 + (settings.residualCleanupAmount * 3.8));
    let fastEnv = 0;
    let slowEnv = 0;
    let totalReductionDb = 0;
    let maxAppliedReductionDb = 0;

    for (let i = 0; i < output.length; i += 1) {
      const sampleAbs = Math.abs(output[i] || 0);
      fastEnv = sampleAbs > fastEnv
        ? (fastAttack * fastEnv) + ((1 - fastAttack) * sampleAbs)
        : (fastRelease * fastEnv) + ((1 - fastRelease) * sampleAbs);
      slowEnv = sampleAbs > slowEnv
        ? (slowAttack * slowEnv) + ((1 - slowAttack) * sampleAbs)
        : (slowRelease * slowEnv) + ((1 - slowRelease) * sampleAbs);

      const activity = clamp01((slowEnv - (floor * 1.25)) / Math.max((speechRef * 0.44), (floor * 3.2), 1e-4));
      const floorProximity = clamp01((floor * 2.6 - fastEnv) / Math.max(floor * 2.2, 1e-4));
      const reductionDb = floorProximity * activity * maxReductionDb;
      const gain = dbToGain(-reductionDb);
      output[i] *= gain;
      totalReductionDb += reductionDb;
      if (reductionDb > maxAppliedReductionDb) {
        maxAppliedReductionDb = reductionDb;
      }
    }

    return {
      samples: output,
      active: maxAppliedReductionDb > 0.2,
      averageReductionDb: round(totalReductionDb / Math.max(1, output.length)),
      maxReductionDb: round(maxAppliedReductionDb),
    };
  }

  function applyDeEsserToSamples(samples, sampleRate, settings) {
    const output = new Float32Array(samples.length);
    if (!samples.length || settings.sensitivity < 0.08) {
      output.set(samples);
      return {
        samples: output,
        active: false,
        averageReductionDb: 0,
        maxReductionDb: 0,
      };
    }

    const lowpassAlpha = 1 - Math.exp((-2 * Math.PI * settings.crossoverHz) / Math.max(sampleRate, 1));
    const attack = Math.exp(-1 / Math.max(1, sampleRate * 0.0015));
    const release = Math.exp(-1 / Math.max(1, sampleRate * 0.05));
    let low = 0;
    let reductionEnv = 0;
    let totalReductionDb = 0;
    let maxAppliedReductionDb = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const input = samples[i] || 0;
      low += lowpassAlpha * (input - low);
      const high = input - low;
      const ratio = Math.abs(high) / Math.max(Math.abs(input), 1e-4);
      const targetReduction = clamp01((ratio - settings.thresholdRatio) / 0.42) * settings.sensitivity;
      reductionEnv = targetReduction > reductionEnv
        ? (attack * reductionEnv) + ((1 - attack) * targetReduction)
        : (release * reductionEnv) + ((1 - release) * targetReduction);
      const reductionDb = reductionEnv * settings.maxReductionDb;
      const gain = dbToGain(-reductionDb);
      output[i] = low + (high * gain);
      totalReductionDb += reductionDb;
      if (reductionDb > maxAppliedReductionDb) {
        maxAppliedReductionDb = reductionDb;
      }
    }

    return {
      samples: output,
      active: maxAppliedReductionDb > 0.25,
      averageReductionDb: round(totalReductionDb / Math.max(1, samples.length)),
      maxReductionDb: round(maxAppliedReductionDb),
    };
  }

  function applyDetailEnhancerToSamples(samples, sampleRate, settings) {
    const output = new Float32Array(samples.length);
    if (!samples.length || (settings.presenceAmount + settings.airAmount + settings.transientAmount) < 0.08) {
      output.set(samples);
      return {
        samples: output,
        active: false,
        averageBoostDb: 0,
        maxBoostDb: 0,
      };
    }

    const presenceAlpha = 1 - Math.exp((-2 * Math.PI * settings.presenceHz) / Math.max(sampleRate, 1));
    const airAlpha = 1 - Math.exp((-2 * Math.PI * settings.airHz) / Math.max(sampleRate, 1));
    let lowPresence = 0;
    let lowAir = 0;
    let prevInput = 0;
    let totalBoost = 0;
    let maxBoost = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const input = samples[i] || 0;
      lowPresence += presenceAlpha * (input - lowPresence);
      lowAir += airAlpha * (input - lowAir);
      const highPresence = input - lowPresence;
      const airBand = input - lowAir;
      const transient = input - prevInput;
      prevInput = input;

      const presenceBoost = highPresence * settings.presenceAmount * 0.18;
      const airBoost = airBand * settings.airAmount * 0.08;
      const transientBoost = transient * settings.transientAmount * 0.22;
      const boosted = clamp(input + presenceBoost + airBoost + transientBoost, -1, 1);
      output[i] = boosted;

      const delta = Math.abs(boosted - input);
      totalBoost += delta;
      if (delta > maxBoost) {
        maxBoost = delta;
      }
    }

    const averageBoostDb = totalBoost > 0 ? 20 * Math.log10(1 + (totalBoost / Math.max(1, samples.length))) : 0;
    const maxBoostDb = maxBoost > 0 ? 20 * Math.log10(1 + maxBoost) : 0;
    return {
      samples: output,
      active: maxBoostDb > 0.1,
      averageBoostDb: round(averageBoostDb),
      maxBoostDb: round(maxBoostDb),
    };
  }

  function blendSignals(dry, wet, amount) {
    const output = new Float32Array(dry.length);
    const wetMix = clamp01(amount);
    const dryMix = 1 - wetMix;
    for (let i = 0; i < dry.length; i += 1) {
      output[i] = (dry[i] * dryMix) + ((wet[i] || 0) * wetMix);
    }
    return output;
  }

  function createMonoBuffer(ctx, samples, sampleRate) {
    const buffer = createBufferLike(ctx, 1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  function createBufferLike(ctx, numberOfChannels, length, sampleRate) {
    if (ctx && typeof ctx.createBuffer === "function") {
      return ctx.createBuffer(numberOfChannels, length, sampleRate);
    }
    if (typeof AudioBuffer === "function") {
      return new AudioBuffer({
        length,
        numberOfChannels,
        sampleRate,
      });
    }

    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) {
      throw new Error("AudioBuffer creation is not supported in this browser.");
    }
    return new OfflineCtx(numberOfChannels, Math.max(1, length), sampleRate).createBuffer(numberOfChannels, length, sampleRate);
  }

  function frameRms(samples, sampleRate, frameSeconds) {
    const frameSize = Math.max(256, Math.floor(sampleRate * frameSeconds));
    const frames = [];
    for (let start = 0; start < samples.length; start += frameSize) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < frameSize && start + i < samples.length; i += 1) {
        const sample = samples[start + i] || 0;
        sum += sample * sample;
        count += 1;
      }
      if (count > 0) {
        frames.push(Math.sqrt(sum / count));
      }
    }
    return frames;
  }

  function frameLevel(samples, start, frameSize) {
    let sum = 0;
    let count = 0;
    const end = Math.min(samples.length, start + frameSize);
    for (let i = start; i < end; i += 1) {
      const sample = samples[i] || 0;
      sum += sample * sample;
      count += 1;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
  }

  function sampleWindows(samples, size, count) {
    if (!samples.length) {
      return [];
    }
    const windows = [];
    const anchors = count === 1 ? [0.5] : [0.18, 0.5, 0.82];
    for (let i = 0; i < Math.min(count, anchors.length); i += 1) {
      windows.push(extractWindow(samples, anchors[i], size));
    }
    return windows;
  }

  function extractWindow(samples, position, size) {
    const window = new Float32Array(size);
    const center = Math.floor(clamp(position, 0, 1) * Math.max(0, samples.length - 1));
    let start = Math.max(0, center - Math.floor(size / 2));
    if (start + size > samples.length) {
      start = Math.max(0, samples.length - size);
    }
    for (let i = 0; i < size; i += 1) {
      const index = start + i;
      window[i] = (samples[index] || 0) * hann(i, size);
    }
    return window;
  }

  function fftMagnitudes(input) {
    const size = nextPowerOfTwo(input.length);
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    real.set(input.subarray(0, Math.min(input.length, size)));
    fft(real, imag);
    const magnitudes = new Float32Array(size / 2);
    for (let i = 0; i < magnitudes.length; i += 1) {
      magnitudes[i] = Math.hypot(real[i], imag[i]);
    }
    return magnitudes;
  }

  function bandEnergy(spectrum, sampleRate, lowHz, highHz) {
    let energy = 0;
    for (let i = 1; i < spectrum.length; i += 1) {
      const frequency = (i * sampleRate) / (spectrum.length * 2);
      if (frequency < lowHz || frequency >= highHz) {
        continue;
      }
      energy += spectrum[i];
    }
    return energy;
  }

  function fft(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = (-2 * Math.PI) / size;
      for (let start = 0; start < n; start += size) {
        for (let i = 0; i < half; i += 1) {
          const angle = step * i;
          const wr = Math.cos(angle);
          const wi = Math.sin(angle);
          const evenIndex = start + i;
          const oddIndex = evenIndex + half;
          const tr = wr * real[oddIndex] - wi * imag[oddIndex];
          const ti = wr * imag[oddIndex] + wi * real[oddIndex];
          real[oddIndex] = real[evenIndex] - tr;
          imag[oddIndex] = imag[evenIndex] - ti;
          real[evenIndex] += tr;
          imag[evenIndex] += ti;
        }
      }
    }
  }

  function nextPowerOfTwo(value) {
    let n = 1;
    while (n < value) {
      n <<= 1;
    }
    return n;
  }

  function hann(index, size) {
    if (size <= 1) {
      return 1;
    }
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }

  function dbToGain(db) {
    return Math.pow(10, (Number(db) || 0) / 20);
  }

  function resolveDenoiseMix(amount) {
    if (amount >= 0.82) {
      return 1;
    }
    return clamp01(0.16 + (amount * 1.06));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.FreeAudioTrimVoiceEnhancer = {
    PRESETS,
    analyzeVoice,
    enhanceVoice,
    prewarmWorker,
    createProcessor,
  };

  function info(message, data) {
    emit("info", LOG_PREFIX, message, data);
  }

  function modelInfo(message, data) {
    emit("info", MODEL_PREFIX, message, data);
  }

  function warn(message, data) {
    emit("warn", LOG_PREFIX, message, data);
  }

  function errorLog(message, data) {
    emit("error", LOG_PREFIX, message, data);
  }

  function emit(level, prefix, message, data) {
    void level;
    void prefix;
    void message;
    void data;
  }

  function round(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }
})();
