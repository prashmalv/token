const CACHE_NAME = 'daystar-queue-cache-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/mobile.html',
  '/display.html',
  '/counter.html',
  '/manifest.json',
  '/socket.io/socket.io.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(resp => resp || fetch(event.request))
  );
});
