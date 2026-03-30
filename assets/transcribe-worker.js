import { pipeline } from "./transformers.min.js";
let model = null;

async function loadModel() {
  if (!model) {
    model = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-base"
    );
  }
  return model;
}

self.onmessage = async (e) => {
  const { type, audio } = e.data;

  if (type === "transcribe") {
    try {
      const model = await loadModel();
      const audioArray = new Float32Array(audio.data);

      if (!(audioArray instanceof Float32Array)) {
        throw new Error("Invalid audio data format");
      }

      const result = await model(audioArray, {
        sampling_rate: audio.sampleRate
      });

      self.postMessage({
        type: "result",
        text: result.text
      });
    } catch (err) {
      console.error("Worker error:", err);

      self.postMessage({
        type: "error",
        message: err.message
      });
    }
  }
};
