---
name: tab-settings
description: >
  Reference skill for the Settings tab (route /settings) of the Mexicano PWA. Covers purpose,
  GitHub/PAT config, logs toggle, PWA install, version, key files, data flow. Use when working on the settings page.
---

# Settings tab

## Purpose
The Settings tab is the operational/admin page for local user identity, member management, GitHub backend configuration, diagnostics toggles, manual attendance entry, and Telegram alert testing.

It is rendered by `renderSettings(container, params)` in `js/pages/settings.js` and is mounted at route `/settings` from `js/app.js`.

## Rules / Logic
The page header shows `Settings`, the current-user avatar and selector. The version/refresh button no longer lives here — it moved to the Home page header title (`#home-title` → `#app-refresh-btn`).

Current user selection uses `Store.getCurrentUser()` and `Store.setCurrentUser(name)`. The avatar is the uppercase first character of the current user, or `?` when no user is selected. Changing user also reruns admin-gated visibility and shows a toast.

Admin detection uses `Store.isAdministrator()`, which compares the lowercased current user with the in-memory administrator list loaded through `Store.setAdministrators(list)`. In `settings.js`, the Members, Attendance, Logs, Custom Push, and Telegram Alerts sections are hidden for non-admin users. The GitHub Backend section is not hidden by this page-level admin gate.

The Members section reads names through `getMembers()`, renders a collapsible list, and allows admins to remove local members after `confirm()`. Adding a member validates a trimmed name, enforces a 1–50 character length, checks case-insensitive duplicates, calls `addPlayerToPlayersJson(name)` to append to GitHub `players.json`, then calls `addMember(name)` to update local Store/Cache and emits member change state from the members service.

The GitHub Backend section uses fixed repository fields in the UI:

```js
owner:    'MinoPlay'
repo:     'DataHub_Mexicano'
basePath: 'mexicano_v3/backup-data'
```

Only the PAT input is editable. Saved PAT is prefilled from `Store.getGitHubConfig()?.pat`. Save requires a non-empty PAT, calls `Store.setGitHubConfig({ owner, repo, pat, basePath })`, shows a toast, and reloads the page. Test temporarily saves the same config, sets the sync icon to `syncing`, calls `testConnection()`, then displays the returned message and sets the icon to `success` or `error`. Clear calls `Store.clearGitHubConfig()`, empties the PAT field, resets the icon to `idle`, and shows a toast.

Sync status uses `getSyncStatus()` for initial state and `onSyncStatus(updateSyncIcon)` for live updates. Icons are: `idle` → `⬜`, `syncing` → `🔄`, `success` → `✅`, `error` → `❌`. The listener is unsubscribed once on `hashchange`.

The logs toggle uses `Store.isLogsEnabled()` for initial checkbox state and `Store.setLogsEnabled(logsToggle.checked)` on change. Logs default to disabled when no value is stored. The toggle shows either `Logs enabled` or `Logs disabled`.

Manual attendance is admin-gated. Clicking `#attendance-add-btn` opens `showManualAttendanceDialog()`.

Telegram alert testing has two buttons. `sendTelegramTestAlert()` triggers the general Doodle test alert, and `sendTournamentTestAlert()` triggers the tournament-group test alert. Status text is written inline, success/failure toasts are shown, and buttons are disabled while requests are in flight.

PWA installation currently follows native browser behavior. `js/components/install-prompt.js` exports `isInstalled()`, but `settings.js` only imports it and does not currently render an install-status section or call it. Do not add a custom deferred `beforeinstallprompt` flow unless the PWA installation feature doc changes.

PAT-in-URL bootstrap and onboarding are adjacent flows, not settings-page code. `parsePatFromUrl(location.href)` is wired in app initialization before onboarding; when a `pat` query param exists, app init saves the fixed GitHub config and strips the token from the URL. `showOnboardingDialog()` then skips the PAT step when `Store.getGitHubConfig()?.pat` exists and only asks for the player when needed. Settings remains the manual place to view, replace, test, or clear the PAT.

