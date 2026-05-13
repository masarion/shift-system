// sw.js — Service Worker (cache-first strategy)

const CACHE = 'shift-system-v1';

const ASSETS = [
  './',
  './index.html',
  './staff.html',
  './css/common.css',
  './css/staff.css',
  './js/mockData.js',
  './js/utils.js',
  './js/storage.js',
  './js/modal.js',
  './js/calendar.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin assets
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses for same-origin requests
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
