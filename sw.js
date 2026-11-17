// Service worker: l'app funziona anche offline. Cambia VERSION a ogni rilascio.
const VERSION = 'coach-v3';
const ASSETS = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/engine.js', 'js/catalog.js',
  'js/stats.js', 'js/store.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rete prima (così gli aggiornamenti arrivano subito), cache se offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
