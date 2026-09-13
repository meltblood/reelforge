const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.1/dist/bundles/mediabunny.min.mjs';

let MB = null;
let selectedFile = null;
let sourceKey = null;
let currentMode = 'auto';
let generatedUrls = [];
const noiseStates = new WeakMap();

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'), pickBtn: $('pickBtn'), fileMeta: $('fileMeta'), processBtn: $('processBtn'),
  modeControl: $('modeControl'), autoOptions: $('autoOptions'), autoZoom: $('autoZoom'), autoPan: $('autoPan'),
  presetSelect: $('presetSelect'), savePresetBtn: $('savePresetBtn'), variantCount: $('variantCount'), formatSelect: $('formatSelect'),
  manualDetails: $('manualDetails'), rangeGrid: $('rangeGrid'), preserveAudio: $('preserveAudio'),
  progressWrap: $('progressWrap'), progressBar: $('progressBar'), progressText: $('progressText'), progressLabel: $('progressLabel'),
  status: $('status'), resultsPanel: $('resultsPanel'), results: $('results'), clearResults: $('clearResults')
};

const RANGE_DEFS = {
  zoom:       { label: 'Zoom', unit: '×', min: 1.0, max: 1.18, step: .001 },
  panX:       { label: 'Смещение X', unit: '%', min: -8, max: 8, step: .1 },
  panY:       { label: 'Смещение Y', unit: '%', min: -8, max: 8, step: .1 },
  edgeCrop:   { label: 'Обрезка краёв', unit: 'px', min: 0, max: 32, step: 1 },
  grain:      { label: 'Grain / шум', unit: '%', min: 0, max: 7, step: .1 },
  brightness: { label: 'Яркость', unit: '%', min: -12, max: 12, step: .1 },
  contrast:   { label: 'Контраст', unit: '%', min: -16, max: 20, step: .1 },
  saturation: { label: 'Насыщенность', unit: '%', min: -16, max: 20, step: .1 },
  temperature:{ label: 'Температура', unit: '%', min: -10, max: 10, step: .1 },
  gamma:      { label: 'Гамма', unit: '', min: .88, max: 1.12, step: .001 },
  speed:      { label: 'Скорость / тон', unit: '×', min: .96, max: 1.04, step: .001 },
  trimStart:  { label: 'Обрезка начала', unit: 'с', min: 0, max: 1.0, step: .01 },
  trimEnd:    { label: 'Обрезка конца', unit: 'с', min: 0, max: 1.0, step: .01 },
  detail:     { label: 'Детализация', unit: '%', min: 0, max: 16, step: .1 }
};

const MANUAL_DEFAULTS = {
  zoom:[1.04,1.10], panX:[-4.8,4.8], panY:[-3.8,3.8], edgeCrop:[4,12], grain:[1.8,4.2],
  brightness:[-5.5,5.5], contrast:[-9.5,12], saturation:[-9.5,12], temperature:[-5.5,5.5],
  gamma:[.93,1.07], speed:[.985,1.015], trimStart:[.12,.52], trimEnd:[.10,.42], detail:[6,14]
};

const BUILTIN_PRESETS = {
  balanced: { name:'Сбалансированный', ranges: clone(MANUAL_DEFAULTS) },
  motion: { name:'Кадр и движение', ranges:{...clone(MANUAL_DEFAULTS), zoom:[1.06,1.13], panX:[-6.5,6.5], panY:[-5,5], edgeCrop:[3,6], grain:[1.5,3.2]} },
  clean: { name:'Цвет и детали', ranges:{...clone(MANUAL_DEFAULTS), zoom:[1.025,1.06], panX:[-2.5,2.5], panY:[-2,2], edgeCrop:[1,4], grain:[1.2,2.6], contrast:[-11,13], saturation:[-11,13], temperature:[-6,6], gamma:[.92,1.08], detail:[8,15]} },
  cropOff: { name:'Без Zoom / Pan', ranges:{...clone(MANUAL_DEFAULTS), zoom:[1,1], panX:[0,0], panY:[0,0], edgeCrop:[1,5], grain:[2,4.5], contrast:[-10,12], saturation:[-10,12], temperature:[-6,6], detail:[7,15]} }
};

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rnd(a,b){ return a + Math.random()*(b-a); }
function round(v,n=4){ const p=10**n; return Math.round(v*p)/p; }
function randomSeed(){ return crypto.getRandomValues(new Uint32Array(1))[0]; }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function hexSeed(seed){ return (seed>>>0).toString(16).padStart(8,'0'); }

