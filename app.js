const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.1/dist/bundles/mediabunny.min.mjs';

let MB = null;
let selectedFile = null;
let sourceKey = null;
let currentMode = 'strong';
let generatedUrls = [];

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'), pickBtn: $('pickBtn'), fileMeta: $('fileMeta'), processBtn: $('processBtn'),
  engineBadge: $('engineBadge'), modeControl: $('modeControl'), presetSelect: $('presetSelect'),
  savePresetBtn: $('savePresetBtn'), variantCount: $('variantCount'), formatSelect: $('formatSelect'),
  manualDetails: $('manualDetails'), rangeGrid: $('rangeGrid'), preserveAudio: $('preserveAudio'),
  qualityGate: $('qualityGate'), progressWrap: $('progressWrap'), progressBar: $('progressBar'),
  progressText: $('progressText'), progressLabel: $('progressLabel'), status: $('status'),
  resultsPanel: $('resultsPanel'), results: $('results'), clearResults: $('clearResults'),
  networkState: $('networkState'), historyCount: $('historyCount'), sourceFingerprint: $('sourceFingerprint')
};

const RANGE_DEFS = {
  zoom:       { label: 'Zoom', unit: '×', min: 1.0, max: 1.18, step: .001 },
  panX:       { label: 'Смещение X', unit: '%', min: -8, max: 8, step: .1 },
  panY:       { label: 'Смещение Y', unit: '%', min: -8, max: 8, step: .1 },
  brightness: { label: 'Яркость', unit: '%', min: -12, max: 12, step: .1 },
  contrast:   { label: 'Контраст', unit: '%', min: -16, max: 20, step: .1 },
  saturation: { label: 'Насыщенность', unit: '%', min: -16, max: 20, step: .1 },
  temperature:{ label: 'Температура', unit: '%', min: -10, max: 10, step: .1 },
  gamma:      { label: 'Гамма', unit: '', min: .88, max: 1.12, step: .001 },
  speed:      { label: 'Скорость', unit: '×', min: .96, max: 1.04, step: .001 },
  trimStart:  { label: 'Обрезка начала', unit: 'с', min: 0, max: 1.0, step: .01 },
  trimEnd:    { label: 'Обрезка конца', unit: 'с', min: 0, max: 1.0, step: .01 },
  detail:     { label: 'Детализация', unit: '%', min: 0, max: 16, step: .1 }
};

const MODES = {
  light: {
    zoom:[1.003,1.018], panX:[-.8,.8], panY:[-.6,.6], brightness:[-1.5,1.5], contrast:[-2,2],
    saturation:[-2,2], temperature:[-1.5,1.5], gamma:[.985,1.015], speed:[.995,1.005], trimStart:[0,.10], trimEnd:[0,.10], detail:[0,3]
  },
  medium: {
    zoom:[1.015,1.055], panX:[-2.3,2.3], panY:[-1.8,1.8], brightness:[-3,3], contrast:[-5,6],
    saturation:[-5,6], temperature:[-3,3], gamma:[.96,1.04], speed:[.985,1.015], trimStart:[0,.28], trimEnd:[0,.24], detail:[2,7]
  },
  strong: {
    zoom:[1.035,1.105], panX:[-4.5,4.5], panY:[-3.4,3.4], brightness:[-5,5], contrast:[-8,10],
    saturation:[-8,10], temperature:[-5,5], gamma:[.93,1.07], speed:[.975,1.025], trimStart:[0,.55], trimEnd:[0,.45], detail:[4,12]
  }
};

const BUILTIN_PRESETS = {
  balanced: { name:'Сбалансированный', mode:'strong', overrides:{} },
  motion: { name:'Кадр и движение', mode:'strong', overrides:{ zoom:[1.055,1.12], panX:[-5.5,5.5], panY:[-4,4], brightness:[-2,2], contrast:[-4,5], saturation:[-3,4] } },
  clean: { name:'Чистый цвет', mode:'medium', overrides:{ zoom:[1.01,1.035], brightness:[-4,4], contrast:[-7,8], saturation:[-6,7], temperature:[-4,4], gamma:[.95,1.05], detail:[4,10] } },
  subtle: { name:'Деликатный', mode:'light', overrides:{ zoom:[1.004,1.014], panX:[-.6,.6], panY:[-.6,.6], contrast:[-2,2], saturation:[-2,2] } }
};

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rnd(a,b){ return a + Math.random()*(b-a); }
function round(v,n=4){ const p=10**n; return Math.round(v*p)/p; }
function randomSeed(){ return crypto.getRandomValues(new Uint32Array(1))[0]; }

