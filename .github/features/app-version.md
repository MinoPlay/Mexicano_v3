# App Version & Refresh

## Behaviour
App carry simple integer version. No more guid/datetime cache name.

- Version = single integer digit (start `1`), bump by +1 each release.
- Single source of truth: `js/version.js` -> `APP_VERSION` (Number).
- Cache name label = `mexicano-v<APP_VERSION>` (e.g. `mexicano-v1`).
- `sw.js` `CACHE_NAME` MUST equal `mexicano-v<APP_VERSION>`. Bump both together.

## Settings Tab
Settings page show "App Version" section:
- Display current version label from `getVersionLabel()` in `#app-version`.
- Refresh button `#app-refresh-btn` -> `refreshApp()`:
  - clear all caches (`caches.keys()` -> delete),
  - update service worker registration,
  - `location.reload()` to pull latest files from network.

## API — `js/version.js`
- `APP_VERSION` — Number (current: `1`).
- `getVersionLabel()` — returns `mexicano-v<APP_VERSION>`.
- `refreshApp()` — async; clears caches, updates SW, reloads. Guards missing `caches`/`serviceWorker`.

## Bump rule
Release = increment `APP_VERSION` in `js/version.js` AND set matching `CACHE_NAME` in `sw.js`.