function getUserPresets(){
  try { return JSON.parse(localStorage.getItem('rf_user_presets') || '{}'); } catch { return {}; }
}
function loadPresetOptions(){
  const users=getUserPresets();
  els.presetSelect.innerHTML='';
  addPresetOption('none','Без пресета');
  for(const [id,p] of Object.entries(BUILTIN_PRESETS)) addPresetOption(`builtin:${id}`,p.name);
  for(const [id,p] of Object.entries(users)) addPresetOption(`user:${id}`,p.name);
  els.presetSelect.value='none';
}
function addPresetOption(value,text){ const o=document.createElement('option'); o.value=value;o.textContent=text;els.presetSelect.appendChild(o); }

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
  const disabled=currentMode!=='manual';
  for(const [key,def] of Object.entries(RANGE_DEFS)){
    const values=ranges[key] || [def.min,def.max];
    const card=document.createElement('div'); card.className='range-card';
    card.innerHTML=`<div class="range-name">${def.label}</div><div class="range-inputs">
      <input data-range="${key}" data-side="min" type="number" min="${def.min}" max="${def.max}" step="${def.step}" value="${values[0]}" ${disabled?'disabled':''}>
      <input data-range="${key}" data-side="max" type="number" min="${def.min}" max="${def.max}" step="${def.step}" value="${values[1]}" ${disabled?'disabled':''}>
    </div><div class="range-unit">min / max ${def.unit}</div>`;
    els.rangeGrid.appendChild(card);
  }
}

function signedWindow(minMagnitude,maxMagnitude,minWidth,maxWidth){
  const sign=pick([-1,1]);
  const width=rnd(minWidth,maxWidth);
  const start=rnd(minMagnitude,Math.max(minMagnitude,maxMagnitude-width));
  const end=Math.min(maxMagnitude,start+width);
  return sign>0 ? [round(start,4),round(end,4)] : [round(-end,4),round(-start,4)];
}
function positiveWindow(minValue,maxValue,minWidth,maxWidth){
  const width=rnd(minWidth,maxWidth);
  const start=rnd(minValue,Math.max(minValue,maxValue-width));
  return [round(start,4),round(Math.min(maxValue,start+width),4)];
}

