// Single source of truth for the app version / cache name.
// Bump APP_VERSION by +1 each release AND set matching CACHE_NAME in sw.js.
export const APP_VERSION = 3;

export function getVersionLabel() {
  return `mexicano-v${APP_VERSION}`;
}

// Clear caches, update the service worker, and reload to pull the latest files.
export async function refreshApp() {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    }
  } finally {
    if (typeof location !== 'undefined') location.reload();
  }
}
