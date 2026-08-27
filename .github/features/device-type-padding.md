# Feature: Device Type (Android / iPhone) Top Padding

Settings option to tell the app which device it runs on, so iPhone users get
extra top padding to clear the iOS status bar / notch.

## Truth
- Setting stored in localStorage key `mexicano_device_type` (string: `'android'` | `'iphone'`).
- Accessed via `Store.getDeviceType()` / `Store.setDeviceType(type)`.
- **Default = `'android'`** when nothing stored (no extra padding, preserves prior behavior).
- `Store.applyDeviceType()` toggles `document.body.classList` with `device-iphone`
  based on the current stored value. Called once on app init (`js/app.js`) and
  again immediately after `setDeviceType()` persists the new value.

## Behavior
- `device_type === 'iphone'` => `document.body` has class `device-iphone` =>
  CSS applies `padding-top: env(safe-area-inset-top, 20px)` on `body` so fixed
  headers/content aren't hidden under the iOS status bar/notch.
- `device_type === 'android'` (or unset) => no `device-iphone` class => no extra
  top padding (unchanged behavior).
- Invalid/unknown stored value falls back to `'android'` behavior.

## UI
- Settings page → new "Device" section (visible to all users, not admin-gated):
  a toggle switch `#device-type-toggle` labeled "iPhone Device" (same `.switch` style as
  the Logs toggle).
- Toggling ON calls `Store.setDeviceType('iphone')`; toggling OFF calls
  `Store.setDeviceType('android')`. Both persist and re-apply the body class
  immediately (no reload needed) and show a toast.

## Key Files
- `js/store.js` — `getDeviceType`, `setDeviceType`, `applyDeviceType`.
- `js/app.js` — calls `Store.applyDeviceType()` once during `init()`.
- `js/pages/settings.js` — renders the Device section and wires the select.
- `css/base.css` — `body.device-iphone { padding-top: env(safe-area-inset-top, 20px); }`.

## Acceptance (input => expected)
- No stored value => `Store.getDeviceType()` === `'android'`.
- `setDeviceType('iphone')` => `getDeviceType()` === `'iphone'` (persisted).
- `setDeviceType('android')` => `getDeviceType()` === `'android'`.
- After `setDeviceType('iphone')` => `document.body.classList.contains('device-iphone')` === `true`.
- After `setDeviceType('android')` => `document.body.classList.contains('device-iphone')` === `false`.
- `applyDeviceType()` with no stored value => body has NO `device-iphone` class.
