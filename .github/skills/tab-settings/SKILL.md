---
name: tab-settings
description: Reference for the Settings route and Supabase/admin/member/attendance/Telegram/push controls.
---

# Settings tab

## Purpose
`renderSettings(container, params)` in `js/pages/settings.js` provides current-player selection, admin elevation, member management, manual attendance, Logs visibility, Telegram tests, push opt-in, and custom push controls.

The desktop page uses `.settings-desktop` for a two-column settings layout. The old Device Type UI section is removed from Settings, although the store API/key remains for tests and compatibility.

## Authorization
- Ordinary access comes from the shared-code/Supabase session flow.
- Selecting a player only sets local attribution.
- `Store.isAdministrator()` reads the active Supabase grant.
- Admin code calls `elevateAdmin()` and creates a temporary admin grant.
- Members, manual attendance, Logs toggle, Telegram tests, and custom push are admin-only through `refreshAdminVisibility()`.
- No PAT, repository owner, or GitHub write configuration is shown or stored.

## Rules / Logic
- Header contains the Settings title and current-user selector/avatar.
- `renderMembersList(listEl)` renders members from `getMembers()`.
- Current user changes call `Store.setCurrentUser(userSelect.value)`, update avatar, refresh admin visibility, and toast.
- Member add validates non-empty, 1-50 chars, and no duplicate case-insensitively, then calls `addPlayerToPlayersJson(name)` and local `addMember(name)`.
- Member delete calls local `removeMember(name)` after confirm.
- Supabase Backend section shows disabled project URL and access role, admin-code input, Unlock admin, Test, and Sign out.
- Sync icon subscribes to `onSyncStatus(updateSyncIcon)` and cleans up on next hashchange.
- Logs toggle writes `Store.setLogsEnabled(logsToggle.checked)`.
- Manual Attendance opens `showManualAttendanceDialog()`.
- Telegram buttons call `sendTelegramTestAlert()` and `sendTournamentTestAlert()`.
- Push opt-in checks `isPushSupported()` and calls `subscribeToPush()`.
- Custom Push can target all devices or one member and calls `sendPushNotification(title || 'Mexicano', body, './', users)`.

## Sections
- Current player selector/avatar in the page header.
- Members — admin-only list, add form, and delete buttons.
- Supabase Backend — project URL/role display, admin-code elevation, connection test, sign-out, and sync status icon.
- Enable Logs — admin-only local nav-visibility preference for the Logs route.
- Attendance — admin-only manual no-tournament attendance dialog entry point.
- Telegram Alerts — admin-only test alert buttons.
- Push Notifications — device push opt-in.
- Send Custom Push — admin-only all-devices or single-member push sender.

## Data
Local/device or session keys used directly or through Store include:

- `mexicano_current_user`
- `mexicano_current_player_id`
- `mexicano_supabase_config`
- `mexicano_supabase_session`
- `mexicano_access_grant`
- `mexicano_logs_enabled`
- `mexicano_device_type` — kept in Store for tests/compatibility, not rendered as a Settings section.

Canonical domain writes go through `js/services/backend.js`; `Store.set()` has no network side effect.

## Key Files & Symbols
- `js/pages/settings.js` — exports `renderSettings`; local helpers `renderMembersList`, `updateAvatar`, `refreshAdminVisibility`, `refreshUserSelect`, and status setters.
- `js/components/manual-attendance-dialog.js` — `showManualAttendanceDialog`.
- `js/services/backend.js` — `testConnection`, `onSyncStatus`, `getSyncStatus`, and `addPlayerToPlayersJson`.
- `js/services/supabase.js` — `elevateAdmin`.
- `js/services/members.js` — `getMembers`, `addMember`, and `removeMember`.
- `js/services/telegram.js` — `sendTelegramTestAlert` and `sendTournamentTestAlert`.
- `js/services/push.js` — `isPushSupported`, `subscribeToPush`, and `sendPushNotification`.
- `js/components/install-prompt.js` — `isInstalled` is imported but not used by current Settings render logic.
- `js/store.js` — user/session/admin/logs state.
- `js/app.js` — registers `/settings`.
- `css/desktop.css` — `settings-desktop` two-column layout.

## Sub-tabs / Sections
There are no sub-tabs. Settings is a set of sections described above, with several details/collapsible controls inside sections.

## Related Feature Docs
- `.github/features/add-member.md` — member creation behavior.
- `.github/features/manual-attendance.md` — manual attendance flow launched from Settings.
- `.github/features/telegram-alerts.md` — Telegram test alert relay behavior.
- `.github/features/desktop-ui.md` — two-column Settings layout and removal of Device Type UI.

## Update Protocol
Update this skill whenever `js/pages/settings.js` sections, admin gating, session state, manual attendance, Telegram/push controls, persistence behavior, or desktop layout changes, or when the linked feature MDs change.
