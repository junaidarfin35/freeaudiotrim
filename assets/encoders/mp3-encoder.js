(function (global) {
  "use strict";

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

  global.MP3EncoderModule = {
    encode: encode,
    isAvailable: function () {
      return !!(global.lamejs && typeof global.lamejs.Mp3Encoder === "function");
    }
  };
})(typeof window !== "undefined" ? window : this);
