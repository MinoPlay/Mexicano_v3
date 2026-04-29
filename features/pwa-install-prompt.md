# PWA Install Prompt

## Summary
Show a bottom banner when the browser fires `beforeinstallprompt`, letting the user install the app as a PWA.

## How It Works (Architecture)

### Entry point
`app.js` calls `initInstallPrompt()` (imported from `js/components/install-prompt.js`) inside `init()`.

### Flow
1. Window listens for `beforeinstallprompt` — browser fires this when install criteria are met.
2. Event is `preventDefault()`-ed to suppress the browser's default mini-infobar.
3. After a 1.5 s delay, the banner is injected into `<body>`.
4. **Install** button → calls `deferredPrompt.prompt()`, awaits user choice, hides banner regardless of outcome.
5. **Not now** button → sets `localStorage.mexicano_install_dismissed = 'true'`, removes banner. Never shown again.
6. `appinstalled` event → removes banner if still visible.

### Skip conditions
- `window.matchMedia('(display-mode: standalone)').matches` → already installed, skip entirely.
- `localStorage.mexicano_install_dismissed === 'true'` → user said no before, skip entirely.

## Files
| File | Role |
|------|------|
| `js/components/install-prompt.js` | Component: event capture, banner DOM, button logic, exported helpers |
| `css/components.css` | `.install-prompt` styles (bottom banner, slide-up anim) |
| `js/app.js` | Import + call `initInstallPrompt()` |
| `js/pages/settings.js` | Import `canInstall`/`triggerInstall`, wire "Install App" section |
| `sw.js` | Cache bust + add new JS file to ASSETS |

## CSS Class
`.install-prompt` — fixed, `bottom: calc(var(--nav-height) + var(--space-sm))`, slide-up keyframe, uses existing design tokens.

## Settings Install Button
Settings → **Install App** section calls `canInstall()` / `triggerInstall()` exported from `install-prompt.js`.
- If running standalone → section hidden
- If prompt ready → Install button enabled; on click clears dismissed flag, triggers native prompt
- If prompt unavailable → button disabled, helper note shown

## Extending / Modifying
- **Change delay**: edit the `setTimeout` ms value in `install-prompt.js`.
- **Re-enable for dismissed users**: clear `localStorage.mexicano_install_dismissed`.
- **Custom icon**: swap `assets/icons/icon-192.png` src in the banner DOM builder.
- **Add "remind later"**: instead of setting dismissed flag, set a timestamp and check it on load.
- **iOS Safari**: `beforeinstallprompt` is NOT fired on iOS. To support iOS, detect `navigator.standalone === false` on iOS and show a manual "tap Share → Add to Home Screen" instruction instead.
