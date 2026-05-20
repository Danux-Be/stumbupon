// Service Worker — StumbUpon.com
const CACHE = 'stumble-v2';
const STATIC = [
  '/style.css',
  '/app.js',
  '/js/alpine.min.js',
  '/offline',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET et les ressources externes
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Assets statiques : cache-first
  if (url.pathname.match(/\.(css|js|svg|png|ico|woff2?)$/)) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return res;
      }))
    );
    return;
  }

  // Navigation HTML : network-first, fallback offline
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/offline'))
    );
    return;
  }
});