// АВТО: скорость всегда уходит от 1.0 в диапазон ±0.3…±1.5% (и питч аудио уходит вместе с ней),
// edge crop строго 1–6 px, grain гарантированно > 0 — noise пересоздаётся под новый seed.
function autoRanges(){
  const zoom=els.autoZoom.checked ? positiveWindow(1.045,1.145,.020,.050) : [1,1];
  const panX=els.autoPan.checked ? signedWindow(2.8,7.5,1.5,3.0) : [0,0];
  const panY=els.autoPan.checked ? signedWindow(2.0,5.5,1.1,2.4) : [0,0];
  const gamma=pick([positiveWindow(.90,.955,.018,.035),positiveWindow(1.045,1.10,.018,.035)]);
  const speed=pick([positiveWindow(.985,.997,.003,.007),positiveWindow(1.003,1.015,.003,.007)]);
  return {
    zoom, panX, panY,
    edgeCrop:positiveWindow(1,6,.5,2),
    grain:positiveWindow(2.5,5.5,1.0,2.0),
    brightness:signedWindow(3.2,8.5,1.7,3.5),
    contrast:signedWindow(5.5,14,2.8,5.5),
    saturation:signedWindow(5.5,14,2.8,5.5),
    temperature:signedWindow(3.3,8.5,1.7,3.5),
    gamma, speed,
    trimStart:positiveWindow(.12,.55,.08,.20),
    trimEnd:positiveWindow(.10,.42,.07,.16),
    detail:positiveWindow(6.5,15,2.5,5)
  };
}
function randomizeAutoRanges(notify=false){
  if(currentMode!=='auto') return;
  const ranges=autoRanges();
  renderRanges(ranges);
  els.manualDetails.open=false;
  els.presetSelect.value='none';
  if(notify){
    const spd=`${ranges.speed[0].toFixed(3)}…${ranges.speed[1].toFixed(3)}×`;
    setStatus(`АВТО: новый набор (speed ${spd} → pitch ${((ranges.speed[0]-1)*100).toFixed(2)}…${((ranges.speed[1]-1)*100).toFixed(2)}%, crop ${ranges.edgeCrop[0]}–${ranges.edgeCrop[1]}px, grain ${ranges.grain[0].toFixed(1)}–${ranges.grain[1].toFixed(1)}%). Нажмите «Создать вариант».`);
  }
}
function applyMode(mode){
  currentMode=mode==='manual'?'manual':'auto';
  [...els.modeControl.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',b.dataset.mode===currentMode));
  els.autoOptions.classList.toggle('hidden',currentMode==='manual');
  if(currentMode==='manual'){
    const existing=els.rangeGrid.children.length ? currentRanges() : clone(MANUAL_DEFAULTS);
    renderRanges(existing);
    els.manualDetails.open=true;
  }else{
    randomizeAutoRanges(true);
  }
}
function applyPresetValue(value){
  if(value==='none') return;
  let preset;
  if(value.startsWith('builtin:')) preset=BUILTIN_PRESETS[value.split(':')[1]];
  else if(value.startsWith('user:')) preset=getUserPresets()[value.split(':')[1]];
  if(!preset) return;
  currentMode='manual';
  [...els.modeControl.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',b.dataset.mode==='manual'));
  els.autoOptions.classList.add('hidden');
  renderRanges(clone(preset.ranges || preset.overrides || MANUAL_DEFAULTS));
  els.manualDetails.open=true;
}

function getHistory(key){
  try { return JSON.parse(localStorage.getItem(`rf_history_${key}`) || '[]'); } catch { return []; }
}
function saveHistory(key,items){ localStorage.setItem(`rf_history_${key}`,JSON.stringify(items.slice(-24))); updateHistoryCount(); }
function updateHistoryCount(){}

function recipeDistance(a,b,ranges){
  const keys=['zoom','panX','panY','edgeCrop','grain','brightness','contrast','saturation','temperature','gamma','speed','trimStart','trimEnd','detail'];
  let total=0,used=0;
  for(const k of keys){
    if(a[k]==null||b[k]==null) continue;
    const activeSpan=Math.abs((ranges?.[k]?.[1] ?? 0)-(ranges?.[k]?.[0] ?? 0));
    if(activeSpan <= (RANGE_DEFS[k]?.step || .001)/2) continue;
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
    const recipeHistory=history.map(x=>x.recipe).filter(Boolean);
    const minDistance=currentMode==='auto'?.060:.025;
    if(recipeHistory.every(old=>recipeDistance(r,old,ranges)>=minDistance)) return r;
  }
  const r={seed:randomSeed(),createdAt:Date.now()};
  for(const [key,rg] of Object.entries(ranges)) r[key]=round(rnd(rg[0],rg[1]),4);
  if(file.type.startsWith('image/')){ r.speed=1; r.trimStart=0; r.trimEnd=0; }
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
function seededRandom(seed){
  let t=seed>>>0;
  return ()=>{
    t+=0x6D2B79F5;
    let x=t;
    x=Math.imul(x^(x>>>15),x|1);
    x^=x+Math.imul(x^(x>>>7),x|61);
    return ((x^(x>>>14))>>>0)/4294967296;
  };
}
function drawGrain(ctx,recipe,outW,outH,phase){
  const amount=clamp(Number(recipe.grain)||0,0,7)/100;
  if(amount<=0) return;
  const bucket=Math.floor(clamp(phase,0,1)*84);
  let state=noiseStates.get(recipe);
  if(!state){
    const canvas=document.createElement('canvas'); canvas.width=72; canvas.height=72;
    state={canvas,ctx:canvas.getContext('2d'),bucket:-1}; noiseStates.set(recipe,state);
  }
  if(state.bucket!==bucket){
    state.bucket=bucket;
    const rand=seededRandom((recipe.seed^(bucket*2654435761))>>>0);
    const image=state.ctx.createImageData(72,72);
    for(let i=0;i<image.data.length;i+=4){
      const v=Math.floor(rand()*256);
      image.data[i]=v; image.data[i+1]=v; image.data[i+2]=v; image.data[i+3]=255;
    }
    state.ctx.putImageData(image,0,0);
  }
  ctx.save();
  ctx.globalAlpha=Math.min(.075,amount*1.25);
  ctx.globalCompositeOperation='soft-light';
  const pattern=ctx.createPattern(state.canvas,'repeat');
  if(pattern){ctx.fillStyle=pattern;ctx.fillRect(0,0,outW,outH);}
  ctx.restore();
}
function drawCover(drawFn,srcW,srcH,ctx,outW,outH,recipe,phase=0){
  const maxCrop=Math.max(0,Math.floor(Math.min(srcW,srcH)/4));
  const edge=clamp(Math.round(recipe.edgeCrop||0),0,maxCrop);
  const sx=edge, sy=edge, sw=Math.max(2,srcW-edge*2), sh=Math.max(2,srcH-edge*2);
  const base=Math.max(outW/sw,outH/sh);
  const dynamic=1+(recipe.zoom-1)*(0.35+0.65*phase);
  const scale=base*dynamic;
  const dw=sw*scale, dh=sh*scale;
  const roomX=Math.max(0,(dw-outW)/2), roomY=Math.max(0,(dh-outH)/2);
  const panPhase=Math.sin(phase*Math.PI*1.15);
  const px=(recipe.panX/8)*roomX*(0.35+0.65*panPhase);
  const py=(recipe.panY/8)*roomY*(0.35+0.65*Math.cos(phase*Math.PI));
  const x=(outW-dw)/2+px, y=(outH-dh)/2+py;
  ctx.clearRect(0,0,outW,outH);
  ctx.fillStyle='#000';ctx.fillRect(0,0,outW,outH);
  applyFrameStyle(ctx,recipe);
  drawFn(sx,sy,sw,sh,x,y,dw,dh);
  ctx.filter='none';
  if(recipe.temperature!==0){
    ctx.globalCompositeOperation='source-atop';
    const warm=recipe.temperature>0; const alpha=Math.min(.09,Math.abs(recipe.temperature)/130);
    ctx.fillStyle=warm?`rgba(255,116,50,${alpha})`:`rgba(70,130,255,${alpha})`;
    ctx.fillRect(0,0,outW,outH);ctx.globalCompositeOperation='source-over';
  }
  if(recipe.detail>0){
    ctx.globalAlpha=Math.min(.095,recipe.detail/160);ctx.globalCompositeOperation='overlay';
    drawFn(sx,sy,sw,sh,x-.4,y-.4,dw+.8,dh+.8);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  }
  drawGrain(ctx,recipe,outW,outH,phase);
}

function retimeAudioSample(sample,speed,AudioSample,baseTimestamp){
  const channels=sample.numberOfChannels;
  const inFrames=sample.numberOfFrames;
  const options={planeIndex:0,format:'f32'};
  const bytes=sample.allocationSize(options);
  const input=new Float32Array(bytes/4);
  sample.copyTo(input,options);
  const outFrames=Math.max(1,Math.round(inFrames/speed));
  const output=new Float32Array(outFrames*channels);
  for(let frame=0;frame<outFrames;frame++){
    const src=Math.min(inFrames-1,frame*speed);
    const a=Math.floor(src), b=Math.min(inFrames-1,a+1), t=src-a;
    const outBase=frame*channels, aBase=a*channels, bBase=b*channels;
    for(let ch=0;ch<channels;ch++) output[outBase+ch]=input[aBase+ch]*(1-t)+input[bBase+ch]*t;
  }
  return new AudioSample({
    data:output,
    format:'f32',
    numberOfChannels:channels,
    sampleRate:sample.sampleRate,
    timestamp:Math.max(0,(sample.timestamp-baseTimestamp)/speed)
  });
}

async function renderVideo(file,recipe,onProgress){
  const {Input,Output,Conversion,ALL_FORMATS,BlobSource,Mp4OutputFormat,BufferTarget,Quality,VideoSample,AudioSample} = MB;
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
      drawCover((sx,sy,sw,sh,x,y,w,h)=>sample.draw(ctx,sx,sy,sw,sh,x,y,w,h),sample.displayWidth,sample.displayHeight,ctx,outW,outH,recipe,phase);
      if(Math.abs(speed-1)<.0001) return canvas;
      return new VideoSample(canvas,{timestamp:Math.max(0,(sample.timestamp-start)/speed),duration:sample.duration/speed});
    }
  };
  let firstAudioTimestamp=null;
  const audioOpts=els.preserveAudio.checked ? {
    codec:'aac', quality:new Quality('high'), forceTranscode:true,
    process:(sample)=>{
      if(Math.abs(speed-1)<.0001) return sample;
      if(firstAudioTimestamp===null) firstAudioTimestamp=sample.timestamp;
      return retimeAudioSample(sample,speed,AudioSample,firstAudioTimestamp);
    }
  } : {discard:true};
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
    drawCover((sx,sy,sw,sh,x,y,w,h)=>ctx.drawImage(bitmap,sx,sy,sw,sh,x,y,w,h),srcW,srcH,ctx,outW,outH,recipe,phase);
    await source.add(i/fps,1/fps,{keyFrame:i%(fps*2)===0});
    if(i%4===0) onProgress?.(i/frames);
  }
  source.close(); await output.finalize(); bitmap.close?.(); onProgress?.(1);
  return new Blob([output.target.buffer],{type:'video/mp4'});
}

