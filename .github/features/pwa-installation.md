# PWA Installation

## Behaviour
Mexicano uses **native browser install affordances** — no custom install button.

The browser decides when the PWA is installable and surfaces its own UI:
- **Android Chrome**: mini-infobar at bottom, or "Add to Home Screen" in browser menu
- **Desktop Chrome/Edge**: install icon in address bar
- **iOS Safari**: "Add to Home Screen" via Share sheet (browser limitation — no API)

## What we do NOT do
- Do NOT call `e.preventDefault()` on `beforeinstallprompt`
- Do NOT show a custom install button that requires the deferred prompt event

## Settings Page
The Settings page shows install status only:
- If running as installed PWA (`display-mode: standalone`): show "App is installed ✅"
- Otherwise: show informational text pointing to browser menu

## Service Worker
Registered in `index.html` inline script (not a module) so it runs on every page load regardless of JS module loading order.

## Manifest
`manifest.json` at repo root. Required fields: `name`, `short_name`, `start_url`, `display: standalone`, `icons` (192×192 and 512×512 PNG).

## Icons
`assets/icons/icon-192.png` and `assets/icons/icon-512.png`.
Both use `purpose: "any maskable"`.
