const readFile= f => new Promise((r,rej)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=rej;fr.readAsArrayBuffer(f)});
const fileInput=document.getElementById('fileInput'), processBtn=document.getElementById('processBtn'), downloadLink=document.getElementById('downloadLink'), status=document.getElementById('status');
const thresholdEl=document.getElementById('thresholdDb'), minMsEl=document.getElementById('minMs');
function encodeWAV(audioBuffer){const numChannels=audioBuffer.numberOfChannels;const sampleRate=audioBuffer.sampleRate;let samples; if(numChannels===2){const l=audioBuffer.getChannelData(0), r=audioBuffer.getChannelData(1);samples=new Float32Array(l.length*2);for(let i=0;i<l.length;i++){samples[2*i]=l[i];samples[2*i+1]=r[i];}}else{samples=audioBuffer.getChannelData(0);}const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);function writeStr(o,s){for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))}let offset=0;writeStr(offset,'RIFF');offset+=4;view.setUint32(offset,36+samples.length*2,true);offset+=4;writeStr(offset,'WAVE');offset+=4;writeStr(offset,'fmt ');offset+=4;view.setUint32(offset,16,true);offset+=4;view.setUint16(offset,1,true);offset+=2;view.setUint16(offset,numChannels,true);offset+=2;view.setUint32(offset,sampleRate,true);offset+=4;view.setUint32(offset,sampleRate*numChannels*2,true);offset+=4;view.setUint16(offset,numChannels*2,true);offset+=2;view.setUint16(offset,16,true);offset+=2;writeStr(offset,'data');offset+=4;view.setUint32(offset,samples.length*2,true);offset+=4;let pos=44;for(let i=0;i<samples.length;i++,pos+=2){let s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(pos,s<0?s*0x8000:s*0x7FFF,true);}return new Blob([view],{type:'audio/wav'});} 

processBtn.addEventListener('click',async()=>{
  const f=fileInput.files[0]; if(!f){status.textContent='Choose a file';return}
  status.textContent='Decoding...'; try{const abuf=await readFile(f);const actx=new (window.AudioContext||window.webkitAudioContext)();const decoded=await actx.decodeAudioData(abuf);
    const thresholdDb=parseFloat(thresholdEl.value);const threshold=Math.pow(10,thresholdDb/20);const frameMs=30;const frameSize=Math.floor(decoded.sampleRate*(frameMs/1000));const minFrames=Math.ceil((parseInt(minMsEl.value)||300)/frameMs);
    // compute RMS per frame (across channels)
    const rms=[];const channels=decoded.numberOfChannels;const len=decoded.length;for(let i=0;i<len;i+=frameSize){let sum=0;let count=0;for(let c=0;c<channels;c++){const data=decoded.getChannelData(c);for(let j=0;j<frameSize && i+j<len;j++){const s=data[i+j];sum+=s*s;count++;}}rms.push(Math.sqrt(sum/count));}
    // find non-silent frames
    const keepSegments=[];let i=0;while(i<rms.length){if(rms[i]>=threshold){let start=i;while(i<rms.length && rms[i]>=threshold)i++;let end=i;keepSegments.push({start:start*frameSize,end:Math.min(len,end*frameSize)});}else{i++;}}
    // merge close segments and skip short segments
    const merged=[];for(const seg of keepSegments){if(merged.length===0)merged.push(seg);else{const prev=merged[merged.length-1];if(seg.start-prev.end<=frameSize*2){prev.end=seg.end;}else merged.push(seg);}}
    if(merged.length===0){status.textContent='No audible segments found with current settings.';return}
    // build new buffer
    let total=0;for(const s of merged)total+=s.end-s.start;const out=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(decoded.numberOfChannels,total,decoded.sampleRate);const outBuf=out.createBuffer(decoded.numberOfChannels,total,decoded.sampleRate);
    let writePos=0;for(const s of merged){for(let c=0;c<decoded.numberOfChannels;c++){const src=decoded.getChannelData(c);const dst=outBuf.getChannelData(c);for(let k=s.start;k<s.end;k++){dst[writePos+k-s.start]=src[k];}}writePos+=s.end-s.start;}
    // render (not strictly necessary since we already have buffer)
    const wav=encodeWAV(outBuf); const url=URL.createObjectURL(wav); downloadLink.href=url; downloadLink.download=(f.name.replace(/\.[^/.]+$/,'' )||'clean')+'_nosilence.wav'; downloadLink.style.display='inline-block'; status.textContent='Ready — download cleaned file.';
  }catch(e){console.error(e);status.textContent='Error processing file.'}}
, false);