async function sha256Blob(blob){ const data=new Uint8Array(await blob.arrayBuffer()); const dig=new Uint8Array(await crypto.subtle.digest('SHA-256',data)); return [...dig.slice(0,8)].map(v=>v.toString(16).padStart(2,'0')).join(''); }

async function renderOne(index,total){
  const ranges=currentRanges();
  const history=getHistory(sourceKey);
  const recipe=generateRecipe(ranges,history,selectedFile);
  const seedHex=hexSeed(recipe.seed);
  const spd=(recipe.speed||1).toFixed(4);
  const pitch=(((recipe.speed||1)-1)*100).toFixed(2);
  setProgress(0,`Вариант ${index+1}/${total} · seed ${seedHex} · speed ${spd}× (pitch ${pitch}%)`);
  const blob=selectedFile.type.startsWith('image/')
    ? await renderPhoto(selectedFile,recipe,p=>setProgress(p,`Вариант ${index+1}/${total} · seed ${seedHex} · рендер`))
    : await renderVideo(selectedFile,recipe,p=>setProgress(p,`Вариант ${index+1}/${total} · seed ${seedHex} · рендер`));
  const hash=await sha256Blob(blob);
  history.push({recipe,hash,createdAt:Date.now()});
  saveHistory(sourceKey,history);
  return {blob,recipe,hash};
}

