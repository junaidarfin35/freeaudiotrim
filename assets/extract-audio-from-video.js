const BROWSER_SUPPORT_MESSAGE = 'Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.';
const readFile = f => new Promise((r,rej)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=rej;fr.readAsArrayBuffer(f)});
function encodeWAV(audioBuffer){const numChannels=audioBuffer.numberOfChannels;const sampleRate=audioBuffer.sampleRate;let samples; if(numChannels===2){const l=audioBuffer.getChannelData(0), r=audioBuffer.getChannelData(1);samples=new Float32Array(l.length*2);for(let i=0;i<l.length;i++){samples[2*i]=l[i];samples[2*i+1]=r[i];}}else{samples=audioBuffer.getChannelData(0);}const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);function writeStr(o,s){for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))}let offset=0;writeStr(offset,'RIFF');offset+=4;view.setUint32(offset,36+samples.length*2,true);offset+=4;writeStr(offset,'WAVE');offset+=4;writeStr(offset,'fmt ');offset+=4;view.setUint32(offset,16,true);offset+=4;view.setUint16(offset,1,true);offset+=2;view.setUint16(offset,numChannels,true);offset+=2;view.setUint32(offset,sampleRate,true);offset+=4;view.setUint32(offset,sampleRate*numChannels*2,true);offset+=4;view.setUint16(offset,numChannels*2,true);offset+=2;view.setUint16(offset,16,true);offset+=2;writeStr(offset,'data');offset+=4;view.setUint32(offset,samples.length*2,true);offset+=4;let pos=44;for(let i=0;i<samples.length;i++,pos+=2){let s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(pos,s<0?s*0x8000:s*0x7FFF,true);}return new Blob([view],{type:'audio/wav'});} 

const fileInput=document.getElementById('fileInput'), extractBtn=document.getElementById('extractBtn'), downloadLink=document.getElementById('downloadLink'), status=document.getElementById('status');
const setStatus=message=>{status.textContent=message;const text=String(message||'').toLowerCase();status.dataset.statusState=/error|failed|not supported/.test(text)?'error':/ready|download/.test(text)?'success':/decoding|encoding|reading|extract/.test(text)?'processing':'idle';};
extractBtn.addEventListener('click', async () => {
  const f = fileInput.files[0];

  if (!f) {
    setStatus('Choose a video file');
    return;
  }

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
    downloadLink.download =
      (f.name.replace(/\.[^/.]+$/, '') || 'extracted') + '.wav';

    downloadLink.style.display = 'inline-block';

    setStatus('Ready - download extracted audio.');

    ac.close();

  } catch (e) {
    console.error(e);

    setStatus((f.type || '').startsWith('video/')
      ? 'This video format is not supported by your browser. Please export as MP4 (H.264) and try again.'
      : 'This audio format is not supported by your browser. ' + BROWSER_SUPPORT_MESSAGE);
  }
});

