/** PWA install — native browser behaviour. No e.preventDefault(). */

/** Returns true when running as an installed PWA. */
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches;
}
