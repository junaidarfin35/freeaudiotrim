// Small helpers: read file and convert AudioBuffer -> WAV
  const fileInput = document.getElementById('fileInput');
  const convertBtn = document.getElementById('convertBtn');
  const downloadLink = document.getElementById('downloadLink');
  const status = document.getElementById('status');

  const readFileAsArrayBuffer = (file) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file);
  });

  function interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0, inputIndex = 0;
    while (index < length) {
      result[index++] = inputL[inputIndex];
      result[index++] = inputR[inputIndex];
      inputIndex++;
    }
    return result;
  }

  function encodeWAV(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    let samples;
    if (numChannels === 2) {
      samples = interleave(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1));
    } else {
      samples = audioBuffer.getChannelData(0);
    }
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    function writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + samples.length * 2, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // PCM chunk size
    view.setUint16(offset, 1, true); offset += 2; // PCM format
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * 2, true); offset += 4;
    view.setUint16(offset, numChannels * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, samples.length * 2, true); offset += 4;

    // PCM samples
    let pos = 44;
    for (let i = 0; i < samples.length; i++, pos += 2) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(pos, s < 0  s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  convertBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) { status.textContent = 'Choose a file first.'; return; }
    status.textContent = 'Decoding...';
    try {
      const arrayBuffer = await readFileAsArrayBuffer(file);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      status.textContent = 'Encoding WAV...';
      const wavBlob = encodeWAV(audioBuffer);
      const url = URL.createObjectURL(wavBlob);
      downloadLink.href = url;
      downloadLink.download = (file.name.replace(/\.[^/.]+$/, '') || 'output') + '.wav';
      downloadLink.style.display = 'inline-block';
      status.textContent = 'Ready - click Download WAV.';
    } catch (err) {
      console.error(err);
      status.textContent = 'Error decoding file. Your browser may not support this file type.';
    }
  });

