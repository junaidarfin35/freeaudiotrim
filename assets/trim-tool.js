(function () {
  "use strict";

  var STYLE_ID = "audio-tool-styles";
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

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#audio-tool .at-root{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:20px;box-sizing:border-box;box-shadow:0 8px 24px rgba(0,0,0,0.06)}" +
      "#audio-tool .at-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}" +
      "#audio-tool .at-row + .at-row{margin-top:12px}" +
      "#audio-tool .at-btn{appearance:none;border:1px solid #d4d4d8;background:#fafafa;color:#111;padding:8px 14px;border-radius:10px;cursor:pointer;transition:all .15s ease}" +
      "#audio-tool .at-btn:hover{background:#f4f4f5}" +
      "#audio-tool .at-btn:active{transform:translateY(1px)}" +
      "#audio-tool .at-btn:disabled{opacity:.5;cursor:not-allowed}" +
      "#audio-tool .at-btn-primary{background:#111;color:#fff;border-color:#111}" +
      "#audio-tool .at-btn-primary:hover{background:#000}" +
      "#audio-tool .at-file{max-width:100%}" +
      "#audio-tool .at-wave-wrap{position:relative;width:100%;touch-action:none}" +
      "#audio-tool canvas.at-wave{width:100%;height:180px;display:block;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px}" +
      "#audio-tool .at-times{display:flex;justify-content:space-between;color:#18181b;font-weight:500;font-variant-numeric:tabular-nums;margin-top:6px}" +
      "#audio-tool .at-status{min-height:20px;color:#3f3f46}" +
      "#audio-tool .at-help{color:#52525b;font-size:12px}" +
      "#audio-tool .at-checkbox{display:inline-flex;gap:6px;align-items:center;user-select:none}" +
      "@media (max-width:640px){#audio-tool .at-root{padding:12px}#audio-tool canvas.at-wave{height:150px}#audio-tool .at-btn{padding:8px 10px}}";
    document.head.appendChild(style);
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

    var src = ctx.createBufferSource();
    src.buffer = this.buffer;
    var gainNode = ctx.createGain();
    src.connect(gainNode);
    gainNode.connect(ctx.destination);
    src.loop = this.loop;
    if (src.loop) {
      src.loopStart = safeStart;
      src.loopEnd = safeEnd;
    }

    this.source = src;
    this.startedAt = ctx.currentTime;
    this.isPlaying = true;
    if (this.uiFadeIn || this.uiFadeOut) {
    var totalDuration = safeEnd - this.startedOffset;
    var fadeIn = this.uiFadeIn || 0;
    var fadeOut = this.uiFadeOut || 0;

    if (fadeIn + fadeOut > totalDuration) {
    fadeIn = totalDuration / 2;
    fadeOut = totalDuration / 2;
  }

    var now = ctx.currentTime;

    if (fadeIn > 0) {
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + fadeIn);
  }

    if (fadeOut > 0) {
    gainNode.gain.setValueAtTime(1, now + totalDuration - fadeOut);
    gainNode.gain.linearRampToValueAtTime(0, now + totalDuration);
  }
}

    var self = this;
    src.onended = function () {
      if (token !== self._playToken) {
        return;
      }
      self.isPlaying = false;
      self.source = null;
      self.startedOffset = self.playStart;
      if (typeof self.onEnded === "function") {
        self.onEnded();
      }
    };

    src.start(0, this.startedOffset);
    if (!this.loop) {
      src.stop(ctx.currentTime + (safeEnd - this.startedOffset));
    }
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

  AudioEngine.prototype.exportWav = function (start, end) {
    var sliced = this._sliceChannels(start, end);
    if (!sliced) {
      throw new Error("No audio loaded.");
    }
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
        var total = sliced.frameCount;
        var fadeInSamples = Math.floor((this.uiFadeIn || 0) * sliced.sampleRate);
        var fadeOutSamples = Math.floor((this.uiFadeOut || 0) * sliced.sampleRate);

        if (fadeInSamples + fadeOutSamples > total) {
        fadeInSamples = Math.floor(total / 2);
        fadeOutSamples = Math.floor(total / 2);
      }

        if (fadeInSamples > 0 && i < fadeInSamples) {
        sample *= i / fadeInSamples;
      }

        if (fadeOutSamples > 0 && i > total - fadeOutSamples) {
        sample *= (total - i) / fadeOutSamples;
      }
        var pcm = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(offset, pcm, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  AudioEngine.prototype.exportMp3 = async function (start, end, bitrateKbps) {
    var sliced = this._sliceChannels(start, end);
    var total = sliced.frameCount;
var fadeInSamples = Math.floor((this.uiFadeIn || 0) * sliced.sampleRate);
var fadeOutSamples = Math.floor((this.uiFadeOut || 0) * sliced.sampleRate);

if (fadeInSamples + fadeOutSamples > total) {
  fadeInSamples = Math.floor(total / 2);
  fadeOutSamples = Math.floor(total / 2);
}

for (var c = 0; c < sliced.channels.length; c += 1) {
  var channel = sliced.channels[c];
  for (var i = 0; i < total; i += 1) {
    if (fadeInSamples > 0 && i < fadeInSamples) {
      channel[i] *= i / fadeInSamples;
    }
    if (fadeOutSamples > 0 && i > total - fadeOutSamples) {
      channel[i] *= (total - i) / fadeOutSamples;
    }
  }
}
    if (!sliced) {
      throw new Error("No audio loaded.");
    }
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
    this.resizeObserver = null;
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
    var bins = Math.max(300, width * 2);
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
    this.render();
  };

  WaveformRenderer.prototype.setSelection = function (startRatio, endRatio) {
    this.selection.start = clamp(startRatio, 0, 1);
    this.selection.end = clamp(endRatio, 0, 1);
    this.render();
  };

  WaveformRenderer.prototype.setPlayhead = function (ratio) {
    this.playheadRatio = ratio == null ? null : clamp(ratio, 0, 1);
    this.render();
  };

  WaveformRenderer.prototype.resize = function () {
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var width = Math.floor(this.canvas.clientWidth || 600);
    var height = Math.floor(this.canvas.clientHeight || 180);
    this.canvas.width = Math.max(1, Math.floor(width * dpr));
    this.canvas.height = Math.max(1, Math.floor(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  };

  WaveformRenderer.prototype.xToRatio = function (x) {
    var width = Math.max(1, this.canvas.clientWidth || 1);
    return clamp(x / width, 0, 1);
  };

  WaveformRenderer.prototype.ratioToX = function (ratio) {
    return clamp(ratio, 0, 1) * (this.canvas.clientWidth || 1);
  };

  WaveformRenderer.prototype.render = function () {
    var ctx = this.ctx;
    var width = this.canvas.clientWidth || 1;
    var height = this.canvas.clientHeight || 1;
    ctx.clearRect(0, 0, width, height);

    var mid = height / 2;
    var startX = this.ratioToX(this.selection.start);
    var endX = this.ratioToX(this.selection.end);

    if (this.peaks && this.peaks.length > 0) {
      var bins = this.peaks.length;
      var pxPerBin = width / bins;

      ctx.fillStyle = "#d4d4d8";
      for (var i = 0; i < bins; i += 1) {
        var amp = this.peaks[i];
        var h = Math.max(1, amp * (height * 0.45));
        var x = i * pxPerBin;
        ctx.fillRect(x, mid - h, Math.max(1, pxPerBin), h * 2);
      }
    } else {
      ctx.fillStyle = "#e4e4e7";
      ctx.fillRect(0, mid - 1, width, 2);
    }

    ctx.fillStyle = "rgba(63,140,212,0.18)";
    ctx.fillRect(startX, 0, Math.max(0, endX - startX), height);

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
    ctx.shadowColor = "rgba(0,0,0,0.15)";
    ctx.shadowBlur = 6;
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
    if (this.dragging === "start") {
      this.startRatio = clamp(ratio, 0, this.endRatio - this.minGap);
    } else {
      this.endRatio = clamp(ratio, this.startRatio + this.minGap, 1);
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
  };

  TrimController.prototype._emit = function () {
    if (typeof this.onChange === "function") {
      this.onChange(this.startRatio, this.endRatio);
    }
  };

  TrimController.prototype.destroy = function () {
    this.canvas.removeEventListener("pointerdown", this._boundDown);
    window.removeEventListener("pointermove", this._boundMove);
    window.removeEventListener("pointerup", this._boundUp);
    window.removeEventListener("pointercancel", this._boundUp);
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
    this.advancedOpen = false;

    this.audio.onEnded = this.onPlaybackEnded.bind(this);
    this.build();
    this.bind();
  }

  UIController.prototype.build = function () {
    this.root.innerHTML = [
      '<div class="at-root">',
      '  <div class="at-row">',
      '    <input class="at-file" type="file" accept="audio/*" aria-label="Upload audio file">',
      "  </div>",
      '  <div class="at-row at-wave-wrap">',
      '    <canvas class="at-wave" aria-label="Waveform view"></canvas>',
      "  </div>",
      '  <div class="at-times">',
      '    <span data-role="startTime">0:00.000</span>',
      '    <span data-role="duration">No file loaded</span>',
      '    <span data-role="endTime">0:00.000</span>',
      "  </div>",
      '  <div class="at-row">',
      '    <button class="at-btn at-btn-primary" data-role="playPause" disabled>Play</button>',
      '    <button class="at-btn" data-role="preview" disabled>Preview</button>',
      '    <label class="at-checkbox"><input type="checkbox" data-role="loop" checked>Loop selection</label>',
      '    <button class="at-btn" data-role="reset" disabled>Reset</button>',
      "  </div>",
      '  <div class="at-row">',
      '    <button class="at-btn at-btn-primary" data-role="exportMp3" disabled>Download MP3</button>',
      '    <button class="at-btn" data-role="exportWav" disabled>Download WAV</button>',
      "  </div>",
      '  <div class="at-row at-status" data-role="status">Upload a file to begin trimming. Files stay on your device.</div>',
      '  <div class="at-row">',
      '    <button class="at-btn" data-role="advancedToggle">Advanced Options</button>',
      "  </div>",
      '  <div class="at-row" data-role="advancedPanel" style="display:none;flex-direction:column;align-items:flex-start;gap:8px;">',
      '    <label>Fade In:',
      '      <select data-role="fadeIn">',
      '        <option value="0">None</option>',
      '        <option value="0.5">0.5s</option>',
      '        <option value="1">1s</option>',
      '        <option value="2">2s</option>',
      '        <option value="3">3s</option>',
      '        <option value="5">5s</option>',
      '      </select>',
      '    </label>',
      '    <label>Fade Out:',
      '      <select data-role="fadeOut">',
      '        <option value="0">None</option>',
      '        <option value="0.5">0.5s</option>',
      '        <option value="1">1s</option>',
      '        <option value="2">2s</option>',
      '        <option value="3">3s</option>',
      '        <option value="5">5s</option>',
      '      </select>',
      '    </label>',
      '   </div>',
      '  <div class="at-row at-help">Spacebar toggles play/pause when focus is outside text inputs.</div>',
      "</div>"
    ].join("");

    this.fileInput = this.root.querySelector(".at-file");
    this.canvas = this.root.querySelector(".at-wave");
    this.playPauseBtn = this.root.querySelector('[data-role="playPause"]');
    this.previewBtn = this.root.querySelector('[data-role="preview"]');
    this.resetBtn = this.root.querySelector('[data-role="reset"]');
    this.exportWavBtn = this.root.querySelector('[data-role="exportWav"]');
    this.exportMp3Btn = this.root.querySelector('[data-role="exportMp3"]');
    this.loopCheckbox = this.root.querySelector('[data-role="loop"]');
    this.statusEl = this.root.querySelector('[data-role="status"]');
    this.advancedToggle = this.root.querySelector('[data-role="advancedToggle"]');
    this.advancedPanel = this.root.querySelector('[data-role="advancedPanel"]');
    this.fadeInSelect = this.root.querySelector('[data-role="fadeIn"]');
    this.fadeOutSelect = this.root.querySelector('[data-role="fadeOut"]');
    this.startTimeEl = this.root.querySelector('[data-role="startTime"]');
    this.endTimeEl = this.root.querySelector('[data-role="endTime"]');
    this.durationEl = this.root.querySelector('[data-role="duration"]');

    this.renderer = new WaveformRenderer(this.canvas);
    this.trim = new TrimController(this.canvas, this.renderer, this.onTrimChanged.bind(this));
  };

  UIController.prototype.bind = function () {
    this.fileInput.addEventListener("change", this.onFileChange.bind(this));
    this.playPauseBtn.addEventListener("click", this.onPlayPause.bind(this));
    this.previewBtn.addEventListener("click", this.onPreview.bind(this));
    this.resetBtn.addEventListener("click", this.onReset.bind(this));
    this.exportWavBtn.addEventListener("click", this.onExportWav.bind(this));
    this.exportMp3Btn.addEventListener("click", this.onExportMp3.bind(this));
    this.advancedToggle.addEventListener("click", () => {
    this.advancedOpen = !this.advancedOpen;
    this.advancedPanel.style.display = this.advancedOpen ? "flex" : "none";});
    this.fadeInSelect.addEventListener("change", (e) => {
    this.fadeInDuration = parseFloat(e.target.value) || 0;});
    this.fadeOutSelect.addEventListener("change", (e) => {
    this.fadeOutDuration = parseFloat(e.target.value) || 0;});
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

  UIController.prototype.onFileChange = async function () {
    var file = this.fileInput.files && this.fileInput.files[0];
    if (!file) {
      return;
    }
    this.currentFile = file;
    this.statusEl.textContent = "Decoding audio...";
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
      this.statusEl.textContent = "Ready. Drag handles to trim and press Play.";
    } catch (err) {
      this.statusEl.textContent = "This audio format is not supported by your browser. " + BROWSER_SUPPORT_MESSAGE;
      this.duration = 0;
      this._setControlsEnabled(false);
    }
  };

  UIController.prototype.onTrimChanged = function () {
    this.updateTimeText();
    if (!this.audio.isPlaying) {
      this.audio.resetPosition(this.trim.startRatio * this.duration);
      this.renderer.setPlayhead(this.trim.startRatio);
    }
  };

  UIController.prototype.updateTimeText = function () {
    if (!this.duration) {
      this.startTimeEl.textContent = "0:00.000";
      this.endTimeEl.textContent = "0:00.000";
      this.durationEl.textContent = "No file loaded";
      return;
    }
    var selection = this._getSelection();
    this.startTimeEl.textContent = formatTime(selection.start);
    this.endTimeEl.textContent = formatTime(selection.end);
    var selectionLength = selection.end - selection.start;
  this.durationEl.textContent = "Length " + formatTime(selectionLength);
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
    this.statusEl.textContent = "Trim region reset.";
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
      var wav = this.audio.exportWav(selection.start, selection.end);
      var base = this.currentFile.name.replace(/\.[^/.]+$/, "") || "trimmed";
      this._downloadBlob(wav, base + "-trimmed.wav");
      this.statusEl.textContent = "WAV ready. Download started.";
    } catch (err) {
      this.statusEl.textContent = "WAV export failed.";
    }
  };

  UIController.prototype.onExportMp3 = async function () {
    if (!this.duration || !this.currentFile) {
      return;
    }
    this.statusEl.textContent = "Encoding MP3...";
    try {
      var selection = this._getSelection();
      var mp3 = await this.audio.exportMp3(selection.start, selection.end, 192);
      var base = this.currentFile.name.replace(/\.[^/.]+$/, "") || "trimmed";
      this._downloadBlob(mp3, base + "-trimmed.mp3");
      this.statusEl.textContent = "MP3 ready. Download started.";
    } catch (err) {
      this.statusEl.textContent = "MP3 export failed: " + err.message;
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
    injectStyles();
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
