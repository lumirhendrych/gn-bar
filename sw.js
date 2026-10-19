// offline cache — při změně appky zvednout verzi
const V = 'gnbar-2';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
// síť napřed (ať se ceník/oprava propíše), bez signálu z cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const k = r.clone(); caches.open(V).then(c => c.put(e.request, k)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