function getUserPresets(){
  try { return JSON.parse(localStorage.getItem('rf_user_presets') || '{}'); } catch { return {}; }
}
function loadPresetOptions(){
  const users=getUserPresets();
  els.presetSelect.innerHTML='';
  for(const [id,p] of Object.entries(BUILTIN_PRESETS)) addPresetOption(`builtin:${id}`,p.name);
  for(const [id,p] of Object.entries(users)) addPresetOption(`user:${id}`,p.name);
  els.presetSelect.value='builtin:balanced';
}
function addPresetOption(value,text){ const o=document.createElement('option'); o.value=value;o.textContent=text;els.presetSelect.appendChild(o); }

function rangesForMode(mode){ return clone(MODES[mode] || MODES.strong); }
function currentRanges(){
  const out={};
  for(const key of Object.keys(RANGE_DEFS)){
    const min=Number(document.querySelector(`[data-range="${key}"][data-side="min"]`)?.value);
    const max=Number(document.querySelector(`[data-range="${key}"][data-side="max"]`)?.value);
    out[key]=[Math.min(min,max),Math.max(min,max)];
  }
  return out;
}
function renderRanges(ranges){
  els.rangeGrid.innerHTML='';
  for(const [key,def] of Object.entries(RANGE_DEFS)){
    const values=ranges[key] || [def.min,def.max];
    const card=document.createElement('div'); card.className='range-card';
    card.innerHTML=`<div class="range-name">${def.label}</div><div class="range-inputs">
      <input data-range="${key}" data-side="min" type="number" min="${def.min}" max="${def.max}" step="${def.step}" value="${values[0]}">
      <input data-range="${key}" data-side="max" type="number" min="${def.min}" max="${def.max}" step="${def.step}" value="${values[1]}">
    </div><div class="range-unit">min / max ${def.unit}</div>`;
    els.rangeGrid.appendChild(card);
  }
}
function applyMode(mode){
  currentMode=mode;
  [...els.modeControl.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if(mode==='manual'){ els.manualDetails.open=true; return; }
  renderRanges(rangesForMode(mode));
}
function applyPresetValue(value){
  let preset;
  if(value.startsWith('builtin:')) preset=BUILTIN_PRESETS[value.split(':')[1]];
  else preset=getUserPresets()[value.split(':')[1]];
  if(!preset) return;
  currentMode=preset.mode || 'strong';
  [...els.modeControl.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',b.dataset.mode===currentMode));
  const base=rangesForMode(currentMode==='manual'?'strong':currentMode);
  renderRanges({...base,...(preset.overrides||preset.ranges||{})});
}

function getHistory(key){
  try { return JSON.parse(localStorage.getItem(`rf_history_${key}`) || '[]'); } catch { return []; }
}
function saveHistory(key,items){ localStorage.setItem(`rf_history_${key}`,JSON.stringify(items.slice(-24))); updateHistoryCount(); }
function updateHistoryCount(){ els.historyCount.textContent=sourceKey ? getHistory(sourceKey).length : '0'; }

function recipeDistance(a,b){
  const keys=['zoom','panX','panY','brightness','contrast','saturation','temperature','gamma','speed','trimStart','trimEnd','detail'];
  let total=0,used=0;
  for(const k of keys){
    if(a[k]==null||b[k]==null) continue;
    const d=RANGE_DEFS[k]; const span=d.max-d.min || 1;
    total += Math.abs(a[k]-b[k])/span; used++;
  }
  return used ? total/used : 1;
}
function generateRecipe(ranges,history,file){
  for(let attempt=0;attempt<60;attempt++){
    const r={seed:randomSeed(),createdAt:Date.now()};
    for(const [key,rg] of Object.entries(ranges)) r[key]=round(rnd(rg[0],rg[1]),4);
    if(file.type.startsWith('image/')){ r.speed=1; r.trimStart=0; r.trimEnd=0; }
    if(els.preserveAudio.checked && file.type.startsWith('video/')) r.speed=1;
    const recipeHistory=history.map(x=>x.recipe).filter(Boolean);
    const minDistance=currentMode==='strong'?.055:currentMode==='medium'?.032:.015;
    if(recipeHistory.every(old=>recipeDistance(r,old)>=minDistance)) return r;
  }
  const r={seed:randomSeed(),createdAt:Date.now()};
  for(const [key,rg] of Object.entries(ranges)) r[key]=round(rnd(rg[0],rg[1]),4);
  if(els.preserveAudio.checked) r.speed=1;
  return r;
}

async function sourceFingerprint(file){
  const chunk=2*1024*1024;
  const pieces=[];
  const parts=[[0,Math.min(chunk,file.size)]];
  if(file.size>chunk*2) parts.push([Math.max(0,Math.floor(file.size/2)-chunk/2),Math.min(file.size,Math.floor(file.size/2)+chunk/2)]);
  if(file.size>chunk) parts.push([Math.max(0,file.size-chunk),file.size]);
  for(const [a,b] of parts) pieces.push(new Uint8Array(await file.slice(a,b).arrayBuffer()));
  const meta=new TextEncoder().encode(`${file.size}|${file.type}`);
  const total=meta.length+pieces.reduce((n,p)=>n+p.length,0);
  const all=new Uint8Array(total); let off=0; all.set(meta,off);off+=meta.length; for(const p of pieces){all.set(p,off);off+=p.length;}
  const dig=new Uint8Array(await crypto.subtle.digest('SHA-256',all));
  return [...dig.slice(0,10)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function setProgress(value,label){
  els.progressWrap.classList.remove('hidden');
  const p=Math.round(clamp(value,0,1)*100); els.progressBar.style.width=`${p}%`; els.progressText.textContent=`${p}%`; if(label) els.progressLabel.textContent=label;
}
function setStatus(text,error=false){ els.status.textContent=text; els.status.classList.toggle('error',error); }

function makeCanvas(w,h){
  if(typeof OffscreenCanvas!=='undefined') return new OffscreenCanvas(w,h);
  const c=document.createElement('canvas'); c.width=w;c.height=h;return c;
}
function applyFrameStyle(ctx,recipe){
  const b=100+recipe.brightness;
  const c=100+recipe.contrast;
  const s=100+recipe.saturation;
  const gammaApprox=100 + (1-recipe.gamma)*42;
  ctx.filter=`brightness(${b+gammaApprox-100}%) contrast(${c}%) saturate(${s}%)`;
}
function drawCover(drawFn,srcW,srcH,ctx,outW,outH,recipe,phase=0){
  const base=Math.max(outW/srcW,outH/srcH);
  const dynamic=1+(recipe.zoom-1)*(0.35+0.65*phase);
  const scale=base*dynamic;
  const dw=srcW*scale, dh=srcH*scale;
  const roomX=Math.max(0,(dw-outW)/2), roomY=Math.max(0,(dh-outH)/2);
  const panPhase=Math.sin(phase*Math.PI*1.15);
  const px=(recipe.panX/8)*roomX*(0.35+0.65*panPhase);
  const py=(recipe.panY/8)*roomY*(0.35+0.65*Math.cos(phase*Math.PI));
  const x=(outW-dw)/2+px, y=(outH-dh)/2+py;
  ctx.clearRect(0,0,outW,outH);
  ctx.fillStyle='#000';ctx.fillRect(0,0,outW,outH);
  applyFrameStyle(ctx,recipe);
  drawFn(x,y,dw,dh);
  ctx.filter='none';
  if(recipe.temperature!==0){
    ctx.globalCompositeOperation='source-atop';
    const warm=recipe.temperature>0; const alpha=Math.min(.08,Math.abs(recipe.temperature)/140);
    ctx.fillStyle=warm?`rgba(255,116,50,${alpha})`:`rgba(70,130,255,${alpha})`;
    ctx.fillRect(0,0,outW,outH);ctx.globalCompositeOperation='source-over';
  }
  if(recipe.detail>0){
    ctx.globalAlpha=Math.min(.09,recipe.detail/170);ctx.globalCompositeOperation='overlay';
    drawFn(x-0.35,y-0.35,dw+0.7,dh+0.7);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  }
}

async function renderVideo(file,recipe,onProgress){
  const {Input,Output,Conversion,ALL_FORMATS,BlobSource,Mp4OutputFormat,BufferTarget,Quality,VideoSample} = MB;
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  const duration=await input.computeDuration();
  const primary=await input.getPrimaryVideoTrack();
  if(!primary) throw new Error('В файле не найден видеопоток');
  const originalW=await primary.getDisplayWidth(); const originalH=await primary.getDisplayHeight();
  const reels=els.formatSelect.value==='reels';
  const outW=reels?1080:Math.max(2,Math.round(originalW/2)*2); const outH=reels?1920:Math.max(2,Math.round(originalH/2)*2);
  const output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target:new BufferTarget()});
  let canvas,ctx;
  const speed=recipe.speed || 1;
  const start=Math.min(recipe.trimStart,Math.max(0,duration-.2));
  const end=Math.max(start+.1,duration-recipe.trimEnd);
  const videoOpts={
    codec:'avc', quality:new Quality('high'), forceTranscode:true, processedWidth:outW, processedHeight:outH,
    process:(sample)=>{
      if(!canvas){canvas=makeCanvas(outW,outH);ctx=canvas.getContext('2d',{alpha:false});}
      const phase=clamp((sample.timestamp-start)/Math.max(.001,end-start),0,1);
      drawCover((x,y,w,h)=>sample.draw(ctx,x,y,w,h),sample.displayWidth,sample.displayHeight,ctx,outW,outH,recipe,phase);
      if(Math.abs(speed-1)<.0001) return canvas;
      return new VideoSample(canvas,{timestamp:(sample.timestamp-start)/speed,duration:sample.duration/speed});
    }
  };
  const audioOpts=els.preserveAudio.checked ? {forceTranscode:false} : {discard:true};
  const conversion=await Conversion.init({input,output,tracks:'primary',video:videoOpts,audio:audioOpts,trim:{start,end},copy:false,tags:{},showWarnings:false});
  if(!conversion.isValid) throw new Error('Этот кодек браузер не может перекодировать');
  conversion.onProgress=(p)=>onProgress?.(p);
  await conversion.execute();
  input.dispose?.();
  return new Blob([output.target.buffer],{type:'video/mp4'});
}

async function loadImage(file){
  const url=URL.createObjectURL(file);
  try{
    const img=new Image(); img.decoding='async'; img.src=url; await img.decode(); return img;
  } finally { /* URL kept until drawing completes via decoded bitmap */ }
}
async function renderPhoto(file,recipe,onProgress){
  const {Output,Mp4OutputFormat,BufferTarget,CanvasSource,Quality}=MB;
  const bitmap=typeof createImageBitmap==='function' ? await createImageBitmap(file) : await loadImage(file);
  const srcW=bitmap.width||bitmap.naturalWidth, srcH=bitmap.height||bitmap.naturalHeight;
  const reels=els.formatSelect.value==='reels';
  const outW=reels?1080:Math.max(2,Math.round(srcW/2)*2); const outH=reels?1920:Math.max(2,Math.round(srcH/2)*2);
  const canvas=makeCanvas(outW,outH); const ctx=canvas.getContext('2d',{alpha:false});
  const output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target:new BufferTarget()});
  const source=new CanvasSource(canvas,{codec:'avc',quality:new Quality('high')}); output.addVideoTrack(source); await output.start();
  const fps=30,duration=7,frames=fps*duration;
  for(let i=0;i<frames;i++){
    const phase=i/(frames-1);
    drawCover((x,y,w,h)=>ctx.drawImage(bitmap,x,y,w,h),srcW,srcH,ctx,outW,outH,recipe,phase);
    await source.add(i/fps,1/fps,{keyFrame:i%(fps*2)===0});
    if(i%4===0) onProgress?.(i/frames);
  }
  source.close(); await output.finalize(); bitmap.close?.(); onProgress?.(1);
  return new Blob([output.target.buffer],{type:'video/mp4'});
}

