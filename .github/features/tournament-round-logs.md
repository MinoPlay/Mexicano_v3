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
  ],
  "standings": [
    { "name": "Alice", "totalPoints": 27, "wins": 2, "gamesPlayed": 2 }
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
| `standings` | Player standings snapshot (sorted by rank) |

## When Logged
- When `startNextRound()` fires (logs the just-completed round)
- When `completeTournament()` fires (logs the final round)

## UI — `/logs` page
- Bottom nav tab: 📝 Logs
- Shows entries newest-first
- Each entry: round card with match scores + standings table
- "🗑 Clear" button in header removes all entries from localStorage

## Access Control
- Logs tab (nav + writes) only active when `Store.isMino()` returns `true`
- Non-admin users: tab hidden, no entries written

```js
import { getRoundLog, clearRoundLog } from './services/round-log.js';

getRoundLog();    // returns array of entries, most recent first
clearRoundLog();  // removes mexicano_round_log from localStorage
```
