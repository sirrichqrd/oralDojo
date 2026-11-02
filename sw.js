const CACHE_NAME = 'oraldojo-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/assets/social-preview.png',
  '/assets/logo/oldo-logo.png',
  '/dojo-data.js',
  '/favicon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Network first for HTML, cache first for assets
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE_NAME).then(c=>c.put(req, copy));
        return res;
      }).catch(()=>caches.match(req).then(r=>r || caches.match('/index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        // cache successful GETs
        if(res.ok && req.method==='GET'){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(c=>c.put(req, copy));
        }
        return res;
      });
    })
  );
});