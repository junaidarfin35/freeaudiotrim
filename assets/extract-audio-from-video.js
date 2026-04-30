const BROWSER_SUPPORT_MESSAGE = 'Supported video formats depend on your browser. MP4, MOV, M4V, and WEBM work on most devices.';
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.avi', '.ogv', '.mpeg', '.mpg', '.3gp']);
const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/x-m4v',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/ogg',
  'video/mpeg',
  'video/3gpp'
]);

function getFileExtension(fileName) {
  const value = String(fileName || '');
  const lastDot = value.lastIndexOf('.');
  return lastDot >= 0 ? value.slice(lastDot).toLowerCase() : '';
}

function isSupportedVideoFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  const extension = getFileExtension(file.name);
  return type.startsWith('video/') || SUPPORTED_VIDEO_MIME_TYPES.has(type) || SUPPORTED_VIDEO_EXTENSIONS.has(extension);
}

const readFile = f => new Promise((r, rej) => {
  const fr = new FileReader();
  fr.onload = () => r(fr.result);
  fr.onerror = rej;
  fr.readAsArrayBuffer(f);
});

function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  let samples;

  if (numChannels === 2) {
    const l = audioBuffer.getChannelData(0);
    const r = audioBuffer.getChannelData(1);
    samples = new Float32Array(l.length * 2);
    for (let i = 0; i < l.length; i++) {
      samples[2 * i] = l[i];
      samples[2 * i + 1] = r[i];
    }
  } else {
    samples = audioBuffer.getChannelData(0);
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeStr(o, s) {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(o + i, s.charCodeAt(i));
    }
  }

  let offset = 0;
  writeStr(offset, 'RIFF');
  offset += 4;
  view.setUint32(offset, 36 + samples.length * 2, true);
  offset += 4;
  writeStr(offset, 'WAVE');
  offset += 4;
  writeStr(offset, 'fmt ');
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * numChannels * 2, true);
  offset += 4;
  view.setUint16(offset, numChannels * 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeStr(offset, 'data');
  offset += 4;
  view.setUint32(offset, samples.length * 2, true);
  offset += 4;

  let pos = 44;
  for (let i = 0; i < samples.length; i++, pos += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

let selectedFile = null;
const extractBtn = document.getElementById('extractBtn');
const downloadLink = document.getElementById('downloadLink');
const status = document.getElementById('status');
const fileRow = document.querySelector('[data-role="fileRow"]');
const fileName = document.querySelector('[data-role="fileName"]');
const fileIcon = document.querySelector('[data-role="fileIcon"]');

if (!extractBtn || !downloadLink || !status) {
} else {
  const setStatus = message => {
    status.textContent = message;
    const text = String(message || '').toLowerCase();
    status.dataset.statusState = /error|failed|not supported/.test(text)
      ? 'error'
      : /ready|download|selected/.test(text)
        ? 'success'
        : /decoding|encoding|reading|extract/.test(text)
          ? 'processing'
          : 'idle';
  };

  extractBtn.addEventListener('click', async () => {
    const f = selectedFile;

    if (!f) {
      setStatus('Choose a video file');
      return;
    }

    if (!isSupportedVideoFile(f)) {
      setStatus('Only supported video files can be extracted.');
      return;
    }

    extractBtn.disabled = true;
    downloadLink.classList.add('is-hidden');
    setStatus('Reading file...');

    try {
      const ab = await readFile(f);
      const ac = new (window.AudioContext || window.webkitAudioContext)();

      setStatus('Decoding audio track...');

      const decoded = await ac.decodeAudioData(ab);

      setStatus('Encoding WAV...');

      const wavBlob = encodeWAV(decoded);
      const url = URL.createObjectURL(wavBlob);

      downloadLink.href = url;
      downloadLink.download = (f.name.replace(/\.[^/.]+$/, '') || 'extracted') + '.wav';
      downloadLink.classList.remove('is-hidden');
      extractBtn.classList.add('is-hidden');
      extractBtn.disabled = false;

      setStatus('Ready - download extracted audio.');

      ac.close();
    } catch (e) {
      console.error(e);
      extractBtn.disabled = false;
      extractBtn.classList.remove('is-hidden');

      setStatus(isSupportedVideoFile(f)
        ? 'This video format is not supported by your browser. Please export as MP4 (H.264) and try again.'
        : 'Only supported video files can be extracted. ' + BROWSER_SUPPORT_MESSAGE);
    }
  });

  downloadLink.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('converter:empty'));
  });

  window.ExtractAudioFromVideoTool = {
    addFile(file) {
      selectedFile = isSupportedVideoFile(file) ? file : null;
      extractBtn.disabled = !file;
      extractBtn.classList.remove('is-hidden');
      downloadLink.classList.add('is-hidden');
      downloadLink.removeAttribute('href');
      if (fileRow) {
        fileRow.classList.toggle('is-hidden', !selectedFile);
      }
      if (fileName) {
        fileName.textContent = selectedFile ? selectedFile.name : '';
      }
      if (fileIcon) {
        fileIcon.setAttribute('data-lucide', 'video');
      }
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
      extractBtn.disabled = !selectedFile;
      setStatus(selectedFile ? 'Ready to extract as WAV.' : file ? 'Only supported video files can be extracted.' : 'Ready to extract');
    }
  };
}