function addResult(result,n){
  els.resultsPanel.classList.remove('hidden');
  const url=URL.createObjectURL(result.blob);generatedUrls.push(url);
  const card=document.createElement('article');card.className='result';
  const recipe=result.recipe;
  const seedHex=hexSeed(recipe.seed);
  const speed=(recipe.speed||1);
  const pitchPct=((speed-1)*100).toFixed(2);
  card.innerHTML=`<video controls playsinline src="${url}"></video><div class="result-body"><div class="result-meta mono">#${n} · seed ${seedHex} · ${result.hash}<br>zoom ${recipe.zoom.toFixed(3)}× · crop ${Math.round(recipe.edgeCrop||0)}px · grain ${(recipe.grain||0).toFixed(1)}% · speed ${speed.toFixed(4)}× (pitch ${pitchPct}%) · C ${recipe.contrast.toFixed(1)} · S ${recipe.saturation.toFixed(1)}</div><div class="result-actions"><a class="action" download="reelforge-${result.hash}.mp4" href="${url}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M5 19h14"/></svg><span>Сохранить MP4</span></a></div></div>`;
  els.results.prepend(card);
}

async function processSelected(){
  if(!selectedFile||!MB) return;
  els.processBtn.disabled=true; setStatus('');
  const count=Number(els.variantCount.value);
  try{
    for(let i=0;i<count;i++){ const res=await renderOne(i,count); addResult(res,i+1); }
    setProgress(1,'Готово'); setStatus(`Создано вариантов: ${count}.`);
  }catch(err){ console.error(err); setStatus(err?.message||String(err),true); }
  finally{ els.processBtn.disabled=false; }
}

