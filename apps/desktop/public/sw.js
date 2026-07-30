const CACHE_NAME = "joessh-v2";
const MAX_CACHE_ENTRIES = 100;
const PRECACHE_URLS = ["/", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Skip API/data requests; only cache static assets and navigation
  const isStaticAsset =
    /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico)(?:\?|$)/.test(
      url.pathname,
    );
  const isNavigation = request.mode === "navigate";
  const isManifest = url.pathname === "/manifest.json";

  if (!isStaticAsset && !isNavigation && !isManifest) return;

  // Stale-while-revalidate for static assets (serve cache immediately, update in background)
  if (isStaticAsset || isManifest) {
    event.respondWith(staleWhileRevalidate(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
        trimCache(cache);
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
      trimCache(cache);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const root = await caches.match("/");
    if (root) return root;
    const offlineResponse = await caches.match("/offline.html");
    return (
      offlineResponse ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE_ENTRIES) {
    await cache.delete(keys[0]);
  }
}
