// sw.js — Service Worker
// HTMLページ（ナビゲーション）はキャッシュせず常にネットワークから取得。
// JS / CSS / 画像等の静的アセットのみ network-first でキャッシュ。

const CACHE = 'shift-system-v4';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // 古いバージョンのキャッシュをすべて削除
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // ── HTMLページ（画面遷移）は SW をスルーして常に新鮮なレスポンスを返す ──
  // Ctrl+Shift+R と同じ動作をページ遷移でも実現する
  if (event.request.mode === 'navigate') return;

  // ── 静的アセット（JS / CSS / 画像）は network-first でキャッシュ ──
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
