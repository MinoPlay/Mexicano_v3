/** PWA install banner — see features/pwa-install-prompt.md for full reference */

let deferredPrompt = null;

export function initInstallPrompt() {
  // Already installed (standalone) — nothing to do.
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  // Always capture the event (needed for settings install button too).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Only show the banner automatically if not previously dismissed.
    if (localStorage.getItem('mexicano_install_dismissed') !== 'true') {
      setTimeout(showBanner, 1500);
    }
  });

  window.addEventListener('appinstalled', () => {
    hideBanner();
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

let bannerEl = null;

function showBanner() {
  if (bannerEl) return;

  bannerEl = document.createElement('div');
  bannerEl.className = 'install-prompt';

  const icon = document.createElement('img');
  icon.src = 'assets/icons/icon-192.png';
  icon.alt = '';
  icon.className = 'install-prompt__icon';

  const text = document.createElement('span');
  text.className = 'install-prompt__text';
  text.textContent = 'Install Mexicano';

  const installBtn = document.createElement('button');
  installBtn.className = 'btn btn-primary btn-sm install-prompt__btn';
  installBtn.textContent = 'Install';
  installBtn.addEventListener('click', async () => {
    hideBanner();
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn btn-ghost btn-sm install-prompt__btn';
  dismissBtn.textContent = 'Not now';
  dismissBtn.addEventListener('click', () => {
    localStorage.setItem('mexicano_install_dismissed', 'true');
    hideBanner();
  });

  bannerEl.appendChild(icon);
  bannerEl.appendChild(text);
  bannerEl.appendChild(installBtn);
  bannerEl.appendChild(dismissBtn);
  document.body.appendChild(bannerEl);
}

function hideBanner() {
  if (!bannerEl) return;
  bannerEl.classList.add('install-prompt--hiding');
  bannerEl.addEventListener('animationend', () => bannerEl?.remove(), { once: true });
  bannerEl = null;
}
