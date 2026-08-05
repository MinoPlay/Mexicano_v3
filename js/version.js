// Version lives in sw.js (single source of truth). Re-export for app use.
// Bump APP_VERSION by +1 each release in sw.js.
import { APP_VERSION } from '../sw.js';

export { APP_VERSION };

export function getVersionLabel() {
  return `mexicano-v${APP_VERSION}`;
}

// Clear caches, UNREGISTER the service worker, and reload so the page comes
// back with no SW controlling it and re-fetches every asset fresh from network.
export async function refreshApp() {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } finally {
    if (typeof location !== 'undefined') location.reload();
  }
}
