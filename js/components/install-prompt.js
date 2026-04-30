/** PWA install — install prompt is triggered from Settings only, never auto-shown. */

let deferredPrompt = null;

export function initInstallPrompt() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

/** Returns true when a native install prompt is available. */
export function canInstall() {
  return !!deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches;
}

/** Trigger the native install prompt programmatically (e.g. from Settings). */
export async function triggerInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}
