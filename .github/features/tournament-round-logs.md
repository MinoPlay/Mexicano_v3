# Tournament Round Logs

## Purpose
Show round-by-round results during active tournaments. Each entry captures match scores and player standings at the moment a round completes. Useful for reviewing how tournament progressed.

## Storage
- Stored in `localStorage` key: `mexicano_round_log`
- Max entries: 200 (oldest auto-evicted)
- **Not** pushed to GitHub — local only

## Log Entry Shape
```json
{
  "ts": "2026-05-19T21:00:00.000Z",
  "tournamentDate": "2026-05-19",
  "roundNumber": 2,
  "matches": [
    { "team1": ["Alice", "Bob"], "team2": ["Carol", "Dave"], "score1": 14, "score2": 11 }
  ]
}
```

### Fields
| Field | Description |
|-------|-------------|
| `ts` | ISO timestamp when round completed |
| `tournamentDate` | Tournament date (yyyy-MM-dd) |
| `roundNumber` | Which round just finished (1, 2, or 3) |
| `matches` | Array of match results for that round |

## When Logged
- When `startNextRound()` fires (logs the just-completed round)
- When `completeTournament()` fires (logs the final round)
- When a completion step **fails** (`logError`) — e.g. the fire-and-forget GitHub
  push after finishing a tournament, or the Telegram alert dispatch. These are the
  silent, often mobile-only failures where the tournament looks finished locally but
  never reached GitHub. Error entries are captured for any admin **even when the Logs
  toggle is off**, so they can be reviewed by enabling the tab afterwards.

## Error Entry Shape
```json
{
  "ts": "2026-08-11T07:00:00.000Z",
  "type": "error",
  "context": "post-complete GitHub push",
  "message": "Error: HTTP 409 ..."
}
```
Rendered newest-first with a red left border and ⚠️ header (`context — timestamp`).

## UI — `/logs` page
- Bottom nav tab: 📝 Logs
- Shows entries newest-first
- Each entry: one header line (`2026-05-19 Round 1`) + one line per match (`Player1 & Player2 13 – 12 Player3 & Player4`)
- "🗑 Clear" button in header removes all entries from localStorage

## Access Control
- Logs tab (nav + writes) only active when `Store.isAdministrator()` returns `true`
- Non-admin users: tab hidden, no entries written

```js
import { getRoundLog, clearRoundLog } from './services/round-log.js';

getRoundLog();    // returns array of entries, most recent first
clearRoundLog();  // removes mexicano_round_log from localStorage
```
