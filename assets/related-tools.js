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

  const scriptNode =
    document.currentScript ||
    Array.from(document.scripts).find((node) =>
      node.src && node.src.includes("related-tools.js")
    );

  const dataUrl = scriptNode?.src
    ? new URL("../related.json", scriptNode.src).href
    : "/related.json";

  const currentPage = (() => {
    const name = window.location.pathname.split("/").pop();
    return name && name.endsWith(".html") ? name : "index.html";
  })();

  const render = (config) => {
    const primary = (config.primary || [])
      .filter((page) => page !== currentPage && toolMeta[page]);
    const pills = (config.pills || [])
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

  fetch(dataUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load related.json (${response.status})`);
      }
      return response.json();
    })
    .then((data) => {
      const pageConfig = data?.pages?.[currentPage];
      if (!pageConfig) return;
      render(pageConfig);
    })
    .catch((error) => {
      console.error("Related tools config error:", error);
    });
});
