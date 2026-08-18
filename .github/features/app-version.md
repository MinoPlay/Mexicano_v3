# App Version & Refresh

## Behaviour
App carry simple integer version. No more guid/datetime cache name.

- Version = single integer digit, bump by +1 each release.
- Single source of truth: `sw.js` -> `export const APP_VERSION` (Number).
- `sw.js` is a **module service worker** (`register('./sw.js', { type: 'module' })`) that
  declares `APP_VERSION` and derives `CACHE_NAME = ` + "`mexicano-v${APP_VERSION}`" + `.
- **Fetch strategy = network-first with HTTP-cache bypass**: every request tries the
  network using `fetch(req, { cache: 'reload' })` (implemented in `js/sw-fetch.js`
  `networkFirst`, imported by `sw.js`), so opening the app pulls the latest files and
  refreshes the Cache API; the versioned cache is used only as an offline fallback. The
  `cache: 'reload'` bypass is required so dynamically-imported modules (e.g.
  `js/pages/settings.js`) are never served stale from the browser HTTP disk cache on
  devices that cannot force-reload (installed mobile PWAs).
- **Auto-update**: `js/app.js` reloads the page once on `controllerchange` (only when a
  controller already existed = an update, not first install), forcing latest build on open.
- `js/version.js` `import { APP_VERSION } from '../sw.js'` and re-exports it. No manual duplicate to keep in sync.
- Cache name label = `mexicano-v<APP_VERSION>` (e.g. `mexicano-v5`).

## Home Tab
Version + refresh live in the Home page header title:
`#home-title` renders `🎾 Mexicano v<APP_VERSION>` followed by `#app-refresh-btn`
(refresh icon `↻`, transparent button inside the `h1`).
- Refresh icon click -> `stopPropagation()` (so the title's clear-cache handler does not
  fire) then `refreshApp()`:
  - clear all caches (`caches.keys()` -> delete),
  - `location.reload()` to pull latest files fresh from network.
  - The SW is **kept registered** on purpose: its network-first strategy uses
    `cache: 'reload'` (see `js/sw-fetch.js`), so the controlled reload re-fetches every
    asset fresh. Unregistering would leave the reload uncontrolled and let the browser
    HTTP cache serve stale modules.
- Title text click (outside the icon) keeps its existing behaviour: clear cached
  tournament data and reload.

## Settings Tab
No version/refresh button — it was moved to the Home header.

## API — `js/version.js`
- `APP_VERSION` — Number, re-exported from `sw.js`.
- `getVersionLabel()` — returns `mexicano-v<APP_VERSION>`.
- `refreshApp()` — async; clears caches and reloads (keeps SW registered so the
  network-first `cache: 'reload'` strategy re-fetches fresh). Guards missing `caches`/`location`.

## Bump rule
Release = increment `APP_VERSION` in `sw.js`. That's the only edit —
`js/version.js` imports `APP_VERSION` and `sw.js` derives `CACHE_NAME` automatically.
