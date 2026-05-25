const SUPPORT_COPY = "Common containers such as MP4, MOV, M4V, WebM, MKV, AVI, MPEG, MPG, 3GP, 3G2, TS, M2TS, MTS, WMV, ASF, MXF, OGV, FLV, F4V, and VOB are supported when they contain an audio track.";
const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".ogv",
  ".mpeg",
  ".mpg",
  ".3gp",
  ".3g2",
  ".ts",
  ".m2ts",
  ".mts",
  ".wmv",
  ".asf",
  ".mxf",
  ".flv",
  ".f4v",
  ".vob"
]);
const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/ogg",
  "video/mpeg",
  "video/3gpp",
  "video/3gpp2",
  "video/mp2t",
  "video/x-ms-wmv",
  "video/x-ms-asf",
  "video/x-flv",
  "application/mxf"
]);
const SUPPORTED_VIDEO_ACCEPT = [
  ...SUPPORTED_VIDEO_EXTENSIONS,
  ...SUPPORTED_VIDEO_MIME_TYPES,
  "video/*"
].join(",");
const UNSUPPORTED_VIDEO_MESSAGE = "This file type is not supported yet. " + SUPPORT_COPY;
const EXTRACT_BUTTON_LABEL = "Extract Audio";
const DOWNLOAD_BUTTON_LABEL = "Download WAV";
const EXTRACTING_BUTTON_LABEL = "Extracting Audio...";

const state = {
  selectedFile: null,
  ffmpeg: null,
  ffmpegLoaded: false,
  ffmpegLoadingPromise: null,
  outputUrl: "",
  extracting: false
};

const extractBtn = document.getElementById("extractBtn");
const downloadLink = document.getElementById("downloadLink");
const status = document.getElementById("status");
const fileRow = document.querySelector('[data-role="fileRow"]');
const fileName = document.querySelector('[data-role="fileName"]');
const fileIcon = document.querySelector('[data-role="fileIcon"]');

if (extractBtn && downloadLink && status) {
  extractBtn.addEventListener("click", function () {
    if (state.outputUrl && downloadLink.href) {
      downloadLink.click();
      return;
    }
    void extractSelectedFile();
  });

  window.addEventListener("beforeunload", function () {
    if (state.ffmpeg && typeof state.ffmpeg.exit === "function") {
      state.ffmpeg.exit();
    }
    revokeOutputUrl();
  });

  window.ExtractAudioFromVideoTool = {
    addFile(file) {
      if (state.extracting) {
        const input = document.getElementById("audioFileInput");
        if (input) {
          input.value = "";
        }
        setStatus("Extraction already running. Wait for it to finish before changing files.", "warning");
        return { accepted: false, reason: "busy" };
      }
      setSelectedFile(file);
      return { accepted: !!state.selectedFile };
    }
  };
  window.AudioToolExtractVideoAccept = SUPPORTED_VIDEO_ACCEPT;
  window.AudioToolValidateExtractVideoFile = function (file) {
    if (isSupportedVideoFile(file)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: UNSUPPORTED_VIDEO_MESSAGE
    };
  };
}

function getFileExtension(fileName) {
  const value = String(fileName || "");
  const lastDot = value.lastIndexOf(".");
  return lastDot >= 0 ? value.slice(lastDot).toLowerCase() : "";
}

function stripExtension(fileName) {
  return String(fileName || "extracted-audio").replace(/\.[^./\\]+$/, "");
}

function sanitizeFsStem(value) {
  return String(value || "video")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "video";
}

function buildTempFileName(prefix, fileName, fallbackExt) {
  const stem = sanitizeFsStem(stripExtension(fileName));
  const extension = getFileExtension(fileName) || fallbackExt;
  return prefix + "-" + stem + "-" + Date.now() + extension;
}

function isSupportedVideoFile(file) {
  if (!file) {
    return false;
  }

  const type = String(file.type || "").toLowerCase();
  const extension = getFileExtension(file.name);

  return type.indexOf("video/") === 0
    || SUPPORTED_VIDEO_MIME_TYPES.has(type)
    || SUPPORTED_VIDEO_EXTENSIONS.has(extension);
}

function revokeOutputUrl() {
  if (state.outputUrl) {
    URL.revokeObjectURL(state.outputUrl);
    state.outputUrl = "";
  }
}

function setStatus(message, nextState) {
  status.textContent = message;
  status.dataset.statusState = nextState || "idle";
}

function syncActionButton() {
  if (!extractBtn) {
    return;
  }

  if (state.extracting) {
    extractBtn.textContent = EXTRACTING_BUTTON_LABEL;
    return;
  }

  extractBtn.textContent = state.outputUrl ? DOWNLOAD_BUTTON_LABEL : EXTRACT_BUTTON_LABEL;
}

