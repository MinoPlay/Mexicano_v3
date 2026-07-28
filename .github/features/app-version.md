# App Version & Refresh

## Behaviour
App carry simple integer version. No more guid/datetime cache name.

- Version = single integer digit (current `4`), bump by +1 each release.
- Single source of truth: `js/version.js` -> `APP_VERSION` (Number).
- Cache name label = `mexicano-v<APP_VERSION>` (e.g. `mexicano-v4`).
- `sw.js` `CACHE_NAME` = `mexicano-v<APP_VERSION>`, set manually to match `js/version.js` (no git hook).

## Settings Tab
Version button lives in the Settings page header row: title `Settings` anchored left,
button `#app-refresh-btn` anchored right, styled blue (`btn btn-primary`), label = `getVersionLabel()` (e.g. `mexicano-v3`).
- Click -> `refreshApp()`:
  - clear all caches (`caches.keys()` -> delete),
  - update service worker registration,
  - `location.reload()` to pull latest files from network.

## API — `js/version.js`
- `APP_VERSION` — Number (current: `4`).
- `getVersionLabel()` — returns `mexicano-v<APP_VERSION>`.
- `refreshApp()` — async; clears caches, updates SW, reloads. Guards missing `caches`/`serviceWorker`.

## Bump rule
Release = increment `APP_VERSION` in `js/version.js` AND set matching `CACHE_NAME = 'mexicano-v<APP_VERSION>'` in `sw.js`. Both manual — no git hook.
