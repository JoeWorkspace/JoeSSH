const CACHE_NAME = 'joessh-admin-v2';
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

  // Never place authenticated API responses in Cache Storage, even when a
  // route happens to end in an asset-like extension.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Only cache static assets and navigation.
  const isStaticAsset = /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico)(?:\?|$)/.test(url.pathname);
  const isNavigation = request.mode === 'navigate';
  const isManifest = url.pathname === '/manifest.json';

  if (!isStaticAsset && !isNavigation && !isManifest) {
    return;
  }

  // Network-first for navigation (HTML pages)
  if (isNavigation) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone());
      trimCache(cache);
    }
    return response;
  }).catch(() => cached || offlineResponse());

  return cached || fetchPromise;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
        await trimCache(cache);
      } catch {
        // Cache write failures must not hide a valid network response.
      }
    }
    return response;
  } catch {
    return (
      (await caches.match(request)) ||
      (await caches.match('/')) ||
      (await caches.match('/offline.html')) ||
      offlineResponse()
    );
  }
}

function isCacheableResponse(response) {
  const cacheControl = response.headers.get('Cache-Control') || '';
  return (
    response.ok &&
    response.type === 'basic' &&
    !response.redirected &&
    !/(?:^|,)\s*(?:private|no-store)\b/i.test(cacheControl)
  );
}

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE_ENTRIES) {
    await cache.delete(keys[0]);
  }
}
