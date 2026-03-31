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
  console.log("Worker raw data:", e.data);

  const data = e.data;

  const type = data.type;
  console.log("Worker e.data.audio exists:", !!e.data.audio);
  const audio = new Float32Array(e.data.audio);
  if (!audio || audio.length === 0) {
  console.error("Audio is missing in worker");
  return;
}
  console.log("Worker received audio length:", audio.length);
  const mode = data.mode;
  const text = data.text;
  const sourceLang = data.sourceLang;
  const targetLang = data.targetLang;

  if (type === "transcribe") {
    const audio = new Float32Array(data.audio);

    if (!audio || audio.length === 0) {
      console.error("Audio is missing in worker");
      return;
    }

    console.log("Worker received audio length:", audio.length);
    console.log("Worker duration (sec):", audio.length / 16000);

    try {
      const model = await loadModel(mode);

      if (!(audio instanceof Float32Array)) {
        throw new Error("Invalid audio data format");
      }

console.log("Feeding Whisper audio length:", audio.length);
      const result = await model(audio, {
  return_timestamps: true,
  chunk_length_s: 30,
  stride_length_s: 5
});

      console.log("Whisper result text length:", result.text.length);
      console.log("Segments:", result.chunks?.length);
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

  function reconstructSentence(text) {
    if (!text) return "";
    return text.replace(/\s+/g, " ").trim();
  }

  function normalizeArabic(text) {
    if (!text) return "";
    return text;
  }

  function polishEnglish(text) {
    if (!text) return "";

    let t = text;

    // Fix common awkward phrasing
    t = t.replace(/\bthe most important thing is that\b/gi, "");
    t = t.replace(/\bfor you\b/gi, "");
    t = t.replace(/\bwhich is\b/gi, "that is");

    // Improve natural phrasing
    t = t.replace(/\bis here to\b/gi, "is here to help");
    t = t.replace(/\banswer all your questions\b/gi, "answer your questions");

    // Fix double words
    t = t.replace(/\b(\w+)( \1\b)+/gi, "$1");

    // Clean spacing
    t = t.replace(/\s+/g, " ").trim();

    // Capitalize first letter
    t = t.charAt(0).toUpperCase() + t.slice(1);

    // Ensure ending punctuation
    if (!/[.!?]$/.test(t)) {
      t += ".";
    }

    return t;
  }

  if (type === "translate_subtitles") {
    try {
      const texts = data.texts;
      const model = await loadTranslationModel();
      const translatedTexts = [];

      for (let i = 0; i < texts.length; i += 1) {
        const text = texts[i];

        if (!text || !text.trim()) {
          translatedTexts.push("");
          continue;
        }

        try {
          // STEP 1: RAW → English (semantic extraction)
          const pivot = await model(text, {
            src_lang: sourceLang,
            tgt_lang: "eng_Latn"
          });

          let pivotText = pivot && pivot[0]
            ? pivot[0].translation_text
            : text;

          let finalText = "";

          // STEP 2: If target is English
          if (targetLang === "eng_Latn") {
            finalText = pivotText;
          } else {
            // STEP 3: English → target
            const final = await model(pivotText, {
              src_lang: "eng_Latn",
              tgt_lang: targetLang
            });

            finalText = final && final[0]
              ? final[0].translation_text
              : "";
          }

          let outputText = cleanTranslation(finalText);

          if (targetLang === "eng_Latn") {
            outputText = polishEnglish(outputText);
          }

          translatedTexts.push(outputText);

        } catch (err) {
          console.error("Semantic translation error:", err);
          translatedTexts.push("");
        }

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
