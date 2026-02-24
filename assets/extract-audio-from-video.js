const readFile = f => new Promise((r,rej)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=rej;fr.readAsArrayBuffer(f)});
function encodeWAV(audioBuffer){const numChannels=audioBuffer.numberOfChannels;const sampleRate=audioBuffer.sampleRate;let samples; if(numChannels===2){const l=audioBuffer.getChannelData(0), r=audioBuffer.getChannelData(1);samples=new Float32Array(l.length*2);for(let i=0;i<l.length;i++){samples[2*i]=l[i];samples[2*i+1]=r[i];}}else{samples=audioBuffer.getChannelData(0);}const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);function writeStr(o,s){for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))}let offset=0;writeStr(offset,'RIFF');offset+=4;view.setUint32(offset,36+samples.length*2,true);offset+=4;writeStr(offset,'WAVE');offset+=4;writeStr(offset,'fmt ');offset+=4;view.setUint32(offset,16,true);offset+=4;view.setUint16(offset,1,true);offset+=2;view.setUint16(offset,numChannels,true);offset+=2;view.setUint32(offset,sampleRate,true);offset+=4;view.setUint32(offset,sampleRate*numChannels*2,true);offset+=4;view.setUint16(offset,numChannels*2,true);offset+=2;view.setUint16(offset,16,true);offset+=2;writeStr(offset,'data');offset+=4;view.setUint32(offset,samples.length*2,true);offset+=4;let pos=44;for(let i=0;i<samples.length;i++,pos+=2){let s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(pos,s<0?s*0x8000:s*0x7FFF,true);}return new Blob([view],{type:'audio/wav'});} 

const fileInput=document.getElementById('fileInput'), extractBtn=document.getElementById('extractBtn'), downloadLink=document.getElementById('downloadLink'), status=document.getElementById('status');
extractBtn.addEventListener('click', async () => {
  const f = fileInput.files[0];

  if (!f) {
    status.textContent = 'Choose a video file';
    return;
  }

  status.textContent = 'Reading file...';

  try {
    const ab = await readFile(f);

    const ac = new (window.AudioContext || window.webkitAudioContext)();

    status.textContent = 'Decoding audio track...';

    const decoded = await ac.decodeAudioData(ab);

    status.textContent = 'Encoding WAV...';

    const wavBlob = encodeWAV(decoded);

    const url = URL.createObjectURL(wavBlob);

    downloadLink.href = url;
    downloadLink.download =
      (f.name.replace(/\.[^/.]+$/, '') || 'extracted') + '.wav';

    downloadLink.style.display = 'inline-block';

    status.textContent = 'Ready — download extracted audio.';

    ac.close();

  } catch (e) {
    console.error(e);

    status.textContent =
      'This video format is not supported by your browser. Please export as MP4 (H.264) and try again.';
  }
});

