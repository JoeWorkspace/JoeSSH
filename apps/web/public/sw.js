const CACHE_NAME = 'joessh-admin-v1';
const MAX_CACHE_ENTRIES = 100;
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/favicon.svg', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip API/data requests; only cache static assets and navigation
  const isStaticAsset = /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico)(?:\?|$)/.test(url.pathname);
  const isNavigation = request.mode === 'navigate';
  const isManifest = url.pathname === '/manifest.json';

  if (!isStaticAsset && !isNavigation && !isManifest) {
    return;
  }

  // Network-first for navigation (HTML pages)
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
            trimCache(cache);
          });
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached || caches.match('/').then((root) =>
              root || caches.match('/offline.html').then((offline) =>
                offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
              )
            )
          )
        ),
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(cache);
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE_ENTRIES) {
    await cache.delete(keys[0]);
  }
}
