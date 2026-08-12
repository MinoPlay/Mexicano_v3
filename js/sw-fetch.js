// Network-first fetch strategy for the service worker.
//
// The network fetch MUST bypass the browser HTTP disk cache (`cache: 'reload'`)
// so every online load pulls the latest build. Without this, dynamically
// imported modules (e.g. js/pages/*.js) can be served stale on devices that
// cannot force-reload (installed mobile PWAs), so app updates never appear.
//
// Falls back to the versioned Cache API — and finally the offline shell — only
// when the network is unreachable.
export function networkFirst(request, { fetch, caches, cacheName, offlineFallback = './index.html' }) {
  return fetch(request, { cache: 'reload' })
    .then((res) => {
      const copy = res.clone();
      caches.open(cacheName).then(cache => cache.put(request, copy)).catch(() => {});
      return res;
    })
    .catch(() => caches.match(request).then(cached => cached || caches.match(offlineFallback)));
}
