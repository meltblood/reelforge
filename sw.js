const CACHE='reelforge-pwa-10';
const LOCAL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/favicon-32.png','./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png'];
const EXTERNAL=['https://cdn.jsdelivr.net/npm/mediabunny@1.56.1/dist/bundles/mediabunny.min.mjs'];
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(LOCAL);for(const u of EXTERNAL){try{const r=await fetch(u,{mode:'cors'});if(r.ok)await c.put(u,r);}catch{}}self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==CACHE)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith((async()=>{const hit=await caches.match(e.request);if(hit)return hit;try{const r=await fetch(e.request);if(r.ok){const c=await caches.open(CACHE);c.put(e.request,r.clone());}return r;}catch{return caches.match('./index.html');}})());});
