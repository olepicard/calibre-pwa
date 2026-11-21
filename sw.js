/**
 * Calibre-Web PWA - Service Worker
 * Provides 100% offline caching for static assets, WASM binary, and offline library functionality.
 */

const CACHE_NAME = 'calibre-web-pwa-v2.5';

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

/**
 * Strip the `redirected` flag from a Response if present so Chrome never rejects
 * serving it for a top-level navigation request.
 */
async function cleanRedirectedResponse(response) {
  if (!response || !response.redirected) {
    return response;
  }
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
}

/**
 * Look up a request in CacheStorage (ignoring query strings like ?v=2.2),
 * with automatic fallback to index.html for navigation requests.
 */
async function matchFromCache(request, isNavigation = false) {
  const cache = await caches.open(CACHE_NAME);

  // 1. Direct match ignoring search query params (?v=2.2)
  let cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  // 2. Global caches match fallback
  cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  // 3. If navigation or HTML document request, return cached ./index.html or ./
  if (isNavigation) {
    cached =
      (await cache.match('./index.html', { ignoreSearch: true })) ||
      (await cache.match('./', { ignoreSearch: true })) ||
      (await caches.match('./index.html', { ignoreSearch: true })) ||
      (await caches.match('./', { ignoreSearch: true }));
    if (cached) return cached;
  }

  return null;
}

// Install: precache all essential files bypassing stale HTTP disk cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Mise en cache hors-ligne des ressources PWA...');
      await Promise.all(
        PRECACHE_ASSETS.map(async (assetUrl) => {
          try {
            // Use URL string (never a navigate Request object) with cache: 'reload'
            const resp = await fetch(assetUrl, { cache: 'reload' });
            if (resp && resp.ok) {
              const cleanResp = await cleanRedirectedResponse(resp);
              await cache.put(assetUrl, cleanResp);
            }
          } catch (e) {
            console.warn('[SW] Precache fallback:', assetUrl, e);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Suppression ancien cache :', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
      await self.clients.claim();
    })
  );
});

// Fetch: 100% Offline-capable handler wrapped in async try/catch
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const acceptHeader = request.headers.get('accept') || '';
  const isNavigation =
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    acceptHeader.includes('text/html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html');

  const isCodeAsset =
    isNavigation ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.webmanifest');

  event.respondWith(
    (async () => {
      // 1. If browser explicitly knows it is offline, serve immediately from cache (0 ms)
      if (typeof self.navigator !== 'undefined' && self.navigator.onLine === false) {
        const offlineCached = await matchFromCache(request, isNavigation);
        if (offlineCached) return offlineCached;
      }

      // 2. For HTML/JS/CSS: try network first (using URL string to avoid navigate RequestInit TypeError!)
      //    with a 2.5s timeout, falling back to CacheStorage when offline.
      if (isCodeAsset) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2500);
          // IMPORTANT: pass request.url (string), NOT request object, when specifying { cache: 'no-cache' }
          // because new Request(navigateRequest, { cache: 'no-cache' }) throws a synchronous TypeError!
          const networkResponse = await fetch(request.url, {
            cache: 'no-cache',
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (networkResponse && networkResponse.status === 200) {
            const cleanResp = await cleanRedirectedResponse(networkResponse);
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, cleanResp.clone()).catch(() => {});
            return cleanResp;
          }
        } catch (err) {
          // Network offline or timed out -> serve from cache!
        }

        const cachedFallback = await matchFromCache(request, isNavigation);
        if (cachedFallback) return cachedFallback;
      }

      // 3. For binaries (.wasm, .db, .epub, .png, .ico): Cache-first for maximum speed & offline reliability
      const cachedBinary = await matchFromCache(request, isNavigation);
      if (cachedBinary) {
        return cachedBinary;
      }

      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
          const cleanResp = await cleanRedirectedResponse(networkResponse);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, cleanResp.clone()).catch(() => {});
          return cleanResp;
        }
        return networkResponse;
      } catch (err) {
        const lastResort = await matchFromCache(request, true);
        if (lastResort) return lastResort;
        throw err;
      }
    })()
  );
});
