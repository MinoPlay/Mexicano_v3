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

## UI
- No dedicated page. The Logs bottom-nav tab was removed.
- Round results are still written to `localStorage` (see below) for potential future use.

```js
import { getRoundLog, clearRoundLog } from './services/round-log.js';

getRoundLog();    // returns array of entries, most recent first
clearRoundLog();  // removes mexicano_round_log from localStorage
```
