import { pipeline } from "./transformers.min.js";
let models = {};
let translationModel = null;

async function loadModel(mode) {
  const modelName = mode === "accurate"
    ? "Xenova/whisper-small"
    : "Xenova/whisper-base";

  if (!models[modelName]) {
    models[modelName] = await pipeline(
      "automatic-speech-recognition",
      modelName
    );
  }

  return models[modelName];
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([.؟!])\s*/g, "$1 ")
    .trim();
}

function improveSpeechStructure(text) {
  return String(text || "")
    .replace(/\n+/g, ". ")
    .replace(/ و/g, ". و")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "").split(/(?<=[.؟!])\s+/);
}

function buildChunks(sentences, maxLength = 300) {
  const chunks = [];
  let current = "";

  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = String(sentences[i] || "").trim();

    if (!sentence) {
      continue;
    }

    if ((current + sentence).length > maxLength) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function cleanTranslation(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s([.,!?])/g, "$1")
    .trim();
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

self.onmessage = async (e) => {
  const { type, audio, mode, text, sourceLang, targetLang } = e.data;

  if (type === "transcribe") {
    try {
      if (mode === "accurate" && audio.duration > 180) {
        throw new Error("Accurate mode supports shorter audio (under 3 minutes)");
      }

      const model = await loadModel(mode);
      const audioArray = new Float32Array(audio.buffer);

      if (!(audioArray instanceof Float32Array)) {
        throw new Error("Invalid audio data format");
      }

      const result = await model(audioArray, {
        sampling_rate: audio.sampleRate,
        return_timestamps: true
      });

      self.postMessage({
        type: "result",
        text: result.text,
        segments: result.chunks || []
      });
    } catch (err) {
      console.error("Worker error:", err);

      let message = err && err.message ? err.message : "Transcription failed";
      if (/bad_alloc|OrtRun\(\)|error code = 6/i.test(message)) {
        message = mode === "accurate"
          ? "Accurate mode needs more memory on this device. Try Fast mode or a shorter file."
          : "This file needs more memory to process. Try a shorter file.";
      }

      self.postMessage({
        type: "error",
        message: message
      });
    }
  }

  if (type === "translate") {
    try {
      const model = await loadTranslationModel();

      let preparedText = improveSpeechStructure(text);
      preparedText = normalizeText(preparedText);

      const sentences = splitSentences(preparedText);
      const chunkSize = mode === "improved" ? 200 : 300;
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
          src_lang: sourceLang,
          tgt_lang: targetLang
        });

        results.push(output && output[0] ? output[0].translation_text : "");

        self.postMessage({
          type: "translation_progress",
          progress: Math.round(((i + 1) / chunks.length) * 100)
        });
      }

      let finalText = results.join(" ");
      finalText = cleanTranslation(finalText);

      self.postMessage({
        type: "translation_result",
        text: finalText
      });
    } catch (err) {
      console.error("Translation worker error:", err);

      self.postMessage({
        type: "translation_error",
        message: err && err.message ? err.message : "Translation failed"
      });
    }
  }

  if (type === "translate_subtitles") {
    try {
      const { texts, sourceLang, targetLang } = e.data;
      const model = await loadTranslationModel();
      const translatedTexts = [];

      for (let i = 0; i < texts.length; i += 1) {
        const text = texts[i];

        if (!text || !text.trim()) {
          translatedTexts.push("");
          continue;
        }

        let preparedText = improveSpeechStructure(text);
        preparedText = normalizeText(preparedText);

        const output = await model(preparedText, {
          src_lang: sourceLang,
          tgt_lang: targetLang
        });

        const translated = output && output[0] ? output[0].translation_text : "";
        translatedTexts.push(cleanTranslation(translated));

        self.postMessage({
          type: "translation_progress",
          progress: Math.round(((i + 1) / texts.length) * 100)
        });
      }

      self.postMessage({
        type: "translation_result",
        texts: translatedTexts
      });
    } catch (err) {
      console.error("Translation worker error:", err);

      self.postMessage({
        type: "translation_error",
        message: err && err.message ? err.message : "Translation failed"
      });
    }
  }
};
