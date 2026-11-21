/**
 * Calibre-Web PWA - Service Worker
 * Provides offline caching for static assets, WASM binary, and offline library functionality.
 */

const CACHE_NAME = 'calibre-web-pwa-v2.1';

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

// Install: precache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Mise en cache des ressources PWA...');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Suppression ancien cache :', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Cache-first strategy for app shell & assets
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and non-chrome-extension URLs
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Cache valid responses for app assets
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // If offline and request is HTML navigation, fallback to cached index.html
        if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
        throw err;
      });
    })
  );
});
