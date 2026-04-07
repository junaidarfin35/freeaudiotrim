import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0";

let transcriber = null;
let isLoading = false;
let isBusy = false;
let translationModel = null;

async function loadModel() {
  if (transcriber) return transcriber;

  if (isLoading) {
    while (isLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return transcriber;
  }

  isLoading = true;

  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-large-v3-turbo",
      {
        device: "auto",
        dtype: "q4",
        use_external_data_format: true
      }
    );

    postMessage({ type: "ready" });
  } catch (err) {
    transcriber = null;
    postMessage({ type: "error", message: "Model load failed" });
    throw err;
  } finally {
    isLoading = false;
  }

  return transcriber;
}

async function loadTranslationModel() {
  if (!translationModel) {
    translationModel = await pipeline(
      "translation",
      "Xenova/nllb-200-distilled-600M"
    );
  }

  return translationModel;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function applyTerminologyHints(text) {
  return String(text || "")
    .replace(/\bthrottle\b/gi, "accelerator pedal")
    .replace(/\bbrake\b/gi, "brake pedal");
}

function improveSpeechStructure(text) {
  return String(text || "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?\u061F])\s+/)
    .filter(Boolean);
}

function buildChunks(sentences, maxLength = 300) {
  const chunks = [];
  let current = "";

  for (let i = 0; i < sentences.length; i++) {
    const sentence = (sentences[i] || "").trim();
    if (!sentence) continue;

    if (current.length + sentence.length > maxLength) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }

  if (current) chunks.push(current.trim());

  return chunks;
}

function cleanTranslation(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s([.,!?])/g, "$1")
    .replace(/(\b\w+\b)( \1\b)+/gi, "$1")
    .trim();
}

function smoothWithContext(prev, curr) {
  if (!prev || !curr) return curr;

  const prevWords = prev.split(" ");
  const overlap = prevWords.slice(0, 2).join(" ");

  if (overlap && curr.startsWith(overlap)) {
    const trimmed = curr.slice(overlap.length).trim();

    if (trimmed.length > 5) {
      return trimmed;
    }
  }

  return curr;
}

function polishEnglish(text) {
  if (!text) return "";

  let value = text;

  value = value.replace(/\bthe most important thing is that\b/gi, "");
  value = value.replace(/\bfor you\b/gi, "");
  value = value.replace(/\bwhich is\b/gi, "that is");
  value = value.replace(/\bis here to\b/gi, "is here to help");
  value = value.replace(/\banswer all your questions\b/gi, "answer your questions");
  value = value.replace(/\b(\w+)( \1\b)+/gi, "$1");
  value = value.replace(/\s+/g, " ").trim();

  if (!value) {
    return "";
  }

  value = value.charAt(0).toUpperCase() + value.slice(1);

  if (!/[.!?]$/.test(value)) {
    value += ".";
  }

  return value;
}

async function handleTranscription(audioBuffer, selectedLanguage) {
  if (!audioBuffer) {
    throw new Error("Missing audio data");
  }

  const audio = new Float32Array(audioBuffer);

  if (!audio.length) {
    throw new Error("Missing audio data");
  }

  postMessage({ type: "loading" });

  const model = await loadModel();

  postMessage({ type: "progress", value: 10, current: 10, total: 100 });

  const sampleRate = 16000;
  const maxSinglePass = sampleRate * 30; // 30 sec
  const chunkSize = sampleRate * 25; // ✅ ALWAYS defined

  let chunks = [];

  if (audio.length <= maxSinglePass) {
  // 🚀 SINGLE PASS (NO CHUNKING)
  chunks = [audio];
  } else {
  // normal chunking
  for (let i = 0; i < audio.length; i += chunkSize) {
    chunks.push(audio.slice(i, i + chunkSize));
  }
  }

  let fullText = "";
  let fullChunks = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const offset = (i * chunkSize) / sampleRate;
    const progress = Math.max(10, Math.round((i / chunks.length) * 100));

    postMessage({ type: "progress", value: progress, current: progress, total: 100 });

    let options = {
      chunk_length_s: 25,
      stride_length_s: 2,
      return_timestamps: "segment",
      task: "transcribe",
      condition_on_previous_text: false,
      temperature: 0
    };

    if (selectedLanguage !== "auto") {
      options.language = selectedLanguage;
    }

    console.log("FINAL OPTIONS:", options);

    const result = await model(chunk, options);

    if (result && result.text) {
      fullText += (fullText ? " " : "") + normalizeText(result.text);
    }

    if (result && Array.isArray(result.chunks)) {

      result.chunks.forEach(chunkResult => {
        fullChunks.push({
          text: normalizeText(chunkResult.text),
          timestamp: [
            (chunkResult.timestamp?.[0] || 0) + offset,
            (chunkResult.timestamp?.[1] || 0) + offset
          ]
        });
      });
    }
  }

  postMessage({ type: "progress", value: 100, current: 100, total: 100 });
  postMessage({
    type: "result",
    text: fullText.trim(),
    segments: fullChunks
  });
}

