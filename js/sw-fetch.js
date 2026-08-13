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

// Decide whether the service worker should apply its cache strategy to a
// request. ONLY same-origin GET requests (the app shell + its modules/assets)
// are handled. Cross-origin requests — the GitHub Contents API, Telegram, Web
// Push endpoints — must bypass the SW and hit the network directly:
//   • their own AbortController timeouts only work on a direct page fetch;
//     re-fetching them inside the SW drops the signal, so a stalled request
//     hangs forever (the mobile-PWA "End Tournament hangs on finalize" bug);
//   • caching auth'd, one-off API responses is wrong and can serve stale data.
export function shouldHandleRequest(request, selfOrigin) {
  if (!request || request.method !== 'GET') return false;
  let url;
  try { url = new URL(request.url); } catch { return false; }
  return url.origin === selfOrigin;
}
