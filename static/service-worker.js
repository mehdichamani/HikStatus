const CACHE_NAME = 'hikstatus-cache-v6';
const ASSETS = [
  '/login',
  '/static/style.css',
  '/static/app.js',
  '/static/logo.webp',
  '/static/index.html',
  '/static/login.html',
  '/static/qrcode.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each asset individually so a single failure doesn't break the whole install
      return Promise.allSettled(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('SW: failed to cache', url, err.message);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Do not intercept API, WebSocket or non-GET requests
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh in background and update cache (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* ignore network errors */});
        
        return cachedResponse;
      }
      // No cache hit — go to network, then cache successful responses
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return networkResponse;
      });
    }).catch(() => {
      // Both cache and network failed — return a basic offline response for navigation
      if (event.request.mode === 'navigate') {
        return caches.match('/login');
      }
      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});
