(function () {
  var bundlePromise = null;
  var coreBase = window.location.origin + "/assets/ffmpeg";
  var bundleUrl = coreBase + "/ffmpeg.js";

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-ffmpeg-bundle="true"]');
      if (existing && window.FFmpegWASM && window.FFmpegWASM.FFmpeg) {
        resolve(window.FFmpegWASM);
        return;
      }

      var script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.setAttribute("data-ffmpeg-bundle", "true");
      script.onload = function () {
        if (!window.FFmpegWASM || typeof window.FFmpegWASM.FFmpeg !== "function") {
          reject(new Error("FFmpeg bundle loaded but the FFmpeg class is unavailable."));
          return;
        }
        resolve(window.FFmpegWASM);
      };
      script.onerror = function () {
        reject(new Error("Failed to load FFmpeg browser bundle."));
      };
      document.head.appendChild(script);
    });
  }

  function ensureBundle() {
    if (window.FFmpegWASM && typeof window.FFmpegWASM.FFmpeg === "function") {
      return Promise.resolve(window.FFmpegWASM);
    }
    if (!bundlePromise) {
      bundlePromise = loadScript(bundleUrl);
    }
    return bundlePromise;
  }

  async function toBlobURL(url, mimeType) {
    var response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch " + url + " (" + response.status + ")");
    }
    var buffer = await response.arrayBuffer();
    var blob = new Blob([buffer], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  async function fetchFile(data) {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (data && typeof data.arrayBuffer === "function") {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (typeof data === "string" || data instanceof URL) {
      var response = await fetch(data);
      if (!response.ok) {
        throw new Error("Failed to fetch " + data + " (" + response.status + ")");
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error("Unsupported input for fetchFile.");
  }

  function createFFmpeg() {
    var core = null;
    var loaded = false;
    var loadPromise = null;

    return {
      load: async function () {
        if (loaded) {
          return;
        }
        if (loadPromise) {
          return loadPromise;
        }

        loadPromise = (async function () {
          var bundle = await ensureBundle();
          core = new bundle.FFmpeg();

          var coreURL = await toBlobURL(coreBase + "/ffmpeg-core.js", "text/javascript");
          var wasmURL = await toBlobURL(coreBase + "/ffmpeg-core.wasm", "application/wasm");

          await core.load({
            coreURL: coreURL,
            wasmURL: wasmURL
          });
          loaded = true;
        })();

        try {
          return await loadPromise;
        } finally {
          loadPromise = null;
        }
      },
      run: function () {
        if (!core) {
          return Promise.reject(new Error("ffmpeg is not loaded, call await ffmpeg.load() first"));
        }
        return core.exec(Array.prototype.slice.call(arguments));
      },
      FS: function (method) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (!core) {
          throw new Error("ffmpeg is not loaded, call await ffmpeg.load() first");
        }
        if (method === "writeFile") {
          return core.writeFile(args[0], args[1]);
        }
        if (method === "readFile") {
          return core.readFile(args[0]);
        }
        if (method === "unlink") {
          return core.deleteFile(args[0]);
        }
        throw new Error("Unsupported FS method: " + method);
      },
      exit: function () {
        if (core) {
          core.terminate();
          core = null;
          loaded = false;
        }
      }
    };
  }

  window.FFmpeg = {
    createFFmpeg: createFFmpeg,
    fetchFile: fetchFile
  };
})();