function seekVideo(video,time){ return new Promise((resolve,reject)=>{ const ok=()=>{cleanup();resolve();}; const fail=()=>{cleanup();reject(new Error('Не удалось прочитать результат'));}; const cleanup=()=>{video.removeEventListener('seeked',ok);video.removeEventListener('error',fail)}; video.addEventListener('seeked',ok,{once:true});video.addEventListener('error',fail,{once:true});video.currentTime=time; }); }
function waitEvent(el,name){ return new Promise((res,rej)=>{ el.addEventListener(name,res,{once:true});el.addEventListener('error',()=>rej(new Error('Ошибка декодирования')),{once:true});}); }
function bytesToB64(bytes){ let s=''; for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s); }
function b64ToBytes(s){ const raw=atob(s),a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return a; }
async function mediaFingerprint(blob){
  const url=URL.createObjectURL(blob); const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
  try{
    await waitEvent(video,'loadedmetadata');
    const c=document.createElement('canvas');c.width=16;c.height=16;const ctx=c.getContext('2d',{willReadFrequently:true});
    const out=[]; const dur=Math.max(.01,video.duration);
    for(const frac of [.1,.3,.5,.7,.9]){
      await seekVideo(video,Math.min(dur-.01,dur*frac));ctx.drawImage(video,0,0,16,16);const d=ctx.getImageData(0,0,16,16).data;
      for(let i=0;i<d.length;i+=4){out.push(d[i],d[i+1],d[i+2]);}
    }
    return {data:bytesToB64(new Uint8Array(out)),duration:round(dur,3)};
  } finally { URL.revokeObjectURL(url); video.src=''; }
}
function fpDistance(a,b){
  if(!a?.data||!b?.data) return 1; const aa=b64ToBytes(a.data),bb=b64ToBytes(b.data);const n=Math.min(aa.length,bb.length);let sum=0;for(let i=0;i<n;i++)sum+=Math.abs(aa[i]-bb[i]); const pixels=sum/(n*255); const duration=Math.min(.15,Math.abs((a.duration||0)-(b.duration||0))/Math.max(1,a.duration||1)); return pixels+duration;
}

