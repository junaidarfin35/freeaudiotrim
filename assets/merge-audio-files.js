const readFile = f => new Promise((r,rej)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=rej;fr.readAsArrayBuffer(f)});
function encodeWAV(audioBuffer){const numChannels=audioBuffer.numberOfChannels;const sampleRate=audioBuffer.sampleRate;let samples; if(numChannels===2){const l=audioBuffer.getChannelData(0), r=audioBuffer.getChannelData(1);samples=new Float32Array(l.length*2);for(let i=0;i<l.length;i++){samples[2*i]=l[i];samples[2*i+1]=r[i];}}else{samples=audioBuffer.getChannelData(0);}const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);function writeStr(o,s){for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))}let offset=0;writeStr(offset,'RIFF');offset+=4;view.setUint32(offset,36+samples.length*2,true);offset+=4;writeStr(offset,'WAVE');offset+=4;writeStr(offset,'fmt ');offset+=4;view.setUint32(offset,16,true);offset+=4;view.setUint16(offset,1,true);offset+=2;view.setUint16(offset,numChannels,true);offset+=2;view.setUint32(offset,sampleRate,true);offset+=4;view.setUint32(offset,sampleRate*numChannels*2,true);offset+=4;view.setUint16(offset,numChannels*2,true);offset+=2;view.setUint16(offset,16,true);offset+=2;writeStr(offset,'data');offset+=4;view.setUint32(offset,samples.length*2,true);offset+=4;let pos=44;for(let i=0;i<samples.length;i++,pos+=2){let s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(pos,s<0?s*0x8000:s*0x7FFF,true);}return new Blob([view],{type:'audio/wav'});} 

const fileInput=document.getElementById('fileInput'), fileList=document.getElementById('fileList'), mergeBtn=document.getElementById('mergeBtn'), downloadLink=document.getElementById('downloadLink'), status=document.getElementById('status');
let files=[];
fileInput.addEventListener('change', ()=>{
  files = Array.from(fileInput.files);
  renderList();
});
function renderList(){fileList.innerHTML='';files.forEach((f,i)=>{const row=document.createElement('div');row.className='file-row';row.innerHTML=`<strong style="flex:1">${f.name}</strong><button data-i="${i}" class="up">↑</button><button data-i="${i}" class="down">↓</button><button data-i="${i}" class="remove">✕</button>`;fileList.appendChild(row)});
  fileList.querySelectorAll('button.up').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;if(i>0){[files[i-1],files[i]]=[files[i],files[i-1]];renderList();}});
  fileList.querySelectorAll('button.down').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;if(i<files.length-1){[files[i+1],files[i]]=[files[i],files[i+1]];renderList();}});
  fileList.querySelectorAll('button.remove').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;files.splice(i,1);renderList();});
}

mergeBtn.addEventListener('click',async()=>{
  if(files.length===0){status.textContent='Add files first';return}
  status.textContent='Decoding files...';try{
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    const decodedArr=[];for(const f of files){const ab=await readFile(f);const buf=await ac.decodeAudioData(ab);decodedArr.push(buf);}    
    // compute total length using sample rate of first
    const sr=decodedArr[0].sampleRate;let total=0;for(const d of decodedArr){total += Math.round(d.duration*sr);}const out=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(decodedArr[0].numberOfChannels,total,sr);
    // create buffer and copy
    const outBuf=out.createBuffer(decodedArr[0].numberOfChannels,total,sr);
    let offset=0;for(const d of decodedArr){for(let c=0;c<outBuf.numberOfChannels;c++){const src = (c<d.numberOfChannels?d.getChannelData(c):d.getChannelData(0)); const dst=outBuf.getChannelData(c); dst.set(src, offset);} offset += Math.round(d.duration*sr);}
    const wav=encodeWAV(outBuf); const url=URL.createObjectURL(wav); downloadLink.href=url; downloadLink.download='merged.wav'; downloadLink.style.display='inline-block'; status.textContent='Ready — download merged file.';
  }catch(e){console.error(e);status.textContent='Error merging files.'}
});

