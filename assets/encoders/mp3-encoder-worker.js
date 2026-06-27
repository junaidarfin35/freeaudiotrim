(function () {
  "use strict";

  importScripts("/assets/encoders/lame.min.js");

  var encoder = null;
  var channelCount = 0;
  var encodedParts = [];

  function floatToInt16(floatSamples) {
    var output = new Int16Array(floatSamples.length);
    for (var i = 0; i < floatSamples.length; i += 1) {
      var sample = Math.max(-1, Math.min(1, floatSamples[i] || 0));
      output[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    }
    return output;
  }

  function appendEncoded(encoded) {
    if (encoded && encoded.length) {
      encodedParts.push(new Uint8Array(encoded));
    }
  }

  self.onmessage = function (event) {
    var message = event.data || {};

    try {
      if (message.type === "init") {
        if (!self.lamejs || typeof self.lamejs.Mp3Encoder !== "function") {
          throw new Error("MP3 encoder runtime is unavailable in the worker.");
        }
        channelCount = message.channelCount === 2 ? 2 : 1;
        encoder = new self.lamejs.Mp3Encoder(
          channelCount,
          message.sampleRate || 44100,
          message.bitrateKbps || 128
        );
        encodedParts = [];
        self.postMessage({ type: "ready" });
        return;
      }

      if (message.type === "chunk") {
        if (!encoder) {
          throw new Error("MP3 worker was not initialized.");
        }
        var left = floatToInt16(new Float32Array(message.left));
        if (channelCount === 2) {
          var right = floatToInt16(new Float32Array(message.right));
          appendEncoded(encoder.encodeBuffer(left, right));
        } else {
          appendEncoded(encoder.encodeBuffer(left));
        }
        self.postMessage({ type: "chunk-complete", framesProcessed: message.framesProcessed });
        return;
      }

      if (message.type === "finish") {
        if (!encoder) {
          throw new Error("MP3 worker was not initialized.");
        }
        appendEncoded(encoder.flush());
        var blob = new Blob(encodedParts, { type: "audio/mpeg" });
        encodedParts = [];
        encoder = null;
        self.postMessage({ type: "done", blob: blob });
        self.close();
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error && error.message ? error.message : "MP3 encoding failed."
      });
      self.close();
    }
  };
})();