async function sha256Blob(blob){ const data=new Uint8Array(await blob.arrayBuffer()); const dig=new Uint8Array(await crypto.subtle.digest('SHA-256',data)); return [...dig.slice(0,8)].map(v=>v.toString(16).padStart(2,'0')).join(''); }

async function renderOne(index,total){
  const ranges=currentRanges(); let history=getHistory(sourceKey); let lastErr;
  for(let attempt=1;attempt<=4;attempt++){
    const recipe=generateRecipe(ranges,history,selectedFile);
    setProgress(0,`Вариант ${index+1}/${total}, попытка ${attempt}`);
    try{
      const blob=selectedFile.type.startsWith('image/')
        ? await renderPhoto(selectedFile,recipe,p=>setProgress(p,`Вариант ${index+1}/${total}, рендер`))
        : await renderVideo(selectedFile,recipe,p=>setProgress(p,`Вариант ${index+1}/${total}, рендер`));
      setProgress(1,'Проверка результата');
      const fp=await mediaFingerprint(blob);
      const distances=history.filter(x=>x.fingerprint).map(x=>fpDistance(fp,x.fingerprint));
      const nearest=distances.length?Math.min(...distances):1;
      const threshold=currentMode==='strong'?.018:currentMode==='medium'?.012:.007;
      if(els.qualityGate.checked && nearest<threshold && attempt<4){ lastErr=new Error(`Результат слишком близок (${nearest.toFixed(3)})`); continue; }
      const hash=await sha256Blob(blob);
      history.push({recipe,fingerprint:fp,hash,createdAt:Date.now()});saveHistory(sourceKey,history);
      return {blob,recipe,fp,hash,nearest,attempt};
    }catch(err){ lastErr=err; if(attempt===4) throw err; }
  }
  throw lastErr || new Error('Не удалось создать вариант');
}

