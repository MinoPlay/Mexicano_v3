# Telegram Alerts

## Purpose
Notify a Telegram group via the Telegram Bot API whenever a doodle entry is saved/deleted,
when a player confirms tournament attendance, or when a manual test is triggered.

## Trigger Points
- `DoodleEditSession.save()` in `js/pages/doodle.js` — fires only after `await pushDoodleNow(yearMonth)` commits `doodle_changelog_YYYY-MM.json`
- Tournament confirmation popup in `js/pages/home.js` — fires when a player confirms attendance
- Alert payload is built from the changelog entries returned by `saveDoodle()` in `js/services/doodle.js`

## Message Format
```
🎾 Doodle update — {playerName} ({yearMonth})
✅ Added: {selectedAdded.join(', ') || 'none'}
❌ Removed: {selectedRemoved.join(', ') || 'none'}
```
Confirmation:
```
🎾 {playerName} confirmed attendance for tournament on {tournamentDate}
```
Test:
```
📞 Mexicano test alert
User: {currentUser}
Time: {ISO timestamp}
```

## Telegram Bot API
- URL: `https://api.telegram.org/bot{bot_token}/sendMessage?chat_id={chat_id}&text={encoded}`
- Method: GET
- Bot created via @BotFather; bot must be a member of the target group
- `chat_id` is the group id (negative, e.g. `-5375683887`; supergroups use `-100...`)

## Config Storage
- GitHub backend `config.json` (same repo as app data)
- Path is derived from configured GitHub base path:
  - If base path is `mexicano_v3/backup-data`, config file is `mexicano_v3/config.json`
- Values read from:
  - `telegram_alerts.bot_token`
  - `telegram_alerts.chat_id`

## Settings UI
- Section "Telegram Alerts" in Settings page
- Visible to all users (not gated by isMino)
- Reload happens via `getTelegramConfig()` on render
- Test button with call icon (`📞 Send Test Alert`) sends a manual Telegram test message
- Shows explicit error when config values are missing or config read fails
- Alert fires only when both `bot_token` and `chat_id` are present and non-empty

## Behavior
- Fire-and-forget: failures log to console, never throw
- Console logs when config load starts/ends, when queueing alerts, and when dispatching requests
- Logs explicit skip reason when bot_token/chat_id missing
- Logs explicit skip reason when both `selectedAdded` and `selectedRemoved` are empty
- Only fires on explicit user saves
- Trigger happens post-commit: alerts start only after GitHub write of monthly doodle + changelog succeeds
- Alerts are serialized client-side (single queue) to preserve commit/change order
- Alerts enforce a minimum send gap (1.1s) to respect Telegram per-chat rate limits
- Dispatch uses `fetch(..., { mode: 'no-cors' })`, so browser logs request dispatch but cannot confirm delivery response
- Test alert forces a fresh config fetch before send and reports missing config as UI error

## File References
- **Service**: `js/services/telegram.js`
- **Trigger**: `js/pages/doodle.js` — `DoodleEditSession.save()`; `js/pages/home.js` — confirmation popup
- **Changelog source**: `js/services/doodle.js` — `saveDoodle()`, `logDoodleChange()`
- **Settings UI**: `js/pages/settings.js`
