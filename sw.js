const CACHE = 'dhr-v1';
const SHELL = [
  '/dhr-app.html',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for app shell
  if (e.request.url.includes('anthropic') || e.request.url.includes('facebook') || e.request.url.includes('workers.dev')) {
    return; // Let API calls go straight to network
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
