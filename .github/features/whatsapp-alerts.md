# WhatsApp Alerts

## Purpose
Notify a WhatsApp number via CallMeBot whenever a doodle entry is saved or deleted.

## Trigger Points
- `saveDoodle()` in `js/services/doodle.js` — fires after `logDoodleChange`, passes `selectedAdded`/`selectedRemoved`
- `deleteDoodle()` in `js/services/doodle.js` — fires after `logDoodleChange`, passes `[]` added and all removed dates

## Message Format
```
🎾 Doodle update — {playerName} ({yearMonth})
✅ Added: {selectedAdded.join(', ') || 'none'}
❌ Removed: {selectedRemoved.join(', ') || 'none'}
```

## CallMeBot API
- URL: `https://api.callmebot.com/whatsapp.php?phone={phone}&text={encoded}&apikey={apikey}`
- Method: GET
- Phone: include country code, e.g. `+4512345678`
- User must activate bot first: https://www.callmebot.com/blog/free-api-whatsapp-messages/

## Config Storage
- GitHub backend `config.json` (same repo as app data)
- Path is derived from configured GitHub base path:
  - If base path is `mexicano_v3/backup-data`, config file is `mexicano_v3/config.json`
- Values read from:
  - `whatsapp_alerts.phone_number`
  - `whatsapp_alerts.api_key`

## Settings UI
- Section "WhatsApp Alerts" in Settings page
- Visible to all users (not gated by isMino)
- Phone input (text, read-only) + API Key input (password, read-only)
- Reload button → re-fetches config from GitHub
- Shows explicit error when config values are missing or config read fails
- Alert fires only when both values are present and non-empty

## Behavior
- Fire-and-forget: failures log to console, never throw
- Silent no-op when phone or apiKey missing
- Silent no-op when both `selectedAdded` and `selectedRemoved` are empty
- Only fires on explicit user saves (not background syncs like syncDoodleFromAzure)
- Alerts are serialized client-side (single queue) to preserve commit/change order
- Alerts enforce minimum send gap (6.5s) to avoid CallMeBot batching multiple changes into one WhatsApp message

## File References
- **Service**: `js/services/whatsapp.js`
- **Trigger**: `js/services/doodle.js` — `saveDoodle()`, `deleteDoodle()`
- **Settings UI**: `js/pages/settings.js`
