(function (global) {
  "use strict";

  var WORKER_PATH = "/assets/encoders/mp3-encoder-worker.js?v=2026-06-22-1";

  function assertLameJs() {
    if (!global.lamejs || typeof global.lamejs.Mp3Encoder !== "function") {
      throw new Error(
        "MP3 encoder unavailable: bundle lamejs in this file or provide window.lamejs before exporting MP3."
      );
    }
  }

  function floatToInt16Sample(value) {
    var clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  function toInt16Array(floatArray) {
    var out = new Int16Array(floatArray.length);
    for (var i = 0; i < floatArray.length; i += 1) {
      out[i] = floatToInt16Sample(floatArray[i]);
    }
    return out;
  }

  function interleaveToMono(channels) {
    if (!channels || channels.length === 0) {
      return new Float32Array(0);
    }
    if (channels.length === 1) {
      return channels[0];
    }
    var length = channels[0].length;
    var mono = new Float32Array(length);
    for (var i = 0; i < length; i += 1) {
      var sum = 0;
      for (var c = 0; c < channels.length; c += 1) {
        sum += channels[c][i];
      }
      mono[i] = sum / channels.length;
    }
    return mono;
  }

  function encode(options) {
    assertLameJs();
    var channels = options.channels || [];
    var sampleRate = options.sampleRate || 44100;
    var bitrateKbps = options.bitrateKbps || 192;
    var channelCount = channels.length >= 2 ? 2 : 1;
    var left = toInt16Array(channels[0] || new Float32Array(0));
    var right =
      channelCount === 2
        ? toInt16Array(channels[1] || channels[0] || new Float32Array(0))
        : null;

    if (channelCount === 1 && channels.length > 1) {
      left = toInt16Array(interleaveToMono(channels));
    }

    var encoder = new global.lamejs.Mp3Encoder(channelCount, sampleRate, bitrateKbps);
    var chunkSize = 1152;
    var mp3Parts = [];

    for (var i = 0; i < left.length; i += chunkSize) {
      var leftChunk = left.subarray(i, i + chunkSize);
      var encoded;
      if (channelCount === 2) {
        var rightChunk = right.subarray(i, i + chunkSize);
        encoded = encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        encoded = encoder.encodeBuffer(leftChunk);
      }
      if (encoded.length > 0) {
        mp3Parts.push(new Uint8Array(encoded));
      }
    }

    var flush = encoder.flush();
    if (flush.length > 0) {
      mp3Parts.push(new Uint8Array(flush));
    }

    return new Blob(mp3Parts, { type: "audio/mpeg" });
  }

  function getFrameLength(channels) {
    if (!channels || !channels.length || !channels[0]) {
      return 0;
    }
    return channels[0].length || 0;
  }

  function floatSliceToInt16(floatArray, start, end) {
    var length = Math.max(0, end - start);
    var out = new Int16Array(length);
    if (!floatArray) {
      return out;
    }
    for (var i = 0; i < length; i += 1) {
      out[i] = floatToInt16Sample(floatArray[start + i] || 0);
    }
    return out;
  }

  function mixSliceToMonoInt16(channels, start, end) {
    var length = Math.max(0, end - start);
    var out = new Int16Array(length);
    if (!channels || !channels.length) {
      return out;
    }
    for (var i = 0; i < length; i += 1) {
      var sum = 0;
      for (var c = 0; c < channels.length; c += 1) {
        var channel = channels[c];
        sum += channel ? (channel[start + i] || 0) : 0;
      }
      out[i] = floatToInt16Sample(sum / channels.length);
    }
    return out;
  }

  function yieldToMainThread() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function getEncodeRange(options, channels) {
    var sourceLength = getFrameLength(channels);
    var start = Math.max(0, Math.min(sourceLength, Math.floor(Number(options.startFrame) || 0)));
    var requestedEnd = Number(options.endFrame);
    var end = isFinite(requestedEnd)
      ? Math.max(start, Math.min(sourceLength, Math.ceil(requestedEnd)))
      : sourceLength;
    return { start: start, end: end, length: end - start };
  }

  function applyFadeToChunk(chunk, relativeStart, totalFrames, fadeInFrames, fadeOutFrames) {
    var safeFadeIn = Math.max(0, Math.min(totalFrames, Math.floor(Number(fadeInFrames) || 0)));
    var safeFadeOut = Math.max(0, Math.min(totalFrames, Math.floor(Number(fadeOutFrames) || 0)));
    if (safeFadeIn + safeFadeOut > totalFrames) {
      safeFadeIn = Math.floor(totalFrames / 2);
      safeFadeOut = totalFrames - safeFadeIn;
    }

    for (var i = 0; i < chunk.length; i += 1) {
      var position = relativeStart + i;
      var gain = 1;
      if (safeFadeIn > 0 && position < safeFadeIn) {
        gain *= Math.sin((position / (safeFadeIn - 1 || 1)) * (Math.PI / 2));
      }
      var fadeOutPosition = totalFrames - 1 - position;
      if (safeFadeOut > 0 && fadeOutPosition < safeFadeOut) {
        gain *= Math.sin((fadeOutPosition / (safeFadeOut - 1 || 1)) * (Math.PI / 2));
      }
      chunk[i] *= gain;
    }
  }

  async function encodeCooperatively(options) {
    assertLameJs();
    var channels = options.channels || [];
    var sampleRate = options.sampleRate || 44100;
    var bitrateKbps = options.bitrateKbps || 192;
    var channelCount = channels.length >= 2 ? 2 : 1;
    var range = getEncodeRange(options, channels);
    var frameLength = range.length;
    var encoder = new global.lamejs.Mp3Encoder(channelCount, sampleRate, bitrateKbps);
    var chunkSize = 1152 * 8;
    var yieldEveryChunks = 32;
    var onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    var mp3Parts = [];

    if (onProgress) {
      onProgress(0);
    }

    for (var start = 0, chunkIndex = 0; start < frameLength; start += chunkSize, chunkIndex += 1) {
      var end = Math.min(frameLength, start + chunkSize);
      var leftChunk;
      var encoded;

      if (channelCount === 1 && channels.length > 1) {
        leftChunk = mixSliceToMonoInt16(channels, range.start + start, range.start + end);
        encoded = encoder.encodeBuffer(leftChunk);
      } else {
        var leftFloat = new Float32Array(end - start);
        leftFloat.set(channels[0].subarray(range.start + start, range.start + end));
        applyFadeToChunk(leftFloat, start, frameLength, options.fadeInFrames, options.fadeOutFrames);
        leftChunk = floatSliceToInt16(leftFloat, 0, leftFloat.length);
        if (channelCount === 2) {
          var rightSource = channels[1] || channels[0];
          var rightFloat = new Float32Array(end - start);
          rightFloat.set(rightSource.subarray(range.start + start, range.start + end));
          applyFadeToChunk(rightFloat, start, frameLength, options.fadeInFrames, options.fadeOutFrames);
          var rightChunk = floatSliceToInt16(rightFloat, 0, rightFloat.length);
          encoded = encoder.encodeBuffer(leftChunk, rightChunk);
        } else {
          encoded = encoder.encodeBuffer(leftChunk);
        }
      }

      if (encoded.length > 0) {
        mp3Parts.push(new Uint8Array(encoded));
      }

      if (onProgress && (chunkIndex % yieldEveryChunks === 0 || end >= frameLength)) {
        onProgress(frameLength ? end / frameLength : 1);
      }
      if (chunkIndex > 0 && chunkIndex % yieldEveryChunks === 0) {
        await yieldToMainThread();
      }
    }

    var flush = encoder.flush();
    if (flush.length > 0) {
      mp3Parts.push(new Uint8Array(flush));
    }
    if (onProgress) {
      onProgress(1);
    }

    return new Blob(mp3Parts, { type: "audio/mpeg" });
  }

  function encodeInWorker(options) {
    return new Promise(function (resolve, reject) {
      var channels = options.channels || [];
      var firstChannel = channels[0];
      if (!firstChannel) {
        reject(new Error("No audio samples were provided."));
        return;
      }

      var range = getEncodeRange(options, channels);
      var frameLength = range.length;
      var channelCount = channels.length >= 2 ? 2 : 1;
      var chunkSize = 1152 * 32;
      var offset = 0;
      var settled = false;
      var worker;

      function finishWithError(error) {
        if (settled) {
          return;
        }
        settled = true;
        if (worker) {
          worker.terminate();
        }
        reject(error instanceof Error ? error : new Error(String(error || "MP3 encoding failed.")));
      }

      function sendNextChunk() {
        if (offset >= frameLength) {
          worker.postMessage({ type: "finish" });
          return;
        }

        var end = Math.min(frameLength, offset + chunkSize);
        var left = new Float32Array(end - offset);
        left.set(firstChannel.subarray(range.start + offset, range.start + end));
        applyFadeToChunk(left, offset, frameLength, options.fadeInFrames, options.fadeOutFrames);
        var transfer = [left.buffer];
        var message = {
          type: "chunk",
          left: left.buffer,
          framesProcessed: end
        };

        if (channelCount === 2) {
          var sourceRight = channels[1] || firstChannel;
          var right = new Float32Array(end - offset);
          right.set(sourceRight.subarray(range.start + offset, range.start + end));
          applyFadeToChunk(right, offset, frameLength, options.fadeInFrames, options.fadeOutFrames);
          message.right = right.buffer;
          transfer.push(right.buffer);
        }

        offset = end;
        worker.postMessage(message, transfer);
      }

      try {
        worker = new Worker(WORKER_PATH);
      } catch (error) {
        finishWithError(error);
        return;
      }

      worker.onmessage = function (event) {
        var message = event.data || {};
        if (message.type === "ready") {
          if (typeof options.onProgress === "function") {
            options.onProgress(0);
          }
          sendNextChunk();
        } else if (message.type === "chunk-complete") {
          if (typeof options.onProgress === "function") {
            options.onProgress(frameLength ? message.framesProcessed / frameLength : 1);
          }
          sendNextChunk();
        } else if (message.type === "done") {
          if (settled) {
            return;
          }
          settled = true;
          worker.terminate();
          if (typeof options.onProgress === "function") {
            options.onProgress(1);
          }
          resolve(message.blob);
        } else if (message.type === "error") {
          finishWithError(new Error(message.message || "MP3 encoding failed."));
        }
      };

      worker.onerror = function (event) {
        finishWithError(new Error(event.message || "MP3 worker failed to load."));
      };

      worker.postMessage({
        type: "init",
        channelCount: channelCount,
        sampleRate: options.sampleRate || 44100,
        bitrateKbps: options.bitrateKbps || 128
      });
    });
  }

  async function encodeAsync(options) {
    if (typeof Worker !== "undefined") {
      try {
        return await encodeInWorker(options);
      } catch (workerError) {
        if (typeof global.lamejs !== "undefined") {
          return encodeCooperatively(options);
        }
        throw workerError;
      }
    }
    return encodeCooperatively(options);
  }

  global.MP3EncoderModule = {
    encode: encode,
    encodeAsync: encodeAsync,
    isAvailable: function () {
      return !!(global.lamejs && typeof global.lamejs.Mp3Encoder === "function");
    }
  };
})(typeof window !== "undefined" ? window : this);