function addResult(result,n){
  els.resultsPanel.classList.remove('hidden');
  const url=URL.createObjectURL(result.blob);generatedUrls.push(url);
  const card=document.createElement('article');card.className='result';
  const recipe=result.recipe;
  card.innerHTML=`<video controls playsinline src="${url}"></video><div class="result-body"><div class="result-meta mono">#${n} · ${result.hash}<br>zoom ${recipe.zoom.toFixed(3)} · pan ${recipe.panX.toFixed(1)}/${recipe.panY.toFixed(1)} · C ${recipe.contrast.toFixed(1)} · S ${recipe.saturation.toFixed(1)} · попытка ${result.attempt}</div><div class="result-actions"><a class="action" download="reelforge-${result.hash}.mp4" href="${url}">Сохранить MP4</a></div></div>`;
  els.results.prepend(card);
}

async function processSelected(){
  if(!selectedFile||!MB) return;
  els.processBtn.disabled=true; setStatus('');
  const count=Number(els.variantCount.value);
  try{
    for(let i=0;i<count;i++){ const res=await renderOne(i,count); addResult(res,i+1); }
    setProgress(1,'Готово'); setStatus(`Создано вариантов: ${count}. Файл не покидал устройство.`);
  }catch(err){ console.error(err); setStatus(err?.message||String(err),true); }
  finally{ els.processBtn.disabled=false; }
}

