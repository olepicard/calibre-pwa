/**
 * Calibre-Web PWA - Service Worker
 * Provides offline caching for static assets, WASM binary, and offline library functionality.
 */

const CACHE_NAME = 'calibre-web-pwa-v2.4';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png',
  './favicon.ico',
  './css/app.css',
  './lib/sql-wasm.js',
  './lib/sql-wasm.wasm',
  './lib/jszip.min.js',
  './lib/epub.min.js',
  './js/storage.js',
  './js/calibre-db.js',
  './js/reader-epub.js',
  './js/app.js',
  './sample-metadata.db',
  './sample.epub'
];

// Install: precache essential files bypassing stale HTTP disk cache ({ cache: 'reload' })
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Mise en cache fraîche des ressources PWA...');
      await Promise.all(
        PRECACHE_ASSETS.map(async (assetUrl) => {
          try {
            const req = new Request(assetUrl, { cache: 'reload' });
            const resp = await fetch(req);
            if (resp && resp.ok) {
              await cache.put(assetUrl, resp);
            }
          } catch (e) {
            console.warn('[SW] Precache skip:', assetUrl, e);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches, claim clients, and refresh open tabs that were running an older SW version
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      let hadOldCache = false;
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            hadOldCache = true;
            console.log('[SW] Suppression ancien cache :', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
      await self.clients.claim();
      if (hadOldCache) {
        const windowClients = await self.clients.matchAll({ type: 'window' });
        for (const client of windowClients) {
          try {
            await client.navigate(client.url);
          } catch (e) {}
        }
      }
    })
  );
});

// Fetch: Network-first for HTML/JS/CSS so updates apply immediately on Android, Cache-first for binaries/WASM
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);
  const isCodeOrHtml =
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  if (isCodeOrHtml) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
