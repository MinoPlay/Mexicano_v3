// Version lives in sw.js (single source of truth). Re-export for app use.
// Bump APP_VERSION by +1 each release in sw.js.
import { APP_VERSION } from '../sw.js';
import { currentDeployId, isOwnCache } from './deploy-env.js';

export { APP_VERSION };

export function getVersionLabel() {
  return `mexicano-v${APP_VERSION}`;
}

// Clear this deploy's versioned caches (other previews/main untouched) and reload. The service worker is kept
// registered on purpose: its network-first strategy bypasses the HTTP disk
// cache (see js/sw-fetch.js), so the controlled reload re-fetches every asset
// fresh. Unregistering would leave the reload uncontrolled and let the browser
// HTTP cache serve stale modules (the mobile "stuck on old version" bug).
export async function refreshApp() {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      const id = currentDeployId();
      await Promise.all(keys.filter(k => isOwnCache(k, id)).map(k => caches.delete(k)));
    }
  } finally {
    if (typeof location !== 'undefined') location.reload();
  }
}