function resetDownloadState() {
  revokeOutputUrl();
  downloadLink.removeAttribute("href");
  downloadLink.removeAttribute("download");
  downloadLink.classList.add("is-hidden");
  syncActionButton();
}

function syncFileUi() {
  const hasFile = !!state.selectedFile;

  if (fileRow) {
    fileRow.classList.toggle("is-hidden", !hasFile);
  }

  if (fileName) {
    fileName.textContent = hasFile ? state.selectedFile.name : "";
  }

  if (fileIcon) {
    fileIcon.setAttribute("data-lucide", "video");
  }

  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

function setSelectedFile(file) {
  const supportedFile = isSupportedVideoFile(file) ? file : null;

  state.selectedFile = supportedFile;
  state.extracting = false;
  resetDownloadState();
  syncFileUi();
  syncActionButton();

  extractBtn.classList.remove("is-hidden");
  extractBtn.disabled = !supportedFile;

  if (!file) {
    setStatus("Ready to extract.", "idle");
    return;
  }

  if (!supportedFile) {
    setStatus(UNSUPPORTED_VIDEO_MESSAGE, "error");
    return;
  }

  setStatus("Video ready. Extract audio when you are ready.", "success");
}

async function ensureFFmpegReady() {
  if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== "function") {
    throw new Error("FFMPEG_UNAVAILABLE");
  }

  if (!state.ffmpeg) {
    state.ffmpeg = window.FFmpeg.createFFmpeg();
  }

  if (state.ffmpegLoaded) {
    return state.ffmpeg;
  }

  if (!state.ffmpegLoadingPromise) {
    state.ffmpegLoadingPromise = (async function () {
      await state.ffmpeg.load();
      state.ffmpegLoaded = true;
      return state.ffmpeg;
    })();
  }

  try {
    return await state.ffmpegLoadingPromise;
  } finally {
    state.ffmpegLoadingPromise = null;
  }
}

function buildExtractionErrorMessage(file, error) {
  if (!file || !isSupportedVideoFile(file)) {
    return UNSUPPORTED_VIDEO_MESSAGE;
  }

  if (error && error.message === "FFMPEG_UNAVAILABLE") {
    return "The in-browser extractor could not be loaded right now. Refresh the page and try again.";
  }

  return "We could not extract audio from this file in the browser. Make sure the video contains an audio track, or try re-saving/exporting it and then upload it again.";
}

async function safeDelete(ffmpeg, fileName) {
  if (!ffmpeg || !fileName) {
    return;
  }

  try {
    await ffmpeg.FS("unlink", fileName);
  } catch (error) {
  }
}

async function extractSelectedFile() {
  const file = state.selectedFile;

  if (state.extracting) {
    return;
  }

  if (!file) {
    setStatus("Choose a video file first.", "warning");
    return;
  }

  if (!isSupportedVideoFile(file)) {
    setStatus(UNSUPPORTED_VIDEO_MESSAGE, "error");
    return;
  }

  state.extracting = true;
  extractBtn.disabled = true;
  resetDownloadState();
  syncActionButton();
  setStatus("Preparing the browser extractor...", "processing");

  let ffmpeg;
  let inputName = "";
  let outputName = "";

  try {
    ffmpeg = await ensureFFmpegReady();

    inputName = buildTempFileName("input", file.name, ".bin");
    outputName = buildTempFileName("output", stripExtension(file.name) + ".wav", ".wav");

    setStatus("Loading your video into the extractor...", "processing");
    await ffmpeg.FS("writeFile", inputName, await window.FFmpeg.fetchFile(file));

    setStatus("Extracting the audio track...", "processing");
    const exitCode = await ffmpeg.run(
      "-i",
      inputName,
      "-vn",
      "-map",
      "0:a:0",
      "-c:a",
      "pcm_s16le",
      outputName
    );

    if (exitCode !== 0) {
      throw new Error("FFMPEG_EXIT_" + exitCode);
    }

    const wavData = await ffmpeg.FS("readFile", outputName);
    const wavBlob = new Blob([wavData.buffer.slice(wavData.byteOffset, wavData.byteOffset + wavData.byteLength)], {
      type: "audio/wav"
    });

    revokeOutputUrl();
    state.outputUrl = URL.createObjectURL(wavBlob);

    downloadLink.href = state.outputUrl;
    downloadLink.download = stripExtension(file.name) + ".wav";

    setStatus("Audio extracted successfully. Download your WAV file when ready.", "ready");
  } catch (error) {
    console.error(error);
    setStatus(buildExtractionErrorMessage(file, error), "error");
  } finally {
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
    state.extracting = false;
    extractBtn.disabled = !state.selectedFile;
    syncActionButton();
  }
}
