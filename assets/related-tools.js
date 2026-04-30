document.addEventListener("DOMContentLoaded", () => {
  const section = document.querySelector(".related-tools");
  if (!section) return;

  const toolMeta = {
    "audio-cutter-online.html": {
      name: "Audio Cutter",
      description: "Trim audio with precise waveform controls"
    },
    "free-mp3-cutter.html": {
      name: "MP3 Cutter",
      description: "Trim MP3 files quickly in your browser"
    },
    "merge-audio-files.html": {
      name: "Merge Audio Files",
      description: "Combine multiple audio tracks into one"
    },
    "remove-silence-from-audio.html": {
      name: "Remove Silence",
      description: "Automatically clean silent gaps"
    },
    "normalize-audio-volume.html": {
      name: "Normalize Audio",
      description: "Balance volume levels instantly"
    },
    "audio-converter.html": {
      name: "Audio Converter",
      description: "Convert audio formats online"
    },
    "extract-audio-from-video.html": {
      name: "Extract Audio",
      description: "Pull audio tracks out of video files"
    },
    "convert-mp3-to-wav.html": {
      name: "MP3 to WAV",
      description: "Convert MP3 files into WAV format"
    },
    "mp3-to-m4r.html": {
      name: "MP3 to M4R",
      description: "Convert MP3 into iPhone ringtone format"
    },
    "audio-speed-changer.html": {
      name: "Speed Changer",
      description: "Speed up or slow down audio"
    },
    "audio-pitch-changer.html": {
      name: "Pitch Changer",
      description: "Raise or lower pitch without changing length"
    },
    "ringtone-maker.html": {
      name: "Ringtone Maker",
      description: "Trim audio into ringtone-ready clips"
    },
    "audio-video-transcription-online.html": {
      name: "Audio Transcription",
      description: "Convert speech into text automatically"
    }
  };
  const allToolPages = Object.keys(toolMeta);
  const pageConfigs = {
    "index.html": {
      primary: [
        "audio-cutter-online.html",
        "audio-converter.html",
        "audio-video-transcription-online.html"
      ]
    },
    "audio-cutter-online.html": {
      primary: [
        "free-mp3-cutter.html",
        "ringtone-maker.html",
        "audio-converter.html"
      ]
    },
    "free-mp3-cutter.html": {
      primary: [
        "audio-cutter-online.html",
        "ringtone-maker.html",
        "audio-converter.html"
      ]
    },
    "ringtone-maker.html": {
      primary: [
        "audio-cutter-online.html",
        "free-mp3-cutter.html",
        "mp3-to-m4r.html"
      ]
    },
    "audio-converter.html": {
      primary: [
        "convert-mp3-to-wav.html",
        "mp3-to-m4r.html",
        "extract-audio-from-video.html"
      ]
    },
    "convert-mp3-to-wav.html": {
      primary: [
        "audio-converter.html",
        "extract-audio-from-video.html",
        "mp3-to-m4r.html"
      ]
    },
    "extract-audio-from-video.html": {
      primary: [
        "audio-video-transcription-online.html",
        "audio-converter.html",
        "convert-mp3-to-wav.html"
      ]
    },
    "audio-video-transcription-online.html": {
      primary: [
        "extract-audio-from-video.html",
        "remove-silence-from-audio.html",
        "audio-cutter-online.html"
      ]
    },
    "audio-pitch-changer.html": {
      primary: [
        "audio-speed-changer.html",
        "normalize-audio-volume.html",
        "audio-cutter-online.html"
      ]
    },
    "audio-speed-changer.html": {
      primary: [
        "audio-pitch-changer.html",
        "normalize-audio-volume.html",
        "audio-cutter-online.html"
      ]
    },
    "merge-audio-files.html": {
      primary: [
        "remove-silence-from-audio.html",
        "normalize-audio-volume.html",
        "audio-cutter-online.html"
      ]
    },
    "normalize-audio-volume.html": {
      primary: [
        "remove-silence-from-audio.html",
        "audio-speed-changer.html",
        "merge-audio-files.html"
      ]
    },
    "remove-silence-from-audio.html": {
      primary: [
        "normalize-audio-volume.html",
        "merge-audio-files.html",
        "audio-cutter-online.html"
      ]
    },
    "mp3-to-m4r.html": {
      primary: [
        "ringtone-maker.html",
        "audio-converter.html",
        "convert-mp3-to-wav.html"
      ]
    }
  };

  const currentPage = (() => {
    const name = window.location.pathname.split("/").pop();
    return name && name.endsWith(".html") ? name : "index.html";
  })();

  const buildFallbackPills = (primary) =>
    allToolPages.filter(
      (page) => page !== currentPage && !primary.includes(page)
    );

  const render = (config) => {
    const primary = (config.primary || [])
      .filter((page) => page !== currentPage && toolMeta[page]);
    const pills = ((config.pills && config.pills.length
      ? config.pills
      : buildFallbackPills(primary)) || [])
      .filter((page) => page !== currentPage && toolMeta[page]);

    if (!primary.length && !pills.length) return;

    const primaryHtml = primary
      .map((page) => {
        const tool = toolMeta[page];
        return `
    <a href="/${page}" class="tool-link">
      <strong>${tool.name}</strong>
      <span>${tool.description}</span>
    </a>`;
      })
      .join("");

    const pillsHtml = pills
      .map((page) => {
        const tool = toolMeta[page];
        return `<a href="/${page}" class="tool-pill">${tool.name}</a>`;
      })
      .join("");

    section.innerHTML = `
  <h2>Explore Audio Tools</h2>
  <h3>Go beyond one task - trim, convert, enhance, and process your audio files with our free online tools.</h3>
  <div class="tool-links-grid">
    ${primaryHtml}
  </div>
  <h3 class="tool-pills-label">More tools</h3>
  <div class="tool-pills">
    ${pillsHtml}
  </div>
`;
  };

  const fallbackPrimary = allToolPages
    .filter((page) => page !== currentPage)
    .slice(0, 3);
  const pageConfig = pageConfigs[currentPage] || {
    primary: fallbackPrimary
  };

  render(pageConfig);
});
