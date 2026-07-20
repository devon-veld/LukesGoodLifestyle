/* Self-destructing service worker.
   An earlier deployment of this domain registered a caching service worker.
   Browsers that still have it check this URL for updates — this replacement
   immediately unregisters itself, wipes all caches and reloads open tabs,
   returning every visitor to plain (fast, correct) network loading. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) {}
  })());
});
