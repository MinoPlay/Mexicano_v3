---
name: tab-settings
description: Reference for the Settings route and Supabase/admin/push controls.
---

# Settings tab

## Purpose

`renderSettings()` in `js/pages/settings.js` provides device preferences, player selection, Supabase diagnostics/admin elevation, member management, manual attendance, logs visibility, and notification controls.

## Authorization

- Ordinary access comes from the shared-code onboarding flow.
- Selecting a player only sets attribution.
- `Store.isAdministrator()` reads the active server-derived Supabase grant.
- Admin code calls `elevateAdmin()` and creates a temporary admin grant.
- Members, manual attendance, Logs toggle, Telegram tests, and custom push are admin-only.

No PAT, repository owner, or GitHub write configuration is shown or stored.

## Sections

- Current player selector/avatar.
- Members: add via `backend.addPlayerToPlayersJson()` (legacy name, Supabase operation); local member cache refreshes after success.
- Supabase Backend: project URL/role display, admin-code elevation, connection test, sign-out.
- Device Type: Android/iPhone local preference.
- Enable Logs: local nav-visibility preference; log content is Supabase `audit_events`.
- Attendance: explicit awaited `backend.saveManualAttendance()`.
- Telegram tests: enqueue outbox items.
- Push opt-in: stores subscription in Supabase.
- Custom Push: admin outbox enqueue, optionally targeted by player name.

## Data

Local/device-only:

- `mexicano_current_user`
- `mexicano_current_player_id`
- `mexicano_supabase_config`
- `mexicano_supabase_session`
- `mexicano_access_grant`
- `mexicano_logs_enabled`
- `mexicano_device_type`

Canonical domain writes go through `js/services/backend.js`; `Store.set()` has no network side effect.

## Key files

- `js/pages/settings.js`
- `js/components/manual-attendance-dialog.js`
- `js/services/backend.js`
- `js/services/supabase.js`
- `js/services/telegram.js`
- `js/services/push.js`
- `js/store.js`

Update this skill when settings sections, admin gating, session state, or persistence behavior changes.
