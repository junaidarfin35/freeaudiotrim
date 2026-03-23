(() => {
  "use strict";

  const BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";

  class AudioEngine {
    constructor(options = {}) {
      this.options = options;
      this.audioContext = null;
      this.originalBuffer = null;
      this.processedBuffer = null;
      this.processedKey = "";
      this.fileName = "audio";
      this.mode = "modified";
      this.previewMode = "B";
      this.sourceNode = null;
      this.gainNode = null;
      this.isPlaying = false;
      this.startedAt = 0;
      this.pausedOffset = 0;
      this.rafId = 0;
      this.settings = {
        pitchSemitones: 0,
        speed: 1,
      };

      this.canvas = options.canvas || null;
      this.timeOutputs = Array.isArray(options.timeOutputs) ? options.timeOutputs : [];
      this.onStateChange = options.onStateChange || (() => {});
      this.onStatus = options.onStatus || (() => {});
      this.onAnalysis = options.onAnalysis || (() => {});
      this.onBuffer = options.onBuffer || (() => {});
    }

    async loadFile(file) {
      try {
        this.stop();
        this.clearProcessedCache();
        this.onStatus("Decoding audio...");
        const ctx = this.getContext();
        const arrayBuffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        this.originalBuffer = decoded;
        this.fileName = stripExtension(file.name || "audio");
        this.previewMode = "B";
        this.mode = "modified";
        this.pausedOffset = 0;
        this.updateTimeDisplays(0);
        this.drawWaveform();
        this.onBuffer({
          originalDuration: decoded.duration,
          processedDuration: decoded.duration,
        });
        this.onStatus("File ready. Adjust settings, preview, then export.");
        this.updateState();
        void this.runAnalysis(decoded);
      } catch (error) {
        console.error(error);
        this.onStatus(`This audio format is not supported by your browser. ${BROWSER_SUPPORT_MESSAGE}`);
      }
    }

    setSettings(nextSettings) {
      this.settings = {
        ...this.settings,
        ...nextSettings,
      };
      this.clearProcessedCache();
      if (this.previewMode === "B" && this.originalBuffer) {
        void this.primeProcessedBuffer();
      } else {
        this.drawWaveform();
      }
      this.updateState();
    }

    async primeProcessedBuffer() {
      if (!this.originalBuffer) {
        return null;
      }
      const buffer = await this.getProcessedBuffer();
      this.onBuffer({
        originalDuration: this.originalBuffer.duration,
        processedDuration: buffer.duration,
      });
      this.drawWaveform();
      return buffer;
    }

    async setMode(nextMode) {
      if (nextMode === "original") {
        await this.setPreviewMode("A");
        return;
      }
      if (nextMode === "modified") {
        await this.setPreviewMode("B");
        return;
      }
      this.updateState();
    }

    async setPreviewMode(nextPreviewMode) {
      if (!this.originalBuffer || (nextPreviewMode !== "A" && nextPreviewMode !== "B")) {
        this.previewMode = nextPreviewMode;
        this.mode = nextPreviewMode === "A" ? "original" : "modified";
        this.updateState();
        return;
      }

      const wasPlaying = this.isPlaying;
      const currentOffset = this.getCurrentTime();

      this.previewMode = nextPreviewMode;
      this.mode = nextPreviewMode === "A" ? "original" : "modified";
      this.pausedOffset = clamp(currentOffset, 0, this.getCurrentDuration() || currentOffset || 0);
      this.stopSourceOnly();
      this.cancelAnimation();
      this.updateTimeDisplays(this.pausedOffset);
      this.drawWaveform();

      if (wasPlaying) {
        await this.play();
      } else {
        this.updateState();
      }
    }

    async togglePreviewMode() {
      await this.setPreviewMode(this.previewMode === "A" ? "B" : "A");
    }

    async seekTo(offsetSeconds) {
      if (!this.originalBuffer) {
        return;
      }

      const wasPlaying = this.isPlaying;
      const buffer = await this.getPlaybackBuffer();
      if (!buffer) {
        return;
      }

      this.pausedOffset = clamp(Number(offsetSeconds) || 0, 0, buffer.duration);

      if (wasPlaying) {
        this.stopSourceOnly();
        this.cancelAnimation();
        await this.play();
        return;
      }

      this.updateTimeDisplays(this.pausedOffset);
      this.drawWaveform();
      this.updateState();
    }

    async togglePlayPause() {
      if (this.isPlaying) {
        this.pause();
        return;
      }
      await this.play();
    }

    async play() {
      const buffer = await this.getPlaybackBuffer();
      if (!buffer) {
        this.onStatus("Upload an audio file first.");
        return;
      }

      const ctx = this.getContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      this.startSource(buffer, this.pausedOffset, this.getPlaybackRate());
      this.onStatus(this.mode === "modified" ? "Previewing modified audio." : "Previewing original audio.");
      this.updateState();
    }

    pause() {
      if (!this.isPlaying) {
        return;
      }
      const buffer = this.getCurrentBufferSync();
      if (!buffer) {
        return;
      }
      this.pausedOffset = clamp(this.getCurrentTime(), 0, buffer.duration);
      this.isPlaying = false;
      this.stopSourceOnly();
      this.cancelAnimation();
      this.updateTimeDisplays(this.pausedOffset);
      this.drawWaveform();
      this.onStatus("Preview paused.");
      this.updateState();
    }

    stop() {
      this.isPlaying = false;
      this.pausedOffset = 0;
      this.stopSourceOnly();
      this.cancelAnimation();
      this.updateTimeDisplays(0);
      this.drawWaveform();
      this.updateState();
    }

    jumpToStart() {
      this.pausedOffset = 0;
      if (this.isPlaying) {
        void this.play();
      } else {
        this.updateTimeDisplays(0);
        this.drawWaveform();
        this.updateState();
      }
    }

    async exportProcessed() {
      if (!this.originalBuffer) {
        this.onStatus("Upload an audio file first.");
        return null;
      }
      try {
        this.onStatus("Rendering processed audio...");
        const buffer = await this.getProcessedBuffer();
        const wavBlob = encodeWav(buffer);
        this.onStatus("Export ready. Click Download.");
        return {
          blob: wavBlob,
          fileName: `${this.fileName}_processed.wav`,
        };
      } catch (error) {
        console.error(error);
        this.onStatus("Export failed. Try a smaller file or another browser.");
        return null;
      }
    }

    getCurrentTime() {
      const buffer = this.getCurrentBufferSync();
      if (!buffer) {
        return 0;
      }
      if (!this.isPlaying || !this.sourceNode) {
        return clamp(this.pausedOffset, 0, buffer.duration);
      }
      const ctx = this.getContext();
      const rate = this.getPlaybackRate();
      return clamp((ctx.currentTime - this.startedAt) * rate, 0, buffer.duration);
    }

    getCurrentDuration() {
      const buffer = this.getCurrentBufferSync();
      if (!buffer) {
        return 0;
      }
      return buffer.duration;
    }

    getPlaybackState() {
      return {
        isPlaying: this.isPlaying,
        mode: this.mode,
        previewMode: this.previewMode,
        currentTime: this.getCurrentTime(),
        duration: this.getCurrentDuration(),
      };
    }

    getContext() {
      if (!this.audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
          throw new Error("AudioContext is not supported.");
        }
        this.audioContext = new Ctx();
      }
      return this.audioContext;
    }

    clearProcessedCache() {
      this.processedBuffer = null;
      this.processedKey = "";
    }

    async getActiveBuffer() {
      return this.getPlaybackBuffer();
    }

    async getPlaybackBuffer() {
      if (!this.originalBuffer) {
        return null;
      }
      if (this.previewMode === "A" || this.isSpeedOnlyPreview()) {
        return this.originalBuffer;
      }
      return this.getProcessedBuffer();
    }

    getCurrentBufferSync() {
      if (this.previewMode === "A" || this.isSpeedOnlyPreview()) {
        return this.originalBuffer;
      }
      return this.processedBuffer || this.originalBuffer;
    }

    getPlaybackRate() {
      if (this.mode !== "modified" || !this.isSpeedOnlyPreview()) {
        return 1;
      }
      return Math.max(0.25, Number(this.settings.speed || 1));
    }

    getPlaybackBufferSync() {
      return this.getCurrentBufferSync();
    }

    isSpeedOnlyPreview() {
      return Math.abs(Number(this.settings.pitchSemitones || 0)) < 0.001;
    }

    async getProcessedBuffer() {
      if (!this.originalBuffer) {
        return null;
      }
      const key = JSON.stringify(this.settings);
      if (this.processedBuffer && this.processedKey === key) {
        return this.processedBuffer;
      }
      this.processedBuffer = await renderProcessedBuffer(this.getContext(), this.originalBuffer, this.settings);
      this.processedKey = key;
      return this.processedBuffer;
    }

    startSource(buffer, offsetSeconds, playbackRate = 1) {
      this.stopSourceOnly();
      const ctx = this.getContext();
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      const rate = Math.max(0.25, Number(playbackRate) || 1);
      const compensation = 1 / Math.sqrt(rate);
      const peak = getPeak(buffer);
      const normalize = peak > 0 ? 1 / peak : 1;
      let gainValue = normalize * compensation;
      gainValue = Math.min(Math.max(gainValue, 0.7), 1.5);

      source.buffer = buffer;
      source.playbackRate.value = rate;
      gainNode.gain.value = gainValue;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0, Math.max(0, offsetSeconds));
      source.onended = () => {
        if (!this.isPlaying) {
          return;
        }
        const played = this.getCurrentTime();
        if (played >= buffer.duration - 0.02) {
          this.stop();
          this.onStatus("Playback stopped.");
        }
      };

      this.sourceNode = source;
      this.gainNode = gainNode;
      this.startedAt = ctx.currentTime - (offsetSeconds / source.playbackRate.value);
      this.pausedOffset = offsetSeconds;
      this.isPlaying = true;
      this.startAnimation();
    }

    stopSourceOnly() {
      if (!this.sourceNode) {
        return;
      }
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch (error) {
        // Ignore race with ended state.
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
    }

    startAnimation() {
      this.cancelAnimation();
      const tick = () => {
        this.updateTimeDisplays(this.getCurrentTime());
        this.drawWaveform();
        this.updateState();
        if (this.isPlaying) {
          this.rafId = window.requestAnimationFrame(tick);
        }
      };
      tick();
    }

    cancelAnimation() {
      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    }

    updateTimeDisplays(currentTime) {
      const duration = this.getCurrentDuration();
      const label = `${formatTime(currentTime)} / ${formatTime(duration)}`;
      this.timeOutputs.forEach((node) => {
        if (node) {
          node.textContent = label;
        }
      });
    }

    drawWaveform() {
      if (!this.canvas) {
        return;
      }
      const buffer = this.getCurrentBufferSync();
      const canvas = this.canvas;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width || canvas.width || 640));
      const height = Math.max(140, Math.floor(rect.height || canvas.height || 180));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#f8fbff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#cfe0f7";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

      if (!buffer) {
        ctx.fillStyle = "#71829a";
        ctx.font = "500 15px DM Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Upload a file to preview waveform", width / 2, height / 2);
        return;
      }

      const mono = mergeToMono(buffer);
      const samplesPerPixel = Math.max(1, Math.floor(mono.length / width));
      const centerY = height / 2;

      ctx.beginPath();
      ctx.strokeStyle = "#5f88bd";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 1) {
        const start = x * samplesPerPixel;
        const end = Math.min(mono.length, start + samplesPerPixel);
        let min = 1;
        let max = -1;
        for (let i = start; i < end; i += 1) {
          const value = mono[i];
          if (value < min) min = value;
          if (value > max) max = value;
        }
        ctx.moveTo(x + 0.5, centerY + min * centerY * 0.88);
        ctx.lineTo(x + 0.5, centerY + max * centerY * 0.88);
      }
      ctx.stroke();

      const duration = buffer.duration || 1;
      const progress = clamp(this.getCurrentTime() / duration, 0, 1);
      const playheadX = progress * width;
      ctx.beginPath();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }

    async runAnalysis(buffer) {
      const analysis = await Promise.resolve().then(() => analyzeBuffer(buffer));
      this.onAnalysis(analysis);
    }

    updateState() {
      this.onStateChange({
        isPlaying: this.isPlaying,
        mode: this.mode,
        currentTime: this.getCurrentTime(),
        duration: this.getCurrentDuration(),
      });
    }
  }

  async function renderProcessedBuffer(ctx, sourceBuffer, settings) {
    let working = cloneBuffer(ctx, sourceBuffer);
    const pitch = Number(settings.pitchSemitones || 0);
    const speed = Math.max(0.25, Number(settings.speed || 1));

    if (Math.abs(pitch) > 0.001) {
      const pitchRate = Math.pow(2, pitch / 12);
      working = pitchShiftBuffer(ctx, working, pitchRate);
    }

    if (Math.abs(speed - 1) > 0.001) {
      working = timeStretchBuffer(ctx, working, speed);
    }

    return working;
  }

  function pitchShiftBuffer(ctx, sourceBuffer, pitchRate) {
    if (Math.abs(pitchRate - 1) < 0.001) {
      return cloneBuffer(ctx, sourceBuffer);
    }
    const resampled = resampleBuffer(ctx, sourceBuffer, pitchRate);
    return timeStretchBuffer(ctx, resampled, 1 / pitchRate);
  }

  function timeStretchBuffer(ctx, sourceBuffer, speed) {
    if (Math.abs(speed - 1) < 0.001) {
      return cloneBuffer(ctx, sourceBuffer);
    }

    const grainSize = 2048;
    const synthesisHop = 512;
    const analysisHop = Math.max(1, Math.round(synthesisHop * speed));
    const window = buildHannWindow(grainSize);
    const expectedLength = Math.max(1, Math.ceil(sourceBuffer.length / speed));
    const outputLength = expectedLength + grainSize * 2;
    const output = ctx.createBuffer(sourceBuffer.numberOfChannels, outputLength, sourceBuffer.sampleRate);

    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const input = sourceBuffer.getChannelData(channel);
      const out = output.getChannelData(channel);
      const norm = new Float32Array(outputLength);
      let inPos = 0;
      let outPos = 0;

      while (Math.floor(inPos) + grainSize < input.length && outPos + grainSize < outputLength) {
        const inputIndex = Math.floor(inPos);
        for (let i = 0; i < grainSize; i += 1) {
          const value = input[inputIndex + i] || 0;
          const weight = window[i];
          out[outPos + i] += value * weight;
          norm[outPos + i] += weight;
        }
        inPos += analysisHop;
        outPos += synthesisHop;
      }

      for (let i = 0; i < out.length; i += 1) {
        const weight = norm[i];
        if (weight > 0.0001) {
          out[i] /= weight;
        }
      }
    }

    return trimBuffer(ctx, output, expectedLength);
  }

  function resampleBuffer(ctx, sourceBuffer, rate) {
    const outputLength = Math.max(1, Math.ceil(sourceBuffer.length / rate));
    const output = ctx.createBuffer(sourceBuffer.numberOfChannels, outputLength, sourceBuffer.sampleRate);
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const input = sourceBuffer.getChannelData(channel);
      const out = output.getChannelData(channel);
      for (let i = 0; i < outputLength; i += 1) {
        const position = i * rate;
        const index = Math.floor(position);
        const frac = position - index;
        const sampleA = input[index] || 0;
        const sampleB = input[Math.min(index + 1, input.length - 1)] || 0;
        out[i] = sampleA + (sampleB - sampleA) * frac;
      }
    }
    return output;
  }

  function cloneBuffer(ctx, sourceBuffer) {
    const clone = ctx.createBuffer(sourceBuffer.numberOfChannels, sourceBuffer.length, sourceBuffer.sampleRate);
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      clone.copyToChannel(sourceBuffer.getChannelData(channel), channel);
    }
    return clone;
  }

  function trimBuffer(ctx, sourceBuffer, length) {
    const trimmed = ctx.createBuffer(sourceBuffer.numberOfChannels, length, sourceBuffer.sampleRate);
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      trimmed.copyToChannel(sourceBuffer.getChannelData(channel).subarray(0, length), channel);
    }
    return trimmed;
  }

  function buildHannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    return window;
  }

  function encodeWav(buffer) {
    const channels = Math.min(buffer.numberOfChannels, 2);
    const sampleRate = buffer.sampleRate;
    const frames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const out = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    let offset = 0;

    const writeString = (value) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
      offset += value.length;
    };

    writeString("RIFF");
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString("WAVE");
    writeString("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, channels, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, sampleRate * blockAlign, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeString("data");
    view.setUint32(offset, dataSize, true);
    offset += 4;

    const channelData = [];
    for (let channel = 0; channel < channels; channel += 1) {
      channelData.push(buffer.getChannelData(channel));
    }

    for (let i = 0; i < frames; i += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = clamp(channelData[channel][i] || 0, -1, 1);
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([out], { type: "audio/wav" });
  }

  function analyzeBuffer(buffer) {
    const mono = mergeToMono(buffer);
    const tempo = detectTempo(mono, buffer.sampleRate);
    const key = detectKey(mono, buffer.sampleRate);
    const confidenceScore = clamp01((tempo.confidence + key.confidence) / 2);
    return {
      key: key.key,
      bpm: tempo.bpm,
      confidence: confidenceScore,
      confidenceLabel: confidenceLevel(confidenceScore),
      keyConfidence: key.confidence,
      bpmConfidence: tempo.confidence,
    };
  }

  function detectTempo(samples, sampleRate) {
    const frameSize = 1024;
    const hopSize = 512;
    const envelope = [];
    let previousEnergy = 0;

    for (let i = 0; i + frameSize < samples.length; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < frameSize; j += 1) {
        const value = samples[i + j];
        energy += value * value;
      }
      energy = Math.sqrt(energy / frameSize);
      envelope.push(Math.max(0, energy - previousEnergy));
      previousEnergy = energy;
    }

    let bestLag = 0;
    let bestScore = 0;
    let secondBestScore = 0;
    const minLag = Math.floor((60 / 180) * sampleRate / hopSize);
    const maxLag = Math.floor((60 / 60) * sampleRate / hopSize);

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let score = 0;
      for (let i = lag; i < envelope.length; i += 1) {
        score += envelope[i] * envelope[i - lag];
      }
      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestLag = lag;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    if (!bestLag) {
      return { bpm: 0, confidence: 0 };
    }
    const rawBpm = Math.round((60 * sampleRate) / (bestLag * hopSize));
    const bpm = normalizeBpm(rawBpm);
    const confidence = clamp01(scoreConfidence(bestScore, secondBestScore, envelope.length));
    return {
      bpm,
      confidence: bpm !== rawBpm ? confidence * 0.88 : confidence,
    };
  }

  function detectKey(samples, sampleRate) {
    const windowSize = 4096;
    const pitchClassEnergy = new Float32Array(12);
    const positions = samples.length <= windowSize ? [0.5] : [0.18, 0.5, 0.82];

    for (const position of positions) {
      const window = extractWindow(samples, position, windowSize);
      const spectrum = fftMagnitudes(window);
      for (let bin = 1; bin < spectrum.length; bin += 1) {
        const frequency = (bin * sampleRate) / window.length;
        if (frequency < 55 || frequency > 1760) {
          continue;
        }
        const magnitude = spectrum[bin];
        if (magnitude <= 0) {
          continue;
        }
        const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
        const pitchClass = ((midi % 12) + 12) % 12;
        pitchClassEnergy[pitchClass] += magnitude;
      }
    }

    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const noteNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

    const scores = [];
    for (let root = 0; root < 12; root += 1) {
      let majorScore = 0;
      let minorScore = 0;
      for (let i = 0; i < 12; i += 1) {
        const sourceIndex = (i + root) % 12;
        majorScore += pitchClassEnergy[sourceIndex] * majorProfile[i];
        minorScore += pitchClassEnergy[sourceIndex] * minorProfile[i];
      }
      scores.push({ key: `${noteNames[root]} major`, score: majorScore });
      scores.push({ key: `${noteNames[root]} minor`, score: minorScore });
    }
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0] || { key: "Unknown", score: 0 };
    const second = scores[1] || { score: 0 };
    const total = scores.reduce((sum, item) => sum + item.score, 0);
    return {
      key: best.key,
      confidence: clamp01(scoreConfidence(best.score, second.score, total)),
    };
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

  function extractWindow(samples, position, size) {
    const window = new Float32Array(size);
    if (!samples.length) {
      return window;
    }
    const center = Math.floor(clamp(position, 0, 1) * (samples.length - 1));
    let start = Math.max(0, center - Math.floor(size / 2));
    if (start + size > samples.length) {
      start = Math.max(0, samples.length - size);
    }
    for (let i = 0; i < size; i += 1) {
      const index = start + i;
      const sample = index < samples.length ? samples[index] : 0;
      window[i] = sample * hann(i, size);
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

  function normalizeBpm(bpm) {
    let normalized = Math.round(bpm || 0);
    while (normalized > 180) {
      normalized = Math.round(normalized / 2);
    }
    while (normalized > 0 && normalized < 60) {
      normalized = Math.round(normalized * 2);
    }
    return normalized;
  }

  function scoreConfidence(bestScore, secondScore, totalScore) {
    if (!bestScore || bestScore <= 0) {
      return 0;
    }
    const separation = Math.max(0, (bestScore - secondScore) / Math.max(bestScore, 1));
    const dominance = bestScore / Math.max(totalScore || bestScore, 1);
    return (separation * 0.7) + (dominance * 3);
  }

  function confidenceLevel(score) {
    if (score >= 0.75) {
      return "High";
    }
    if (score >= 0.45) {
      return "Medium";
    }
    return "Low";
  }

  function hann(i, size) {
    if (size <= 1) {
      return 1;
    }
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }

  function nextPowerOfTwo(value) {
    let n = 1;
    while (n < value) {
      n <<= 1;
    }
    return n;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "00:00";
    }
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function stripExtension(name) {
    return String(name).replace(/\.[^/.]+$/, "");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getPeak(buffer) {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i += 1) {
        const abs = Math.abs(data[i]);
        if (abs > peak) {
          peak = abs;
        }
      }
    }
    return peak;
  }

  window.FreeAudioTrimAudioEngine = {
    AudioEngine,
    formatTime,
    BROWSER_SUPPORT_MESSAGE,
  };
})();
