// offline cache — při změně appky zvednout verzi
const V = 'gnbar-6';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
// síť napřed (ať se ceník/oprava propíše), ale nejdéle 2,5 s — na přetížené síti v hale pak z cache
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  e.respondWith((async () => {
    const z = await caches.match(r, { ignoreSearch: true });
    const sit = fetch(r).then(res => {
      // do cache jen platné odpovědi bez parametrů (návrat ze SumUpu nese ?sumup=…)
      // ne přesměrování (přihlašovací stránka Wi-Fi) ani cizí odpověď
      if (res.ok && !res.redirected && res.type === 'basic' && !u.search) { const k = res.clone(); caches.open(V).then(c => c.put(r, k)); }
      return res;
    });
    if (!z) return sit;
    return Promise.race([sit.catch(() => z), new Promise(ok => setTimeout(() => ok(z), 2500))]);
  })());
});