async function handleFile(file){
  if(!file) return; selectedFile=file; els.processBtn.disabled=true; setStatus('Анализ файла');
  sourceKey=await sourceFingerprint(file); updateHistoryCount();
  const mb=(file.size/1024/1024).toFixed(1);els.fileMeta.classList.remove('hidden');els.fileMeta.textContent=`${file.name} · ${mb} MB · ${file.type||'unknown'}`;
  els.processBtn.disabled=!MB; setStatus(MB?'Готово к обработке':'Медиа-движок ещё загружается');
}

els.pickBtn.addEventListener('click',()=>els.fileInput.click());
els.fileInput.addEventListener('change',()=>handleFile(els.fileInput.files?.[0]));
els.modeControl.addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-mode]');if(!b)return;
  const sameMode=b.dataset.mode===currentMode;
  applyMode(b.dataset.mode);
  if(sameMode && b.dataset.mode==='auto'){
    setStatus('АВТО: параметры перегенерированы, нажмите «Создать вариант».');
  }
});
els.autoZoom.addEventListener('change',()=>{ if(currentMode==='auto') randomizeAutoRanges(true); });
els.autoPan.addEventListener('change',()=>{ if(currentMode==='auto') randomizeAutoRanges(true); });
els.presetSelect.addEventListener('change',()=>applyPresetValue(els.presetSelect.value));
els.savePresetBtn.addEventListener('click',()=>{ const name=prompt('Название пресета');if(!name)return;const id=`p_${Date.now()}`;const all=getUserPresets();all[id]={name,ranges:currentRanges()};localStorage.setItem('rf_user_presets',JSON.stringify(all));loadPresetOptions();els.presetSelect.value=`user:${id}`;applyPresetValue(`user:${id}`); });
els.processBtn.addEventListener('click',processSelected);
els.clearResults.addEventListener('click',()=>{generatedUrls.forEach(URL.revokeObjectURL);generatedUrls=[];els.results.innerHTML='';els.resultsPanel.classList.add('hidden');});
loadPresetOptions();renderRanges(autoRanges());

if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});

(async()=>{
  try{
    if(typeof VideoEncoder==='undefined'||typeof VideoDecoder==='undefined') throw new Error('WebCodecs недоступен');
    MB=await import(MB_URL);
    const canVideo=await MB.canEncodeVideo('avc',{width:720,height:1280});
    if(!canVideo) throw new Error('H.264 encoder недоступен');
    if(selectedFile) els.processBtn.disabled=false;
  }catch(err){
    console.error(err);setStatus('Этот браузер не даёт кодировать H.264. На iPhone нужен актуальный Safari/iOS.',true);
  }
})();