(function () {
  "use strict";

  var ENCODER_PATH = "/assets/encoders/mp3-encoder.js";
  var BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";

  function formatTime(seconds) {
    var total = Math.max(0, Number(seconds) || 0);
    var mins = Math.floor(total / 60);
    var secs = Math.floor(total % 60);
    var ms = Math.floor((total % 1) * 1000);
    return mins + ":" + String(secs).padStart(2, "0") + "." + String(ms).padStart(3, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function prefersLowPowerWaveform() {
    var coarsePointer = typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    var touchPoints = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
    return !!(coarsePointer || touchPoints);
  }

  function createCanvasBuffer(width, height) {
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Unable to read file."));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function loadMp3Module() {
    return new Promise(function (resolve, reject) {
      if (window.MP3EncoderModule) {
        resolve(window.MP3EncoderModule);
        return;
      }
      var script = document.createElement("script");
      script.src = ENCODER_PATH;
      script.async = true;
      script.onload = function () {
        if (window.MP3EncoderModule) {
          resolve(window.MP3EncoderModule);
          return;
        }
        reject(new Error("MP3 module loaded but unavailable."));
      };
      script.onerror = function () {
        reject(new Error("Failed to load MP3 module from " + ENCODER_PATH));
      };
      document.head.appendChild(script);
    });
  }

  function AudioEngine() {
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.isPlaying = false;
    this.loop = true;
    this.playStart = 0;
    this.playEnd = 0;
    this.startedAt = 0;
    this.startedOffset = 0;
    this.onEnded = null;
    this._playToken = 0;
  }

  AudioEngine.prototype.ensureContext = function () {
    if (!this.context) {
      var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextCtor();
    }
    return this.context;
  };

  AudioEngine.prototype.loadFile = async function (file) {
    var ctx = this.ensureContext();
    var arrayBuffer = await readFileAsArrayBuffer(file);
    this.stop();
    this.buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.playStart = 0;
    this.playEnd = this.buffer.duration;
    this.startedOffset = 0;
    return this.buffer;
  };

  AudioEngine.prototype.stop = function () {
    this._playToken += 1;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch (err) {
      }
      try {
        this.source.disconnect();
      } catch (err2) {
      }
      this.source = null;
    }
    this.isPlaying = false;
  };

  AudioEngine.prototype.pause = function () {
    if (!this.isPlaying) {
      return;
    }
    var pos = this.getCurrentPosition();
    this.stop();
    this.startedOffset = clamp(pos, this.playStart, this.playEnd);
  };

  AudioEngine.prototype.getCurrentPosition = function () {
    if (!this.isPlaying || !this.context) {
      return this.startedOffset || 0;
    }
    var elapsed = this.context.currentTime - this.startedAt;
    var range = Math.max(0.001, this.playEnd - this.playStart);
    if (this.loop) {
      return this.playStart + ((((this.startedOffset - this.playStart) + elapsed) % range + range) % range);
    }
    return Math.min(this.playEnd, this.startedOffset + elapsed);
  };

  AudioEngine.prototype.play = async function (start, end, loop) {
    if (!this.buffer) {
      return;
    }
    var ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    var safeStart = clamp(start, 0, this.buffer.duration);
    var safeEnd = clamp(end, safeStart + 0.001, this.buffer.duration);
    var token = this._playToken + 1;

    this.stop();
    this._playToken = token;
    this.loop = !!loop;
    this.playStart = safeStart;
    this.playEnd = safeEnd;
    this.startedOffset = clamp(this.startedOffset || safeStart, safeStart, safeEnd);
    if (this.startedOffset >= safeEnd - 0.0001) {
      this.startedOffset = safeStart;
    }
    var self = this;
    var useManualLoopFade = this.loop && (this.uiFadeIn || this.uiFadeOut);

    function startSegment(offset) {
      var segmentOffset = clamp(offset, safeStart, safeEnd);
      var totalDuration = safeEnd - segmentOffset;
      var fadeIn = self.uiFadeIn || 0;
      var fadeOut = self.uiFadeOut || 0;
      var src = ctx.createBufferSource();
      var gainNode = ctx.createGain();

      src.buffer = self.buffer;
      src.connect(gainNode);
      gainNode.connect(ctx.destination);

      if (!useManualLoopFade) {
        src.loop = self.loop;
        if (src.loop) {
          src.loopStart = safeStart;
          src.loopEnd = safeEnd;
        }
      }

      self.source = src;
      self.startedAt = ctx.currentTime;
      self.startedOffset = segmentOffset;
      self.isPlaying = true;

      if (fadeIn + fadeOut > totalDuration) {
        fadeIn = totalDuration / 2;
        fadeOut = totalDuration / 2;
      }

      if (fadeIn > 0) {
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);
      }

      if (fadeOut > 0) {
        gainNode.gain.setValueAtTime(1, ctx.currentTime + totalDuration - fadeOut);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + totalDuration);
      }

      src.onended = function () {
        if (token !== self._playToken) {
          return;
        }
        if (useManualLoopFade) {
          startSegment(safeStart);
          return;
        }
        self.isPlaying = false;
        self.source = null;
        self.startedOffset = self.playStart;
        if (typeof self.onEnded === "function") {
          self.onEnded();
        }
      };

      src.start(0, segmentOffset);
      if (!src.loop) {
        src.stop(ctx.currentTime + totalDuration);
      }
    }

    startSegment(this.startedOffset);
  };

  AudioEngine.prototype.resetPosition = function (start) {
    this.startedOffset = start || 0;
  };

  AudioEngine.prototype._sliceChannels = function (start, end) {
    if (!this.buffer) {
      return null;
    }
    var sampleRate = this.buffer.sampleRate;
    var from = Math.floor(clamp(start, 0, this.buffer.duration) * sampleRate);
    var to = Math.ceil(clamp(end, 0, this.buffer.duration) * sampleRate);
    var frameCount = Math.max(1, to - from);
    var channels = [];
    for (var c = 0; c < this.buffer.numberOfChannels; c += 1) {
      var src = this.buffer.getChannelData(c);
      channels.push(src.slice(from, from + frameCount));
    }
    return {
      sampleRate: sampleRate,
      channels: channels,
      frameCount: frameCount
    };
  };

  AudioEngine.prototype._applyFadeToSliced = function (sliced, fadeInSec, fadeOutSec) {
    if (!sliced || !sliced.channels || !sliced.channels.length) {
      return;
    }
    var total = sliced.frameCount || (sliced.channels[0] ? sliced.channels[0].length : 0);
    if (!total) {
      return;
    }
    var fadeInSamples = Math.floor(Math.max(0, Number(fadeInSec) || 0) * sliced.sampleRate);
    var fadeOutSamples = Math.floor(Math.max(0, Number(fadeOutSec) || 0) * sliced.sampleRate);
    if (fadeInSamples <= 0 && fadeOutSamples <= 0) {
      return;
    }
    fadeInSamples = Math.min(total, fadeInSamples);
    fadeOutSamples = Math.min(total, fadeOutSamples);
    if (fadeInSamples + fadeOutSamples > total) {
      fadeInSamples = Math.floor(total / 2);
      fadeOutSamples = total - fadeInSamples;
    }
    for (var c = 0; c < sliced.channels.length; c += 1) {
      var channel = sliced.channels[c];
      if (!channel || !channel.length) {
        continue;
      }
      for (var i = 0; i < fadeInSamples; i += 1) {
        var t = i / (fadeInSamples - 1 || 1);
        var gain = Math.sin(t * (Math.PI / 2));
        channel[i] *= gain;
      }
      for (var j = 0; j < fadeOutSamples; j += 1) {
        var idx = channel.length - 1 - j;
        if (idx < 0) {
          break;
        }
        var t = j / (fadeOutSamples - 1 || 1);
        var gain = Math.sin(t * (Math.PI / 2));
        channel[idx] *= gain;
      }
    }
  };

  AudioEngine.prototype.exportWav = function (start, end, fadeInSec, fadeOutSec) {
    var sliced = this._sliceChannels(start, end);
    if (!sliced) {
      throw new Error("No audio loaded.");
    }
    var appliedFadeIn = Number(fadeInSec);
    var appliedFadeOut = Number(fadeOutSec);
    if (!isFinite(appliedFadeIn)) {
      appliedFadeIn = Number(this.uiFadeIn) || 0;
    }
    if (!isFinite(appliedFadeOut)) {
      appliedFadeOut = Number(this.uiFadeOut) || 0;
    }
    this._applyFadeToSliced(sliced, appliedFadeIn, appliedFadeOut);
    var channels = sliced.channels;
    var channelCount = channels.length;
    var samples = sliced.frameCount * channelCount;
    var bytes = samples * 2;
    var buffer = new ArrayBuffer(44 + bytes);
    var view = new DataView(buffer);

    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + bytes, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sliced.sampleRate, true);
    view.setUint32(28, sliced.sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, bytes, true);

    var offset = 44;
    for (var i = 0; i < sliced.frameCount; i += 1) {
      for (var c = 0; c < channelCount; c += 1) {
        var sample = clamp(channels[c][i], -1, 1);
        var pcm = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(offset, pcm, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  AudioEngine.prototype.exportMp3 = async function (start, end, bitrateKbps, fadeInSec, fadeOutSec) {
    var sliced = this._sliceChannels(start, end);
    if (!sliced) {
      throw new Error("No audio loaded.");
    }
    var appliedFadeIn = Number(fadeInSec);
    var appliedFadeOut = Number(fadeOutSec);
    if (!isFinite(appliedFadeIn)) {
      appliedFadeIn = Number(this.uiFadeIn) || 0;
    }
    if (!isFinite(appliedFadeOut)) {
      appliedFadeOut = Number(this.uiFadeOut) || 0;
    }
    this._applyFadeToSliced(sliced, appliedFadeIn, appliedFadeOut);
    var mp3 = await loadMp3Module();
    return mp3.encode({
      channels: sliced.channels,
      sampleRate: sliced.sampleRate,
      bitrateKbps: bitrateKbps || 192
    });
  };

  function WaveformRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.peaks = null;
    this.playheadRatio = null;
    this.selection = { start: 0, end: 1 };
    this.handleRadius = 8;
    this.uiFadeIn = 0;
    this.uiFadeOut = 0;
    this.duration = 1;
    this.resizeObserver = null;
    this.waveformCache = null;
    this.waveformCacheWidth = 0;
    this.waveformCacheHeight = 0;
    this.renderQueued = false;
    this.renderFrame = null;
    this.waveformDirty = true;
    this._onResize = this.resize.bind(this);
    window.addEventListener("resize", this._onResize);

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.resize.bind(this));
      this.resizeObserver.observe(canvas);
    }
    this.resize();
  }

  WaveformRenderer.prototype.setPeaksFromBuffer = function (audioBuffer) {
    var width = Math.max(400, Math.floor(this.canvas.clientWidth || 600));
    var channelData = audioBuffer.getChannelData(0);
    var second = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    var totalSamples = channelData.length;
    var bins = prefersLowPowerWaveform()
      ? Math.max(180, Math.min(420, Math.floor(width * 0.9)))
      : Math.max(300, Math.min(1200, width * 2));
    var samplesPerBin = Math.max(1, Math.floor(totalSamples / bins));
    var peaks = new Float32Array(bins);

    for (var i = 0; i < bins; i += 1) {
      var start = i * samplesPerBin;
      var end = Math.min(totalSamples, start + samplesPerBin);
      var max = 0;
      for (var s = start; s < end; s += 1) {
        var value = Math.abs(channelData[s]);
        if (second) {
          value = Math.max(value, Math.abs(second[s]));
        }
        if (value > max) {
          max = value;
        }
      }
      peaks[i] = max;
    }
    this.peaks = peaks;
    this.waveformDirty = true;
    this.scheduleRender();
  };

  WaveformRenderer.prototype.setSelection = function (startRatio, endRatio) {
    this.selection.start = clamp(startRatio, 0, 1);
    this.selection.end = clamp(endRatio, 0, 1);
    this.scheduleRender();
  };

  WaveformRenderer.prototype.setPlayhead = function (ratio) {
    this.playheadRatio = ratio == null ? null : clamp(ratio, 0, 1);
    this.scheduleRender();
  };

  WaveformRenderer.prototype.resize = function () {
    var dpr = Math.max(1, Math.min(prefersLowPowerWaveform() ? 1.5 : 2, window.devicePixelRatio || 1));
    var width = Math.floor(this.canvas.clientWidth || 600);
    var height = Math.floor(this.canvas.clientHeight || 180);
    this.canvas.width = Math.max(1, Math.floor(width * dpr));
    this.canvas.height = Math.max(1, Math.floor(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.waveformDirty = true;
    this.scheduleRender();
  };

  WaveformRenderer.prototype.xToRatio = function (x) {
    var width = Math.max(1, this.canvas.clientWidth || 1);
    return clamp(x / width, 0, 1);
  };

  WaveformRenderer.prototype.ratioToX = function (ratio) {
    return clamp(ratio, 0, 1) * (this.canvas.clientWidth || 1);
  };

  WaveformRenderer.prototype.scheduleRender = function () {
    var self = this;
    if (this.renderQueued) {
      return;
    }
    this.renderQueued = true;
    this.renderFrame = requestAnimationFrame(function () {
      self.renderQueued = false;
      self.renderFrame = null;
      self.render();
    });
  };

  WaveformRenderer.prototype._renderWaveformCache = function (width, height) {
    if (!this.waveformDirty &&
      this.waveformCache &&
      this.waveformCacheWidth === this.canvas.width &&
      this.waveformCacheHeight === this.canvas.height) {
      return;
    }

    var cacheCanvas = createCanvasBuffer(this.canvas.width, this.canvas.height);
    var cacheCtx = cacheCanvas.getContext("2d");
    var dpr = this.canvas.width / Math.max(1, width);
    cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cacheCtx.clearRect(0, 0, width, height);

    var mid = height / 2;
    if (this.peaks && this.peaks.length > 0) {
      var bins = this.peaks.length;
      var pxPerBin = width / bins;
      var gradient = cacheCtx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#c7d2fe");
      gradient.addColorStop(1, "#4338ca");
      cacheCtx.fillStyle = gradient;

      for (var i = 0; i < bins; i += 1) {
        var amp = this.peaks[i];
        var h = Math.max(1, amp * (height * 0.45));
        var x = i * pxPerBin;
        cacheCtx.fillRect(x, mid - h, Math.max(1, pxPerBin), h * 2);
      }
    } else {
      cacheCtx.fillStyle = "#e4e4e7";
      cacheCtx.fillRect(0, mid - 1, width, 2);
    }

    this.waveformCache = cacheCanvas;
    this.waveformCacheWidth = this.canvas.width;
    this.waveformCacheHeight = this.canvas.height;
    this.waveformDirty = false;
  };

  WaveformRenderer.prototype.render = function () {
    var ctx = this.ctx;
    var width = this.canvas.clientWidth || 1;
    var height = this.canvas.clientHeight || 1;
    ctx.clearRect(0, 0, width, height);

    var mid = height / 2;
    var startX = this.ratioToX(this.selection.start);
    var endX = this.ratioToX(this.selection.end);

    this._renderWaveformCache(width, height);
    if (this.waveformCache) {
      ctx.drawImage(this.waveformCache, 0, 0, this.canvas.width, this.canvas.height, 0, 0, width, height);
    }

    ctx.fillStyle = "rgba(99,102,241,0.18)";
    ctx.fillRect(startX, 0, Math.max(0, endX - startX), height);
    ctx.strokeStyle = "rgba(99,102,241,0.6)";
    ctx.lineWidth = 1;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.strokeRect(
      startX + 0.5,
      0.5,
      (endX - startX) - 1,
      height - 1
      );

    // Fade visual overlays
    if (this.uiFadeIn > 0) {
      var fadeWidth = (this.uiFadeIn / this.duration) * width;
      fadeWidth = Math.min(fadeWidth, endX - startX);

      var fadeInGradient = ctx.createLinearGradient(startX, 0, startX + fadeWidth, 0);

      fadeInGradient.addColorStop(0, "rgba(99,102,241,0.35)");
      fadeInGradient.addColorStop(1, "rgba(99,102,241,0)");

      ctx.fillStyle = fadeInGradient;
      ctx.fillRect(startX, 0, fadeWidth, height);
    }
    
    if (this.uiFadeOut > 0) {
      var fadeWidth = (this.uiFadeOut / this.duration) * width;
      fadeWidth = Math.min(fadeWidth, endX - startX);

      var fadeOutGradient = ctx.createLinearGradient(endX - fadeWidth, 0, endX, 0);

      fadeOutGradient.addColorStop(0, "rgba(99,102,241,0)");
      fadeOutGradient.addColorStop(1, "rgba(99,102,241,0.35)");

      ctx.fillStyle = fadeOutGradient;
      ctx.fillRect(endX - fadeWidth, 0, fadeWidth, height);
    }

    ctx.fillStyle = "#111";
    ctx.fillRect(startX - 1, 0, 2, height);
    ctx.fillRect(endX - 1, 0, 2, height);

    ctx.beginPath();
    ctx.arc(startX, mid, this.handleRadius, 0, Math.PI * 2);
    ctx.arc(endX, mid, this.handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#3f8cd4";
    ctx.lineWidth = 2;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (this.playheadRatio != null) {
      var playheadX = this.ratioToX(this.playheadRatio);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(playheadX - 1, 0, 2, height);
    }
  };

  WaveformRenderer.prototype.destroy = function () {
    window.removeEventListener("resize", this._onResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.renderFrame != null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  };

  WaveformRenderer.prototype.setFadeDurations = function(fadeIn, fadeOut) {
    this.uiFadeIn = fadeIn;
    this.uiFadeOut = fadeOut;
    this.scheduleRender();
  };
  WaveformRenderer.prototype.setDuration = function(duration) {
  this.duration = duration || 1;
  };

  function TrimController(canvas, renderer, onChange) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.onChange = onChange;
    this.startRatio = 0;
    this.endRatio = 1;
    this.minGap = 0.002;
    this.dragging = null;
    this.pointerId = null;
    this.pendingEmit = false;
    this.emitFrame = null;
    this._boundDown = this.handlePointerDown.bind(this);
    this._boundMove = this.handlePointerMove.bind(this);
    this._boundUp = this.handlePointerUp.bind(this);

    canvas.addEventListener("pointerdown", this._boundDown);
    window.addEventListener("pointermove", this._boundMove);
    window.addEventListener("pointerup", this._boundUp);
    window.addEventListener("pointercancel", this._boundUp);
    renderer.setSelection(this.startRatio, this.endRatio);
  }

  TrimController.prototype.reset = function () {
    this.startRatio = 0;
    this.endRatio = 1;
    this.renderer.setSelection(this.startRatio, this.endRatio);
    this._emit();
  };

  TrimController.prototype.setFromSeconds = function (start, end, duration) {
    if (!duration || duration <= 0) {
      this.reset();
      return;
    }
    this.startRatio = clamp(start / duration, 0, 1);
    this.endRatio = clamp(end / duration, this.startRatio + this.minGap, 1);
    this.renderer.setSelection(this.startRatio, this.endRatio);
    this._emit();
  };

  TrimController.prototype.handlePointerDown = function (event) {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    var rect = this.canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var startX = this.renderer.ratioToX(this.startRatio);
    var endX = this.renderer.ratioToX(this.endRatio);
    var hitZone = 20;
    var distStart = Math.abs(x - startX);
    var distEnd = Math.abs(x - endX);

    if (distStart <= hitZone || distEnd <= hitZone) {
      this.dragging = distStart <= distEnd ? "start" : "end";
    } else if (x > startX && x < endX) {
      this.dragging = Math.abs(x - startX) < Math.abs(x - endX) ? "start" : "end";
    } else {
      this.dragging = x < startX ? "start" : "end";
    }

    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  TrimController.prototype.handlePointerMove = function (event) {
    if (!this.dragging || this.pointerId !== event.pointerId) {
      return;
    }
    var rect = this.canvas.getBoundingClientRect();
    var ratio = this.renderer.xToRatio(event.clientX - rect.left);
    var prevStart = this.startRatio;
    var prevEnd = this.endRatio;
    if (this.dragging === "start") {
      this.startRatio = clamp(ratio, 0, this.endRatio - this.minGap);
    } else {
      this.endRatio = clamp(ratio, this.startRatio + this.minGap, 1);
    }
    if (prevStart === this.startRatio && prevEnd === this.endRatio) {
      return;
    }
    this.renderer.setSelection(this.startRatio, this.endRatio);
    this._emit();
  };

  TrimController.prototype.handlePointerUp = function (event) {
    if (this.pointerId !== event.pointerId) {
      return;
    }
    this.dragging = null;
    this.pointerId = null;
    this._flushEmit();
  };

  TrimController.prototype._emit = function () {
    var self = this;
    if (this.pendingEmit) {
      return;
    }
    this.pendingEmit = true;
    this.emitFrame = requestAnimationFrame(function () {
      self.pendingEmit = false;
      self.emitFrame = null;
      if (typeof self.onChange === "function") {
        self.onChange(self.startRatio, self.endRatio);
      }
    });
  };

  TrimController.prototype._flushEmit = function () {
    if (this.emitFrame != null) {
      cancelAnimationFrame(this.emitFrame);
      this.emitFrame = null;
    }
    this.pendingEmit = false;
    if (typeof this.onChange === "function") {
      this.onChange(this.startRatio, this.endRatio);
    }
  };

  TrimController.prototype.destroy = function () {
    this.canvas.removeEventListener("pointerdown", this._boundDown);
    window.removeEventListener("pointermove", this._boundMove);
    window.removeEventListener("pointerup", this._boundUp);
    window.removeEventListener("pointercancel", this._boundUp);
    if (this.emitFrame != null) {
      cancelAnimationFrame(this.emitFrame);
      this.emitFrame = null;
    }
  };

  function UIController(root) {
    this.root = root;
    this.audio = new AudioEngine();
    this.renderer = null;
    this.trim = null;
    this.currentFile = null;
    this.duration = 0;
    this.animationId = null;
    this.boundKeyDown = this.onKeyDown.bind(this);
    this.objectUrls = [];
    this.fadeInDuration = 0;
    this.fadeOutDuration = 0;

    this.audio.onEnded = this.onPlaybackEnded.bind(this);
    this.build();
    this.bind();
  }

  UIController.prototype.build = function () {
    this.fadeInToggle = this.root.querySelector('[data-role="fadeInToggle"]');
    this.fadeOutToggle = this.root.querySelector('[data-role="fadeOutToggle"]');
    this.fadeInOverlay = this.root.querySelector('.fade-in');
    this.fadeOutOverlay = this.root.querySelector('.fade-out');
    this.fileInput = this.root.querySelector(".at-file");
    this.canvas = this.root.querySelector(".at-wave");
    this.playPauseBtn = this.root.querySelector('[data-role="playPause"]');
    this.previewBtn = this.root.querySelector('[data-role="preview"]');
    this.resetBtn = this.root.querySelector('[data-role="reset"]');
    this.exportWavBtn = this.root.querySelector('[data-role="exportWav"]');
    this.exportMp3Btn = this.root.querySelector('[data-role="exportMp3"]');
    this.loopCheckbox = this.root.querySelector('[data-role="loop"]');
    this.statusEl = this.root.querySelector('[data-role="status"]');
    this.advancedPanel = this.root.querySelector('[data-role="advancedPanel"]');
    this.fadeInSelect = this.root.querySelector('[data-role="fadeIn"]') || this.root.querySelector('[data-role="fadeInToggle"]');
    this.fadeOutSelect = this.root.querySelector('[data-role="fadeOut"]') || this.root.querySelector('[data-role="fadeOutToggle"]');
    this.startTimeEl = this.root.querySelector('[data-role="startTime"]');
    this.endTimeEl = this.root.querySelector('[data-role="endTime"]');
    this.durationEl = this.root.querySelector('[data-role="duration"]');
    this.fileRow = this.root.querySelector('[data-role="fileRow"]');
    this.fileNameEl = this.root.querySelector('[data-role="fileName"]');
    this.changeFileBtn = this.root.querySelector('[data-role="changeFile"]');
    this.renderer = new WaveformRenderer(this.canvas);
    this.trim = new TrimController(this.canvas, this.renderer, this.onTrimChanged.bind(this));
    this.updateTimeText();
  };

  UIController.prototype.updateFadeOverlay = function () {
  if (!this.fadeInOverlay || !this.fadeOutOverlay) return;

  var total = this.duration || 1;
  var startRatio = this.trim ? this.trim.startRatio || 0 : 0;
  var endRatio = this.trim ? this.trim.endRatio || 1 : 1;
  var selectionRatio = Math.max(0, endRatio - startRatio);
  var selectionDuration = Math.max(0, selectionRatio * total);

  var fadeIn = this.fadeInDuration || 0;
  var fadeOut = this.fadeOutDuration || 0;
  if (fadeIn + fadeOut > selectionDuration && selectionDuration > 0) {
    fadeIn = selectionDuration / 2;
    fadeOut = selectionDuration - fadeIn;
  } else {
    fadeIn = Math.min(fadeIn, selectionDuration);
    fadeOut = Math.min(fadeOut, selectionDuration);
  }

  var startPercent = startRatio * 100;
  var endPercent = endRatio * 100;
  var fadeInPercent = (fadeIn / total) * 100;
  var fadeOutPercent = (fadeOut / total) * 100;

  this.fadeInOverlay.style.left = startPercent + "%";
  this.fadeInOverlay.style.right = "auto";
  this.fadeInOverlay.style.width = fadeInPercent + "%";
  this.fadeOutOverlay.style.left = (endPercent - fadeOutPercent) + "%";
  this.fadeOutOverlay.style.right = "auto";
  this.fadeOutOverlay.style.width = fadeOutPercent + "%";

  this.fadeInOverlay.style.display = fadeIn > 0 ? "block" : "none";
  this.fadeOutOverlay.style.display = fadeOut > 0 ? "block" : "none";
  };

  UIController.prototype.bind = function () {
    this.fileInput.addEventListener("change", this.onFileChange.bind(this));
    this.playPauseBtn.addEventListener("click", this.onPlayPause.bind(this));
    this.previewBtn.addEventListener("click", this.onPreview.bind(this));
    this.resetBtn.addEventListener("click", this.onReset.bind(this));
    this.exportWavBtn.addEventListener("click", this.onExportWav.bind(this));
    this.exportMp3Btn.addEventListener("click", this.onExportMp3.bind(this));
    if (this.changeFileBtn && this.fileInput) {
      this.changeFileBtn.addEventListener("click", () => {
        this.fileInput.click();
      });
    }
    function readFadeDuration(control) {
      if (!control) {
        return 0;
      }
      if (control.type === "checkbox") {
        return control.checked ? 1 : 0;
      }
      return parseFloat(control.value) || 0;
    }
    this.fadeInDuration = readFadeDuration(this.fadeInSelect);
    this.fadeOutDuration = readFadeDuration(this.fadeOutSelect);
    this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
    this.renderer.setDuration(this.duration);
    if (this.fadeInSelect) {
      this.fadeInSelect.addEventListener("change", (e) => {
        this.fadeInDuration = readFadeDuration(e.target);
        this.updateFadeOverlay();
        this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
        this.renderer.setDuration(this.duration);
      });
    }
    if (this.fadeOutSelect) {
      this.fadeOutSelect.addEventListener("change", (e) => {
        this.fadeOutDuration = readFadeDuration(e.target);
        this.updateFadeOverlay();
        this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
        this.renderer.setDuration(this.duration);
      });
    }
    if (this.fadeInToggle) {
      this.fadeInToggle.addEventListener("change", (e) => {
        this.fadeInDuration = e.target.checked ? 1 : 0;
        this.updateFadeOverlay();
        this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
        this.renderer.setDuration(this.duration);
      });
    }
    if (this.fadeOutToggle) {
      this.fadeOutToggle.addEventListener("change", (e) => {
        this.fadeOutDuration = e.target.checked ? 1 : 0;
        this.updateFadeOverlay();
        this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
        this.renderer.setDuration(this.duration);
      });
    }
    document.addEventListener("keydown", this.boundKeyDown);
  };

  UIController.prototype._getSelection = function () {
    var start = this.trim.startRatio * this.duration;
    var end = this.trim.endRatio * this.duration;
    return { start: start, end: end };
  };

  UIController.prototype._setControlsEnabled = function (enabled) {
    this.playPauseBtn.disabled = !enabled;
    this.previewBtn.disabled = !enabled;
    this.resetBtn.disabled = !enabled;
    this.exportWavBtn.disabled = !enabled;
    this.exportMp3Btn.disabled = !enabled;
  };

  UIController.prototype.setStatus = function (message) {
    this.statusEl.textContent = message;
    var text = String(message || "").toLowerCase();
    this.statusEl.dataset.statusState =
      /error|failed|not supported/.test(text) ? "error" :
      /ready|download started|reset/.test(text) ? "success" :
      /decoding|encoding|loading/.test(text) ? "processing" :
      "idle";
  };

  UIController.prototype.onFileChange = async function () {
    var file = this.fileInput.files && this.fileInput.files[0];
    if (!file) {
      return;
    }
    if (this.fileNameEl) {
      this.fileNameEl.textContent = file.name;
    }
    if (this.fileRow) {
      this.fileRow.classList.remove("is-hidden");
    }
    this.currentFile = file;
    this.setStatus("Decoding audio...");
    this._setControlsEnabled(false);
    this.audio.stop();
    this.stopAnimationLoop();
    this.renderer.setPlayhead(null);

    try {
      var buffer = await this.audio.loadFile(file);
      this.duration = buffer.duration;
      this.trim.reset();
      this.renderer.setPeaksFromBuffer(buffer);
      this._setControlsEnabled(true);
      this.updateTimeText();
      this.updateFadeOverlay();
      this.setStatus("Ready. Drag handles to trim and press Play.");
    } catch (err) {
      var errText = String((err && (err.message || err.name)) || "").toLowerCase();
      var isDecodeError =
        errText.indexOf("decode") !== -1 ||
        errText.indexOf("encodingerror") !== -1 ||
        errText.indexOf("notsupportederror") !== -1;
      if (isDecodeError) {
        this.setStatus("This audio format is not supported by your browser. " + BROWSER_SUPPORT_MESSAGE);
      } else {
        this.setStatus("Failed to load audio file. " + (err && err.message ? err.message : "Please try another file."));
      }
      this.duration = 0;
      this._setControlsEnabled(false);
    }
  };

  UIController.prototype.onTrimChanged = function () {
    this.updateTimeText();
    this.updateFadeOverlay();
    this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
    if (!this.audio.isPlaying) {
      this.audio.resetPosition(this.trim.startRatio * this.duration);
      this.renderer.setPlayhead(this.trim.startRatio);
    }
  };

  UIController.prototype.updateTimeText = function () {
    if (!this.duration) {
      this.startTimeEl.textContent = "0:00.000";
      this.endTimeEl.textContent = "0:00.000";
      this.durationEl.textContent = "0:00.000";
      return;
    }
    var selection = this._getSelection();
    this.startTimeEl.textContent = formatTime(selection.start);
    this.endTimeEl.textContent = formatTime(selection.end);
    var selectionLength = selection.end - selection.start;
    this.durationEl.textContent = formatTime(selectionLength);
  };

  UIController.prototype.onPlayPause = async function () {
    if (!this.duration) {
      return;
    }
    if (this.audio.isPlaying) {
      this.audio.pause();
      this.stopAnimationLoop();
      this.playPauseBtn.textContent = "Play";
      return;
    }
    var selection = this._getSelection();
    this.audio.resetPosition(selection.start);
    this.audio.uiFadeIn = this.fadeInDuration;
    this.audio.uiFadeOut = this.fadeOutDuration;
    this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
    await this.audio.play(selection.start, selection.end, this.loopCheckbox.checked);
    this.playPauseBtn.textContent = "Pause";
    this.startAnimationLoop();
  };

  UIController.prototype.onPreview = async function () {
    if (!this.duration) {
      return;
    }
    var selection = this._getSelection();
    this.audio.uiFadeIn = this.fadeInDuration;
    this.audio.uiFadeOut = this.fadeOutDuration;
    this.audio.resetPosition(selection.start);
    await this.audio.play(selection.start, selection.end, false);
    this.playPauseBtn.textContent = "Pause";
    this.startAnimationLoop();
  };

  UIController.prototype.onReset = function () {
    if (!this.duration) {
      return;
    }
    this.audio.stop();
    this.stopAnimationLoop();
    this.playPauseBtn.textContent = "Play";
    this.trim.reset();
    this.audio.resetPosition(0);
    this.renderer.setPlayhead(0);
    this.setStatus("Trim region reset.");
  };

  UIController.prototype._downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  UIController.prototype.onExportWav = function () {
    if (!this.duration || !this.currentFile) {
      return;
    }
    try {
      var selection = this._getSelection();
      this.audio.uiFadeIn = this.fadeInDuration;
      this.audio.uiFadeOut = this.fadeOutDuration;
      var wav = this.audio.exportWav(selection.start, selection.end, this.fadeInDuration, this.fadeOutDuration);
      var base = this.currentFile.name.replace(/\.[^/.]+$/, "") || "trimmed";
      this._downloadBlob(wav, base + "-trimmed.wav");
      this.setStatus("WAV ready. Download started.");
    } catch (err) {
      this.setStatus("WAV export failed.");
    }
  };

  UIController.prototype.onExportMp3 = async function () {
    if (!this.duration || !this.currentFile) {
      return;
    }
    this.setStatus("Encoding MP3...");
    try {
      var selection = this._getSelection();
      this.audio.uiFadeIn = this.fadeInDuration;
      this.audio.uiFadeOut = this.fadeOutDuration;
      var mp3 = await this.audio.exportMp3(selection.start, selection.end, 192, this.fadeInDuration, this.fadeOutDuration);
      var base = this.currentFile.name.replace(/\.[^/.]+$/, "") || "trimmed";
      this._downloadBlob(mp3, base + "-trimmed.mp3");
      this.setStatus("MP3 ready. Download started.");
    } catch (err) {
      this.setStatus("MP3 export failed: " + err.message);
    }
  };

  UIController.prototype.onPlaybackEnded = function () {
    this.stopAnimationLoop();
    this.playPauseBtn.textContent = "Play";
    this.renderer.setPlayhead(this.trim.startRatio);
  };

  UIController.prototype.startAnimationLoop = function () {
    this.stopAnimationLoop();
    var self = this;
    function tick() {
      if (!self.audio.isPlaying || !self.duration) {
        return;
      }
      var pos = self.audio.getCurrentPosition();
      self.renderer.setPlayhead(pos / self.duration);
      self.animationId = requestAnimationFrame(tick);
    }
    this.animationId = requestAnimationFrame(tick);
  };

  UIController.prototype.stopAnimationLoop = function () {
    if (this.animationId != null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  };

  UIController.prototype.onKeyDown = function (event) {
    if (event.code !== "Space") {
      return;
    }
    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || (target && target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    this.onPlayPause();
  };

  UIController.prototype.destroy = function () {
    this.stopAnimationLoop();
    this.audio.stop();
    if (this.renderer) {
      this.renderer.destroy();
    }
    if (this.trim) {
      this.trim.destroy();
    }
    document.removeEventListener("keydown", this.boundKeyDown);
    for (var i = 0; i < this.objectUrls.length; i += 1) {
      URL.revokeObjectURL(this.objectUrls[i]);
    }
    this.objectUrls = [];
  };

  function boot() {
    var mount = document.getElementById("audio-tool");
    if (!mount) {
      return;
    }
    if (mount.__audioToolController && typeof mount.__audioToolController.destroy === "function") {
      mount.__audioToolController.destroy();
    }
    mount.__audioToolController = new UIController(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
