const CACHE='reelforge-pwa-14';
const LOCAL=['./','./index.html','./styles.css?v=14','./app.js?v=14','./manifest.webmanifest','./icons/favicon-32.png','./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png'];
const EXTERNAL=['https://cdn.jsdelivr.net/npm/mediabunny@1.56.1/dist/bundles/mediabunny.min.mjs'];
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(LOCAL);for(const u of EXTERNAL){try{const r=await fetch(u,{mode:'cors'});if(r.ok)await c.put(u,r);}catch{}}self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==CACHE)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  const appAsset=url.origin===self.location.origin && (
    e.request.mode==='navigate' || url.pathname.endsWith('/app.js') || url.pathname.endsWith('/styles.css')
  );
  e.respondWith((async()=>{
    if(appAsset){
      try{
        const fresh=await fetch(e.request,{cache:'no-store'});
        if(fresh.ok){const c=await caches.open(CACHE);await c.put(e.request,fresh.clone());}
        return fresh;
      }catch{
        return (await caches.match(e.request)) || caches.match('./index.html');
      }
    }
    const hit=await caches.match(e.request);
    if(hit) return hit;
    try{
      const fresh=await fetch(e.request);
      if(fresh.ok){const c=await caches.open(CACHE);await c.put(e.request,fresh.clone());}
      return fresh;
    }catch{
      return caches.match('./index.html');
    }
  })());
});
