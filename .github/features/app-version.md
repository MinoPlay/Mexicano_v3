# App Version & Refresh

## Behaviour
App carry simple integer version. No more guid/datetime cache name.

- Version = single integer digit (current `2`), bump by +1 each release.
- Single source of truth: `js/version.js` -> `APP_VERSION` (Number).
- Cache name label = `mexicano-v<APP_VERSION>` (e.g. `mexicano-v2`).
- `sw.js` `CACHE_NAME` is auto-synced to `mexicano-v<APP_VERSION>` by the `.git/hooks/pre-commit` hook.

## Settings Tab
Top of Settings page (above Current User), compact, right-aligned:
- Refresh button `#app-refresh-btn`, its label = `getVersionLabel()` (e.g. `mexicano-v1`).
- Click -> `refreshApp()`:
  - clear all caches (`caches.keys()` -> delete),
  - update service worker registration,
  - `location.reload()` to pull latest files from network.

## API — `js/version.js`
- `APP_VERSION` — Number (current: `2`).
- `getVersionLabel()` — returns `mexicano-v<APP_VERSION>`.
- `refreshApp()` — async; clears caches, updates SW, reloads. Guards missing `caches`/`serviceWorker`.

## Bump rule
Release = increment `APP_VERSION` in `js/version.js`. The pre-commit hook rewrites `CACHE_NAME` in `sw.js` to match.
