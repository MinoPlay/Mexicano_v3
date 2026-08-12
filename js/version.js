// Version lives in sw.js (single source of truth). Re-export for app use.
// Bump APP_VERSION by +1 each release in sw.js.
import { APP_VERSION } from '../sw.js';

export { APP_VERSION };

export function getVersionLabel() {
  return `mexicano-v${APP_VERSION}`;
}

// Clear the versioned Cache API and reload. The service worker is kept
// registered on purpose: its network-first strategy bypasses the HTTP disk
// cache (see js/sw-fetch.js), so the controlled reload re-fetches every asset
// fresh. Unregistering would leave the reload uncontrolled and let the browser
// HTTP cache serve stale modules (the mobile "stuck on old version" bug).
export async function refreshApp() {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } finally {
    if (typeof location !== 'undefined') location.reload();
  }
}
