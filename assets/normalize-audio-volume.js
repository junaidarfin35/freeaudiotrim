const readFile = file => new Promise((r,rej)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=rej;fr.readAsArrayBuffer(file)});
const fileInput=document.getElementById('fileInput'), normalizeBtn=document.getElementById('normalizeBtn'), downloadLink=document.getElementById('downloadLink'), targetDb=document.getElementById('targetDb'), status=document.getElementById('status');
function encodeWAV(audioBuffer){const numChannels=audioBuffer.numberOfChannels;const sampleRate=audioBuffer.sampleRate;const frameCount=audioBuffer.length;const samples=new Float32Array(frameCount*numChannels);for(let i=0;i<frameCount;i++){for(let ch=0;ch<numChannels;ch++){samples[i*numChannels+ch]=audioBuffer.getChannelData(ch)[i];}}const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);function writeStr(o,s){for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));}
let offset=0;writeStr(offset,'RIFF');offset+=4;view.setUint32(offset,36+samples.length*2,true);offset+=4;writeStr(offset,'WAVE');offset+=4;writeStr(offset,'fmt ');offset+=4;view.setUint32(offset,16,true);offset+=4;view.setUint16(offset,1,true);offset+=2;view.setUint16(offset,numChannels,true);offset+=2;view.setUint32(offset,sampleRate,true);offset+=4;view.setUint32(offset,sampleRate*numChannels*2,true);offset+=4;view.setUint16(offset,numChannels*2,true);offset+=2;view.setUint16(offset,16,true);offset+=2;writeStr(offset,'data');offset+=4;view.setUint32(offset,samples.length*2,true);offset+=4;let pos=44;for(let i=0;i<samples.length;i++,pos+=2){let s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(pos,s<0?s*0x8000:s*0x7FFF,true);}return new Blob([view.buffer],{type:'audio/wav'});} normalizeBtn.addEventListener('click',async()=>{
  const file=fileInput.files[0]; if(!file){status.textContent='Choose a file';return}
  status.textContent='Decoding...'; try{
    const buf=await readFile(file);const ac=new (window.AudioContext||window.webkitAudioContext)();const ab=await ac.decodeAudioData(buf);
    // compute peak
    let peak=0; for(let c=0;c<ab.numberOfChannels;c++){const data=ab.getChannelData(c);for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));}}
    const peakDb=20*Math.log10(peak||1e-8); const target=parseFloat(targetDb.value); const gainDb=target-peakDb; const gain=Math.pow(10,gainDb/20);
    status.textContent='Applying gain...';
    // apply gain to copies
    const out= new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(ab.numberOfChannels,ab.length,ab.sampleRate);
    const src=out.createBufferSource(); src.buffer=ab; const gainNode=out.createGain(); gainNode.gain.value=gain; src.connect(gainNode); gainNode.connect(out.destination); src.start(0);
    const rendered=await out.startRendering();
    const wav=encodeWAV(rendered); const url=URL.createObjectURL(wav); downloadLink.href=url; downloadLink.download=(file.name.replace(/\.[^/.]+$/,'')||'normalized')+'.wav'; downloadLink.style.display='inline-block'; status.textContent='Ready - download the normalized WAV.';
  }catch(e){console.error(e);status.textContent='Error processing file.'}
});