async function handleFile(file){
  if(!file) return; selectedFile=file; els.processBtn.disabled=true; setStatus('Анализ файла');
  sourceKey=await sourceFingerprint(file); els.sourceFingerprint.textContent=sourceKey.slice(0,10); updateHistoryCount();
  const mb=(file.size/1024/1024).toFixed(1);els.fileMeta.classList.remove('hidden');els.fileMeta.textContent=`${file.name} · ${mb} MB · ${file.type||'unknown'}`;
  els.processBtn.disabled=!MB; setStatus(MB?'Готово к обработке':'Медиа-движок ещё загружается');
}

function networkLabel(){ els.networkState.textContent=navigator.onLine?'Доступна':'Офлайн'; }

els.pickBtn.addEventListener('click',()=>els.fileInput.click());
els.fileInput.addEventListener('change',()=>handleFile(els.fileInput.files?.[0]));
els.modeControl.addEventListener('click',(e)=>{ const b=e.target.closest('button[data-mode]');if(!b)return;applyMode(b.dataset.mode);if(b.dataset.mode!=='manual')els.presetSelect.value='builtin:balanced'; });
els.presetSelect.addEventListener('change',()=>applyPresetValue(els.presetSelect.value));
els.savePresetBtn.addEventListener('click',()=>{ const name=prompt('Название пресета');if(!name)return;const id=`p_${Date.now()}`;const all=getUserPresets();all[id]={name,mode:'manual',ranges:currentRanges()};localStorage.setItem('rf_user_presets',JSON.stringify(all));loadPresetOptions();els.presetSelect.value=`user:${id}`;applyPresetValue(`user:${id}`); });
els.processBtn.addEventListener('click',processSelected);
els.clearResults.addEventListener('click',()=>{generatedUrls.forEach(URL.revokeObjectURL);generatedUrls=[];els.results.innerHTML='';els.resultsPanel.classList.add('hidden');});
window.addEventListener('online',networkLabel);window.addEventListener('offline',networkLabel);networkLabel();

loadPresetOptions();renderRanges(rangesForMode('strong'));

if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});

(async()=>{
  try{
    if(typeof VideoEncoder==='undefined'||typeof VideoDecoder==='undefined') throw new Error('WebCodecs недоступен');
    MB=await import(MB_URL);
    const canVideo=await MB.canEncodeVideo('avc',{width:720,height:1280});
    if(!canVideo) throw new Error('H.264 encoder недоступен');
    els.engineBadge.textContent='Локальный движок готов';els.engineBadge.classList.add('ok');
    if(selectedFile) els.processBtn.disabled=false;
  }catch(err){
    console.error(err);els.engineBadge.textContent='Нет поддержки кодека';els.engineBadge.classList.add('bad');setStatus('Этот браузер не даёт локально кодировать H.264. На iPhone нужен актуальный Safari/iOS.',true);
  }
})();
