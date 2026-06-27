(function () {
  "use strict";

  var ENCODER_PATH = "/assets/encoders/mp3-encoder.js?v=2026-06-22-worker-export-1";
  var LAME_PATH = "/assets/encoders/lame.min.js";
  var BROWSER_SUPPORT_MESSAGE = "Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.";
  var TRIM_AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.mpga";
  var TRIM_MEDIA_ACCEPT = "audio/*,video/mp4,video/x-m4v,video/webm,video/quicktime,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.mpga,.mp4,.m4v,.mov,.webm,.mpeg,.mpg,.avi,.mkv,.3gp,.3g2,.hevc,.h265";
  var TRIM_SAFARI_VIDEO_MESSAGE = "Video files are not supported in Safari for browser waveform editing yet. Please use an audio file like MP3, WAV, M4A, AAC, FLAC, or OGG. You can still use MP4, MOV, M4V, and WebM files in desktop Chrome.";

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

  function formatFileSize(bytes) {
    var value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 * 1024 * 1024) {
      return (value / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    }
    if (value >= 1024 * 1024) {
      return (value / (1024 * 1024)).toFixed(1) + " MB";
    }
    if (value >= 1024) {
      return Math.round(value / 1024) + " KB";
    }
    return Math.round(value) + " bytes";
  }

  function estimateSourceBitrateKbps(file, duration) {
    var size = file && Number(file.size);
    var safeDuration = Math.max(0, Number(duration) || 0);
    if (!size || !safeDuration) {
      return 0;
    }
    return (size * 8) / safeDuration / 1000;
  }

  function chooseSmartMp3Bitrate(file, duration) {
    var sourceBitrate = estimateSourceBitrateKbps(file, duration);
    var sourceName = file && String(file.name || "").toLowerCase();
    var sourceType = file && String(file.type || "").toLowerCase();
    var isMp3 = /\.mp3$/.test(sourceName) || sourceType === "audio/mpeg" || sourceType === "audio/mp3";
    var supportedBitrates = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

    if (!isMp3 || sourceBitrate <= 0) {
      return 128;
    }

    var target = supportedBitrates[0];
    for (var i = 0; i < supportedBitrates.length; i += 1) {
      if (supportedBitrates[i] <= sourceBitrate) {
        target = supportedBitrates[i];
      } else {
        break;
      }
    }
    return target;
  }

  function estimateMp3Bytes(durationSeconds, bitrateKbps) {
    var safeDuration = Math.max(0, Number(durationSeconds) || 0);
    var safeBitrate = Math.max(0, Number(bitrateKbps) || 0);
    return Math.round((safeDuration * safeBitrate * 1000) / 8);
  }

  var TRIM_HANDLE_HIT_ZONE = 5;

  function setPlayPauseButtonState(button, isPlaying) {
    if (!button) {
      return;
    }
    button.classList.add("at-icon-btn");
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
    button.setAttribute("title", isPlaying ? "Pause" : "Play");
    button.dataset.state = isPlaying ? "pause" : "play";
    button.innerHTML = isPlaying
      ? '<span class="at-play-pause-icon at-play-pause-icon--pause" aria-hidden="true"><span></span><span></span></span><span class="at-sr-only">Pause</span>'
      : '<span class="at-play-pause-icon at-play-pause-icon--play" aria-hidden="true"></span><span class="at-sr-only">Play</span>';
  }

  function renderLucideIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function isArabicDocument() {
    return String(document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  }

  function createSnapButton(role, label, iconName) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "at-btn at-icon-btn at-snap-btn";
    button.dataset.role = role;
    button.disabled = true;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.innerHTML =
      '<i data-lucide="' + iconName + '" class="at-lucide-icon" aria-hidden="true"></i>' +
      '<span class="at-sr-only">' + label + "</span>";
    return button;
  }

  function setLoopToggleButtonState(button, isEnabled) {
    if (!button) {
      return;
    }
    button.classList.add("at-icon-btn", "at-loop-toggle-btn");
    button.setAttribute("type", "button");
    button.setAttribute("aria-pressed", isEnabled ? "true" : "false");
    button.setAttribute("aria-label", isEnabled ? "Disable repeat" : "Enable repeat");
    button.setAttribute("title", isEnabled ? "Repeat on" : "Repeat off");
    button.dataset.state = isEnabled ? "loop-on" : "loop-off";
    button.innerHTML = isEnabled
      ? '<svg class="at-loop-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span class="at-sr-only">Repeat on</span>'
      : '<svg class="at-loop-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M4 4 20 20"/></svg><span class="at-sr-only">Repeat off</span>';
  }

  function setResetButtonIcon(button) {
    if (!button) {
      return;
    }
    button.classList.add("at-icon-btn", "at-reset-btn");
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", "Reset trim");
    button.setAttribute("title", "Reset");
    button.innerHTML = '<i data-lucide="rotate-ccw" class="at-lucide-icon" aria-hidden="true"></i><span class="at-sr-only">Reset</span>';
    renderLucideIcons();
  }

  function placeStatusAfterFileRow(fileRow, statusEl) {
    if (!fileRow || !statusEl || !fileRow.parentNode || statusEl.previousElementSibling === fileRow) {
      return;
    }
    fileRow.insertAdjacentElement("afterend", statusEl);
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

  function roundedRectPath(ctx, x, y, width, height, radius) {
    var safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
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

  function getFileExtension(name) {
    if (!name) {
      return "";
    }
    var idx = name.lastIndexOf(".");
    if (idx === -1) {
      return "";
    }
    return name.slice(idx).toLowerCase();
  }

  function isDecodeLikeError(err) {
    var errText = String((err && (err.message || err.name)) || "").toLowerCase();
    return (
      errText.indexOf("decode") !== -1 ||
      errText.indexOf("encodingerror") !== -1 ||
      errText.indexOf("notsupportederror") !== -1 ||
      errText.indexOf("loading failed") !== -1 ||
      errText.indexOf("could not decode") !== -1
    );
  }

  function isVideoLikeFile(file) {
    if (!file) {
      return false;
    }
    var type = String(file.type || "").toLowerCase();
    if (type.indexOf("video/") === 0) {
      return true;
    }
    var ext = getFileExtension(file.name);
    return (
      ext === ".mp4" ||
      ext === ".m4v" ||
      ext === ".webm" ||
      ext === ".mpeg" ||
      ext === ".mpg" ||
      ext === ".avi" ||
      ext === ".mkv" ||
      ext === ".3gp" ||
      ext === ".3g2"
    );
  }

  function isSafariBrowser() {
    if (typeof navigator === "undefined") {
      return false;
    }
    var ua = String(navigator.userAgent || "");
    var vendor = String(navigator.vendor || "");
    var isAppleVendor = vendor.indexOf("Apple") !== -1;
    var hasSafariToken = ua.indexOf("Safari") !== -1;
    var isExcluded =
      ua.indexOf("CriOS") !== -1 ||
      ua.indexOf("Chrome") !== -1 ||
      ua.indexOf("Chromium") !== -1 ||
      ua.indexOf("EdgiOS") !== -1 ||
      ua.indexOf("Edg") !== -1 ||
      ua.indexOf("FxiOS") !== -1 ||
      ua.indexOf("Firefox") !== -1 ||
      ua.indexOf("OPiOS") !== -1 ||
      ua.indexOf("OPR") !== -1 ||
      ua.indexOf("Android") !== -1;
    return hasSafariToken && isAppleVendor && !isExcluded;
  }

  function isLikelyUnsupportedQuickTimeFile(file) {
    if (!file) {
      return false;
    }
    var type = String(file.type || "").toLowerCase();
    var ext = getFileExtension(file.name);
    return (
      type === "video/quicktime" ||
      ext === ".mov" ||
      ext === ".hevc" ||
      ext === ".h265"
    );
  }

  function isSafariUnsupportedMediaFile(file) {
    if (!file) {
      return false;
    }
    return isLikelyUnsupportedQuickTimeFile(file) || isVideoLikeFile(file);
  }

  function resolveUploadPolicy(context) {
    if (typeof window.AudioToolUploadPolicy === "function") {
      return window.AudioToolUploadPolicy(context || {});
    }
    if (window.AudioToolUploadPolicy && typeof window.AudioToolUploadPolicy === "object") {
      return window.AudioToolUploadPolicy;
    }
    return null;
  }

  var sharedFFmpeg = null;
  var sharedFFmpegLoaded = false;
  var sharedFFmpegLoadPromise = null;
  var sharedFFmpegCompatPromise = null;

  function loadSharedFFmpegCompat() {
    if (window.FFmpeg && typeof window.FFmpeg.createFFmpeg === "function") {
      return Promise.resolve(window.FFmpeg);
    }
    if (sharedFFmpegCompatPromise) {
      return sharedFFmpegCompatPromise;
    }

    sharedFFmpegCompatPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "/assets/ffmpeg/ffmpeg-compat.js?v=2026-05-18-1";
      script.async = true;
      script.onload = function () {
        if (window.FFmpeg && typeof window.FFmpeg.createFFmpeg === "function") {
          resolve(window.FFmpeg);
          return;
        }
        reject(new Error("FFmpeg loader unavailable."));
      };
      script.onerror = function () {
        reject(new Error("FFmpeg loader unavailable."));
      };
      document.head.appendChild(script);
    }).catch(function (error) {
      sharedFFmpegCompatPromise = null;
      throw error;
    });

    return sharedFFmpegCompatPromise;
  }

  function loadSharedFFmpeg() {
    if (sharedFFmpegLoaded && sharedFFmpeg) {
      return Promise.resolve(sharedFFmpeg);
    }
    if (sharedFFmpegLoadPromise) {
      return sharedFFmpegLoadPromise;
    }

    sharedFFmpegLoadPromise = (async function () {
      await loadSharedFFmpegCompat();
      if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== "function") {
        throw new Error("FFmpeg loader unavailable.");
      }
      var createFFmpeg = window.FFmpeg.createFFmpeg;
      var base = window.location.origin + "/assets/ffmpeg";
      sharedFFmpeg = createFFmpeg({
        log: false,
        corePath: base + "/ffmpeg-core.js",
        mainName: "main"
      });
      await sharedFFmpeg.load();
      sharedFFmpegLoaded = true;
      return sharedFFmpeg;
    })();

    return sharedFFmpegLoadPromise.catch(function (error) {
      sharedFFmpegLoadPromise = null;
      sharedFFmpeg = null;
      throw error;
    });
  }

  function createCompatibilityFile(bytes, sourceFile) {
    var baseName = sourceFile && sourceFile.name
      ? sourceFile.name.replace(/\.[^/.]+$/, "")
      : "media";
    return new File([bytes.buffer], baseName + "-compat.wav", {
      type: "audio/wav",
      lastModified: Date.now()
    });
  }

  async function defaultPreprocessMediaFile(file, decodeError, controller) {
    if (!isVideoLikeFile(file)) {
      return null;
    }

    if (controller && typeof controller.setStatus === "function") {
      controller.setStatus("Converting media for compatibility...");
    }

    var encoder = await loadSharedFFmpeg();
    var fetchFile = window.FFmpeg && window.FFmpeg.fetchFile;
    if (typeof fetchFile !== "function") {
      throw new Error("FFmpeg file bridge unavailable.");
    }

    var inputExt = getFileExtension(file.name) || ".bin";
    var inputName = "compat-input" + inputExt;
    var outputName = "compat-output.wav";

    encoder.FS("writeFile", inputName, await fetchFile(file));
    try {
      await encoder.run(
        "-i", inputName,
        "-vn",
        "-ac", "2",
        "-ar", "44100",
        "-c:a", "pcm_s16le",
        outputName
      );
    } catch (err) {
      throw new Error("Unable to decode this media format on this device.");
    }

    var outputData = null;
    try {
      outputData = encoder.FS("readFile", outputName);
    } catch (readErr) {
      throw new Error("Unable to decode this media format on this device.");
    } finally {
      try { encoder.FS("unlink", inputName); } catch (err1) {}
      try { encoder.FS("unlink", outputName); } catch (err2) {}
    }

    return createCompatibilityFile(outputData, file);
  }

  window.AudioToolDefaultShouldTryPreprocess = function (file, decodeError, controller) {
    return isVideoLikeFile(file);
  };

  window.AudioToolDefaultPreprocessFile = function (file, decodeError, controller) {
    return defaultPreprocessMediaFile(file, decodeError, controller);
  };

  function resolveUploadValidator(policy) {
    if (policy && typeof policy.validateFile === "function") {
      return policy.validateFile.bind(policy);
    }
    if (typeof window.AudioToolValidateFile === "function") {
      return window.AudioToolValidateFile;
    }
    return window.AudioToolDefaultValidateFile;
  }

  function runDefaultValidation(file, context) {
    var policy = resolveUploadPolicy(context);
    if (policy && typeof policy.validateFile === "function") {
      return policy.validateFile(file, context || null);
    }
    var safariRuntime = typeof window.AudioToolIsSafariBrowser === "function"
      ? window.AudioToolIsSafariBrowser()
      : isSafariBrowser();
    if (policy && policy.family === "trim-waveform" && safariRuntime && isSafariUnsupportedMediaFile(file)) {
      return {
        ok: false,
        message: TRIM_SAFARI_VIDEO_MESSAGE
      };
    }
    return { ok: true };
  }

  window.AudioToolDefaultValidateFile = function (file, controllerOrContext) {
    var context = controllerOrContext;
    if (!context || typeof context !== "object" || context.fileInput || context.currentFile) {
      context = {
        controller: controllerOrContext || null,
        phase: controllerOrContext && controllerOrContext.duration ? "replacement" : "initial"
      };
    }
    return runDefaultValidation(file, context);
  };

  window.AudioToolIsSafariBrowser = isSafariBrowser;
  window.AudioToolIsVideoLikeFile = isVideoLikeFile;
  window.AudioToolTrimAudioAccept = TRIM_AUDIO_ACCEPT;
  window.AudioToolTrimMediaAccept = TRIM_MEDIA_ACCEPT;
  window.AudioToolTrimSafariVideoMessage = TRIM_SAFARI_VIDEO_MESSAGE;
  window.AudioToolResolveUploadPolicy = resolveUploadPolicy;
  window.AudioToolResolveUploadValidator = resolveUploadValidator;
  window.AudioToolCreateTrimWaveformUploadPolicy = function (options) {
    var config = options || {};
    return {
      toolId: config.toolId || "trim-waveform",
      family: "trim-waveform",
      getPickerAccept: function () {
        return isSafariBrowser() ? TRIM_AUDIO_ACCEPT : TRIM_MEDIA_ACCEPT;
      },
      validateFile: function (file) {
        if (isSafariBrowser() && isSafariUnsupportedMediaFile(file)) {
          return {
            ok: false,
            message: config.safariVideoMessage || TRIM_SAFARI_VIDEO_MESSAGE
          };
        }
        return { ok: true };
      }
    };
  };

  var mp3ModulePromise = null;
  var lamePromise = null;

  function loadScriptOnce(src, isReady, errorMessage) {
    return new Promise(function (resolve, reject) {
      if (isReady()) {
        resolve();
        return;
      }

      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        existing.addEventListener("load", function () {
          if (isReady()) {
            resolve();
            return;
          }
          reject(new Error(errorMessage));
        }, { once: true });
        existing.addEventListener("error", function () {
          reject(new Error(errorMessage));
        }, { once: true });
        return;
      }

      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () {
        if (isReady()) {
          resolve();
          return;
        }
        reject(new Error(errorMessage));
      };
      script.onerror = function () {
        reject(new Error(errorMessage));
      };
      document.head.appendChild(script);
    });
  }

  function ensureLameLoaded() {
    if (window.lamejs && typeof window.lamejs.Mp3Encoder === "function") {
      return Promise.resolve();
    }
    if (!lamePromise) {
      lamePromise = loadScriptOnce(
        LAME_PATH,
        function () {
          return !!(window.lamejs && typeof window.lamejs.Mp3Encoder === "function");
        },
        "Failed to load MP3 encoder runtime from " + LAME_PATH
      ).catch(function (error) {
        lamePromise = null;
        throw error;
      });
    }
    return lamePromise;
  }

  function loadMp3Module() {
    if (window.MP3EncoderModule) {
      return Promise.resolve(window.MP3EncoderModule);
    }
    if (!mp3ModulePromise) {
      mp3ModulePromise = ensureLameLoaded()
        .then(function () {
          return loadScriptOnce(
            ENCODER_PATH,
            function () {
              return !!window.MP3EncoderModule;
            },
            "Failed to load MP3 module from " + ENCODER_PATH
          );
        })
        .then(function () {
          if (window.MP3EncoderModule) {
            return window.MP3EncoderModule;
          }
          throw new Error("MP3 module loaded but unavailable.");
        })
        .catch(function (error) {
          mp3ModulePromise = null;
          throw error;
        });
    }
    return mp3ModulePromise;
  }

  function AudioEngine() {
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.outputGain = null;
    this.pendingSuspend = null;
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
    if (!this.context || this.context.state === "closed") {
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

  AudioEngine.prototype.stop = function (shouldSuspendContext) {
    this._playToken += 1;
    var suspendContext = shouldSuspendContext !== false;
    var ctx = this.context;
    if (this.outputGain && ctx) {
      try {
        this.outputGain.gain.cancelScheduledValues(ctx.currentTime);
        this.outputGain.gain.setValueAtTime(0, ctx.currentTime);
      } catch (gainErr) {
      }
    }
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
    if (this.outputGain) {
      try {
        this.outputGain.disconnect();
      } catch (gainDisconnectErr) {
      }
      this.outputGain = null;
    }
    this.isPlaying = false;
    if (suspendContext && ctx && ctx.state === "running") {
      var suspendPromise = ctx.suspend().catch(function () {});
      this.pendingSuspend = suspendPromise;
      suspendPromise.finally(function () {
        if (this.pendingSuspend === suspendPromise) {
          this.pendingSuspend = null;
        }
      }.bind(this));
    }
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
    if (this.pendingSuspend) {
      await this.pendingSuspend;
    }
    var safeStart = clamp(start, 0, this.buffer.duration);
    var safeEnd = clamp(end, safeStart + 0.001, this.buffer.duration);
    var token = this._playToken + 1;

    this.stop(false);
    this._playToken = token;
    this.loop = !!loop;
    this.playStart = safeStart;
    this.playEnd = safeEnd;
    this.startedOffset = clamp(this.startedOffset || safeStart, safeStart, safeEnd);
    if (this.startedOffset >= safeEnd - 0.0001) {
      this.startedOffset = safeStart;
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    var self = this;
    var useManualLoopFade = this.loop && (this.uiFadeIn || this.uiFadeOut);

    function startSegment(offset) {
      var segmentOffset = clamp(offset, safeStart, safeEnd);
      var totalDuration = safeEnd - segmentOffset;
      var fadeIn = self.uiFadeIn || 0;
      var fadeOut = self.uiFadeOut || 0;
      var shouldApplyFadeIn = Math.abs(segmentOffset - safeStart) < 0.0005;
      var appliedFadeIn = shouldApplyFadeIn ? fadeIn : 0;
      var src = ctx.createBufferSource();
      var gainNode = ctx.createGain();

      src.buffer = self.buffer;
      src.connect(gainNode);
      gainNode.connect(ctx.destination);
      gainNode.gain.setValueAtTime(1, ctx.currentTime);

      if (!useManualLoopFade) {
        src.loop = self.loop;
        if (src.loop) {
          src.loopStart = safeStart;
          src.loopEnd = safeEnd;
        }
      }

      self.source = src;
      self.outputGain = gainNode;
      self.startedAt = ctx.currentTime;
      self.startedOffset = segmentOffset;
      self.isPlaying = true;

      if (appliedFadeIn + fadeOut > totalDuration) {
        appliedFadeIn = totalDuration / 2;
        fadeOut = totalDuration / 2;
      }

      if (appliedFadeIn > 0) {
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + appliedFadeIn);
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
        self.outputGain = null;
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

  AudioEngine.prototype.estimateWavBytes = function (start, end) {
    if (!this.buffer) {
      return 0;
    }
    var safeStart = clamp(start, 0, this.buffer.duration);
    var safeEnd = clamp(end, safeStart, this.buffer.duration);
    var channelCount = Math.max(1, this.buffer.numberOfChannels || 1);
    var frameCount = Math.ceil((safeEnd - safeStart) * this.buffer.sampleRate);
    return Math.max(0, frameCount * channelCount * 2);
  };

  AudioEngine.prototype.estimateMp3Bytes = function (start, end, bitrateKbps) {
    if (!this.buffer) {
      return 0;
    }
    var safeStart = clamp(start, 0, this.buffer.duration);
    var safeEnd = clamp(end, safeStart, this.buffer.duration);
    return estimateMp3Bytes(safeEnd - safeStart, bitrateKbps);
  };

  AudioEngine.prototype.exportMp3 = async function (start, end, bitrateKbps, fadeInSec, fadeOutSec, progressCallback) {
    if (!this.buffer) {
      throw new Error("No audio loaded.");
    }
    var sampleRate = this.buffer.sampleRate;
    var startFrame = Math.floor(clamp(start, 0, this.buffer.duration) * sampleRate);
    var endFrame = Math.ceil(clamp(end, start, this.buffer.duration) * sampleRate);
    var channels = [];
    for (var c = 0; c < Math.min(this.buffer.numberOfChannels, 2); c += 1) {
      channels.push(this.buffer.getChannelData(c));
    }
    var appliedFadeIn = Number(fadeInSec);
    var appliedFadeOut = Number(fadeOutSec);
    if (!isFinite(appliedFadeIn)) {
      appliedFadeIn = Number(this.uiFadeIn) || 0;
    }
    if (!isFinite(appliedFadeOut)) {
      appliedFadeOut = Number(this.uiFadeOut) || 0;
    }
    var mp3 = await loadMp3Module();
    var encodeMethod = typeof mp3.encodeAsync === "function" ? mp3.encodeAsync : mp3.encode;
    return encodeMethod({
      channels: channels,
      sampleRate: sampleRate,
      bitrateKbps: bitrateKbps || 192,
      startFrame: startFrame,
      endFrame: endFrame,
      fadeInFrames: Math.floor(Math.max(0, appliedFadeIn) * sampleRate),
      fadeOutFrames: Math.floor(Math.max(0, appliedFadeOut) * sampleRate),
      onProgress: progressCallback
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
    var height = Math.floor(this.canvas.clientHeight || 200);
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
      cacheCtx.fillStyle = "#4f46e5";

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
    var edgeEpsilon = 0.0005;
    var touchesStartEdge = this.selection.start <= edgeEpsilon;
    var touchesEndEdge = this.selection.end >= 1 - edgeEpsilon;
    var isFullWidthSelection = touchesStartEdge && touchesEndEdge;

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

    if (isFullWidthSelection) {
      var glowWidth = Math.max(18, Math.min(30, width * 0.04));
      var glowHeight = Math.max(34, Math.min(58, height * 0.5));
      var glowTop = (height - glowHeight) / 2;

      var leftGlow = ctx.createLinearGradient(0, 0, glowWidth, 0);
      leftGlow.addColorStop(0, "rgba(79, 95, 224, 0.28)");
      leftGlow.addColorStop(0.42, "rgba(79, 95, 224, 0.14)");
      leftGlow.addColorStop(1, "rgba(79, 95, 224, 0)");
      ctx.fillStyle = leftGlow;
      ctx.fillRect(0, glowTop, glowWidth, glowHeight);

      var rightGlow = ctx.createLinearGradient(width - glowWidth, 0, width, 0);
      rightGlow.addColorStop(0, "rgba(79, 95, 224, 0)");
      rightGlow.addColorStop(0.58, "rgba(79, 95, 224, 0.14)");
      rightGlow.addColorStop(1, "rgba(79, 95, 224, 0.28)");
      ctx.fillStyle = rightGlow;
      ctx.fillRect(width - glowWidth, glowTop, glowWidth, glowHeight);
    }

    var capHeight = Math.max(30, Math.min(44, height * 0.34));
    var capWidth = 8;
    var capY = (height - capHeight) / 2;

    if (touchesStartEdge) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
      ctx.strokeStyle = "rgba(63, 140, 212, 0.78)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = isFullWidthSelection ? "rgba(79, 95, 224, 0.18)" : "transparent";
      ctx.shadowBlur = isFullWidthSelection ? 12 : 0;
      roundedRectPath(ctx, 2, capY, capWidth, capHeight, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (touchesEndEdge) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
      ctx.strokeStyle = "rgba(63, 140, 212, 0.78)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = isFullWidthSelection ? "rgba(79, 95, 224, 0.18)" : "transparent";
      ctx.shadowBlur = isFullWidthSelection ? 12 : 0;
      roundedRectPath(ctx, width - capWidth - 2, capY, capWidth, capHeight, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

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

  function TrimController(canvas, renderer, onChange, onSeek) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.onChange = onChange;
    this.onSeek = onSeek;
    this.startRatio = 0;
    this.endRatio = 1;
    this.minGap = 0.002;
    this.dragging = null;
    this.pointerId = null;
    this.dragOffsetRatio = 0;
    this.lockedSelectionRatio = null;
    this.pendingEmit = false;
    this.emitFrame = null;
    this._boundDown = this.handlePointerDown.bind(this);
    this._boundCanvasMove = this.handleCanvasPointerMove.bind(this);
    this._boundMove = this.handlePointerMove.bind(this);
    this._boundUp = this.handlePointerUp.bind(this);
    this._boundLeave = this.handlePointerLeave.bind(this);

    canvas.addEventListener("pointerdown", this._boundDown);
    canvas.addEventListener("pointermove", this._boundCanvasMove);
    canvas.addEventListener("pointerleave", this._boundLeave);
    window.addEventListener("pointermove", this._boundMove);
    window.addEventListener("pointerup", this._boundUp);
    window.addEventListener("pointercancel", this._boundUp);
    renderer.setSelection(this.startRatio, this.endRatio);
    this._setCursor(null);
  }

  TrimController.prototype.reset = function () {
    this.lockedSelectionRatio = null;
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

  TrimController.prototype.setStartRatio = function (ratio) {
    this.lockedSelectionRatio = null;
    this.startRatio = clamp(Number(ratio) || 0, 0, this.endRatio - this.minGap);
    this.renderer.setSelection(this.startRatio, this.endRatio);
    this._emit();
    return this.startRatio;
  };

  TrimController.prototype.setEndRatio = function (ratio) {
    this.lockedSelectionRatio = null;
    this.endRatio = clamp(Number(ratio) || 0, this.startRatio + this.minGap, 1);
    this.renderer.setSelection(this.startRatio, this.endRatio);
    this._emit();
    return this.endRatio;
  };

  TrimController.prototype.setLockedSelectionLength = function (seconds, duration) {
    if (!duration || duration <= 0) {
      this.lockedSelectionRatio = null;
      this.reset();
      return;
    }

    var safeSeconds = Math.max(0, Number(seconds) || 0);
    if (!safeSeconds) {
      this.lockedSelectionRatio = null;
      this.reset();
      return;
    }

    var maxRatio = 1;
    var requestedRatio = clamp(safeSeconds / duration, this.minGap, maxRatio);
    this.lockedSelectionRatio = requestedRatio;
    this.startRatio = 0;
    this.endRatio = requestedRatio >= 1 ? 1 : requestedRatio;
    this.renderer.setSelection(this.startRatio, this.endRatio);
    this._emit();
  };

  TrimController.prototype.clearLockedSelection = function () {
    this.lockedSelectionRatio = null;
    this.reset();
  };

  TrimController.prototype.hasLockedSelection = function () {
    return this.lockedSelectionRatio != null;
  };

  TrimController.prototype.handlePointerDown = function (event) {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    var rect = this.canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var startX = this.renderer.ratioToX(this.startRatio);
    var endX = this.renderer.ratioToX(this.endRatio);
    var hitZone = TRIM_HANDLE_HIT_ZONE;
    var distStart = Math.abs(x - startX);
    var distEnd = Math.abs(x - endX);
    var ratio = this.renderer.xToRatio(x);

    if (this.lockedSelectionRatio != null) {
      if (x >= startX && x <= endX) {
        this.dragging = "window";
        this.dragOffsetRatio = ratio - this.startRatio;
        this.pointerId = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        this._setCursor(this.dragging, true);
        event.preventDefault();
      }
      return;
    }

    if (distStart <= hitZone || distEnd <= hitZone) {
      this.dragging = distStart <= distEnd ? "start" : "end";
    } else if (x > startX && x < endX) {
      this.dragging = "seek";
      if (typeof this.onSeek === "function") {
        this.onSeek(this.renderer.xToRatio(x));
      }
    } else {
      this.dragging = x < startX ? "start" : "end";
    }

    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this._setCursor(this.dragging, true);
    event.preventDefault();
  };

  TrimController.prototype.handleCanvasPointerMove = function (event) {
    if (this.dragging && this.pointerId === event.pointerId) {
      this._setCursor(this.dragging, true);
      return;
    }
    this._setCursor(this._getPointerIntent(event), false);
  };

  TrimController.prototype.handlePointerMove = function (event) {
    if (!this.dragging || this.pointerId !== event.pointerId) {
      return;
    }
    this._setCursor(this.dragging, true);
    var rect = this.canvas.getBoundingClientRect();
    var ratio = this.renderer.xToRatio(event.clientX - rect.left);
    if (this.dragging === "seek") {
      if (typeof this.onSeek === "function") {
        this.onSeek(ratio);
      }
      return;
    }
    var prevStart = this.startRatio;
    var prevEnd = this.endRatio;
    if (this.dragging === "window") {
      var lockedWidth = clamp(this.lockedSelectionRatio || (this.endRatio - this.startRatio), this.minGap, 1);
      var nextStart = clamp(ratio - this.dragOffsetRatio, 0, 1 - lockedWidth);
      this.startRatio = nextStart;
      this.endRatio = clamp(nextStart + lockedWidth, this.startRatio + this.minGap, 1);
    } else if (this.dragging === "start") {
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
    var wasSeeking = this.dragging === "seek";
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (err) {
    }
    this.dragging = null;
    this.pointerId = null;
    this.dragOffsetRatio = 0;
    this._setCursor(this._getPointerIntent(event), false);
    if (!wasSeeking) {
      this._flushEmit();
    }
  };

  TrimController.prototype.handlePointerLeave = function () {
    if (this.dragging) {
      return;
    }
    this._setCursor(null, false);
  };

  TrimController.prototype._getPointerIntent = function (event) {
    if (!event) {
      return null;
    }
    var rect = this.canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var startX = this.renderer.ratioToX(this.startRatio);
    var endX = this.renderer.ratioToX(this.endRatio);
    var hitZone = TRIM_HANDLE_HIT_ZONE;
    var distStart = Math.abs(x - startX);
    var distEnd = Math.abs(x - endX);

    if (this.lockedSelectionRatio != null) {
      return x >= startX && x <= endX ? "window" : null;
    }

    if (distStart <= hitZone || distEnd <= hitZone) {
      return distStart <= distEnd ? "start" : "end";
    }

    if (x > startX && x < endX) {
      return "seek";
    }

    return null;
  };

  TrimController.prototype._setCursor = function (intent, dragging) {
    if (!this.canvas || !this.canvas.style) {
      return;
    }
    var cursor = "";
    if (intent === "start" || intent === "end") {
      cursor = "ew-resize";
    } else if (intent === "window") {
      cursor = dragging ? "grabbing" : "grab";
    } else if (intent === "seek") {
      cursor = "pointer";
    }
    this.canvas.style.cursor = cursor;
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
    this.canvas.removeEventListener("pointermove", this._boundCanvasMove);
    this.canvas.removeEventListener("pointerleave", this._boundLeave);
    window.removeEventListener("pointermove", this._boundMove);
    window.removeEventListener("pointerup", this._boundUp);
    window.removeEventListener("pointercancel", this._boundUp);
    this._setCursor(null);
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
    this.setStartBtn = this.root.querySelector('[data-role="setStartToPlayhead"]');
    this.setEndBtn = this.root.querySelector('[data-role="setEndToPlayhead"]');
    var fadeControlsRow = this.fadeOutToggle && this.fadeOutToggle.closest
      ? this.fadeOutToggle.closest(".at-row")
      : null;
    if (fadeControlsRow && (!this.setStartBtn || !this.setEndBtn)) {
      var startLabel = isArabicDocument() ? "تعيين البداية" : "Set Start";
      var endLabel = isArabicDocument() ? "تعيين النهاية" : "Set End";
      var firstFadeControl = this.fadeInToggle && this.fadeInToggle.closest
        ? this.fadeInToggle.closest("label")
        : null;
      if (!this.setStartBtn) {
        this.setStartBtn = createSnapButton("setStartToPlayhead", startLabel, "arrow-right-to-line");
        fadeControlsRow.insertBefore(this.setStartBtn, firstFadeControl);
      }
      if (!this.setEndBtn) {
        this.setEndBtn = createSnapButton("setEndToPlayhead", endLabel, "arrow-left-to-line");
        fadeControlsRow.insertBefore(this.setEndBtn, firstFadeControl);
      }
      renderLucideIcons();
    }
    this.fadeInOverlay = this.root.querySelector('.fade-in');
    this.fadeOutOverlay = this.root.querySelector('.fade-out');
    this.fileInput = this.root.querySelector(".at-file");
    this.canvas = this.root.querySelector(".at-wave");
    this.playPauseBtn = this.root.querySelector('[data-role="playPause"]');
    this.loopToggleBtn = this.root.querySelector('[data-role="loopToggle"]');
    this.resetBtn = this.root.querySelector('[data-role="reset"]');
    this.exportWavBtn = this.root.querySelector('[data-role="exportWav"]');
    this.exportMp3Btn = this.root.querySelector('[data-role="exportMp3"]');
    this.mp3QualitySelect = this.root.querySelector('[data-role="mp3Quality"]');
    if (!this.mp3QualitySelect && this.exportMp3Btn) {
      var isArabic = String(document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
      this.mp3QualitySelect = document.createElement("select");
      this.mp3QualitySelect.dataset.role = "mp3Quality";
      this.mp3QualitySelect.setAttribute("aria-label", isArabic ? "جودة MP3" : "MP3 quality");
      this.mp3QualitySelect.title = isArabic ? "اختر جودة وحجم ملف MP3" : "Choose MP3 quality and file size";
      this.mp3QualitySelect.disabled = true;
      this.mp3QualitySelect.style.width = "auto";
      this.mp3QualitySelect.style.maxWidth = "100%";
      [
        { value: "auto", label: isArabic ? "تلقائي (موصى به)" : "Auto (recommended)" },
        { value: "64", label: isArabic ? "صغير · 64 kbps" : "Small · 64 kbps" },
        { value: "80", label: isArabic ? "صغير · 80 kbps" : "Small · 80 kbps" },
        { value: "96", label: isArabic ? "متوازن · 96 kbps" : "Balanced · 96 kbps" },
        { value: "128", label: isArabic ? "متوازن · 128 kbps" : "Balanced · 128 kbps" },
        { value: "192", label: isArabic ? "عالي · 192 kbps" : "High · 192 kbps" }
      ].forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        option.dataset.baseLabel = item.label;
        this.mp3QualitySelect.appendChild(option);
      }, this);
      this.exportMp3Btn.parentNode.insertBefore(this.mp3QualitySelect, this.exportMp3Btn);
    }
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
    placeStatusAfterFileRow(this.fileRow, this.statusEl);
    this.renderer = new WaveformRenderer(this.canvas);
    this.trim = new TrimController(
      this.canvas,
      this.renderer,
      this.onTrimChanged.bind(this),
      this.onWaveformSeek.bind(this)
    );
    this.loopEnabled = true;
    setPlayPauseButtonState(this.playPauseBtn, false);
    setLoopToggleButtonState(this.loopToggleBtn, this.loopEnabled);
    setResetButtonIcon(this.resetBtn);
    this.updateTimeText();
    this.updateMp3QualityEstimate();
  };

  UIController.prototype.getSelectedMp3Bitrate = function () {
    var selected = this.mp3QualitySelect ? this.mp3QualitySelect.value : "auto";
    var explicitBitrate = Number(selected);
    if (selected !== "auto" && isFinite(explicitBitrate) && explicitBitrate > 0) {
      return explicitBitrate;
    }
    return chooseSmartMp3Bitrate(this.currentFile, this.duration);
  };

  UIController.prototype.updateMp3QualityEstimate = function () {
    if (!this.mp3QualitySelect) {
      return;
    }
    var autoOption = this.mp3QualitySelect.querySelector('option[value="auto"]');
    if (!autoOption) {
      return;
    }
    var isArabic = String(document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
    if (!this.currentFile || !this.duration || !this.trim) {
      autoOption.textContent = isArabic ? "تلقائي (موصى به)" : "Auto (recommended)";
      return;
    }
    var selection = this._getSelection();
    var bitrate = chooseSmartMp3Bitrate(this.currentFile, this.duration);
    var size = this.audio.estimateMp3Bytes(selection.start, selection.end, bitrate);
    autoOption.textContent = (isArabic ? "تلقائي" : "Auto") + " · " + bitrate + " kbps · ~" + formatFileSize(size);
    Array.prototype.forEach.call(this.mp3QualitySelect.options, function (option) {
      if (option.value === "auto") {
        return;
      }
      var optionBitrate = Number(option.value);
      var optionSize = this.audio.estimateMp3Bytes(selection.start, selection.end, optionBitrate);
      option.textContent = (option.dataset.baseLabel || option.textContent) + " · ~" + formatFileSize(optionSize);
    }, this);
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
    if (this.loopToggleBtn) {
      this.loopToggleBtn.addEventListener("click", this.onLoopToggle.bind(this));
    }
    this.resetBtn.addEventListener("click", this.onReset.bind(this));
    this.exportWavBtn.addEventListener("click", this.onExportWav.bind(this));
    this.exportMp3Btn.addEventListener("click", this.onExportMp3.bind(this));
    if (this.setStartBtn) {
      this.setStartBtn.addEventListener("click", this.onSetStartToPlayhead.bind(this));
    }
    if (this.setEndBtn) {
      this.setEndBtn.addEventListener("click", this.onSetEndToPlayhead.bind(this));
    }
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

  UIController.prototype._getPlaybackStart = function () {
    var selection = this._getSelection();
    var current = this.audio.getCurrentPosition();
    if (!isFinite(current)) {
      return selection.start;
    }
    return clamp(current, selection.start, selection.end);
  };

  UIController.prototype._setControlsEnabled = function (enabled) {
    this.playPauseBtn.disabled = !enabled;
    if (this.loopToggleBtn) {
      this.loopToggleBtn.disabled = !enabled;
    }
    this.resetBtn.disabled = !enabled;
    this.exportWavBtn.disabled = !enabled;
    this.exportMp3Btn.disabled = !enabled;
    if (this.mp3QualitySelect) {
      this.mp3QualitySelect.disabled = !enabled;
    }
    if (this.setStartBtn) {
      this.setStartBtn.disabled = !enabled;
    }
    if (this.setEndBtn) {
      this.setEndBtn.disabled = !enabled;
    }
  };

  UIController.prototype.onLoopToggle = function () {
    this.loopEnabled = !this.loopEnabled;
    setLoopToggleButtonState(this.loopToggleBtn, this.loopEnabled);
  };

  UIController.prototype.onSetStartToPlayhead = function () {
    if (!this.duration) {
      return;
    }
    var position = clamp(this.audio.getCurrentPosition(), 0, this.duration);
    var appliedRatio = this.trim.setStartRatio(position / this.duration);
    var appliedPosition = appliedRatio * this.duration;
    if (typeof window.AudioToolDidSetTrimBoundary === "function") {
      window.AudioToolDidSetTrimBoundary(this, {
        boundary: "start",
        position: appliedPosition
      });
    }
    this.setStatus(
      isArabicDocument()
        ? "تم تعيين البداية عند " + formatTime(appliedPosition) + "."
        : "Start set to " + formatTime(appliedPosition) + "."
    );
  };

  UIController.prototype.onSetEndToPlayhead = function () {
    if (!this.duration) {
      return;
    }
    var position = clamp(this.audio.getCurrentPosition(), 0, this.duration);
    var appliedRatio = this.trim.setEndRatio(position / this.duration);
    var appliedPosition = appliedRatio * this.duration;
    if (typeof window.AudioToolDidSetTrimBoundary === "function") {
      window.AudioToolDidSetTrimBoundary(this, {
        boundary: "end",
        position: appliedPosition
      });
    }
    this.setStatus(
      isArabicDocument()
        ? "تم تعيين النهاية عند " + formatTime(appliedPosition) + "."
        : "End set to " + formatTime(appliedPosition) + "."
    );
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

  UIController.prototype.setPlayPauseVisualState = function (isPlaying) {
    setPlayPauseButtonState(this.playPauseBtn, !!isPlaying);
  };

  UIController.prototype.onFileChange = async function () {
    var file = this.fileInput.files && this.fileInput.files[0];
    if (!file) {
      return;
    }
    var validationContext = {
      controller: this,
      input: this.fileInput || null,
      phase: this.duration ? "replacement" : "initial"
    };
    var policy = resolveUploadPolicy(validationContext);
    var validateFile = resolveUploadValidator(policy);
    if (validateFile) {
      var validation = validateFile(file, validationContext);
      if (validation && validation.ok === false) {
        var hadLoadedFile = !!(this.currentFile && this.duration);
        var previousFile = this.currentFile;
        this.currentFile = null;
        if (this.fileInput) {
          this.fileInput.value = "";
        }
        if (hadLoadedFile && previousFile) {
          var self = this;
          this.currentFile = previousFile;
          this.audio.stop();
          this.stopAnimationLoop();
          setPlayPauseButtonState(this.playPauseBtn, false);
          this.audio.resetPosition(this.trim.startRatio * this.duration);
          this.renderer.setPlayhead(this.trim.startRatio);
          setTimeout(function () {
            if (self.fileNameEl) {
              self.fileNameEl.textContent = previousFile.name;
            }
            if (self.fileRow) {
              self.fileRow.classList.remove("is-hidden");
            }
          }, 0);
        } else {
          this.duration = 0;
          this.audio.stop();
          this.stopAnimationLoop();
          this.renderer.setPlayhead(null);
          this._setControlsEnabled(false);
          this.trim.reset();
          this.updateTimeText();
          this.updateFadeOverlay();
          if (this.fileNameEl) {
            this.fileNameEl.textContent = "";
          }
          if (this.fileRow) {
            this.fileRow.classList.add("is-hidden");
          }
        }
        this.setStatus(validation.message || "This file is not supported.");
        return;
      }
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
      var fileForDecode = file;
      var convertedForCompatibility = false;
      var buffer = null;

      try {
        buffer = await this.audio.loadFile(fileForDecode);
      } catch (decodeError) {
        var preprocess = typeof window.AudioToolPreprocessFile === "function"
          ? window.AudioToolPreprocessFile
          : (typeof window.AudioToolDefaultPreprocessFile === "function"
            ? window.AudioToolDefaultPreprocessFile
            : null);
        var shouldTryPreprocess = typeof window.AudioToolShouldTryPreprocess === "function"
          ? window.AudioToolShouldTryPreprocess(file, decodeError, this)
          : (typeof window.AudioToolDefaultShouldTryPreprocess === "function"
            ? window.AudioToolDefaultShouldTryPreprocess(file, decodeError, this)
            : false);

        if ((!isDecodeLikeError(decodeError) && !shouldTryPreprocess) || !preprocess) {
          throw decodeError;
        }

        this.setStatus("Converting media for compatibility...");
        var preprocessed = await preprocess(file, decodeError, this);
        if (!preprocessed) {
          throw decodeError;
        }
        fileForDecode = preprocessed;
        buffer = await this.audio.loadFile(fileForDecode);
        convertedForCompatibility = true;
      }

      this.duration = buffer.duration;
      this.trim.reset();
      this.renderer.setPeaksFromBuffer(buffer);
      this._setControlsEnabled(true);
      this.updateTimeText();
      this.updateMp3QualityEstimate();
      this.updateFadeOverlay();
      if (convertedForCompatibility) {
        this.setStatus("Ready. File converted for compatibility.");
      } else {
        this.setStatus("Ready. Drag handles to trim and press Play.");
      }
      if (typeof window.AudioToolDidLoadFile === "function") {
        window.AudioToolDidLoadFile(this, {
          convertedForCompatibility: convertedForCompatibility
        });
      }
    } catch (err) {
      if (isDecodeLikeError(err)) {
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
    this.updateMp3QualityEstimate();
    this.updateFadeOverlay();
    this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
    if (!this.audio.isPlaying) {
      var position = this._getPlaybackStart();
      this.audio.resetPosition(position);
      this.renderer.setPlayhead(this.duration ? position / this.duration : this.trim.startRatio);
    }
  };

  UIController.prototype.onWaveformSeek = function (ratio) {
    if (!this.duration) {
      return;
    }
    if (this.audio.isPlaying) {
      this.audio.pause();
      this.stopAnimationLoop();
      setPlayPauseButtonState(this.playPauseBtn, false);
    }
    var selection = this._getSelection();
    var position = clamp((Number(ratio) || 0) * this.duration, selection.start, selection.end);
    this.audio.resetPosition(position);
    this.renderer.setPlayhead(position / this.duration);
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
      setPlayPauseButtonState(this.playPauseBtn, false);
      return;
    }
    var selection = this._getSelection();
    this.audio.resetPosition(this._getPlaybackStart());
    this.audio.uiFadeIn = this.fadeInDuration;
    this.audio.uiFadeOut = this.fadeOutDuration;
    this.renderer.setFadeDurations(this.fadeInDuration, this.fadeOutDuration);
    await this.audio.play(selection.start, selection.end, this.loopEnabled);
    setPlayPauseButtonState(this.playPauseBtn, true);
    this.startAnimationLoop();
  };

  UIController.prototype.onReset = function () {
    if (!this.duration) {
      return;
    }
    this.audio.stop();
    this.stopAnimationLoop();
    setPlayPauseButtonState(this.playPauseBtn, false);
    this.trim.reset();
    this.audio.resetPosition(0);
    this.renderer.setPlayhead(0);
    this.setStatus("Trim region reset.");
    if (typeof window.AudioToolDidReset === "function") {
      window.AudioToolDidReset(this);
    }
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
      var estimatedBytes = this.audio.estimateWavBytes(selection.start, selection.end);
      if (estimatedBytes >= 100 * 1024 * 1024) {
        var shouldContinue = window.confirm(
          "This WAV will be about " + formatFileSize(estimatedBytes) + " because WAV is uncompressed. Continue, or use MP3 for a smaller file?"
        );
        if (!shouldContinue) {
          this.setStatus("WAV export canceled. Use MP3 for a smaller download.");
          return;
        }
      }
      this.audio.uiFadeIn = this.fadeInDuration;
      this.audio.uiFadeOut = this.fadeOutDuration;
      var wav = this.audio.exportWav(selection.start, selection.end, this.fadeInDuration, this.fadeOutDuration);
      var base = this.currentFile.name.replace(/\.[^/.]+$/, "") || "trimmed";
      this._downloadBlob(wav, base + "-trimmed.wav");
      this.setStatus("WAV ready (" + formatFileSize(wav.size) + "). Download started.");
    } catch (err) {
      this.setStatus("WAV export failed.");
    }
  };

  UIController.prototype.onExportMp3 = async function () {
    if (!this.duration || !this.currentFile) {
      return;
    }
    var selection = this._getSelection();
    var bitrateKbps = this.getSelectedMp3Bitrate();
    var estimatedSize = this.audio.estimateMp3Bytes(selection.start, selection.end, bitrateKbps);
    var self = this;
    this.setStatus("Encoding MP3 at " + bitrateKbps + " kbps...");
    this._setControlsEnabled(false);
    try {
      this.audio.uiFadeIn = this.fadeInDuration;
      this.audio.uiFadeOut = this.fadeOutDuration;
      var mp3 = await this.audio.exportMp3(
        selection.start,
        selection.end,
        bitrateKbps,
        this.fadeInDuration,
        this.fadeOutDuration,
        function (progress) {
          var percent = Math.max(0, Math.min(100, Math.round((Number(progress) || 0) * 100)));
          self.setStatus("Encoding MP3 at " + bitrateKbps + " kbps... " + percent + "%");
        }
      );
      var base = this.currentFile.name.replace(/\.[^/.]+$/, "") || "trimmed";
      this._downloadBlob(mp3, base + "-trimmed.mp3");
      this.setStatus("MP3 ready (" + formatFileSize(mp3.size || estimatedSize) + "). Download started.");
    } catch (err) {
      this.setStatus("MP3 export failed: " + err.message);
    } finally {
      this._setControlsEnabled(true);
    }
  };

  UIController.prototype.onPlaybackEnded = function () {
    this.stopAnimationLoop();
    setPlayPauseButtonState(this.playPauseBtn, false);
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
