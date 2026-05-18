// Portal service worker. Scoped to portal.docksbase.com — by serving
// this file from that origin, the SW can never intercept requests to
// booking.docksbase.com (different origin, separate registration scope).
const CACHE = 'marina-portal-v2';
const PRECACHE = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Don't cache API requests or portal endpoints
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/portal/')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