## Key Files & Symbols
- `js/pages/settings.js` — exports `renderSettings(container, params)` plus local helpers `renderMembersList(listEl)`, `updateAvatar(avatarEl)`, `refreshAdminVisibility()`, `refreshUserSelect()`, `setGhStatusMsg()`, `updateSyncIcon()`, `setTgStatus()`, and `refreshTgTestBtn()`.
- `js/store.js` — `Store.getGitHubConfig`, `Store.setGitHubConfig`, `Store.clearGitHubConfig`, `Store.getCurrentUser`, `Store.setCurrentUser`, `Store.isAdministrator`, `Store.isLogsEnabled`, `Store.setLogsEnabled`, `Store.setMembers`.
- `js/services/github.js` — `testConnection`, `onSyncStatus`, `getSyncStatus`, `addPlayerToPlayersJson`; `pushDoodleNow` is imported by `settings.js` but not used there.
- `js/services/members.js` — `getMembers`, `addMember`, `removeMember`; updates Store/Cache and emits `members-changed` via `State`.
- `js/state.js` — simple pub/sub used by member services; not imported directly by `settings.js`.
- `js/services/pat-url.js` — `parsePatFromUrl(href)` and `buildPatUrl(baseUrl, pat)` for shareable PAT bootstrap links.
- `js/components/onboarding-dialog.js` — `showOnboardingDialog()` handles first-run PAT entry and player selection with the same fixed GitHub defaults.
- `js/components/install-prompt.js` — `isInstalled()` detects `display-mode: standalone`; currently unused by Settings rendering.
- `js/version.js` — `APP_VERSION`, `getVersionLabel()`, and `refreshApp()`; used by the Home header, not by Settings.
- `js/app.js` — route table maps `/settings` to `renderSettings`.

## Data
All persistent browser keys use the `mexicano_` localStorage prefix through `Store`.

- `mexicano_github_config` — JSON object `{ owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: '<PAT>', basePath: 'mexicano_v3/backup-data' }`. Stored as-is; the PAT is sensitive.
- `mexicano_current_user` — JSON string with the selected player name, or absent/empty for no selection.
- `mexicano_logs_enabled` — JSON boolean. Missing/null means disabled.
- `mexicano_members` — JSON array of player names, maintained by `Store.setMembers(members)` as a local fallback/warm copy; current reads prefer Cache where available.
- `players.json` in GitHub — array of player objects. Adding a member appends a default object with fields such as `Name`, `ELO`, `PreviousELO`, `Wins`, `Losses`, `TotalPoints`, `Average`, `Tournaments`, `Id`, and `MatchPadelId`.
- `attendance_manual` — managed by the manual attendance dialog, with shape documented in `Store`: `[{ date: 'YYYY-MM-DD', players: ['Name'], note: '' }]`.

`Store.set(key, value)` writes `mexicano_<key>` and schedules a debounced GitHub push when GitHub config is present. `Store.remove(key)` removes the prefixed key.

## Sub-tabs / Sections
There are no sub-tabs; the page is a flat settings page with collapsible or standalone sections:

- Header and identity — current-user avatar/select plus app version refresh button.
- Members — admin-only member list and add/remove controls.
- GitHub connection — fixed owner/repo/basePath, editable PAT, Save/Test/Clear, sync status icon.
- Logs toggle — admin-only `isLogsEnabled` checkbox.
- Attendance — admin-only manual attendance dialog launcher.
- Telegram Alerts — admin-only test buttons for Doodle and tournament-group relay alerts.
- PWA install — no visible section in the current `settings.js`; install behavior is native browser UI only.
- Version/about — represented by the header button showing `getVersionLabel()` and calling `refreshApp()`.

## Related Feature Docs
- `.github/features/onboarding.md` — defines first-run PAT and player setup, using the same fixed GitHub defaults that Settings saves manually.
- `.github/features/pat-url-bootstrap.md` — defines `?pat=` share links and URL cleanup before onboarding; Settings is where users can later test, replace, or clear that saved PAT.
- `.github/features/pwa-installation.md` — defines native install behavior and says Settings should only show install status; current code does not render this section despite importing `isInstalled()`.
- `.github/features/app-version.md` — defines `APP_VERSION` in `sw.js`, `getVersionLabel()`, and the Settings header refresh button behavior.

## Update Protocol
Update this skill whenever js/pages/settings.js config/toggle/install/version logic, data shape, or routing changes, or when the linked feature MDs change.