async function handleTranslation(data) {
  data.mode = "full";
  const model = await loadTranslationModel();
  let preparedText = improveSpeechStructure(data.text);
  preparedText = normalizeText(preparedText);

  const sentences = splitSentences(preparedText);
  const chunkSize = data.mode === "improved" ? 200 : 300;
  const chunks = buildChunks(sentences, chunkSize);
  const results = [];

  if (!chunks.length) {
    throw new Error("Translation could not be completed. Try a shorter or clearer input.");
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];

    if (!chunk || !chunk.trim()) {
      continue;
    }

    const output = await model(chunk, {
      src_lang: data.sourceLang,
      tgt_lang: data.targetLang
    });

    results.push(output && output[0] ? output[0].translation_text : "");

    postMessage({
      type: "translation_progress",
      progress: Math.round(((i + 1) / chunks.length) * 100)
    });
  }

  postMessage({
    type: "translation_result",
    text: cleanTranslation(results.join(" "))
  });
}

async function handleSubtitleTranslation(data) {
  data.mode = "subtitle";
  const texts = Array.isArray(data.texts) ? data.texts : [];

  if (false && data.useWhisperTranslate) {
    // Use Whisper translation
    const audioBuffer = data.audio;
    if (!audioBuffer) {
      postMessage({
        type: "translation_result",
        texts: texts
      });
      return;
    }

    const audio = new Float32Array(audioBuffer);
    if (!audio.length) {
      postMessage({
        type: "translation_result",
        texts: texts
      });
      return;
    }

    postMessage({ type: "loading" });
    const model = await loadModel();
    const sampleRate = 16000;
    const chunkSize = sampleRate * 25;
    const chunks = [];

    for (let i = 0; i < audio.length; i += chunkSize) {
      chunks.push(audio.slice(i, i + chunkSize));
    }

    let fullText = "";
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const progress = Math.max(10, Math.round((i / chunks.length) * 100));
      postMessage({ type: "progress", value: progress, current: progress, total: 100 });

      const result = await model(chunk, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        task: "translate"
      });

      if (result && result.text) {
        fullText += (fullText ? " " : "") + normalizeText(result.text);
      }
    }

    const translatedTexts = fullText ? fullText.split(/\r?\n/) : texts;
    postMessage({
      type: "translation_result",
      texts: translatedTexts
    });
  } else {
    const model = await loadTranslationModel();
    const translatedTexts = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      try {
        const result = await model(text, {
          src_lang: data.sourceLang,
          tgt_lang: data.targetLang
        });

        const outputText = result && result[0]
          ? normalizeText(result[0].translation_text)
          : "";

        let refined = cleanTranslation(outputText);
        const prev = translatedTexts[translatedTexts.length - 1] || "";
        refined = smoothWithContext(prev, refined);

        translatedTexts.push(refined);

      } catch (err) {
        translatedTexts.push(text);
      }

      postMessage({
        type: "translation_progress",
        progress: Math.round(((i + 1) / texts.length) * 100)
      });
    }

    postMessage({
      type: "translation_result",
      texts: translatedTexts
    });
  }
}

self.onmessage = async (e) => {
  const data = e.data || {};
  const requestType = data.type;

  if (isBusy) {
    postMessage({
      type: requestType === "transcribe" ? "error" : "translation_error",
      message: "Worker is busy"
    });
    return;
  }

  isBusy = true;

  try {
    if (requestType === "transcribe") {
      await handleTranscription(data.audio, data.selectedLanguage);
      return;
    }

    if (requestType === "translate") {
      await handleTranslation(data);
      return;
    }

    if (requestType === "translate_subtitles") {
      await handleSubtitleTranslation(data);
      return;
    }

    throw new Error("Unsupported worker message");
  } catch (err) {
    postMessage({
      type: requestType === "transcribe" ? "error" : "translation_error",
      message: err && err.message ? err.message : "Worker request failed"
    });
  } finally {
    isBusy = false;
  }
};
