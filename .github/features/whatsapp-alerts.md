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
- localStorage only — never synced to GitHub
- Key `mexicano_whatsapp_phone` → phone number string
- Key `mexicano_whatsapp_apikey` → API key string

## Settings UI
- Section "WhatsApp Alerts" in Settings page
- Visible to all users (not gated by isMino)
- Phone input (text) + API Key input (password)
- Save button → writes both to localStorage
- Clear button → removes both keys
- Alert fires only when both keys are present and non-empty

## Behavior
- Fire-and-forget: failures log to console, never throw
- Silent no-op when phone or apiKey missing
- Only fires on explicit user saves (not background syncs like syncDoodleFromAzure)

## File References
- **Service**: `js/services/whatsapp.js`
- **Trigger**: `js/services/doodle.js` — `saveDoodle()`, `deleteDoodle()`
- **Settings UI**: `js/pages/settings.js`
