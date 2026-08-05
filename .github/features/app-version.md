# App Version & Refresh

## Behaviour
App carry simple integer version. No more guid/datetime cache name.

- Version = single integer digit, bump by +1 each release.
- Single source of truth: `sw.js` -> `export const APP_VERSION` (Number).
- `sw.js` is a **module service worker** (`register('./sw.js', { type: 'module' })`) that
  declares `APP_VERSION` and derives `CACHE_NAME = ` + "`mexicano-v${APP_VERSION}`" + `.
- **Fetch strategy = network-first**: every request tries the network (so opening the app
  pulls the latest files and refreshes the cache); cache is used only as offline fallback.
- **Auto-update**: `js/app.js` reloads the page once on `controllerchange` (only when a
  controller already existed = an update, not first install), forcing latest build on open.
- `js/version.js` `import { APP_VERSION } from '../sw.js'` and re-exports it. No manual duplicate to keep in sync.
- Cache name label = `mexicano-v<APP_VERSION>` (e.g. `mexicano-v5`).

## Settings Tab
Version button lives in the Settings page header row: title `Settings` anchored left,
button `#app-refresh-btn` anchored right, styled blue (`btn btn-primary`), label = `getVersionLabel()` (e.g. `mexicano-v3`).
- Click -> `refreshApp()`:
  - clear all caches (`caches.keys()` -> delete),
  - **unregister** all service worker registrations (so reload runs with no SW controlling),
  - `location.reload()` to pull latest files fresh from network. SW re-registers on load.

## API — `js/version.js`
- `APP_VERSION` — Number, re-exported from `sw.js`.
- `getVersionLabel()` — returns `mexicano-v<APP_VERSION>`.
- `refreshApp()` — async; clears caches, unregisters SW, reloads. Guards missing `caches`/`serviceWorker`.

## Bump rule
Release = increment `APP_VERSION` in `sw.js`. That's the only edit —
`js/version.js` imports `APP_VERSION` and `sw.js` derives `CACHE_NAME` automatically.
